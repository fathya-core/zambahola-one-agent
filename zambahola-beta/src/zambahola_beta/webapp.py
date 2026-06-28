"""ZAMBAHOLA BETA Console — one local web UI for everything (no commands).

Run it (start.ps1 or `python -m zambahola_beta.webapp`) and a browser dashboard
opens. It shows the current trend signal per asset, your account/equity (if keys
are configured), a one-click rebalance (testnet + dry-run by default), an
auto-mode that checks/executes on a schedule, and a strategy comparison — all
visual, no CLI.

Safety is unchanged: execution defaults to testnet; live needs the keys plus env
ZAMBAHOLA_I_ACCEPT_REAL_TRADING=RISK; keys are loaded from outside the repo and
never shown (only masked).
"""

from __future__ import annotations

import json
import os
import threading
import time
import webbrowser
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .data import fetch_many
from .executor import (
    SELL_MARGIN,
    BinanceSpot,
    RiskLimits,
    load_keys,
    plan_rebalance,
    safety_gate,
)
from .ledger import append_trade, load_ledger, load_trades, reset_ledger, save_ledger
from .strategy import compare_portfolios, current_allocation


def _perf_path() -> Path:
    return Path(os.environ.get("ZAMBAHOLA_DATA_DIR", "data")) / "equity_history.json"


def _load_equity_history() -> list:
    try:
        data = json.loads(_perf_path().read_text("utf-8"))
        return data if isinstance(data, list) else []
    except Exception:  # noqa: BLE001
        return []


def _save_equity_history(hist: list) -> None:
    try:
        p = _perf_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(hist), "utf-8")
    except Exception:  # noqa: BLE001
        pass


def _config_path() -> Path:
    return Path(os.environ.get("ZAMBAHOLA_DATA_DIR", "data")) / "config.json"


def _auto_path() -> Path:
    return Path(os.environ.get("ZAMBAHOLA_DATA_DIR", "data")) / "auto.json"


def _save_auto(state: AppState) -> None:
    try:
        p = _auto_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({
            "auto_enabled": state.auto_enabled,
            "auto_execute": state.auto_execute,
            "auto_interval_hours": state.auto_interval_hours,
            "pnl_peak_usd": state.pnl_peak_usd,
            "port_tp_cooldown_until": state.port_tp_cooldown_until,
            "sell_ban_until": state.sell_ban_until,
        }), "utf-8")
    except Exception:  # noqa: BLE001
        pass


def _load_auto(state: AppState) -> None:
    try:
        d = json.loads(_auto_path().read_text("utf-8"))
        state.auto_enabled = bool(d.get("auto_enabled", state.auto_enabled))
        state.auto_execute = bool(d.get("auto_execute", state.auto_execute))
        state.auto_interval_hours = float(d.get("auto_interval_hours", state.auto_interval_hours))
        state.pnl_peak_usd = float(d.get("pnl_peak_usd", state.pnl_peak_usd))
        state.port_tp_cooldown_until = float(d.get("port_tp_cooldown_until", state.port_tp_cooldown_until))
        raw = d.get("sell_ban_until")
        if isinstance(raw, dict):
            state.sell_ban_until = {str(k): float(v) for k, v in raw.items()}
    except Exception:  # noqa: BLE001
        pass


_PERSIST_FIELDS = (
    "mode", "interval", "max_total", "universe_size", "top_n", "max_order_usd", "max_total_usd",
    "rebalance_band", "take_profit_pct", "take_profit_frac", "breaker_pct", "max_correlation",
    "stop_pct", "conviction_power", "vol_power", "cap_vol_ref", "target_vol", "profit_lock_arm", "profit_lock_giveback",
    "min_hold_hours", "hard_stop_pct",
    "port_tp_arm_usd", "port_tp_giveback", "port_tp_sell_frac", "port_tp_cooldown_h",
    "max_weight", "reentry_ban_hours", "stop_cooldown_hours",
)


def _save_config(cfg: AppConfig) -> None:
    try:
        p = _config_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({k: getattr(cfg, k) for k in _PERSIST_FIELDS}), "utf-8")
    except Exception:  # noqa: BLE001
        pass


def _load_config(cfg: AppConfig) -> None:
    """Restore persisted settings (never `live` — always start on safe testnet)."""
    try:
        data = json.loads(_config_path().read_text("utf-8"))
    except Exception:  # noqa: BLE001
        return
    for k in _PERSIST_FIELDS:
        if k in data:
            try:
                setattr(cfg, k, type(getattr(cfg, k))(data[k]))
            except Exception:  # noqa: BLE001
                pass


def compute_pnl(hist: list) -> dict | None:
    """Account value over time -> return since baseline (the actual performance)."""
    pts = [h for h in hist if isinstance(h, dict) and "eq" in h]
    if not pts:
        return None
    start = float(pts[0]["eq"]) or 1.0
    cur = float(pts[-1]["eq"])
    peak = max(float(p["eq"]) for p in pts)
    return {
        "start": round(float(pts[0]["eq"]), 2),
        "current": round(cur, 2),
        "pnl_usd": round(cur - float(pts[0]["eq"]), 2),
        "pnl_pct": round((cur / start - 1.0) * 100, 2),
        "drawdown_pct": round((cur / peak - 1.0) * 100, 2) if peak else 0.0,
        "points": [round(float(p["eq"]), 2) for p in pts[-80:]],
        "since": pts[0].get("t", ""),
        "n": len(pts),
    }

DASHBOARD_HTML = """<!doctype html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZAMBAHOLA BETA</title>
<style>
:root{--bg:#0b0e14;--card:#151a23;--mut:#8b97a7;--up:#16c784;--down:#ea3943;--warn:#f0b90b;--acc:#3b82f6}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,Segoe UI,Tahoma,Arial;background:var(--bg);color:#e6edf3}
.wrap{max-width:1000px;margin:0 auto;padding:18px}
h1{font-size:20px;margin:0}.sub{color:var(--mut);font-size:13px}
.row{display:flex;gap:14px;flex-wrap:wrap}.row>*{flex:1;min-width:240px}
.card{background:var(--card);border:1px solid #222c3a;border-radius:14px;padding:16px;margin-top:14px}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700}
.b-up{background:rgba(22,199,132,.15);color:var(--up)}.b-down{background:rgba(234,57,67,.15);color:var(--down)}
.b-warn{background:rgba(240,185,11,.15);color:var(--warn)}.b-mut{background:#222c3a;color:var(--mut)}
.bar{height:8px;background:#222c3a;border-radius:6px;overflow:hidden;margin-top:6px}
.bar>i{display:block;height:100%;background:var(--acc)}
.big{font-size:26px;font-weight:800}.k{color:var(--mut);font-size:12px}
button{background:var(--acc);color:#fff;border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer}
button.sec{background:#222c3a;color:#e6edf3}button:disabled{opacity:.5;cursor:not-allowed}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:7px 8px;text-align:right;border-bottom:1px solid #222c3a}
.log{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--mut);max-height:200px;overflow:auto;white-space:pre-wrap}
.flex{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.sw{margin-inline-start:auto}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block}.on{background:var(--up)}.off{background:var(--mut)}
small{color:var(--mut)}
</style></head><body><div class="wrap">
<div class="flex"><div><h1>ZAMBAHOLA BETA — لوحة التحكّم</h1>
<div class="sub" id="sub">جارٍ التحميل…</div></div>
<div class="sw flex"><span class="dot off" id="autodot"></span><span id="autotxt">تلقائي: متوقف</span></div></div>

<div id="halt" class="card" style="display:none;border-color:var(--down);background:rgba(234,57,67,.12)">
<div class="flex"><b style="color:var(--down)">⛔ قاطع الدائرة فعّال — التداول متوقف (تصفية لنقد)</b>
<button id="resume" class="sw" style="background:var(--down)">▶ استئناف</button></div>
<div class="k" id="halttxt" style="margin-top:6px"></div></div>

<div class="card"><div class="flex">
<button id="check">🔄 افحص السوق الآن</button>
<button id="exec" class="sec">⚡ نفّذ (testnet)</button>
<button id="auto" class="sec">🤖 تداول تلقائي</button>
<button id="flatten" class="sw" style="background:var(--down)">🛑 تصفية الكل لنقد</button>
<button id="cleanstart" class="sec" style="background:#7c5cff">♻️ بداية نظيفة (USDT)</button>
</div>
<div class="flex" style="margin-top:6px"><small id="mode"></small></div>
<div class="flex" style="margin-top:8px">
 <label class="flex" style="gap:6px"><input type="checkbox" id="autoexec"> ينفّذ تلقائياً (مو فحص فقط)</label>
 <span class="flex" style="gap:6px"><small>كل</small><input id="autoiv" type="number" step="0.1" min="0.1" style="width:70px"><small>ساعة</small></span>
 <small class="sw" id="autostate"></small>
</div></div>

<div class="card"><div class="flex"><b>الإعدادات</b><span class="sw"><small id="cfgnote"></small></span></div>
<div class="row" style="margin-top:8px">
 <div><div class="k">الوضع الحقيقي (Live)</div>
  <div class="flex"><button id="live" class="sec">⚪ testnet (آمن)</button>
  <small id="livewarn" style="color:var(--warn)"></small></div></div>
 <div><div class="k">التعرّض / الرافعة</div>
  <div class="flex" id="lev">
   <button class="sec lv" data-v="0.5">محافظ 0.5x</button>
   <button class="sec lv" data-v="1">كامل 1x</button>
   <button class="sec lv" data-v="2">رافعة 2x ⚠</button>
   <button class="sec lv" data-v="3">رافعة 3x ⚠</button>
  </div><small id="levnote" style="color:var(--mut)"></small></div>
</div>
<div style="margin-top:8px"><div class="k">الإطار الزمني (أسرع = أنشط)</div>
 <div class="flex" id="tf">
  <button class="sec tfb" data-v="1d">يومي</button>
  <button class="sec tfb" data-v="12h">12س</button>
  <button class="sec tfb" data-v="8h">8س</button>
  <button class="sec tfb" data-v="4h">4س ⚡</button>
 </div><small id="tfnote" style="color:var(--mut)"></small></div>
<div class="row" style="margin-top:6px">
 <div><div class="k">عدد العملات الممسوحة</div><input id="uni" type="number" min="5" max="60" style="width:90px"></div>
 <div><div class="k">عدد المراكز (أقوى ترند)</div><input id="topn" type="number" min="1" max="15" style="width:90px"></div>
 <div><div class="k">حد الأمر $</div><input id="ord" type="number" min="0" style="width:90px"></div>
 <div><div class="k">حد الإجمالي $</div><input id="tot" type="number" min="0" style="width:90px"></div>
 <div style="display:flex;align-items:flex-end"><button id="save">💾 حفظ وإعادة فحص</button></div>
</div></div>

<div class="card"><div class="flex"><b>🔭 مسح السوق — أقوى الاتجاهات</b><span class="sw"><small id="scanned"></small></span></div>
<div id="market" class="sub" style="margin-top:8px">جارٍ مسح السوق…</div></div>

<div id="assets" class="row"></div>

<div class="card"><div class="flex"><b>الحساب</b><span class="sw" id="acctstatus"></span></div>
<div class="big" id="equity">—</div><div class="k">إجمالي القيمة (USDT)</div>
<div id="balances" class="sub" style="margin-top:8px"></div></div>

<div class="card"><div class="flex"><b>📈 الأداء الفعلي (PnL)</b>
<button id="perfreset" class="sec sw" style="padding:5px 12px;font-size:12px">صفّر البداية</button></div>
<div class="row" style="margin-top:8px;align-items:center">
 <div style="min-width:120px"><div class="big" id="pnlpct">—</div><div class="k">العائد منذ البداية</div></div>
 <div style="min-width:120px"><div class="big" id="pnlusd">—</div><div class="k">ربح/خسارة (USDT)</div></div>
 <div style="flex:2"><canvas id="spark" width="420" height="56" style="width:100%;max-width:480px"></canvas>
  <div class="k" id="pnlmeta"></div></div>
</div></div>

<div class="card"><div class="flex"><b>🧾 سجل الصفقات والأرباح المحقّقة</b>
<button id="ledgerreset" class="sec sw" style="padding:5px 12px;font-size:12px">صفّر السجل</button></div>
<div class="row" style="margin-top:8px">
 <div style="min-width:140px"><div class="big" id="stratpnl">—</div><div class="k">ربح الاستراتيجية (محقّق+مفتوح · % على الميزانية)</div></div>
 <div style="min-width:130px"><div class="big" id="winrate">—</div><div class="k">نسبة الفوز</div></div>
 <div style="min-width:150px"><div class="k">محقّق: <span id="realized">—</span> · مفتوح: <span id="unreal">—</span></div>
  <div class="k">مستثمَر: $<span id="invested">0</span> · مغلقة: <span id="closed">0</span> (ربح <span id="wins">0</span>/خسارة <span id="losses">0</span>)</div></div>
</div>
<div id="tradetbl" class="sub" style="margin-top:8px"></div></div>

<div class="card"><div class="flex"><b>🧪 باك-تست الاستراتيجية الفعلية (مسح + Regime + وقف خسارة)</b>
<span class="sw flex"><button id="bt" class="sec" style="padding:5px 12px;font-size:12px">حديث (~٧ أشهر)</button>
<button id="btlong" class="sec" style="padding:5px 12px;font-size:12px">سنوات (دورة كاملة)</button></span></div>
<div id="btres" class="sub" style="margin-top:8px">اضغط لتشغيل محاكاة تاريخية حقيقية لمنطق الوكيل الكامل.</div></div>

<div class="card"><b>مقارنة الاستراتيجيات (سلّة مرجعية)</b><div id="pf" class="sub">اضغط "افحص الآن" لتحميلها…</div></div>

<div class="card"><b>سجل الإجراءات</b><div class="log" id="log"></div></div>
<div class="sub" style="margin-top:10px">لا يوجد ربح مضمون. التنفيذ على testnet افتراضياً؛ الحقيقي يتطلّب تأكيداً صريحاً. الإشارة قد تكون "نقد" لتجنّب الهبوط.</div>
</div>
<script>
const $=id=>document.getElementById(id);
function actionBadge(a){if(a&&a.includes("INVEST"))return'<span class="badge b-up">استثمر</span>';
if(a&&a.includes("PARTIAL"))return'<span class="badge b-warn">جزئي</span>';return'<span class="badge b-mut">نقد</span>';}
async function api(path,method="GET",body){const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return r.json();}
let LIVE=false,AUTO=false;
function setIf(id,v){const e=$(id);if(e&&document.activeElement!==e&&v!=null)e.value=v;}
function render(s){
 LIVE=!!s.live;AUTO=!!s.auto_enabled;
 $("sub").textContent="آخر تحديث: "+(s.updated||"—")+" · بيانات حتى "+(s.signal?.as_of||"—");
 $("mode").textContent="الوضع: "+(s.live?"حقيقي ⚠":"testnet")+" · أوامر حتى $"+s.max_order_usd+" / إجمالي $"+s.max_total_usd;
 $("autodot").className="dot "+(s.auto_enabled?"on":"off");
 $("autotxt").textContent="تلقائي: "+(s.auto_enabled?("يعمل كل "+s.auto_interval_hours+"س"+(s.auto_execute?" + تنفيذ":" (فحص فقط)")):"متوقف");
 $("auto").textContent=s.auto_enabled?"⏸ أوقف التلقائي":"🤖 تداول تلقائي";
 if(document.activeElement!==$("autoexec"))$("autoexec").checked=!!s.auto_execute;
 setIf("autoiv",s.auto_interval_hours);
 $("autostate").textContent=s.auto_enabled?("▶ يعمل: "+(s.auto_execute?"يتداول":"يفحص")+" كل "+s.auto_interval_hours+"س"):"متوقف";
 // settings
 $("live").textContent=s.live?"🔴 حقيقي (Live)":"⚪ testnet (آمن)";
 $("live").className=s.live?"":"sec";
 $("livewarn").textContent=s.live?"تداول بأموال حقيقية — يتطلّب ZAMBAHOLA_I_ACCEPT_REAL_TRADING=RISK":"";
 document.querySelectorAll(".lv").forEach(b=>b.className=(parseFloat(b.dataset.v)===s.max_total)?"lv":"sec lv");
 document.querySelectorAll(".tfb").forEach(b=>b.className=(b.dataset.v===s.interval)?"tfb":"sec tfb");
 $("tfnote").textContent="الإطار الحالي: "+(s.interval||"1d")+(s.interval&&s.interval!=="1d"?" — أسرع، صفقات أكثر ورسوم أكثر":" — موصى به (مُثبت)");
 $("levnote").textContent=(s.max_total>1)?"⚠ الرافعة >1 تتطلّب حساب فيوتشرز — على spot يُنفَّذ 1x كحد أقصى":"تعرّض على spot (بدون رافعة)";
 setIf("uni",s.universe_size);setIf("topn",s.top_n);setIf("ord",s.max_order_usd);setIf("tot",s.max_total_usd);
 {let sc=s.scanned!=null?("مُسح "+s.scanned+" عملة"):"";if(s.regime!=null){const rp=Math.round(s.regime*100);sc+=" · وضع السوق: "+rp+"% "+(rp>=80?"🟢":(rp>=55?"🟡":"🔴 خطر"));}$("scanned").textContent=sc;}
 // market scan table (smart score = risk-adjusted momentum + acceleration + relative strength)
 const ranked=s.ranked||s.signal?.ranked;
 if(ranked&&ranked.length){let h='<table><tr><th>#</th><th>العملة</th><th>السعر</th><th>قوة الترند</th><th>زخم 90ي</th><th>عائد/مخاطرة</th><th>الوزن</th><th>الحالة</th></tr>';
  ranked.forEach((r,i)=>{const inv=r.action==="INVEST";h+=`<tr><td>${i+1}</td><td><b>${r.symbol}</b></td><td>${r.price}</td>
   <td>${Math.round((r.trend_consensus||0)*100)}%</td><td style="color:${r.momentum>=0?'var(--up)':'var(--down)'}">${(r.momentum*100).toFixed(1)}%</td>
   <td style="color:${(r.risk_adj||0)>=0?'var(--up)':'var(--down)'}">${(r.risk_adj!=null?r.risk_adj.toFixed(2):'—')}</td>
   <td>${Math.round((r.target_weight||0)*100)}%</td><td>${inv?'<span class="badge b-up">استثمر</span>':(r.action==="STOP"?'<span class="badge b-down">وقف خسارة</span>':(r.action==="UPTREND"?'<span class="badge b-warn">صاعد</span>':'<span class="badge b-mut">—</span>'))}</td></tr>`;});
  $("market").innerHTML=h+'</table>';}
 else $("market").textContent="السوق كله هابط الآن — البقاء نقداً هو القرار الصحيح (حماية من الخسارة).";
 const a=$("assets");a.innerHTML="";
 const rs=s.signal?s.signal.reasons:{};
 for(const sym in rs){const r=rs[sym];if((r.target_weight||0)<=0)continue;const pct=Math.round((r.trend_consensus||0)*100);
  a.innerHTML+=`<div class="card"><div class="flex"><b>${sym}</b><span class="sw">${actionBadge(r.action)}</span></div>
  <div class="big">${r.price}</div><div class="k">السعر</div>
  <div style="margin-top:8px">قوة الترند: ${pct}%<div class="bar"><i style="width:${pct}%"></i></div></div>
  <div class="k" style="margin-top:8px">الوزن الهدف: ${Math.round((r.target_weight||0)*100)}% · تقلّب: ${Math.round((r.realized_vol_ann||0)*100)}%</div></div>`;}
 if(s.cash_weight!=null&&s.cash_weight>0.001)a.innerHTML+=`<div class="card"><div class="flex"><b>نقد</b><span class="sw badge b-mut">${Math.round(s.cash_weight*100)}%</span></div><div class="k" style="margin-top:8px">غير مستثمر — حماية من الهبوط</div></div>`;
 $("acctstatus").innerHTML=s.account?.connected?'<span class="badge b-up">متصل</span>':'<span class="badge b-mut">غير متصل (أضف المفاتيح)</span>';
 $("equity").textContent=s.account?.equity_usd!=null?("$"+s.account.equity_usd):"—";
 if(s.account?.balances){let bt=Object.entries(s.account.balances).map(([k,v])=>k+": "+v).join("  ·  ");const hc=s.account.holdings_count||0,sh=Object.keys(s.account.balances).length-1;if(hc>sh)bt+="   (+"+(hc-sh)+" أخرى)";$("balances").textContent=bt;$("balances").style.color="";}else{$("balances").textContent=s.account?.error||"";$("balances").style.color=s.account?.error?"var(--warn)":"";}
 $("exec").disabled=!s.account?.connected;$("exec").textContent=s.live?"⚡ نفّذ (حقيقي ⚠)":"⚡ نفّذ (testnet)";
 renderPnl(s.pnl);
 // circuit breaker banner
 $("halt").style.display=s.halted?"":"none";
 if(s.halted)$("halttxt").textContent="هبط رأس المال "+(s.drawdown_pct!=null?s.drawdown_pct.toFixed(1):"?")+"% عن القمّة (الحد "+s.breaker_pct+"%). اضغط استئناف للعودة.";
 // trade ledger
 const lg=s.ledger||{};
 const sp=(lg.strategy_pnl!=null)?lg.strategy_pnl:lg.realized_pnl;
 if(sp!=null){const up=sp>=0;$("stratpnl").textContent=(up?'+':'')+'$'+sp+(lg.strategy_pnl_pct!=null?' ('+(lg.strategy_pnl_pct>=0?'+':'')+lg.strategy_pnl_pct+'%)':'');$("stratpnl").style.color=up?'var(--up)':'var(--down)';}
 $("realized").textContent=lg.realized_pnl!=null?('$'+lg.realized_pnl):'—';
 $("unreal").textContent=lg.unrealized_pnl!=null?('$'+lg.unrealized_pnl):'—';
 $("invested").textContent=lg.invested!=null?lg.invested:0;
 $("winrate").textContent=lg.win_rate!=null?lg.win_rate+'%':'—';
 $("closed").textContent=lg.trades_closed||0;$("wins").textContent=lg.wins||0;$("losses").textContent=lg.losses||0;
 const tr=s.trades||[];
 if(tr.length){let h='<table><tr><th>الوقت</th><th>النوع</th><th>العملة</th><th>$</th><th>ربح</th><th>السبب</th></tr>';
  tr.slice().reverse().forEach(t=>{const sell=t.side==='SELL';const rp=t.realized||0;h+=`<tr><td>${(t.t||'').slice(5,16)}</td><td>${sell?'بيع':'شراء'}</td><td><b>${t.symbol}</b></td><td>${t.usd}</td><td style="color:${rp>0?'var(--up)':(rp<0?'var(--down)':'var(--mut)')}">${rp?((rp>0?'+':'')+'$'+rp):'—'}</td><td class="k">${t.why||''}</td></tr>`;});
  $("tradetbl").innerHTML=h+'</table>';}else $("tradetbl").textContent="لا صفقات بعد.";
 renderBacktest(s.backtest);
 if(s.portfolio&&s.portfolio.length){let h='<table><tr><th>استراتيجية</th><th>عائد</th><th>CAGR</th><th>Sharpe</th><th>أقصى تراجع</th></tr>';
  for(const r of s.portfolio)h+=`<tr><td>${r.strategy}</td><td>${(r.total_return*100).toFixed(0)}%</td><td>${(r.cagr*100).toFixed(0)}%</td><td>${r.sharpe}</td><td>${(r.max_drawdown*100).toFixed(0)}%</td></tr>`;
  $("pf").innerHTML=h+'</table>';}
 $("log").textContent=(s.actions||[]).slice().reverse().join("\\n");
}
function renderPnl(p){
 if(!p){$("pnlpct").textContent="—";$("pnlusd").textContent="—";$("pnlmeta").textContent="بانتظار أول قراءة للحساب…";return;}
 const up=p.pnl_usd>=0,col=up?'var(--up)':'var(--down)';
 $("pnlpct").textContent=(up?'+':'')+p.pnl_pct+'%';$("pnlpct").style.color=col;
 $("pnlusd").textContent=(up?'+':'')+'$'+p.pnl_usd;$("pnlusd").style.color=col;
 $("pnlmeta").textContent='من $'+p.start+' إلى $'+p.current+' · '+p.n+' قراءة · أقصى تراجع '+p.drawdown_pct+'%';
 const c=$("spark"),x=c.getContext('2d'),W=c.width,H=c.height,d=p.points||[];x.clearRect(0,0,W,H);
 if(d.length>1){const mn=Math.min(...d),mx=Math.max(...d),rg=(mx-mn)||1;
  x.beginPath();x.lineWidth=2;x.strokeStyle=col;
  d.forEach((v,i)=>{const px=i/(d.length-1)*(W-4)+2,py=H-4-((v-mn)/rg)*(H-8);i?x.lineTo(px,py):x.moveTo(px,py);});x.stroke();
  x.globalAlpha=0.12;x.lineTo(W-2,H);x.lineTo(2,H);x.closePath();x.fillStyle=col;x.fill();x.globalAlpha=1;}
}
function renderBacktest(b){
 if(!b)return;
 if(!b.ok){$("btres").textContent="تعذّر: "+(b.error||"");return;}
 const up=b.total_return>=0,bup=(b.btc_hodl_return||0)>=0;
 $("btres").innerHTML=`<table>
 <tr><td>النطاق</td><td>${b.scope==='years'?'دورة كاملة (سنوات)':'حديث'}</td></tr>
 <tr><td>الفترة</td><td>${(b.start||'').slice(0,10)} → ${(b.end||'').slice(0,10)} (${b.days} يوم · ${b.coins} عملة)</td></tr>
 <tr><td>عائد الاستراتيجية</td><td style="color:${up?'var(--up)':'var(--down)'}"><b>${(b.total_return*100).toFixed(0)}%</b> (CAGR ${(b.cagr*100).toFixed(0)}%)</td></tr>
 <tr><td>مقابل احتفاظ BTC</td><td style="color:${bup?'var(--up)':'var(--down)'}">${b.btc_hodl_return!=null?(b.btc_hodl_return*100).toFixed(0)+'%':'—'}</td></tr>
 <tr><td>Sharpe · أقصى تراجع</td><td>${b.sharpe} · ${(b.max_drawdown*100).toFixed(0)}%</td></tr>
 <tr><td>أيام رابحة</td><td>${b.positive_days_pct}%</td></tr></table>`;
}
async function refresh(){render(await api('/api/state'));}
$("bt").onclick=async()=>{$("bt").disabled=true;$("btlong").disabled=true;$("btres").textContent="جارٍ المحاكاة الحديثة…";try{render(await api('/api/backtest','POST',{long:false}));}finally{$("bt").disabled=false;$("btlong").disabled=false;}};
$("btlong").onclick=async()=>{$("bt").disabled=true;$("btlong").disabled=true;$("btres").textContent="جارٍ محاكاة سنوات (دورة كاملة)… قد تأخذ دقيقة–دقيقتين";try{render(await api('/api/backtest','POST',{long:true}));}finally{$("bt").disabled=false;$("btlong").disabled=false;}};
$("check").onclick=async()=>{$("check").disabled=true;$("check").textContent="…جارٍ مسح السوق";render(await api('/api/check','POST'));$("check").disabled=false;$("check").textContent="🔄 افحص السوق الآن";};
$("exec").onclick=async()=>{if(!confirm((LIVE?"تنفيذ حقيقي بأموال فعلية":"تنفيذ على testnet")+" الآن؟"))return;$("exec").disabled=true;render(await api('/api/execute','POST',{}));$("exec").disabled=false;};
$("auto").onclick=async()=>{const willEnable=!AUTO;if(willEnable&&$("autoexec").checked&&LIVE&&!confirm("تشغيل تداول تلقائي حقيقي بأموال فعلية؟"))return;render(await api('/api/auto','POST',{enabled:willEnable,execute:$("autoexec").checked,interval_hours:parseFloat($("autoiv").value)||6}));};
$("autoexec").onchange=async()=>{render(await api('/api/auto','POST',{enabled:AUTO,execute:$("autoexec").checked,interval_hours:parseFloat($("autoiv").value)||6}));};
$("live").onclick=async()=>{const next=!LIVE;if(next&&!confirm("تفعيل التداول الحقيقي بأموال فعلية؟ تأكد من المفاتيح وZAMBAHOLA_I_ACCEPT_REAL_TRADING=RISK"))return;render(await api('/api/config','POST',{live:next}));};
document.querySelectorAll(".lv").forEach(b=>b.onclick=async()=>{render(await api('/api/config','POST',{max_total:parseFloat(b.dataset.v)}));});
document.querySelectorAll(".tfb").forEach(b=>b.onclick=async()=>{if(b.dataset.v!=="1d"&&!confirm("إطار أسرع = صفقات ورسوم أكثر وضجيج أكثر. متأكد؟"))return;render(await api('/api/config','POST',{interval:b.dataset.v}));});
$("save").onclick=async()=>{render(await api('/api/config','POST',{universe_size:+$("uni").value,top_n:+$("topn").value,max_order_usd:+$("ord").value,max_total_usd:+$("tot").value}));};
$("perfreset").onclick=async()=>{if(!confirm("تصفير سجل الأداء والبدء من القيمة الحالية؟"))return;render(await api('/api/perf-reset','POST',{}));};
$("ledgerreset").onclick=async()=>{if(!confirm("تصفير سجل الصفقات والأرباح المحقّقة؟"))return;render(await api('/api/ledger-reset','POST',{}));};
$("flatten").onclick=async()=>{if(!confirm((LIVE?"تصفية حقيقية":"تصفية testnet")+" لكل المراكز إلى نقد الآن؟"))return;$("flatten").disabled=true;render(await api('/api/flatten','POST',{}));$("flatten").disabled=false;};
$("resume").onclick=async()=>{render(await api('/api/resume','POST',{}));};
$("cleanstart").onclick=async()=>{if(!confirm("بداية نظيفة: بيع كل الأصول إلى USDT وتصفير السجل والأداء؟ (testnet)"))return;$("cleanstart").disabled=true;$("cleanstart").textContent="…جارٍ التصفية";try{render(await api('/api/clean-start','POST',{}));}finally{$("cleanstart").disabled=false;$("cleanstart").textContent="♻️ بداية نظيفة (USDT)";}};
refresh();setInterval(refresh,15000);
</script></body></html>"""


@dataclass
class AppConfig:
    assets: tuple[str, ...] = ("BTCUSDT", "ETHUSDT")
    interval: str = "1d"
    bars: int = 400
    mode: str = "scan"  # scan = market-wide trend scanner (default), or ensemble
    target_vol: float = 0.6
    max_total: float = 1.0  # gross exposure target (1.0 = full spot; >1 = leverage*)
    universe_size: int = 25  # how many top coins to scan
    top_n: int = 3  # MAX strongest uptrends (auto-shrinks when quality gate filters weak picks)
    max_weight: float = 0.50  # concentration cap: no single coin above 50% of the book
    max_order_usd: float = 1000.0  # per-order slippage cap (high = don't throttle deployment)
    max_total_usd: float = 1000.0  # total budget to deploy across picks
    rebalance_band: float = 0.2  # fee-aware: ignore drifts < 20% of position
    take_profit_pct: float = 15.0  # trim a winner once it's up this % from avg cost
    take_profit_frac: float = 0.3  # how much of the position to trim (opportunistic)
    breaker_pct: float = 18.0  # halt + go cash if equity falls this % from peak
    max_correlation: float = 0.85  # diversification: skip picks too correlated
    stop_pct: float = 0.35  # trailing stop from PEAK (let winners run; full-cycle validated)
    hard_stop_pct: float = 0.15  # hard stop from COST: cut a loser this far underwater
    conviction_power: float = 1.5  # concentrate weight toward the strongest trends
    vol_power: float = 2.0  # >1 penalises hyper-volatile coins harder (anti-concentration)
    cap_vol_ref: float = 1.5  # vol-aware cap ref: a coin's max weight shrinks if vol>ref
    profit_lock_arm: float = 0.15  # arm the profit ratchet once a position is up this %
    profit_lock_giveback: float = 0.07  # FLOOR give-back; actual is vol-adaptive (7%-18%)
    min_hold_hours: float = 24.0  # anti-churn: hold a new position at least this long (rotation only)
    # portfolio take-profit ratchet: bank winners when the WHOLE book rolls over from its peak
    port_tp_arm_usd: float = 150.0  # only active once strategy PnL peaked >= this many $
    port_tp_giveback: float = 0.15  # bank when PnL gives back this FRACTION of the peak gain
    port_tp_sell_frac: float = 0.5  # how much of each winner to bank (lock to cash)
    port_tp_cooldown_h: float = 8.0  # after banking, park profit in cash (no new buys) this long
    reentry_ban_hours: float = 48.0  # after forced exit, block re-buy this long (anti-churn)
    stop_cooldown_hours: float = 336.0  # after a trailing-stop sell, block re-buy (anti-whipsaw, ~14d)
    live: bool = False
    port: int = 8799


@dataclass
class AppState:
    signal: dict | None = None
    account: dict | None = None
    portfolio: list | None = None
    actions: list[str] = field(default_factory=list)
    updated: str | None = None
    auto_enabled: bool = False
    auto_execute: bool = False
    auto_interval_hours: float = 6.0
    equity_history: list = field(default_factory=list)
    halted: bool = False  # circuit breaker tripped -> trading paused
    backtest: dict | None = None
    last_auto_run: float = 0.0  # epoch of last auto cycle (separate from `updated`)
    pnl_peak_usd: float = 0.0  # high-water of strategy PnL in $ (stable; % distorts as cash grows)
    port_tp_cooldown_until: float = 0.0  # park banked profit in cash until this epoch
    sell_ban_until: dict = field(default_factory=dict)  # sym -> epoch; no re-buy after forced sell
    lock: threading.Lock = field(default_factory=threading.Lock)

    def log(self, msg: str) -> None:
        stamp = time.strftime("%Y-%m-%d %H:%M")
        self.actions.append(f"[{stamp}] {msg}")
        self.actions[:] = self.actions[-100:]

    def record_equity(self, equity: float) -> None:
        """Append an account-value point (throttled to ~1/min) and persist it."""
        now = time.time()
        with self.lock:
            h = self.equity_history
            if h:
                try:
                    last_ts = time.mktime(time.strptime(h[-1]["t"], "%Y-%m-%d %H:%M:%S"))
                    if now - last_ts < 55:  # throttle: at most ~1 point/min
                        return
                except Exception:  # noqa: BLE001
                    pass
            h.append({"t": time.strftime("%Y-%m-%d %H:%M:%S"), "eq": round(float(equity), 2)})
            self.equity_history = h[-2000:]
            snapshot = list(self.equity_history)
        _save_equity_history(snapshot)

    def reset_equity(self) -> None:
        with self.lock:
            self.equity_history = []
        _save_equity_history([])


# ---------- testable core ----------

def compute_signal(frames: dict, *, mode: str, target_vol: float) -> dict:
    """Pure: target allocation from already-fetched klines frames."""
    return current_allocation(frames, mode=mode, target_vol=target_vol)


def account_snapshot(client: BinanceSpot, assets: tuple[str, ...], *, quote: str = "USDT") -> dict:
    """Connected account view. Uses ONE bulk price call (not N per-symbol), so it
    stays fast even on a testnet faucet wallet with dozens of junk tokens, and
    equity reflects the full real wallet."""
    balances = client.balances()
    try:
        allp = client.all_prices()
    except Exception:  # noqa: BLE001
        allp = {}
    equity = balances.get(quote, 0.0)
    prices: dict[str, float] = {}
    valued: list[tuple[str, float, float]] = []  # (base, qty, usd)
    for b, q in balances.items():
        if b == quote or q <= 0:
            continue
        sym = f"{b}{quote}"
        p = allp.get(sym, 0.0)
        prices[sym] = p
        usd = q * p
        equity += usd
        valued.append((b, q, usd))
    for s in assets:
        if s in allp:
            prices[s] = allp[s]
    # keep the UI clean: USDT + top holdings by USD value (faucet wallets have 100s)
    valued.sort(key=lambda x: x[2], reverse=True)
    shown = {quote: round(balances.get(quote, 0.0), 2)}
    for b, q, _usd in valued[:12]:
        shown[b] = round(q, 6)
    return {"connected": True, "equity_usd": round(equity, 2),
            "balances": shown, "holdings_count": len(valued), "_prices": prices}


# ---------- actions ----------

def _connect(live: bool) -> BinanceSpot | None:
    try:
        keys = load_keys(testnet=not live)
    except RuntimeError:
        return None
    return BinanceSpot(keys, testnet=not live)


def _scan_signal(cfg: AppConfig) -> tuple[dict, list[str], dict]:
    """Market-wide scan -> (signal dict, scanned symbols by volume, frames)."""
    from .universe import fetch_frames, fetch_top_symbols, scan

    symbols = fetch_top_symbols(cfg.universe_size)
    frames = fetch_frames(symbols, interval=cfg.interval, total=max(cfg.bars, 400))
    held = {s for s, p in load_ledger().positions.items() if p.qty > 1e-9}
    sc = scan(frames, top_n=cfg.top_n, target_vol=cfg.target_vol, max_total=cfg.max_total,
              stop_pct=cfg.stop_pct, conviction_power=cfg.conviction_power,
              vol_power=cfg.vol_power, cap_vol_ref=cfg.cap_vol_ref,
              max_correlation=cfg.max_correlation, max_weight=cfg.max_weight, held=held)
    as_of = ""
    first = next((s for s in symbols if s in frames), None)
    if first is not None:
        as_of = str(frames[first]["open_time"].iloc[-1])
    sig = {
        "as_of": as_of,
        "mode": "scan",
        "scanned": sc["scanned"],
        "regime": sc.get("regime", 1.0),
        "targets": sc["targets"],
        "cash_weight": sc["cash_weight"],
        "ranked": sc["ranked"][:12],
        "reasons": {r["symbol"]: r for r in sc["ranked"][:8]},
    }
    return sig, symbols, frames


def _portfolio_records(frames: dict, symbols: list[str], cfg: AppConfig) -> list | None:
    """Strategy comparison on a long-history liquid basket (reuses scan frames)."""
    try:
        if cfg.mode == "scan":
            basket_syms = [s for s in symbols if s in frames and len(frames[s]) >= 350][:4]
            basket = {s: frames[s] for s in basket_syms}
        else:
            basket = frames
        if not basket:
            return None
        return compare_portfolios(basket, cost_bps=10.0, target_vol=cfg.target_vol).to_dict("records")
    except Exception:  # noqa: BLE001
        return None


def _port_tp_should_bank(cur: float | None, peak: float,
                         arm: float, giveback: float) -> bool:
    """Portfolio take-profit trigger: armed once the book's $ PnL peaked >= `arm`,
    fires when it gives back >= `giveback` fraction of that peak gain. Uses $ (not %)
    because the % spikes artificially as winners are sold to cash (invested shrinks)."""
    if cur is None or peak < arm or peak <= 0:
        return False
    return cur <= peak * (1 - giveback)


def do_check(cfg: AppConfig, state: AppState, *, with_portfolio: bool = False) -> None:
    if cfg.mode == "scan":
        sig, symbols, frames = _scan_signal(cfg)
    else:
        symbols = list(cfg.assets)
        frames = fetch_many(symbols, interval=cfg.interval, total=max(cfg.bars, 400))
        sig = compute_signal(frames, mode=cfg.mode, target_vol=cfg.target_vol)

    client = _connect(cfg.live)
    if client is None:
        net = "الحقيقية" if cfg.live else "testnet"
        account = {"connected": False,
                   "error": f"لم يتم العثور على مفاتيح {net} — ضع testnet-keys.txt و binance-API.txt على سطح المكتب"}
    else:
        try:
            assets = tuple(sig["targets"].keys()) or cfg.assets
            account = account_snapshot(client, assets or cfg.assets)
        except Exception as exc:  # noqa: BLE001
            account = {"connected": False, "error": str(exc)}
    pf = _portfolio_records(frames, symbols, cfg) if with_portfolio else None
    with state.lock:
        state.signal = sig
        state.account = account
        if pf is not None:
            state.portfolio = pf
        state.updated = time.strftime("%Y-%m-%d %H:%M:%S")
    # track actual account value over time (outside the lock)
    if account.get("connected") and account.get("equity_usd") is not None:
        state.record_equity(account["equity_usd"])
        prices = account.get("_prices") or {}
        if prices:
            led = load_ledger()
            led.update_peaks(prices)
            save_ledger(led)
            cur_usd = led.summary(prices).get("strategy_pnl")
            if cur_usd is not None and cur_usd > state.pnl_peak_usd:
                state.pnl_peak_usd = cur_usd  # high-water mark ($) for the portfolio ratchet
                _save_auto(state)


def _resolve_whitelist(
    targets: dict, balances: dict, *, universe: list[str] | None = None,
    ledger_syms: set | None = None, quote: str = "USDT", cap: int = 50,
) -> list[str]:
    """Symbols the executor may trade = targets to ENTER + held coins to EXIT.

    A held coin is managed if it's in the scanned `universe` OR it's a strategy
    position in `ledger_syms` (a coin we actually bought). Held coins that are
    neither — e.g. testnet faucet junk we never touched — are left alone so we
    don't liquidate a wallet stuffed with random airdropped tokens.
    """
    out = list(targets.keys())
    uni = set(universe or [])
    led = set(ledger_syms or [])
    for base, qty in balances.items():
        if base == quote or qty <= 0:
            continue
        sym = f"{base}{quote}"
        if sym in out:
            continue
        # filter only when a universe is given: manage held coins in the universe
        # OR ones we actually bought (ledger). No universe -> manage all holdings.
        if uni and sym not in uni and sym not in led:
            continue
        out.append(sym)
    return out[:cap]


def _order_reason(sym: str, side: str, targets: dict, ranked_map: dict) -> str:
    """Human reason for a trade so the smart decision is visible in the log."""
    r = ranked_map.get(sym, {})
    action = r.get("action")
    if side == "BUY":
        return "دخول: ترند صاعد قوي"
    if action == "STOP":
        return "وقف خسارة (هبط عن قمّته)"
    if targets.get(sym, 0) > 0:
        return "تقليل للوزن المستهدف"
    if action == "CASH" or r.get("trend_consensus", 0) < 0.5:
        return "خروج: لا يوجد ترند"
    return "خروج/إعادة توازن"


def _active_sell_bans(state: AppState, now: float | None = None) -> dict[str, float]:
    """Symbols blocked from re-buy after a forced exit."""
    ts = now if now is not None else time.time()
    return {s: until for s, until in state.sell_ban_until.items() if until > ts}


def _apply_reentry_bans(targets: dict, state: AppState) -> list[str]:
    """Zero-out buy targets for symbols still under a post-forced-sell ban."""
    blocked = []
    for s, w in list(targets.items()):
        if w > 0 and s in _active_sell_bans(state):
            targets[s] = 0.0
            blocked.append(s)
    return blocked


def _ban_symbols(state: AppState, symbols: set[str], hours: float) -> None:
    if hours <= 0 or not symbols:
        return
    until = time.time() + hours * 3600
    for s in symbols:
        state.sell_ban_until[s] = until
    _save_auto(state)


def _force_sell_symbols(
    client: BinanceSpot, symbols: set[str], balances: dict, allp: dict,
    led, cfg: AppConfig, state: AppState, *, why: str, min_usd: float = 10.0,
) -> tuple[int, list[str]]:
    """Market-sell full wallet holdings for forced exits (stop/lock); uses SELL_MARGIN."""
    placed = 0
    sold: list[str] = []
    for sym in symbols:
        px = allp.get(sym, 0.0)
        if px <= 0:
            continue
        base = sym[:-4] if sym.endswith("USDT") else sym
        amt = round(balances.get(base, 0.0) * px * SELL_MARGIN, 2)
        if amt < min_usd:
            continue
        try:
            client.market_order(sym, "SELL", quote_qty=amt)
            rec = led.record("SELL", sym, amt, px)
            append_trade({**rec, "mode": "live" if cfg.live else "testnet", "why": why})
            balances[base] = max(0.0, balances.get(base, 0.0) - amt / px)
            placed += 1
            sold.append(sym)
            pnl = f" · ربح ${rec['realized']}" if rec["realized"] else ""
            state.log(f"{'حقيقي' if cfg.live else 'testnet'} بيع {sym} ${amt} ✓ — {why}{pnl}")
        except Exception as exc:  # noqa: BLE001
            state.log(f"✗ فشل بيع {sym}: {exc}")
    return placed, sold


def do_execute(cfg: AppConfig, state: AppState) -> dict:
    try:
        safety_gate(live=cfg.live)
    except RuntimeError as exc:
        state.log(f"تنفيذ محظور: {exc}")
        return {"ok": False, "error": str(exc)}
    client = _connect(cfg.live)
    if client is None:
        state.log("لا مفاتيح — التنفيذ متعذّر")
        return {"ok": False, "error": "no keys"}

    if cfg.mode == "scan":
        sig, universe, _ = _scan_signal(cfg)
    else:
        universe = list(cfg.assets)
        frames = fetch_many(universe, interval=cfg.interval, total=max(cfg.bars, 400))
        sig = compute_signal(frames, mode=cfg.mode, target_vol=cfg.target_vol)

    balances = client.balances()
    # manage: scan targets + held faucet coins in the universe + EVERY coin the
    # strategy actually bought (ledger), even if it has since left the universe —
    # so a stale held position still gets rotated out to cash, not abandoned.
    ledger_syms = {s for s, p in load_ledger().positions.items() if p.qty > 1e-9}
    whitelist = _resolve_whitelist(sig["targets"], balances, universe=universe,
                                   ledger_syms=ledger_syms)
    try:
        allp = client.all_prices()
    except Exception:  # noqa: BLE001
        allp = {}
    prices = {s: allp[s] for s in whitelist if s in allp and allp[s] > 0}
    whitelist = tuple(s for s in whitelist if s in prices)

    targets = {s: w for s, w in sig["targets"].items()}
    # 1) circuit breaker: account fell too far from its peak -> flatten to cash + halt
    with state.lock:
        _hist = list(state.equity_history)
    dd = _breaker_drawdown(_hist)
    breaker = dd is not None and dd <= -abs(cfg.breaker_pct)
    if breaker:
        targets = {}
        with state.lock:
            state.halted = True
            state.auto_execute = False
        _save_auto(state)
        state.log(f"⛔ قاطع الدائرة: تراجع رأس المال {dd:.1f}% — تصفية كاملة لنقد وإيقاف التداول")

    led = load_ledger()
    led.update_peaks(allp)
    # 1b) PORTFOLIO take-profit ratchet — the whole book rolled over from its peak ->
    # BANK winners to cash (locks realized profit instead of giving it all back).
    # Tracked in $ (not %) because % spikes artificially as positions are sold to cash.
    cur_usd = led.summary(allp).get("strategy_pnl")
    if cur_usd is not None and cur_usd > state.pnl_peak_usd:
        state.pnl_peak_usd = cur_usd
    now_ts = time.time()
    if (not breaker and now_ts >= state.port_tp_cooldown_until
            and _port_tp_should_bank(cur_usd, state.pnl_peak_usd,
                                     cfg.port_tp_arm_usd, cfg.port_tp_giveback)):
        banked = 0.0
        banked_syms: set[str] = set()
        for s, p in list(led.positions.items()):
            px = allp.get(s, 0.0)
            if p.qty <= 1e-12 or p.avg <= 0 or px <= 0 or (px / p.avg - 1) <= 0.03:
                continue  # only bank genuine winners
            base = s[:-4] if s.endswith("USDT") else s
            wallet_usd = balances.get(base, 0.0) * px
            sell_usd = round(wallet_usd * cfg.port_tp_sell_frac * SELL_MARGIN, 2)
            if sell_usd < 10:
                continue
            try:
                client.market_order(s, "SELL", quote_qty=sell_usd)
                rec = led.record("SELL", s, sell_usd, px)
                append_trade({**rec, "mode": "live" if cfg.live else "testnet",
                              "why": "جني ربح المحفظة (تراجع عن القمّة)"})
                banked += rec["realized"]
                banked_syms.add(s)
                balances[base] = max(0.0, balances.get(base, 0.0) - sell_usd / px)
                g = (px / p.avg - 1) * 100
                state.log(f"💰 بنك ربح {s}: +{g:.0f}% بيع {int(cfg.port_tp_sell_frac*100)}% (قفل ${rec['realized']})")
            except Exception as exc:  # noqa: BLE001
                state.log(f"✗ فشل جني {s}: {exc}")
        if banked != 0.0:
            peak_was = state.pnl_peak_usd
            state.port_tp_cooldown_until = now_ts + cfg.port_tp_cooldown_h * 3600
            state.pnl_peak_usd = cur_usd  # re-arm from the new (lower) level
            # anti give-back: don't immediately RELOAD a coin we just banked a big win
            # on — that's the exact pattern that gives gains back when it reverses.
            if cfg.reentry_ban_hours > 0 and banked_syms:
                _ban_symbols(state, banked_syms, cfg.reentry_ban_hours)
                state.log(f"🚫 منع إعادة شراء {', '.join(sorted(banked_syms))} لمدة {cfg.reentry_ban_hours:g}س بعد جني الربح")
            _save_auto(state)
            save_ledger(led)
            state.log(f"🔒 قفل ربح المحفظة عند ${cur_usd:.0f} (القمّة ${peak_was:.0f}) — نقد + تهدئة {cfg.port_tp_cooldown_h:g}س")
    in_cooldown = time.time() < state.port_tp_cooldown_until
    # volatility-adaptive give-back per coin: wild coins get room, calm coins lock
    # tight (fully automatic, scales with each coin's own daily volatility)
    ranked_vol = {r["symbol"]: r.get("realized_vol_ann", 0.0) for r in sig.get("ranked", [])}
    giveback_map = {}
    for s, p in led.positions.items():
        if p.qty > 1e-12:
            daily_vol = (ranked_vol.get(s, 0.0) or 0.0) / (365 ** 0.5)
            giveback_map[s] = max(cfg.profit_lock_giveback, min(0.18, 2.5 * daily_vol))
    # 2a) profit ratchet: a winner that gave back from its peak -> EXIT to lock the gain
    lock_syms: set[str] = set()
    if not breaker:
        for sym in led.profit_lock_exits(allp, cfg.profit_lock_arm, cfg.profit_lock_giveback,
                                         giveback_map=giveback_map):
            g = led.unrealized_gain_pct(sym, allp.get(sym, 0.0))
            targets[sym] = 0.0  # force full exit (lock profit near the peak)
            lock_syms.add(sym)
            if sym not in whitelist:
                whitelist = whitelist + (sym,)
            if sym not in prices and sym in allp:
                prices[sym] = allp[sym]
            state.log(f"🔒 قفل ربح {sym}: +{g:.0f}% (تراجع عن القمّة) → بيع كامل")
    # 2b) opportunistic profit-taking: trim winners above the take-profit threshold
    if targets:
        for sym in list(targets):
            g = led.unrealized_gain_pct(sym, prices.get(sym, 0.0))
            if g is not None and g >= cfg.take_profit_pct and targets[sym] > 0:
                targets[sym] = round(targets[sym] * (1 - cfg.take_profit_frac), 4)
                state.log(f"💰 جني أرباح {sym}: +{g:.0f}% → بيع {int(cfg.take_profit_frac * 100)}%")
    # 2b2) RISK EXITS — fire on ANY ledger position even after it drops OUT of the
    # scanned universe (a crashed strategy buy must still be stopped; only untracked
    # faucet tokens are left alone). Cuts deep losers + dumps dead-weight stablecoins.
    risk_exit_syms: set[str] = set()
    if not breaker:
        from .universe import _STABLES
        exits = led.risk_exits(allp, cfg.hard_stop_pct, cfg.stop_pct, stables=_STABLES)
        for s, (code, val) in exits.items():
            if code == "stable":
                reason = "عملة مستقرة (وزن ميّت)"
            elif code == "hard_stop":
                reason = f"وقف خسارة {val * 100:.0f}%"
            else:
                reason = f"وقف متحرّك ({val * 100:.0f}% عن القمّة)"
            targets[s] = 0.0
            risk_exit_syms.add(s)
            if s not in whitelist:
                whitelist = whitelist + (s,)
            if s not in prices:
                prices[s] = allp.get(s, 0.0)
            state.log(f"🛑 {reason} {s} → بيع كامل")
    # 2c) min-hold anti-churn: a YOUNG position is protected from a FULL rotation exit
    # (target=0 — dropped from the book). Trimming overweight (target>0 but below current)
    # and all risk/profit-lock exits still run normally.
    if not breaker and cfg.min_hold_hours > 0:
        usdt = balances.get("USDT", 0.0)
        hv = {}
        for s in whitelist:
            base = s[:-4] if s.endswith("USDT") else s
            q = balances.get(base, 0.0)
            px = prices.get(s, 0.0)
            if q > 0 and px > 0:
                hv[s] = q * px
        equity = usdt + sum(hv.values())
        protected = []
        for s, p in led.positions.items():
            if (p.qty <= 1e-12 or p.age_hours() >= cfg.min_hold_hours
                    or s in lock_syms or s in risk_exit_syms):
                continue
            tgt = targets.get(s, 0.0)
            if tgt > 0:
                continue  # still in book — allow trim-down rebalances
            cur_w = (hv.get(s, 0.0) / equity) if equity > 0 else 0.0
            if cur_w > 0:
                targets[s] = round(cur_w, 4)  # block full exit only
                protected.append(s)
        if protected:
            state.log(f"⏳ حد أدنى للاحتفاظ ({cfg.min_hold_hours:g}س): إبقاء {', '.join(protected)} (منع خروج كامل)")
    save_ledger(led)

    # forced exits (stop-loss / profit-lock) go direct to market — don't rely on
    # plan_rebalance alone (avoids -2010 and ensures risk sells actually fire).
    force_syms = lock_syms | risk_exit_syms
    forced = 0
    forced_sold: list[str] = []
    if force_syms and not breaker:
        forced, forced_sold = _force_sell_symbols(
            client, force_syms, balances, allp, led, cfg, state,
            why="خروج إجباري (وقف خسارة / قفل ربح)",
        )
        if forced_sold:
            _ban_symbols(state, set(forced_sold), cfg.reentry_ban_hours)
            state.log(
                f"🚫 منع إعادة شراء {', '.join(forced_sold)} لمدة {cfg.reentry_ban_hours:g}س"
            )
        if forced:
            save_ledger(led)

    blocked_reentry = _apply_reentry_bans(targets, state)
    if blocked_reentry:
        mins = max(int((state.sell_ban_until[s] - time.time()) / 60) for s in blocked_reentry)
        state.log(f"🚫 إعادة شراء موقوفة: {', '.join(blocked_reentry)} ({mins}د متبقية)")

    limits = RiskLimits(max_order_usd=cfg.max_order_usd, max_total_usd=cfg.max_total_usd,
                        rebalance_band=cfg.rebalance_band, whitelist=whitelist)
    plan = plan_rebalance(targets, balances, prices, limits)
    # during the take-profit cooldown, keep the banked gain in CASH: allow sells
    # (risk exits) but block new buys so we don't immediately re-deploy the profit.
    if in_cooldown:
        dropped = [o for o in plan.orders if o.side == "BUY"]
        plan.orders[:] = [o for o in plan.orders if o.side != "BUY"]
        if dropped:
            mins = int((state.port_tp_cooldown_until - time.time()) / 60)
            state.log(f"⏸️ تهدئة جني ربح: تجاهل {len(dropped)} شراء — الربح مقفول نقداً ({mins} دقيقة متبقية)")
    buys = sum(1 for o in plan.orders if o.side == "BUY")
    sells = len(plan.orders) - buys
    if not plan.orders and forced == 0:
        parts = []
        if in_cooldown:
            parts.append(f"تهدئة جني ربح ({int((state.port_tp_cooldown_until - time.time()) / 60)}د — شراء موقوف)")
        dust = [s for s in force_syms
                if balances.get(s[:-4] if s.endswith("USDT") else s, 0) * allp.get(s, 0) * SELL_MARGIN < 10]
        if dust:
            parts.append(f"غبار تحت $10: {', '.join(dust)}")
        state.log("لا أوامر — " + (" · ".join(parts) if parts else "المحفظة مطابقة للأهداف"))
        return {"ok": True, "orders": 0, "buys": 0, "sells": 0}
    if not plan.orders:
        return {"ok": True, "orders": forced, "buys": 0, "sells": forced}
    net = "خطة: " + (f"شراء {buys}" if buys else "") + (" · " if buys and sells else "") + (f"بيع {sells}" if sells else "")
    state.log(f"{net} (ميزانية ${cfg.max_total_usd:g})")
    ranked_map = {r["symbol"]: r for r in sig.get("ranked", [])}
    placed = forced
    stop_banned: set[str] = set()
    for o in plan.orders:
        why = _order_reason(o.symbol, o.side, targets, ranked_map)
        try:
            res = client.market_order(o.symbol, o.side, quote_qty=o.usd)
            placed += 1
            rec = led.record(o.side, o.symbol, o.usd, prices.get(o.symbol, 0.0))
            append_trade({**rec, "mode": "live" if cfg.live else "testnet", "why": why})
            side_ar = "شراء" if o.side == "BUY" else "بيع"
            ok = str(res.get("status", "")).upper() in ("FILLED", "NEW", "PARTIALLY_FILLED")
            mark = "✓ تم" if ok else f"({res.get('status')})"
            pnl = f" · ربح ${rec['realized']}" if (o.side == "SELL" and rec["realized"]) else ""
            state.log(f"{'حقيقي' if cfg.live else 'testnet'} {side_ar} {o.symbol} ${o.usd} {mark} — {why}{pnl}")
            # anti-whipsaw: a coin sold because it fell off its peak (trailing stop)
            # must not be rebought into the same chop for a cooldown window.
            if (o.side == "SELL" and cfg.stop_cooldown_hours > 0
                    and ranked_map.get(o.symbol, {}).get("action") == "STOP"):
                stop_banned.add(o.symbol)
        except Exception as exc:  # noqa: BLE001
            state.log(f"✗ فشل {o.side} {o.symbol}: {exc}")
    if stop_banned:
        _ban_symbols(state, stop_banned, cfg.stop_cooldown_hours)
        days = cfg.stop_cooldown_hours / 24.0
        state.log(f"🚫 منع إعادة شراء بعد وقف الخسارة: {', '.join(sorted(stop_banned))} (~{days:g}ي)")
    save_ledger(led)
    return {"ok": True, "orders": placed, "buys": buys, "sells": sells + forced}


def _breaker_drawdown(hist: list) -> float | None:
    """Account drawdown % from its tracked peak (None if not enough data)."""
    pts = [float(h["eq"]) for h in hist if isinstance(h, dict) and "eq" in h]
    if len(pts) < 2:
        return None
    peak = max(pts)
    return (pts[-1] / peak - 1.0) * 100 if peak > 0 else None


def do_flatten(cfg: AppConfig, state: AppState, *, full: bool = False, cap: int = 200) -> dict:
    """Sell holdings to USDT. full=True liquidates the ENTIRE wallet (clean slate);
    otherwise it's the kill switch limited to the scanned strategy universe."""
    try:
        safety_gate(live=cfg.live)
    except RuntimeError as exc:
        state.log(f"تصفية محظورة: {exc}")
        return {"ok": False, "error": str(exc)}
    client = _connect(cfg.live)
    if client is None:
        return {"ok": False, "error": "no keys"}
    balances = client.balances()
    try:
        allp = client.all_prices()
    except Exception:  # noqa: BLE001
        allp = {}
    quote = "USDT"
    universe = None
    if not full:
        if cfg.mode == "scan":
            try:
                from .universe import fetch_top_symbols
                universe = fetch_top_symbols(cfg.universe_size)
            except Exception:  # noqa: BLE001
                universe = None
        else:
            universe = list(cfg.assets)
    uni = set(universe) if universe else None

    # value-sorted sell list: held coins with a tradeable USDT pair >= min notional
    candidates = []
    remaining = 0.0
    for base, qty in balances.items():
        if base == quote or qty <= 0:
            continue
        sym = f"{base}{quote}"
        price = allp.get(sym, 0.0)
        if price <= 0:
            continue
        usd = qty * price
        if usd < 10:
            continue
        if uni is not None and sym not in uni:
            continue
        candidates.append((sym, usd, price))
        remaining += usd
    candidates.sort(key=lambda x: x[1], reverse=True)
    candidates = candidates[:cap]
    led = load_ledger()
    state.log(("♻️ بداية نظيفة: تصفية كل الأصول لـUSDT" if full else "🛑 طوارئ: تصفية المراكز لنقد")
              + f" ({len(candidates)} عملة)")
    placed = 0
    for sym, usd, price in candidates:
        amt = round(usd * SELL_MARGIN, 2)
        try:
            client.market_order(sym, "SELL", quote_qty=amt)
            rec = led.record("SELL", sym, amt, price)
            append_trade({**rec, "mode": "live" if cfg.live else "testnet",
                          "why": "تصفية لبداية نظيفة" if full else "طوارئ: تصفية"})
            placed += 1
        except Exception as exc:  # noqa: BLE001
            state.log(f"✗ فشل بيع {sym}: {exc}")
        time.sleep(0.12)
    save_ledger(led)
    return {"ok": True, "sold": placed, "attempted": len(candidates),
            "remaining_value": round(remaining, 2)}


def do_backtest(cfg: AppConfig, state: AppState, *, long_history: bool = False) -> dict:
    """Run the real-strategy backtest (on demand, heavy).

    long_history=True uses a curated multi-year basket (BTC/ETH/SOL...) so the
    test spans a full cycle (bull + bear), not just the recent window.
    """
    from .scan_backtest import backtest_scan
    from .universe import LONG_UNIVERSE, fetch_frames, fetch_top_symbols

    if long_history:
        symbols, total, min_bars = LONG_UNIVERSE, 1600, 700
    else:
        symbols, total, min_bars = fetch_top_symbols(cfg.universe_size), 500, 300
    frames = fetch_frames(symbols, interval=cfg.interval, total=total, min_bars=120)
    ppy = {"1d": 365, "12h": 730, "8h": 1095, "6h": 1460, "4h": 2190, "1h": 8760}.get(cfg.interval, 365)
    res = backtest_scan(frames, top_n=cfg.top_n, target_vol=cfg.target_vol,
                        max_total=cfg.max_total, min_bars=min_bars, periods_per_year=ppy,
                        stop_pct=cfg.stop_pct, conviction_power=cfg.conviction_power,
                        vol_power=cfg.vol_power, cap_vol_ref=cfg.cap_vol_ref,
                        stop_cooldown_days=cfg.stop_cooldown_hours / 24.0,
                        max_weight=cfg.max_weight)
    res["scope"] = "years" if long_history else "recent"
    res["interval"] = cfg.interval
    with state.lock:
        state.backtest = res
    if res.get("ok"):
        btc = res.get("btc_hodl_return")
        scope_ar = "سنوات" if long_history else "حديث"
        state.log(f"باك-تست ({scope_ar}): عائد {int(res['total_return'] * 100)}% · "
                  f"تراجع {int(res['max_drawdown'] * 100)}% · Sharpe {res['sharpe']}"
                  + (f" مقابل BTC {int(btc * 100)}%" if btc is not None else ""))
    else:
        state.log("باك-تست فشل: " + str(res.get("error", "")))
    return res


def _auto_loop(cfg: AppConfig, state: AppState) -> None:
    while True:
        time.sleep(5)
        with state.lock:
            enabled = state.auto_enabled
            execute = state.auto_execute
            interval = state.auto_interval_hours
            last_run = state.last_auto_run
        if not enabled:
            continue
        # due strictly off the last AUTO cycle (NOT `updated`, which the 5-min
        # refresh loop also touches — that previously froze auto-trading)
        if (time.time() - last_run) < interval * 3600:
            continue
        with state.lock:
            state.last_auto_run = time.time()
        try:
            do_check(cfg, state)
            state.log("فحص تلقائي")
            with state.lock:
                halted = state.halted
            if execute and not halted:
                do_execute(cfg, state)
        except Exception as exc:  # noqa: BLE001
            state.log(f"خطأ تلقائي: {exc}")


# ---------- HTTP ----------

def make_handler(cfg: AppConfig, state: AppState):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # silence
            pass

        def _send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _state_dict(self):
            with state.lock:
                d = {
                    "signal": state.signal,
                    "account": state.account,
                    "portfolio": state.portfolio,
                    "actions": list(state.actions),
                    "updated": state.updated,
                    "auto_enabled": state.auto_enabled,
                    "auto_execute": state.auto_execute,
                    "auto_interval_hours": state.auto_interval_hours,
                    "pnl": compute_pnl(state.equity_history),
                    "halted": state.halted,
                    "drawdown_pct": _breaker_drawdown(state.equity_history),
                    "auto_stale": (state.auto_enabled and state.last_auto_run > 0
                                   and (time.time() - state.last_auto_run)
                                   > state.auto_interval_hours * 3600 * 1.5),
                    "cash_weight": state.signal.get("cash_weight") if state.signal else None,
                    "scanned": state.signal.get("scanned") if state.signal else None,
                    "regime": state.signal.get("regime") if state.signal else None,
                    "ranked": state.signal.get("ranked") if state.signal else None,
                    "live": cfg.live,
                    "mode": cfg.mode,
                    "interval": cfg.interval,
                    "max_total": cfg.max_total,
                    "universe_size": cfg.universe_size,
                    "top_n": cfg.top_n,
                    "max_weight": cfg.max_weight,
                    "max_order_usd": cfg.max_order_usd,
                    "max_total_usd": cfg.max_total_usd,
                    "breaker_pct": cfg.breaker_pct,
                    "take_profit_pct": cfg.take_profit_pct,
                    "min_hold_hours": cfg.min_hold_hours,
                    "hard_stop_pct": cfg.hard_stop_pct,
                    "port_tp_arm_usd": cfg.port_tp_arm_usd,
                    "port_tp_giveback": cfg.port_tp_giveback,
                    "pnl_peak_usd": round(state.pnl_peak_usd, 2),
                    "tp_cooldown_min": max(0, int((state.port_tp_cooldown_until - time.time()) / 60)),
                    "backtest": state.backtest,
                }
            # file-backed (read outside the state lock)
            acct = d.get("account") or {}
            prices = acct.get("_prices") if isinstance(acct, dict) else None
            d["ledger"] = load_ledger().summary(prices)
            # headline % is return-on-budget (stable) instead of return-on-cost-basis
            # (which spikes artificially toward 100%+ as winners are banked to cash)
            tot = d["ledger"].get("strategy_pnl")
            if tot is not None and cfg.max_total_usd > 0:
                d["ledger"]["strategy_pnl_pct"] = round(tot / cfg.max_total_usd * 100, 2)
                d["ledger"]["pnl_basis"] = "budget"
                d["ledger"]["budget_usd"] = cfg.max_total_usd
            d["trades"] = load_trades(30)
            return d

        def _read_json(self) -> dict:
            try:
                ln = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(ln) if ln else b"{}"
                return json.loads(raw or b"{}")
            except Exception:  # noqa: BLE001
                return {}

        def _apply_config(self, body: dict) -> None:
            if "live" in body:
                cfg.live = bool(body["live"])
            if "max_total" in body:
                cfg.max_total = max(0.1, min(3.0, float(body["max_total"])))
            if "universe_size" in body:
                cfg.universe_size = int(max(5, min(60, int(body["universe_size"]))))
            if "top_n" in body:
                cfg.top_n = int(max(1, min(15, int(body["top_n"]))))
            if "max_weight" in body:
                cfg.max_weight = max(0.1, min(1.0, float(body["max_weight"])))
            if "max_order_usd" in body:
                cfg.max_order_usd = max(0.0, float(body["max_order_usd"]))
            if "max_total_usd" in body:
                cfg.max_total_usd = max(0.0, float(body["max_total_usd"]))
            if body.get("mode") in ("scan", "ensemble", "rotation", "trend"):
                cfg.mode = body["mode"]
            if body.get("interval") in ("1d", "12h", "8h", "6h", "4h", "1h"):
                cfg.interval = body["interval"]
            if "rebalance_band" in body:
                cfg.rebalance_band = max(0.0, min(0.9, float(body["rebalance_band"])))
            if "min_hold_hours" in body:
                cfg.min_hold_hours = max(0.0, min(240.0, float(body["min_hold_hours"])))
            if "take_profit_pct" in body:
                cfg.take_profit_pct = max(1.0, float(body["take_profit_pct"]))
            if "take_profit_frac" in body:
                cfg.take_profit_frac = max(0.0, min(1.0, float(body["take_profit_frac"])))
            if "breaker_pct" in body:
                cfg.breaker_pct = max(2.0, float(body["breaker_pct"]))
            if "stop_pct" in body:
                cfg.stop_pct = max(0.05, min(0.9, float(body["stop_pct"])))
            if "hard_stop_pct" in body:
                cfg.hard_stop_pct = max(0.03, min(0.9, float(body["hard_stop_pct"])))
            if "port_tp_arm_usd" in body:
                cfg.port_tp_arm_usd = max(10.0, float(body["port_tp_arm_usd"]))
            if "port_tp_giveback" in body:
                cfg.port_tp_giveback = max(0.05, min(0.9, float(body["port_tp_giveback"])))
            if "port_tp_sell_frac" in body:
                cfg.port_tp_sell_frac = max(0.1, min(1.0, float(body["port_tp_sell_frac"])))
            if "port_tp_cooldown_h" in body:
                cfg.port_tp_cooldown_h = max(0.0, float(body["port_tp_cooldown_h"]))
            if "reentry_ban_hours" in body:
                cfg.reentry_ban_hours = max(0.0, min(720.0, float(body["reentry_ban_hours"])))
            if "stop_cooldown_hours" in body:
                cfg.stop_cooldown_hours = max(0.0, min(2160.0, float(body["stop_cooldown_hours"])))
            if "port_tp_cooldown_until" in body:
                state.port_tp_cooldown_until = float(body["port_tp_cooldown_until"])
                _save_auto(state)
            if body.get("clear_tp_cooldown"):
                if not body.get("confirm"):
                    state.log("⚠️ رفض إلغاء التهدئة — أضف confirm:true يدوياً إذا كنت متأكداً")
                else:
                    state.port_tp_cooldown_until = 0.0
                    _save_auto(state)
                    state.log("⚠️ تم إلغاء تهدئة جني الربح — الشراء مسموح من جديد")
            if "conviction_power" in body:
                cfg.conviction_power = max(1.0, min(3.0, float(body["conviction_power"])))
            if "vol_power" in body:
                cfg.vol_power = max(1.0, min(3.0, float(body["vol_power"])))
            if "cap_vol_ref" in body:
                cfg.cap_vol_ref = max(0.0, min(10.0, float(body["cap_vol_ref"])))
            if "target_vol" in body:
                cfg.target_vol = max(0.1, min(3.0, float(body["target_vol"])))
            if "profit_lock_arm" in body:
                cfg.profit_lock_arm = max(0.05, min(2.0, float(body["profit_lock_arm"])))
            if "profit_lock_giveback" in body:
                cfg.profit_lock_giveback = max(0.03, min(0.5, float(body["profit_lock_giveback"])))
            _save_config(cfg)
            state.log("تحديث الإعدادات: " + json.dumps(body, ensure_ascii=False))

        def do_GET(self):
            if self.path == "/" or self.path.startswith("/index"):
                return self._send(200, DASHBOARD_HTML.encode(), "text/html; charset=utf-8")
            if self.path == "/api/state":
                return self._send(200, self._state_dict())
            return self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path == "/api/check":
                do_check(cfg, state, with_portfolio=True)
                return self._send(200, self._state_dict())
            if self.path == "/api/execute":
                res = do_execute(cfg, state)
                do_check(cfg, state)
                return self._send(200, {**self._state_dict(), "result": res})
            if self.path == "/api/auto":
                body = self._read_json()
                with state.lock:
                    if "enabled" in body:
                        state.auto_enabled = bool(body["enabled"])
                    else:
                        state.auto_enabled = not state.auto_enabled
                    if "execute" in body:
                        state.auto_execute = bool(body["execute"])
                    if "interval_hours" in body:
                        state.auto_interval_hours = max(0.05, float(body["interval_hours"]))
                    en, ex, iv = state.auto_enabled, state.auto_execute, state.auto_interval_hours
                _save_auto(state)
                state.log(
                    f"التداول التلقائي {'تشغيل' if en else 'إيقاف'}"
                    + (f" · {'تنفيذ' if ex else 'فحص فقط'} كل {iv:g}س" if en else "")
                )
                if en:
                    def _cycle(run_exec: bool) -> None:
                        do_check(cfg, state, with_portfolio=True)
                        if run_exec:
                            do_execute(cfg, state)
                            do_check(cfg, state)
                    threading.Thread(target=_cycle, args=(ex,), daemon=True).start()
                return self._send(200, self._state_dict())
            if self.path == "/api/config":
                self._apply_config(self._read_json())
                threading.Thread(target=lambda: do_check(cfg, state), daemon=True).start()
                return self._send(200, self._state_dict())
            if self.path == "/api/perf-reset":
                state.reset_equity()
                state.log("تصفير سجل الأداء — البداية من الآن")
                threading.Thread(target=lambda: do_check(cfg, state), daemon=True).start()
                return self._send(200, self._state_dict())
            if self.path == "/api/ledger-reset":
                reset_ledger()
                state.log("تصفير سجل الصفقات والأرباح المحقّقة")
                return self._send(200, self._state_dict())
            if self.path == "/api/flatten":
                full = bool(self._read_json().get("full", False))
                res = do_flatten(cfg, state, full=full)
                do_check(cfg, state)
                return self._send(200, {**self._state_dict(), "result": res})
            if self.path == "/api/clean-start":
                res = do_flatten(cfg, state, full=True)
                reset_ledger()
                state.reset_equity()
                with state.lock:
                    state.halted = False
                state.log("♻️ بداية نظيفة: تصفية الكل لـUSDT + تصفير السجل والأداء")
                threading.Thread(target=lambda: do_check(cfg, state, with_portfolio=True), daemon=True).start()
                return self._send(200, {**self._state_dict(), "result": res})
            if self.path == "/api/backtest":
                long_hist = bool(self._read_json().get("long", False))
                res = do_backtest(cfg, state, long_history=long_hist)
                return self._send(200, {**self._state_dict(), "backtest_result": res})
            if self.path == "/api/resume":
                with state.lock:
                    state.halted = False
                state.reset_equity()  # reset peak so the breaker doesn't instantly refire
                state.log("استئناف التداول بعد قاطع الدائرة — أُعيد ضبط القمّة")
                threading.Thread(target=lambda: do_check(cfg, state), daemon=True).start()
                return self._send(200, self._state_dict())
            return self._send(404, {"error": "not found"})

    return Handler


def _refresh_loop(cfg: AppConfig, state: AppState) -> None:
    """Keep signal/account/equity fresh (and the PnL curve growing) every 5 min.

    Also reacts FAST to a portfolio roll-over: if the book gave back from its peak
    while auto-execute is on, bank the winners now instead of waiting for the
    hourly cycle (so a +20% top isn't fully given back before the next execute)."""
    while True:
        time.sleep(300)
        try:
            do_check(cfg, state)
            with state.lock:
                ready = (state.auto_enabled and state.auto_execute and not state.halted
                         and time.time() >= state.port_tp_cooldown_until)
            prices = (state.account or {}).get("_prices") or {}
            if ready and prices:
                cur = load_ledger().summary(prices).get("strategy_pnl")
                if _port_tp_should_bank(cur, state.pnl_peak_usd,
                                        cfg.port_tp_arm_usd, cfg.port_tp_giveback):
                    state.log("⚡ تراجع المحفظة عن القمّة — جني ربح فوري")
                    do_execute(cfg, state)
        except Exception:  # noqa: BLE001
            pass


def main(cfg: AppConfig | None = None, *, open_browser: bool = True) -> None:
    cfg = cfg or AppConfig()
    _load_config(cfg)  # restore saved budget/settings across restarts (not live)
    state = AppState()
    state.equity_history = _load_equity_history()
    _load_auto(state)  # resume autonomous trading after a restart (testnet-safe)
    state.log("بدء اللوحة" + (" · استئناف التداول التلقائي" if state.auto_enabled else ""))
    threading.Thread(target=_auto_loop, args=(cfg, state), daemon=True).start()
    threading.Thread(target=_refresh_loop, args=(cfg, state), daemon=True).start()
    # initial signal fetch in background so the page loads instantly
    threading.Thread(target=lambda: do_check(cfg, state, with_portfolio=True), daemon=True).start()
    httpd = ThreadingHTTPServer(("127.0.0.1", cfg.port), make_handler(cfg, state))
    url = f"http://127.0.0.1:{cfg.port}"
    print(f"[beta] ZAMBAHOLA BETA Console -> {url}")
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[beta] stopped")


if __name__ == "__main__":
    main()
