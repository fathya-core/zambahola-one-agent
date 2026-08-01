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
    BinanceMargin,
    BinanceSpot,
    RiskLimits,
    load_keys,
    plan_rebalance,
    safety_gate,
)
from .ledger import append_trade, load_ledger, load_trades, reset_ledger, save_ledger
from .perf import readiness as _readiness_of
from .benchmark import refresh_benchmark, compute_benchmark
from .research import research_digest
from .strategy import compare_portfolios, current_allocation


# Binance spot min order notional. Balances worth less than this can't be sold
# (the exchange rejects sub-$10 orders), so they are treated as unsellable dust.
MIN_NOTIONAL_USD = 10.0

# CROSS-MARGIN liquidation guard. Binance margin-calls at level 1.3 and force-
# liquidates at 1.1 — we act FAR above both: stop opening new positions below
# BLOCK_BUYS and actively sell down (AUTO_REPAY) below DELEVERAGE, back up to
# TARGET. A book at our default gross cap 2x sits at level ≈2.0, so a healthy
# portfolio never even approaches these thresholds; they are the backstop.
MARGIN_LEVEL_BLOCK_BUYS = 1.8
MARGIN_LEVEL_DELEVERAGE = 1.4
MARGIN_LEVEL_TARGET = 2.0


def _margin_deleverage_usd(gross_assets: float, debt: float,
                           target_level: float = MARGIN_LEVEL_TARGET) -> float:
    """USD of positions to sell (with AUTO_REPAY) so marginLevel recovers to
    `target_level`. Selling x repays x of debt, moving the level from A/D to
    (A-x)/(D-x) = target  ->  x = (target*D - A)/(target - 1)."""
    if debt <= 0 or target_level <= 1.0:
        return 0.0
    x = (target_level * debt - gross_assets) / (target_level - 1.0)
    return max(0.0, min(x, gross_assets))


def _levered_targets(targets: dict, lev_map: dict) -> dict:
    """Margin execution: a pick's target notional = weight x its per-coin leverage
    (advisor or manual override, never below 1). Exit targets (<=0) untouched."""
    return {s: (round(w * max(1.0, float(lev_map.get(s, 1.0))), 4) if w > 0 else w)
            for s, w in targets.items()}


def _perf_path() -> Path:
    return Path(os.environ.get("ZAMBAHOLA_DATA_DIR", "data")) / "equity_history.json"


def _data_dir() -> Path:
    return Path(os.environ.get("ZAMBAHOLA_DATA_DIR", "data"))


# Progressive trailing-stop tiers (peak_gain_threshold, trail_pct). Inspired by
# opencrypto, but a multi-year A/B (_trailsweep) showed tightening HURTS this
# strategy badly: it cuts winners early (avg winner +80% -> +44%) and doubles
# trade count into whipsaw, dropping mean compounded return from +25% to +6%.
# So progressive_trail defaults OFF; these tiers exist only for experimentation.
_TRAIL_TIERS = (
    (0.60, 0.10),
    (0.40, 0.13),
    (0.25, 0.18),
    (0.15, 0.25),
)


_LAST_READY: dict[str, int] = {"closed": -1}


def compute_readiness() -> dict:
    """Directional-readiness snapshot from the live ledger (no side effects)."""
    try:
        return _readiness_of(_data_dir() / "trades.jsonl")
    except Exception:  # noqa: BLE001
        return {}


def refresh_readiness(state: "AppState") -> dict:
    """Compute readiness, persist READINESS.json, and log ONE line whenever a new
    trade closes (so the phone/dashboard always shows an up-to-date GO/NO-GO)."""
    r = compute_readiness()
    if not r:
        return r
    try:
        p = _data_dir() / "READINESS.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    if r.get("closed", 0) != _LAST_READY.get("closed"):
        _LAST_READY["closed"] = r.get("closed", 0)
        pf = "∞" if r.get("profit_factor") is None else f"{r['profit_factor']:.2f}"
        icon = "✅" if r.get("ready") else "⏳"
        tail = "GO" if r.get("ready") else f"يلزم {r.get('need_more', 0)} صفقة"
        state.log(f"{icon} جاهزية: {r['closed']} صفقة · إصابة {r['hit_rate']:.0f}% · PF {pf} · {tail}")
    return r


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
            "last_rebalance_candle": state.last_rebalance_candle,
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
        state.last_rebalance_candle = str(d.get("last_rebalance_candle", state.last_rebalance_candle))
        state.pnl_peak_usd = float(d.get("pnl_peak_usd", state.pnl_peak_usd))
        state.port_tp_cooldown_until = float(d.get("port_tp_cooldown_until", state.port_tp_cooldown_until))
        raw = d.get("sell_ban_until")
        if isinstance(raw, dict):
            state.sell_ban_until = {str(k): float(v) for k, v in raw.items()}
    except Exception:  # noqa: BLE001
        pass


_PERSIST_FIELDS = (
    "mode", "interval", "max_total", "universe_size", "min_quote_volume_usd", "top_n", "max_order_usd", "max_total_usd",
    "rebalance_band", "take_profit_pct", "take_profit_frac", "breaker_pct", "max_correlation",
    "stop_pct", "conviction_power", "vol_power", "cap_vol_ref", "target_vol", "profit_lock_arm", "profit_lock_giveback",
    "min_hold_hours", "hard_stop_pct",
    "port_tp_arm_usd", "port_tp_giveback", "port_tp_sell_frac", "port_tp_cooldown_h",
    "max_weight", "reentry_ban_hours", "stop_cooldown_hours", "participation_cap",
    "adaptive_liquidity", "progressive_trail",
    "starter_frac", "starter_max_vol", "starter_min_mom30", "starter_regime_min",
    "max_entry_gap_pct", "entry_quality_dd_penalty", "entry_max_dd",
    "max_spike_1d", "spike_base_max", "min_score_frac",
    "max_lev", "lev_target_vol", "lev_gross_cap", "lev_overrides",
    "margin",
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
    # live spot cannot lever: a persisted UI "leverage" >1 only inflates the target
    # weights and silently disables the regime cash-scaling (Aug 1: 3x deployed 100%
    # of the real book in a 0.50 regime that called for ~50% cash).
    if cfg.live and cfg.max_total > 1.0:
        cfg.max_total = 1.0


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
 <div><div class="k">التعرّض على spot (بدون اقتراض)</div>
  <div class="flex" id="lev">
   <button class="sec lv" data-v="0.5">محافظ 0.5x</button>
   <button class="sec lv" data-v="1">كامل 1x</button>
  </div></div>
</div>
<div style="margin-top:8px"><div class="k">الرافعة القصوى للمحفظة (صريحة — فيوتشرز)</div>
 <div class="flex" id="levcap">
  <button class="sec lc" data-v="1">×1 (بدون)</button>
  <button class="sec lc" data-v="2">×2</button>
  <button class="sec lc" data-v="3">×3</button>
  <button class="sec lc" data-v="5">×5 ⚠</button>
  <button class="sec lc" data-v="10">×10 ⚠</button>
 </div><small id="levnote" style="color:var(--mut)"></small></div>
<div style="margin-top:8px"><div class="k">رافعة حقيقية بالاقتراض (مارجن متقاطع — مفعّل على مفتاحك)</div>
 <div class="flex">
  <button id="mgbtn" class="sec">🏦 تفعيل المارجن (ترحيل تلقائي)</button>
  <small id="mgstats" style="color:var(--mut)"></small>
 </div></div>
<div style="margin-top:8px"><div class="k">رافعة يدوية لعملة محددة (تجربة — تتجاوز اقتراح المحرك)</div>
 <div class="flex">
  <input id="lovsym" placeholder="مثال: UNI" style="width:110px;text-transform:uppercase">
  <input id="lovval" type="number" min="1" max="10" step="0.5" placeholder="×الرافعة" style="width:100px">
  <button id="lovadd" class="sec">➕ طبّق</button>
 </div><div id="lovlist" class="k" style="margin-top:5px"></div></div>
<div style="margin-top:8px"><div class="k">الإطار الزمني (أسرع = أنشط)</div>
 <div class="flex" id="tf">
  <button class="sec tfb" data-v="1d">يومي</button>
  <button class="sec tfb" data-v="12h">12س</button>
  <button class="sec tfb" data-v="8h">8س</button>
  <button class="sec tfb" data-v="4h">4س ⚡</button>
 </div><small id="tfnote" style="color:var(--mut)"></small></div>
<div class="row" style="margin-top:6px">
 <div><div class="k">عدد العملات الممسوحة</div><input id="uni" type="number" min="5" max="120" style="width:90px"></div>
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
<div id="readystat" class="k" style="margin-top:8px;padding:7px 10px;border-radius:8px;background:#0d1526"></div>
<div id="benchstat" class="k" style="margin-top:8px;padding:7px 10px;border-radius:8px;background:#0d1526"></div>
<div class="k" style="margin-top:10px;margin-bottom:2px"><b>المراكز المفتوحة (ربح/خسارة حيّة)</b></div>
<div id="opentbl" class="sub"></div>
<div class="k" style="margin-top:10px;margin-bottom:2px"><b>سجل الحركات</b></div>
<div id="tradetbl" class="sub" style="margin-top:2px"></div></div>

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
let LIVE=false,AUTO=false,MARGIN=false;
function setIf(id,v){const e=$(id);if(e&&document.activeElement!==e&&v!=null)e.value=v;}
function render(s){
 LIVE=!!s.live;AUTO=!!s.auto_enabled;MARGIN=!!s.margin;
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
 document.querySelectorAll(".lc").forEach(b=>b.className=(parseFloat(b.dataset.v)===s.lev_gross_cap)?"lc":"sec lc");
 document.querySelectorAll(".tfb").forEach(b=>b.className=(b.dataset.v===s.interval)?"tfb":"sec tfb");
 $("tfnote").textContent="الإطار الحالي: "+(s.interval||"1d")+(s.interval&&s.interval!=="1d"?" — أسرع، صفقات أكثر ورسوم أكثر":" — موصى به (مُثبت)");
 {const ge=s.signal&&s.signal.gross_exposure!=null?s.signal.gross_exposure:null;const eff=(s.lev_gross_cap!=null&&s.regime!=null)?(s.lev_gross_cap*s.regime).toFixed(2):"—";
  const tail=s.live?(s.margin?' · <span style="color:var(--up)">التنفيذ فعلي بالاقتراض (مارجن) — MARGIN_BUY/AUTO_REPAY</span>':' · <span style="color:var(--warn)">التنفيذ spot=×1 — فعّل المارجن بالأسفل لرافعة حقيقية</span>'):"";
  $("levnote").innerHTML=(s.lev_gross_cap>1?("رافعة صريحة ×"+s.lev_gross_cap+" · السقف الفعّال الآن = ×"+s.lev_gross_cap+"×وضع السوق = <b>"+eff+"</b>"+(ge!=null?" · التعرّض الحالي <b>"+ge+"</b>":"")):"بدون رافعة (×1)")+tail;}
 {const ms=(s.account&&s.account.margin)||null;
  $("mgbtn").textContent=MARGIN?"⛔ إيقاف المارجن والرجوع لسبوت":"🏦 تفعيل المارجن (ترحيل تلقائي)";
  $("mgbtn").className=MARGIN?"":"sec";
  let mt="";
  if(MARGIN&&ms){const lv=ms.margin_level>=999?"∞":Number(ms.margin_level).toFixed(2);const lc=(ms.margin_level<1.8&&ms.margin_level<999)?"var(--warn)":"var(--up)";
   mt='مستوى الهامش <b style="color:'+lc+'">'+lv+'</b> · قرض $'+(ms.debt_usdt||0)+' · صافي $'+(ms.net_equity_usd!=null?ms.net_equity_usd:"—")+' · حارس تصفية: حظر شراء &lt;1.8، تخفيض &lt;1.4';}
  else if(MARGIN)mt="مفعّل — بانتظار قراءة الحساب";
  else mt=s.live?"مطفأ — الشراء نقدي فقط. التفعيل: بيع سبوت → تحويل USDT ضمان → اقتراض فعلي":"يتطلّب الوضع الحقيقي (live)";
  $("mgstats").innerHTML=mt;}
 {const ov=s.lev_overrides||{};const ks=Object.keys(ov);
  $("lovlist").innerHTML=ks.length?("رافعات يدوية: "+ks.map(k=>'<span style="display:inline-block;background:#12203a;padding:2px 8px;border-radius:10px;margin:2px">'+k.replace('USDT','')+' ×'+ov[k]+' <a href="#" data-rm="'+k+'" class="lovrm" style="color:var(--down);text-decoration:none">✕</a></span>').join(" ")):"لا رافعات يدوية — المحرك يقترح تلقائياً.";
  document.querySelectorAll(".lovrm").forEach(a=>a.onclick=async(e)=>{e.preventDefault();render(await api('/api/config','POST',{lev_overrides:{[a.dataset.rm]:0}}));});}
 setIf("uni",s.universe_size);setIf("topn",s.top_n);setIf("ord",s.max_order_usd);setIf("tot",s.max_total_usd);
 {let sc=s.scanned!=null?("مُسح "+s.scanned+" عملة"):"";if(s.regime!=null){const rp=Math.round(s.regime*100);sc+=" · وضع السوق: "+rp+"% "+(rp>=80?"🟢":(rp>=55?"🟡":"🔴 خطر"));}$("scanned").textContent=sc;}
 // market scan table (smart score = risk-adjusted momentum + acceleration + relative strength)
 const ranked=s.ranked||s.signal?.ranked;
 if(ranked&&ranked.length){let h='<table><tr><th>#</th><th>العملة</th><th>السعر</th><th>قوة الترند</th><th>زخم 90ي</th><th>عائد/مخاطرة</th><th>الوزن</th><th>رافعة مقترحة</th><th>الحالة</th></tr>';
 ranked.forEach((r,i)=>{const inv=r.action==="INVEST";const lv=(inv&&r.lev)?('×'+r.lev+(r.lev_manual?' ✋':(r.lev>=5?' 💪':''))):'—';h+=`<tr><td>${i+1}</td><td><b>${r.symbol}</b></td><td>${r.price}</td>
  <td>${Math.round((r.trend_consensus||0)*100)}%</td><td style="color:${r.momentum>=0?'var(--up)':'var(--down)'}">${(r.momentum*100).toFixed(1)}%</td>
  <td style="color:${(r.risk_adj||0)>=0?'var(--up)':'var(--down)'}">${(r.risk_adj!=null?r.risk_adj.toFixed(2):'—')}</td>
  <td>${Math.round((r.target_weight||0)*100)}%</td><td style="color:${(r.lev||1)>1?'var(--up)':'var(--mut)'}"><b>${lv}</b></td><td>${inv?'<span class="badge b-up">استثمر</span>':(r.action==="STOP"?'<span class="badge b-down">وقف خسارة</span>':(r.action==="UPTREND"?'<span class="badge b-warn">صاعد</span>':'<span class="badge b-mut">—</span>'))}</td></tr>`;});
 if(s.signal&&s.signal.gross_exposure!=null)h+='<div class="k" style="margin-top:6px">الرافعة: يقترحها المحرك لكل عملة (تقلّب + قناعة + وضع السوق + أمان التصفية)؛ ✋ = رافعة يدوية منك · 💪 = ≥×5. '+(s.live?'التنفيذ الحالي spot = ×1 (استشارية)؛ تفعيلها الفعلي يتطلّب حساب فيوتشرز.':'')+'</div>';
 $("market").innerHTML=h+'</table>';}
 else $("market").textContent="السوق كله هابط الآن — البقاء نقداً هو القرار الصحيح (حماية من الخسارة).";
 const a=$("assets");a.innerHTML="";
 const rs=s.signal?s.signal.reasons:{};
 for(const sym in rs){const r=rs[sym];if((r.target_weight||0)<=0)continue;const pct=Math.round((r.trend_consensus||0)*100);
  a.innerHTML+=`<div class="card"><div class="flex"><b>${sym}</b><span class="sw">${actionBadge(r.action)}</span></div>
  <div class="big">${r.price}</div><div class="k">السعر</div>
  <div style="margin-top:8px">قوة الترند: ${pct}%<div class="bar"><i style="width:${pct}%"></i></div></div>
  <div class="k" style="margin-top:8px">الوزن الهدف: ${Math.round((r.target_weight||0)*100)}% · تقلّب: ${Math.round((r.realized_vol_ann||0)*100)}%${(r.lev&&r.lev>1)?' · رافعة مقترحة: <b style="color:var(--up)">×'+r.lev+'</b>':''}</div></div>`;}
 if(s.cash_weight!=null&&s.cash_weight>0.001)a.innerHTML+=`<div class="card"><div class="flex"><b>نقد</b><span class="sw badge b-mut">${Math.round(s.cash_weight*100)}%</span></div><div class="k" style="margin-top:8px">غير مستثمر — حماية من الهبوط</div></div>`;
 $("acctstatus").innerHTML=s.account?.connected?'<span class="badge b-up">متصل</span>':'<span class="badge b-mut">غير متصل (أضف المفاتيح)</span>';
 $("equity").textContent=s.account?.equity_usd!=null?("$"+s.account.equity_usd):"—";
 if(s.account?.balances){let bt=Object.entries(s.account.balances).map(([k,v])=>k+": "+v).join("  ·  ");const dc=s.account.dust_count||0,du=s.account.dust_usd||0;if(dc>0)bt+="   · غبار testnet: "+dc+" عملة (~$"+du+" غير قابلة للبيع)";$("balances").textContent=bt;$("balances").style.color="";}else{$("balances").textContent=s.account?.error||"";$("balances").style.color=s.account?.error?"var(--warn)":"";}
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
 {const op=lg.open_positions||{};const ks=Object.keys(op);if(ks.length){let oh='<table><tr><th>العملة</th><th>قيمة</th><th>دخول</th><th>حالي</th><th>ربح/خسارة</th></tr>';
   for(const k of ks){const p=op[k];const u=p.upnl_usd;const uc=(u>0?'var(--up)':(u<0?'var(--down)':'var(--mut)'));const pv=(u!=null)?((u>0?'+':'')+'$'+u+' ('+(p.upnl_pct>0?'+':'')+p.upnl_pct+'%)'):'—';
     oh+=`<tr><td><b>${k.replace('USDT','')}</b></td><td>${p.value_usd!=null?'$'+p.value_usd:'—'}</td><td>${p.avg}</td><td>${p.price!=null?p.price:'—'}</td><td style="color:${uc}">${pv}</td></tr>`;}
   $("opentbl").innerHTML=oh+'</table>';}else $("opentbl").textContent="لا مراكز مفتوحة.";}
 {const rd=s.readiness;const el=$("readystat");if(rd&&rd.closed!=null){const pf=rd.profit_factor==null?'∞':rd.profit_factor.toFixed(2);
   const go=rd.ready;const clr=go?'var(--up)':(rd.verdict==='NO-GO: perf'?'var(--down)':'#f5a623');
   const badge=go?'✅ جاهز (GO)':(rd.need_more>0?('⏳ يلزم '+rd.need_more+' صفقة'):'🔴 الأداء دون العتبة');
   const pct=Math.min(100,Math.round(rd.closed/(rd.min_trades||50)*100));
   el.innerHTML=`<b style="color:${clr}">جاهزية الواقع: ${badge}</b> · إصابة ${rd.hit_rate}% (هدف ${rd.gate_hit}%) · PF ${pf}`+
     `<div style="margin-top:5px;height:6px;background:#1b2740;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${clr}"></div></div>`+
     `<div style="margin-top:3px" class="k">${rd.closed}/${rd.min_trades||50} صفقة نحو حكم موثوق — تلقائي بالكامل</div>`;}
  else if(el){el.textContent='جاهزية الواقع: تُحسب تلقائياً بعد أول صفقة مغلقة';}}
 {const bm=s.benchmark;const be=$("benchstat");if(bm&&bm.ok){const ab=bm.alpha_vs_btc_pct;const clr=ab!=null?(ab>=0?'var(--up)':'var(--down)'):'var(--mut)';
   const bh=(bm.btc_hodl_pct!=null?bm.btc_hodl_pct:'—');const ew=(bm.equal_weight_pct!=null?bm.equal_weight_pct:'—');const av=(ab!=null?ab:'—');
   if(be)be.innerHTML=`<b style="color:${clr}">مقابل السوق (محلي)</b> · استراتيجية ${bm.strategy_return_pct}% · BTC ${bh}% · EW ${ew}% · α=${av}%`;
 }else if(be){be.textContent='مقابل السوق: يُحدَّث تلقائياً مع منحنى المحفظة';}}
 const tr=s.trades||[];
 if(tr.length){let h='<table><tr><th>الوقت</th><th>النوع</th><th>العملة</th><th>$</th><th>ربح</th><th>السبب</th></tr>';
  tr.slice().reverse().forEach(t=>{const sell=t.side==='SELL';const rp=t.realized||0;const pl=sell?(`<span style="color:${rp>0?'var(--up)':(rp<0?'var(--down)':'var(--mut)')}">${rp?((rp>0?'+':'')+'$'+rp+(t.gain_pct!=null?' ('+(t.gain_pct>0?'+':'')+t.gain_pct+'%)':'')):'$0'}</span>`):'<span class="k">— دخول</span>';h+=`<tr><td>${(t.t||'').slice(5,16)}</td><td>${sell?'بيع':'شراء'}</td><td><b>${t.symbol.replace('USDT','')}</b></td><td>$${t.usd}</td><td>${pl}</td><td class="k">${t.why||''}</td></tr>`;});
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
document.querySelectorAll(".lc").forEach(b=>b.onclick=async()=>{const v=parseFloat(b.dataset.v);if(v>3&&!confirm("رافعة ×"+v+" تضخّم الربح والخسارة معاً وتضيف خطر تصفية. للتجربة — متأكد؟"))return;render(await api('/api/config','POST',{lev_gross_cap:v}));});
$("lovadd").onclick=async()=>{let sym=($("lovsym").value||"").trim().toUpperCase();const val=parseFloat($("lovval").value);if(!sym||!(val>=1)){alert("اكتب رمز العملة ورافعة ≥ 1 (مثال: UNI و 5)");return;}if(val>3&&!confirm("رافعة يدوية ×"+val+" على "+sym+" — تتجاوز حماية المحرك للتجربة. متأكد؟"))return;render(await api('/api/config','POST',{lev_overrides:{[sym]:val}}));$("lovsym").value="";$("lovval").value="";};
$("mgbtn").onclick=async()=>{const on=!MARGIN;
 if(on){if(!confirm("تفعيل الرافعة الحقيقية (مارجن متقاطع): بيع مراكز سبوت الحالية، تحويل كل USDT لمحفظة المارجن كضمان، والشراء يقترض فعلياً (MARGIN_BUY) بفائدة ساعية وAUTO_REPAY عند البيع. فيه خطر تصفية إذا انهار السوق (حارس آلي عند مستوى 1.4). متأكد؟"))return;
  if(!confirm("تأكيد أخير: اقتراض حقيقي بأموال حقيقية. نكمل؟"))return;}
 else{if(!confirm("إيقاف المارجن: بيع مراكز المارجن + سداد القرض + إرجاع USDT لسبوت. متأكد؟"))return;}
 $("mgbtn").disabled=true;$("mgbtn").textContent="⏳ جاري الترحيل…";
 try{const r=await api('/api/margin','POST',{on});render(r);if(r.result&&r.result.error)alert(r.result.error);}finally{$("mgbtn").disabled=false;}};
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
    universe_size: int = 75  # how many top coins to scan (wide = catch uptrends beyond the mega-caps)
    min_quote_volume_usd: float = 50_000_000.0  # fixed LIQUIDITY FLOOR (used only when adaptive off)
    adaptive_liquidity: bool = True  # dynamic floor: top-N above the $5M dust guard, adapts to market
    top_n: int = 5  # MAX strongest uptrends (5 spreads risk + generalises better than 3 in walk-forward)
    max_weight: float = 0.35  # concentration cap: no single coin above 35% of the book (lower = safer)
    max_order_usd: float = 1000.0  # per-order slippage cap (high = don't throttle deployment)
    max_total_usd: float = 1000.0  # total budget to deploy across picks
    participation_cap: float = 0.005  # liquidity-aware: cap each order to 0.5% of the coin's 24h volume
    rebalance_band: float = 0.2  # fee-aware: ignore drifts < 20% of position
    take_profit_pct: float = 15.0  # trim a winner once it's up this % from avg cost
    take_profit_frac: float = 0.3  # how much of the position to trim (opportunistic)
    breaker_pct: float = 18.0  # halt + go cash if equity falls this % from peak
    max_correlation: float = 0.85  # diversification: skip picks too correlated
    stop_pct: float = 0.35  # trailing stop from PEAK — wide "let winners run" (backtested best)
    progressive_trail: bool = False  # OFF: A/B showed tightening cuts winners early (+25% -> +6% comp). Kept for experiments only.
    hard_stop_pct: float = 0.12  # hard stop from COST: cut a loser this far underwater (tightened from 0.15 to cap single-trade loss)
    conviction_power: float = 1.5  # concentrate weight toward the strongest trends
    vol_power: float = 2.0  # >1 penalises hyper-volatile coins harder (anti-concentration)
    cap_vol_ref: float = 1.5  # vol-aware cap ref: a coin's max weight shrinks if vol>ref
    # starter tier: deploy idle cash into CALM, trend-confirmed coins whose short-term
    # momentum only softened (not collapsed), at a reduced weight. A/B (starter_frac=0.4):
    # trending window +94%->+116% return, Sharpe 1.57->1.76, drawdown -33%->-27%.
    # Walk-forward showed the edge is REGIME-DEPENDENT, so starters only fire in risk-on
    # markets (regime>=starter_regime_min): keeps ~96% of the upside, removes the choppy
    # drag entirely (OOS matched cash-heavy). 0 = old cash-heavy behaviour.
    starter_frac: float = 0.4
    starter_max_vol: float = 1.5  # only calm coins qualify as starters (avoid adding hyper-vol risk)
    starter_min_mom30: float = -0.10  # don't starter a coin already falling >10% in 30d
    starter_regime_min: float = 0.65  # only deploy starters when the market is risk-on (regime gate)
    # entry QUALITY tilt: scale a pick's score down by dd_penalty * (drawdown from its
    # recent high). Prefers clean trends near highs over 'big past momentum but now
    # bleeding' names -> fewer entries into rolling-over coins. Walk-forward (IS/OOS)
    # picked 1.0: OOS return 39.9%->41.7%, Sharpe 0.90->0.93, dd -38.0%->-37.4%; 2.0
    # overfit (best IS, worst OOS). 0 = original momentum-only ranking.
    entry_quality_dd_penalty: float = 1.0
    # refuse NEW full picks already rolled over > this fraction from their 60d high
    # (ZEC -24%, TLM -23% were 'past momentum' traps). Starters unchanged.
    entry_max_dd: float = 0.12
    # SINGLE-DAY PUMP guard: refuse a NEW full pick whose last day spiked >= max_spike_1d
    # while the 6-day base BEFORE it was <= spike_base_max (a fresh pump on a dead trend,
    # not a sustained one). DODO popped +44% in a day on a -5% prior week -> the spike
    # flipped consensus to 1.0 so the old gate bought the top and it reverted -12% (-$317
    # real loss). A genuine trend that also popped (DEXE +25% on a +59% base) is kept. A/B
    # on established coins: identical return/Sharpe (never rejects a real winner).
    max_spike_1d: float = 0.20
    spike_base_max: float = 0.0
    # relative CONVICTION FLOOR: drop full picks scoring < this fraction of the best
    # full score (starters exempt). Long-basket A/B at 0.30: return +173%->+179%,
    # drawdown -41%->-40%, WFE ~2.0 — concentrates capital in real conviction and
    # (on a small live book) avoids sub-$10 slices that can never fill.
    min_score_frac: float = 0.30
    # PER-COIN LEVERAGE ADVISOR (x1..x max_lev): computed per pick from vol budget x
    # conviction x (soft) regime with a hard liquidation-safety cap (see
    # suggest_leverage). Long-basket A/B (4.4y, 20bps + funding + liquidation sim):
    # 179% -> 250% return at the SAME -40% drawdown, Sharpe 1.09 -> 1.17, 0
    # liquidations; gross caps above x2 add nothing (the per-coin liquidation-safety
    # math is the binding constraint, by design — that's what keeps drawdown flat).
    # ADVISORY on spot (execution stays 1x — spot physically cannot lever); futures
    # execution (when a futures account/keys exist) will consume it per position.
    max_lev: float = 10.0
    lev_target_vol: float = 0.9   # levered position's annualised-vol budget
    lev_gross_cap: float = 2.0    # portfolio guard: sum(weight x lev) <= this x regime
    # MANUAL per-coin leverage overrides (explicit, for experimentation): {SYM: x}.
    # Replaces the advisor for that coin (clamped to [1, max_lev]); the portfolio
    # gross cap protects overrides first and only trims them as a last resort.
    lev_overrides: dict = field(default_factory=dict)
    profit_lock_arm: float = 0.15  # arm the profit ratchet once a position is up this %
    profit_lock_giveback: float = 0.07  # FLOOR give-back; actual is vol-adaptive (7%-18%)
    min_hold_hours: float = 24.0  # anti-churn: hold a new position at least this long (rotation only)
    # portfolio take-profit ratchet: bank winners when the WHOLE book rolls over from its peak
    port_tp_arm_usd: float = 2500.0  # only active once strategy PnL peaked >= this many $ (~5% of capital; hair-trigger banking kills winners early)
    port_tp_giveback: float = 0.3  # bank when PnL gives back this FRACTION of the peak gain (let winners breathe)
    port_tp_sell_frac: float = 0.5  # how much of each winner to bank (lock to cash)
    port_tp_cooldown_h: float = 8.0  # after banking, park profit in cash (no new buys) this long
    reentry_ban_hours: float = 48.0  # after forced exit, block re-buy this long (anti-churn)
    stop_cooldown_hours: float = 336.0  # after a trailing-stop sell, block re-buy (anti-whipsaw, ~14d)
    # FALLING-KNIFE guard: the signal is computed on CLOSED daily candles but orders
    # execute at the LIVE price. If a coin has already crashed this far BELOW the close
    # the buy decision was based on, the uptrend thesis is broken -> skip the new entry
    # (stay in cash) instead of catching the knife. EPIC lost -$921 entering ~24% below
    # its decision candle; this blocks exactly that. Execution-layer only (a daily
    # backtest enters AT the close so gap=0 and it never triggers there).
    max_entry_gap_pct: float = 0.10
    live: bool = False  # SAFE default; enable REAL trading via --live / watchdog -Live / dashboard toggle
    # REAL leverage via CROSS-MARGIN borrowing (the user's key has enableMargin;
    # futures is a separate permission that is off). Toggled ONLY through the
    # /api/margin flow (liquidate spot -> transfer USDT -> switch), never by a
    # bare config write — flipping it silently would strand positions in the
    # other wallet. Requires live=True; ignored on testnet (no /sapi margin API).
    margin: bool = False
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
    last_rebalance_candle: str = ""  # `as_of` of the last candle we ROTATED on (anti-churn)
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
    # keep the UI clean & HONEST: a Binance testnet faucet seeds the wallet with
    # hundreds of tiny coin balances the agent never traded, all below the $10 min
    # notional -> physically UNSELLABLE. Separate real holdings from that faucet dust
    # so the dashboard shows meaningful positions, not 400 lines of junk.
    valued.sort(key=lambda x: x[2], reverse=True)
    real = [v for v in valued if v[2] >= MIN_NOTIONAL_USD]
    dust = [v for v in valued if v[2] < MIN_NOTIONAL_USD]
    shown = {quote: round(balances.get(quote, 0.0), 2)}
    for b, q, _usd in real[:12]:
        shown[b] = round(q, 6)
    return {"connected": True, "equity_usd": round(equity, 2),
            "balances": shown, "holdings_count": len(real),
            "dust_count": len(dust), "dust_usd": round(sum(v[2] for v in dust), 2),
            "_prices": prices}


# ---------- actions ----------

def _connect(live: bool, margin: bool = False) -> BinanceSpot | None:
    try:
        keys = load_keys(testnet=not live)
    except RuntimeError:
        return None
    # margin exists on live only; on testnet the flag is ignored (spot client)
    if live and margin:
        client: BinanceSpot = BinanceMargin(keys)
    else:
        client = BinanceSpot(keys, testnet=not live)
    client.sync_time()  # align to server clock -> avoid -1021 on signed orders
    return client


def _live_prices(symbols: list[str]) -> dict[str, float]:
    """Current spot prices for display — signals run on CLOSED candles (no
    look-ahead), but the price SHOWN to the user must be the live market, not the
    last daily close (which can be ~24h stale for a coin that moved a lot). Uses
    the public ticker with host failover; returns {} on failure (display falls
    back to the candle close)."""
    import requests as _rq

    from .data import KLINE_HOSTS
    for host in KLINE_HOSTS:
        try:
            r = _rq.get(f"{host}/api/v3/ticker/price", timeout=10)
            r.raise_for_status()
            want = set(symbols)
            return {d["symbol"]: float(d["price"]) for d in r.json()
                    if d["symbol"] in want}
        except Exception:  # noqa: BLE001
            continue
    return {}


def _scan_signal(cfg: AppConfig, *, exclude: set | None = None) -> tuple[dict, list[str], dict]:
    """Market-wide scan -> (signal dict, scanned symbols by volume, frames).

    `exclude` = symbols under an active re-entry ban; they're dropped from PICK
    eligibility so the book fills with the next-best available uptrend instead of
    parking that capital in cash because the top pick happens to be locked out."""
    from .universe import fetch_frames, fetch_top_symbols, scan

    symbols = fetch_top_symbols(cfg.universe_size, min_quote_volume=cfg.min_quote_volume_usd,
                                adaptive=cfg.adaptive_liquidity)
    frames = fetch_frames(symbols, interval=cfg.interval, total=max(cfg.bars, 400))
    held = {s for s, p in load_ledger().positions.items() if p.qty > 1e-9}
    sc = scan(frames, top_n=cfg.top_n, target_vol=cfg.target_vol, max_total=cfg.max_total,
              stop_pct=cfg.stop_pct, conviction_power=cfg.conviction_power,
              vol_power=cfg.vol_power, cap_vol_ref=cfg.cap_vol_ref,
              max_correlation=cfg.max_correlation, max_weight=cfg.max_weight, held=held,
              exclude=exclude, starter_frac=cfg.starter_frac,
              starter_max_vol=cfg.starter_max_vol, starter_min_mom30=cfg.starter_min_mom30,
              starter_regime_min=cfg.starter_regime_min,
              dd_penalty=cfg.entry_quality_dd_penalty,
              entry_max_dd=cfg.entry_max_dd,
              max_spike_1d=cfg.max_spike_1d, spike_base_max=cfg.spike_base_max,
              min_score_frac=cfg.min_score_frac,
              max_lev=cfg.max_lev, lev_target_vol=cfg.lev_target_vol,
              lev_gross_cap=cfg.lev_gross_cap, lev_overrides=cfg.lev_overrides)
    as_of = ""
    first = next((s for s in symbols if s in frames), None)
    if first is not None:
        as_of = str(frames[first]["open_time"].iloc[-1])
    # overlay live prices for DISPLAY only (keeps signal math on closed candles)
    live = _live_prices([r["symbol"] for r in sc["ranked"]])
    # full candle-close map (ALL scanned coins) for the falling-knife guard — the
    # display list is truncated to 12, but a pick can enter from beyond that slice
    # (correlation filter / hysteresis), and the guard must still see its reference.
    closes = {r["symbol"]: r["price"] for r in sc["ranked"]}
    ranked = sc["ranked"][:12]
    for r in ranked:
        lp = live.get(r["symbol"])
        if lp and lp > 0:
            r["candle_close"] = r["price"]  # what the signal used
            r["price"] = round(lp, 6)       # what the market shows now
    sig = {
        "as_of": as_of,
        "price_live": bool(live),
        "mode": "scan",
        "scanned": sc["scanned"],
        "regime": sc.get("regime", 1.0),
        "targets": sc["targets"],
        "leverage": sc.get("leverage", {}),
        "lev_overridden": sc.get("lev_overridden", []),
        "gross_exposure": sc.get("gross_exposure"),
        "cash_weight": sc["cash_weight"],
        "candle_close": closes,
        "ranked": ranked,
        "reasons": {r["symbol"]: r for r in ranked[:8]},
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
        sig, symbols, frames = _scan_signal(cfg, exclude=set(_active_sell_bans(state)))
    else:
        symbols = list(cfg.assets)
        frames = fetch_many(symbols, interval=cfg.interval, total=max(cfg.bars, 400))
        sig = compute_signal(frames, mode=cfg.mode, target_vol=cfg.target_vol)

    client = _connect(cfg.live, cfg.margin)
    if client is None:
        net = "الحقيقية" if cfg.live else "testnet"
        account = {"connected": False,
                   "error": f"لم يتم العثور على مفاتيح {net} — ضع testnet-keys.txt و binance-API.txt على سطح المكتب"}
    else:
        try:
            assets = tuple(sig["targets"].keys()) or cfg.assets
            account = account_snapshot(client, assets or cfg.assets)
            if isinstance(client, BinanceMargin):
                # equity must be NET of the loan (free coins include borrowed money)
                ms = client.margin_stats()
                account["margin"] = ms
                account["equity_usd"] = round(
                    account.get("equity_usd", 0.0) - ms.get("debt_usdt", 0.0), 2)
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


def _should_rotate(sig_as_of: str, last_candle: str, force: bool) -> bool:
    """Anti-churn: rotate (new entries + rebalance trims) ONLY when the signal candle
    changed since the last rotation, or when explicitly forced (manual button). A daily
    strategy re-run hourly otherwise churns positions on the SAME candle -> micro-losses.
    Protection (stops/locks/breaker) runs every cycle regardless of this gate."""
    if force:
        return True
    if not sig_as_of:  # no candle stamp -> don't block (fail open, act)
        return True
    return sig_as_of != last_candle


def _book_drop_exits(held_syms, book: set, exclude: set) -> set:
    """Held strategy positions no longer among the current picks (`book`) -> prompt exit.

    This is CLEANUP, not churn: the original churn was repeated TRIM-to-target of coins
    STILL in the book. A coin that fully dropped out of the picks (rank fell / left the
    liquid universe) should not be held bleeding for a whole day waiting for the next
    candle — sell it now. `exclude` skips coins already handled by a stop/lock exit."""
    return {s for s in held_syms if s not in book and s not in exclude}


def _falling_knife_skips(targets: dict, close_ref: dict, prices: dict,
                         held: set, max_gap: float) -> list[str]:
    """Zero-out NEW buy targets whose live price is > max_gap below the closed candle
    the signal ranked them on (a broken/stale uptrend). Held positions are left alone
    (their exits are managed elsewhere). Mutates ``targets``; returns human labels of
    the coins that were skipped (e.g. 'EPIC (-24%)')."""
    knifed: list[str] = []
    for sym in list(targets):
        if targets[sym] <= 0 or sym in held:
            continue
        ref = close_ref.get(sym)
        live_px = prices.get(sym, 0.0)
        if ref and live_px > 0 and live_px < ref * (1 - max_gap):
            gap = (live_px / ref - 1) * 100
            targets[sym] = 0.0
            knifed.append(f"{sym[:-4] if sym.endswith('USDT') else sym} ({gap:.0f}%)")
    return knifed


def _consolidate_small_targets(targets: dict, equity_usd: float, min_usd: float,
                               held: set, cap_w: float) -> list[str]:
    """A NEW entry whose target $ sits below the exchange min-notional can never fill:
    the weight silently rots as dead cash while the coin shows as 'picked' (COTI at
    4.3% of a $178 book = $7.6 < $10 -> skipped every cycle). Drop such targets and
    redistribute the freed weight across the remaining picks (proportionally, capped
    per coin at ``cap_w``); whatever can't be absorbed stays cash. Held coins are left
    alone — a small target there is a TRIM instruction, not an unfillable buy.
    Mutates ``targets``; returns the dropped symbols."""
    if equity_usd <= 0 or min_usd <= 0:
        return []
    drop = [s for s, w in targets.items()
            if s not in held and w > 0 and w * equity_usd < min_usd]
    if not drop:
        return []
    freed = 0.0
    for s in drop:
        freed += targets[s]
        targets[s] = 0.0
    for _ in range(3):  # a few passes in case per-coin caps bind
        alive = {s: w for s, w in targets.items() if 0 < w < cap_w}
        if freed <= 1e-9 or not alive:
            break
        ssum = sum(alive.values()) or 1.0
        absorbed = 0.0
        for s, w in alive.items():
            new_w = min(cap_w, w + freed * (w / ssum))
            absorbed += new_w - w
            targets[s] = round(new_w, 4)
        freed -= absorbed
        if absorbed <= 1e-9:
            break
    return drop


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
        wallet_qty = balances.get(base, 0.0)
        wallet_usd = wallet_qty * px
        amt = round(wallet_usd * SELL_MARGIN, 2)
        if amt < min_usd:
            # wallet too small to trade — zero phantom ledger qty so we stop retrying
            p = led.positions.get(sym)
            if p and p.qty > 1e-12:
                loss = wallet_usd - p.cost
                led.realized += loss
                if loss > 0:
                    led.wins += 1
                elif loss < 0:
                    led.losses += 1
                p.qty = p.cost = p.peak = p.t_entry = 0.0
                sold.append(sym)
                state.log(f"🧹 تصفية غبار {sym} (${wallet_usd:.1f}) — إغلاق في الدفتر")
            continue
        try:
            # FULL exit: sell the entire base qty (LOT_SIZE-floored) so nothing is
            # left behind. Falls back to a quote-qty sell if the qty route fails.
            try:
                res = client.market_sell_all(sym, wallet_qty)
                est_gross, est_qty = round(wallet_usd, 2), wallet_qty
            except Exception:  # noqa: BLE001
                res = client.market_order(sym, "SELL", quote_qty=amt)
                est_gross, est_qty = amt, amt / px
            # Book the ACTUAL fill when the exchange reports it (keeps the ledger
            # exactly in sync); fall back to the estimate if the response is bare.
            exq = float((res or {}).get("executedQty", 0) or 0)
            qf = float((res or {}).get("cummulativeQuoteQty", 0) or 0)
            if exq > 0 and qf > 0:
                gross, fill_px, sold_qty = round(qf, 2), qf / exq, exq
            else:
                gross, fill_px, sold_qty = est_gross, px, est_qty
            rec = led.record("SELL", sym, gross, fill_px)
            append_trade({**rec, "mode": "live" if cfg.live else "testnet", "why": why})
            balances[base] = max(0.0, wallet_qty - sold_qty)
            placed += 1
            sold.append(sym)
            pnl = f" · ربح ${rec['realized']}" if rec["realized"] else ""
            state.log(f"{'حقيقي' if cfg.live else 'testnet'} بيع {sym} ${gross} ✓ — {why}{pnl}")
        except Exception as exc:  # noqa: BLE001
            state.log(f"✗ فشل بيع {sym}: {exc}")
    return placed, sold


def _reconcile_ledger(led, balances: dict, allp: dict, state: AppState,
                      *, live: bool = False) -> bool:
    """Idempotency guard: make the ledger match the real wallet every cycle.

    If a failed/partial/out-of-band order left the ledger claiming MORE base units
    than the wallet actually holds, book the missing quantity as sold at the current
    price and shrink (or close) the position. This kills phantom holdings (e.g. a
    coin the ledger thinks is open but the wallet emptied) so risk/rebalance logic
    stops acting on ghosts. We never invent cost basis for surplus wallet coins."""
    changed = False
    for sym, p in list(led.positions.items()):
        if p.qty <= 1e-9:
            continue
        base = sym[:-4] if sym.endswith("USDT") else sym
        wallet_qty = balances.get(base, 0.0)
        px = allp.get(sym, 0.0)
        if px <= 0:
            continue
        missing = p.qty - wallet_qty
        if missing <= 0:
            continue  # wallet has enough (surplus is left alone — no invented basis)
        missing_usd = missing * px
        # MATERIAL desync (a real phantom: failed/out-of-band order): book it as a sell
        # so risk/rebalance logic stops acting on a ghost, and it shows in the audit.
        if missing > p.qty * 0.05 and missing_usd > 25.0:
            rec = led.record("SELL", sym, missing_usd, px)
            append_trade({**rec, "mode": "live" if live else "testnet",
                          "why": "reconcile-phantom"})
            state.log(f"🔧 مطابقة {sym}: إغلاق {missing:.6g} وحدة وهمية "
                      f"(ربح/خسارة ${rec['realized']})")
            changed = True
        elif missing_usd > 0.01:
            # DUST (exchange lot-size rounding / fee): silently align the ledger qty
            # down to the wallet — no phantom trade record, no log spam. Keeps cost
            # basis so avg cost stays honest.
            p.qty = wallet_qty
            changed = True
    return changed


def do_execute(cfg: AppConfig, state: AppState, *, force_rebalance: bool = False) -> dict:
    try:
        safety_gate(live=cfg.live)
    except RuntimeError as exc:
        state.log(f"تنفيذ محظور: {exc}")
        return {"ok": False, "error": str(exc)}
    client = _connect(cfg.live, cfg.margin)
    if client is None:
        state.log("لا مفاتيح — التنفيذ متعذّر")
        return {"ok": False, "error": "no keys"}
    use_margin = bool(cfg.live and cfg.margin and isinstance(client, BinanceMargin))

    if cfg.mode == "scan":
        sig, universe, _ = _scan_signal(cfg, exclude=set(_active_sell_bans(state)))
    else:
        universe = list(cfg.assets)
        frames = fetch_many(universe, interval=cfg.interval, total=max(cfg.bars, 400))
        sig = compute_signal(frames, mode=cfg.mode, target_vol=cfg.target_vol)

    # ANTI-CHURN: the strategy signal only changes when a NEW candle closes (daily on
    # 1d). Running hourly re-ran the SAME daily signal and churned positions in/out on
    # intraday noise + universe-membership jitter (19/21 sells were "trim to target"
    # micro-losses). Split protection from rotation: risk exits (stop-loss/profit-lock/
    # breaker) run EVERY cycle for intraday safety, but ROTATION (new entries + rebalance
    # trims) only fires on a new candle. This makes live match the daily backtest that
    # was validated. force_rebalance=True (manual button) overrides for on-demand action.
    sig_as_of = str(sig.get("as_of", "") or "")
    rotate = _should_rotate(sig_as_of, state.last_rebalance_candle, force_rebalance)

    balances = client.balances()
    mstats: dict = {}
    if use_margin:
        try:
            mstats = client.margin_stats()
        except Exception as exc:  # noqa: BLE001
            state.log(f"⚠️ تعذّرت قراءة حساب المارجن ({exc}) — دورة بلا رافعة")
            use_margin = False
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
    if use_margin and targets:
        # REAL leverage: each pick's target notional = weight x its advised (or
        # manually overridden) leverage. The scan already caps the portfolio's
        # gross at lev_gross_cap x regime, so the levered sum stays bounded.
        targets = _levered_targets(targets, sig.get("leverage") or {})
    led = load_ledger()
    if _reconcile_ledger(led, balances, allp, state, live=cfg.live):
        save_ledger(led)
    led.update_peaks(allp)
    # MARGIN LIQUIDATION GUARD — every cycle, before anything else: if the margin
    # level fell into the danger band, sell down positions (AUTO_REPAY shrinks the
    # loan) until the level recovers to TARGET. Never candle-gated.
    if use_margin and mstats:
        _lvl = float(mstats.get("margin_level", 999) or 999)
        if _lvl < MARGIN_LEVEL_DELEVERAGE:
            need = _margin_deleverage_usd(float(mstats.get("gross_assets_usd", 0) or 0),
                                          float(mstats.get("debt_usdt", 0) or 0))
            if need > 0:
                state.log(f"⛑️ مستوى الهامش {_lvl:.2f} — تخفيض رافعة إجباري: بيع ~${need:.0f} لسداد القرض")
                remaining = need
                by_value = sorted(led.positions.items(),
                                  key=lambda kv: -(kv[1].qty * allp.get(kv[0], 0.0)))
                for s, p in by_value:
                    if remaining <= 0:
                        break
                    px = allp.get(s, 0.0)
                    val = p.qty * px
                    if px <= 0 or val < MIN_NOTIONAL_USD:
                        continue
                    sell_usd = round(min(val * SELL_MARGIN, remaining), 2)
                    if sell_usd < MIN_NOTIONAL_USD:
                        continue
                    try:
                        res = client.market_order(s, "SELL", quote_qty=sell_usd)
                        qe = float(res.get("executedQty", 0) or 0)
                        qf = float(res.get("cummulativeQuoteQty", 0) or 0)
                        if qe > 0 and qf > 0:
                            rec = led.record("SELL", s, round(qf, 2), qf / qe)
                            append_trade({**rec, "mode": "live", "why": "تخفيض رافعة (حماية من التصفية)"})
                            remaining -= qf
                            base_a = s[:-4] if s.endswith("USDT") else s
                            balances[base_a] = max(0.0, balances.get(base_a, 0.0) - qe)
                    except Exception as exc:  # noqa: BLE001
                        state.log(f"✗ فشل تخفيض {s}: {exc}")
                save_ledger(led)
                try:
                    balances = client.balances()
                    mstats = client.margin_stats()
                except Exception:  # noqa: BLE001
                    pass
    # 1) circuit breaker on STRATEGY drawdown (not raw account equity): if the
    # strategy's own PnL gives back > breaker_pct of the budget from its peak,
    # flatten to cash + halt. This tracks the strategy's health directly instead
    # of the whole wallet (which on testnet is dominated by faucet cash and would
    # never trip; in live it could contain unrelated assets).
    cur_pnl = led.summary(allp).get("strategy_pnl")
    strat_dd_pct = None
    if cur_pnl is not None and cfg.max_total_usd > 0:
        strat_dd_pct = (cur_pnl - state.pnl_peak_usd) / cfg.max_total_usd * 100
    breaker = strat_dd_pct is not None and strat_dd_pct <= -abs(cfg.breaker_pct)
    if breaker:
        targets = {}
        rotate = True  # breaker liquidation runs via plan_rebalance -> must NOT be gated
        with state.lock:
            state.halted = True
            state.auto_execute = False
        _save_auto(state)
        state.log(f"⛔ قاطع الدائرة: تراجع أداء الاستراتيجية {strat_dd_pct:.1f}% من القمّة — تصفية كاملة لنقد وإيقاف التداول")
    # 1b) PORTFOLIO take-profit ratchet — the whole book rolled over from its peak ->
    # BANK winners to cash (locks realized profit instead of giving it all back).
    # Tracked in $ (not %) because % spikes artificially as positions are sold to cash.
    cur_usd = led.summary(allp).get("strategy_pnl")
    if cur_usd is not None and cur_usd > state.pnl_peak_usd:
        state.pnl_peak_usd = cur_usd
    now_ts = time.time()
    port_tp_arm = max(cfg.port_tp_arm_usd, 0.05 * cfg.max_total_usd)  # never arm below 5% of capital
    if (not breaker and now_ts >= state.port_tp_cooldown_until
            and led.invested() > 0
            and _port_tp_should_bank(cur_usd, state.pnl_peak_usd,
                                     port_tp_arm, cfg.port_tp_giveback)):
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
                res = client.market_order(s, "SELL", quote_qty=sell_usd)
                exq = float((res or {}).get("executedQty", 0) or 0)
                qf = float((res or {}).get("cummulativeQuoteQty", 0) or 0)
                if exq > 0 and qf > 0:  # actual fill (estimate fallback if bare)
                    rec = led.record("SELL", s, round(qf, 2), qf / exq)
                    sold_q = exq
                else:
                    rec = led.record("SELL", s, sell_usd, px)
                    sold_q = sell_usd / px
                append_trade({**rec, "mode": "live" if cfg.live else "testnet",
                              "why": "جني ربح المحفظة (تراجع عن القمّة)"})
                banked += rec["realized"]
                banked_syms.add(s)
                balances[base] = max(0.0, balances.get(base, 0.0) - sold_q)
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
        tiers = _TRAIL_TIERS if cfg.progressive_trail else None
        exits = led.risk_exits(allp, cfg.hard_stop_pct, cfg.stop_pct, stables=_STABLES,
                               trail_tiers=tiers)
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
    # 2b3) BOOK-DROP EXITS — a held strategy position no longer among the current picks
    # (fell out of the book / left the liquid universe) is CLEANUP, not churn: exit it
    # PROMPTLY every cycle (bypasses the new-candle rotation gate) so we never sit on an
    # unwanted coin bleeding for a full day. ATM was stuck at -4% for hours because the
    # candle gate blocked its exit. The original churn was TRIM-to-target of IN-book coins.
    drop_exit_syms: set[str] = set()
    if not breaker:
        book = set(sig.get("targets", {}))
        held_syms = {s for s, p in led.positions.items() if p.qty > 1e-12}
        drop_exit_syms = _book_drop_exits(held_syms, book, lock_syms | risk_exit_syms)
        for s in drop_exit_syms:
            targets[s] = 0.0
            if s not in whitelist:
                whitelist = whitelist + (s,)
            if s not in prices:
                prices[s] = allp.get(s, 0.0)
        if drop_exit_syms:
            names = ", ".join(sorted(
                x[:-4] if x.endswith("USDT") else x for x in drop_exit_syms))
            state.log(f"🔄 تصفية خارج الكتاب: {names} → بيع كامل (ليست ضمن المختارات)")
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
        if use_margin:
            equity -= float(mstats.get("debt_usdt", 0.0))  # net of the loan
        protected = []
        for s, p in led.positions.items():
            if (p.qty <= 1e-12 or p.age_hours() >= cfg.min_hold_hours
                    or s in lock_syms or s in risk_exit_syms):
                continue
            tgt = targets.get(s, 0.0)
            if tgt > 0:
                continue  # still in book — allow trim-down rebalances
            # dropped entirely from the scan book -> rotate out even if young
            if s not in sig.get("targets", {}):
                continue
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
        if forced_sold or forced:
            save_ledger(led)
            # refresh wallet after forced sells so rebalance plan doesn't double-sell
            balances = client.balances()
    # book-drop cleanup: sell promptly every cycle too, but NO reentry ban — it isn't a
    # stop-out, so it may be re-bought later if it climbs back into the picks (new candle).
    if drop_exit_syms and not breaker:
        d_forced, d_sold = _force_sell_symbols(
            client, drop_exit_syms, balances, allp, led, cfg, state,
            why="خروج: خارج الكتاب",
        )
        forced += d_forced
        forced_sold += d_sold
        force_syms = force_syms | drop_exit_syms  # dedup so plan_rebalance won't resell
        if d_forced or d_sold:
            save_ledger(led)
            balances = client.balances()

    blocked_reentry = _apply_reentry_bans(targets, state)
    if blocked_reentry:
        mins = max(int((state.sell_ban_until[s] - time.time()) / 60) for s in blocked_reentry)
        state.log(f"🚫 إعادة شراء موقوفة: {', '.join(blocked_reentry)} ({mins}د متبقية)")

    # FALLING-KNIFE guard: refuse a NEW entry (or add) whose live price has already
    # dropped > max_entry_gap_pct below the CLOSED candle the signal ranked it on. The
    # uptrend thesis is stale/broken; catching it is how EPIC lost -$921. Held positions
    # are untouched here (risk_exits/profit-lock manage them) — we only block fresh buys.
    if cfg.max_entry_gap_pct > 0 and targets:
        close_ref = dict(sig.get("candle_close") or {})
        if not close_ref:  # non-scan modes: fall back to the display rows
            close_ref = {r["symbol"]: r.get("candle_close")
                         for r in sig.get("ranked", []) if r.get("candle_close")}
        held_now = {s for s, p in led.positions.items() if p.qty > 1e-9}
        knifed = _falling_knife_skips(targets, close_ref, prices, held_now,
                                      cfg.max_entry_gap_pct)
        if knifed:
            state.log("🔪 تجنّب سكين طايح — إلغاء دخول: " + " · ".join(knifed))

    # SMALL-CAPITAL CONSOLIDATION: with a small live book, the weakest pick's target
    # can fall below the exchange min-notional and would silently never fill — merge
    # that weight into the fillable picks instead of leaving it as dead cash.
    if rotate and not breaker and targets:
        eq_now = balances.get("USDT", 0.0)
        for s2 in whitelist:
            base2 = s2[:-4] if s2.endswith("USDT") else s2
            q2, px2 = balances.get(base2, 0.0), prices.get(s2, 0.0)
            if q2 > 0 and px2 > 0:
                eq_now += q2 * px2
        held_pos = {s2 for s2, p2 in led.positions.items() if p2.qty > 1e-9}
        cap_w = cfg.max_weight * min(1.0, cfg.max_total) * float(sig.get("regime") or 1.0)
        if use_margin:
            eq_now -= float(mstats.get("debt_usdt", 0.0))
            # targets here are LEVERED weights — scale the per-coin cap accordingly
            lev_map2 = sig.get("leverage") or {}
            cap_w *= max([max(1.0, float(lev_map2.get(s2, 1.0)))
                          for s2, w2 in targets.items() if w2 > 0], default=1.0)
        small = _consolidate_small_targets(
            targets, eq_now, MIN_NOTIONAL_USD * 1.1, held_pos, cap_w)
        if small:
            state.log("🧲 دمج أهداف أصغر من الحد الأدنى ($10): "
                      + " · ".join(x[:-4] if x.endswith("USDT") else x for x in small)
                      + " → توزيع الوزن على البقية")

    # ANTI-CHURN GATE: on the SAME candle, protection (stop-loss/profit-lock/breaker)
    # already ran above via forced sells — but skip ROTATION (new entries + rebalance
    # trims), the noise-trading that bled 19/21 trades. Rotation resumes on a new candle.
    if not rotate:
        if force_syms:
            save_ledger(led)
            return {"ok": True, "orders": forced, "buys": 0, "sells": forced,
                    "rotated": False}
        return {"ok": True, "orders": 0, "buys": 0, "sells": 0, "rotated": False}
    # committed to rotating on THIS candle -> record it now so any subsequent same-candle
    # cycle (even one that ends with "no orders") skips rotation until a new candle closes.
    if sig_as_of:
        with state.lock:
            state.last_rebalance_candle = sig_as_of
        _save_auto(state)

    from .universe import last_volumes
    limits = RiskLimits(max_order_usd=cfg.max_order_usd, max_total_usd=cfg.max_total_usd,
                        rebalance_band=cfg.rebalance_band, whitelist=whitelist,
                        participation=cfg.participation_cap, vol_usd=last_volumes())
    if use_margin:
        # let BUYs exceed cash via MARGIN_BUY — but never borrow past what the
        # portfolio gross cap allows: extra debt <= (gross-1) x net equity.
        debt_now = float(mstats.get("debt_usdt", 0.0))
        net_eq = float(mstats.get("net_equity_usd") or 0.0)
        allowed_gross = max(1.0, cfg.lev_gross_cap * float(sig.get("regime") or 1.0))
        budget_eq = min(net_eq, cfg.max_total_usd) if net_eq > 0 else cfg.max_total_usd
        max_extra_debt = max(0.0, (allowed_gross - 1.0) * budget_eq - debt_now)
        try:
            exch_borrowable = client.max_borrowable("USDT")
        except Exception:  # noqa: BLE001
            exch_borrowable = 0.0
        limits.quote_debt = debt_now
        limits.borrowable = round(min(exch_borrowable, max_extra_debt), 2)
        limits.max_target_w = allowed_gross  # a single coin may exceed 100% when levered
    plan = plan_rebalance(targets, balances, prices, limits)
    # margin safety: below BLOCK_BUYS the account is drifting toward a margin call —
    # keep selling/dealing with risk but do NOT add exposure.
    if use_margin and mstats:
        _lvl2 = float(mstats.get("margin_level", 999) or 999)
        if _lvl2 < MARGIN_LEVEL_BLOCK_BUYS:
            dropped_m = [o for o in plan.orders if o.side == "BUY"]
            plan.orders[:] = [o for o in plan.orders if o.side != "BUY"]
            if dropped_m:
                state.log(f"🛡️ مستوى الهامش {_lvl2:.2f} < {MARGIN_LEVEL_BLOCK_BUYS} — إيقاف الشراء حتى يتعافى")
    # forced exits already sold via market — don't let plan_rebalance SELL again (-2010)
    if force_syms:
        dup = [o for o in plan.orders if o.side == "SELL" and o.symbol in force_syms]
        if dup:
            plan.orders[:] = [o for o in plan.orders if not (o.side == "SELL" and o.symbol in force_syms)]
            state.log(f"⏭️ تجاهل {len(dup)} بيع مكرر (خروج إجباري نُفّذ)")
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
            base = o.symbol[:-4] if o.symbol.endswith("USDT") else o.symbol
            px = prices.get(o.symbol, 0.0)
            full_exit = (o.side == "SELL" and targets.get(o.symbol, 0.0) <= 0
                         and balances.get(base, 0.0) > 0)
            if full_exit:
                # clean full liquidation by base qty -> no 8% SELL_MARGIN dust left
                try:
                    res = client.market_sell_all(o.symbol, balances.get(base, 0.0))
                except Exception:  # noqa: BLE001 -- fall back to quote-qty sell
                    res = client.market_order(o.symbol, o.side, quote_qty=o.usd)
            else:
                res = client.market_order(o.symbol, o.side, quote_qty=o.usd)
            side_ar = "شراء" if o.side == "BUY" else "بيع"
            # Book the ACTUAL executed fill (from the exchange response) so the ledger
            # mirrors the wallet exactly. Using the requested amount instead used to
            # create phantom positions when an order returned WITHOUT filling (e.g.
            # EXPIRED on an illiquid testnet symbol) -> reconcile then "closed" that
            # ghost every cycle = churn + fake losses. If nothing filled, skip cleanly.
            exec_qty = float(res.get("executedQty", 0) or 0)
            quote_filled = float(res.get("cummulativeQuoteQty", 0) or 0)
            status = str(res.get("status", "")).upper()
            if exec_qty <= 0 or quote_filled <= 0:
                state.log(f"⚠️ {side_ar} {o.symbol} لم يُنفَّذ ({status or 'no-fill'}) — تخطّي بلا تسجيل وهمي")
                continue
            if full_exit:
                balances[base] = 0.0
            fill_px = (quote_filled / exec_qty) if exec_qty > 0 else px
            usd = round(quote_filled, 2)
            placed += 1
            rec = led.record(o.side, o.symbol, usd, fill_px)
            append_trade({**rec, "mode": "live" if cfg.live else "testnet", "why": why})
            mark = "✓ تم" if status in ("FILLED", "PARTIALLY_FILLED") else f"({status})"
            pnl = f" · ربح ${rec['realized']}" if (o.side == "SELL" and rec["realized"]) else ""
            state.log(f"{'حقيقي' if cfg.live else 'testnet'} {side_ar} {o.symbol} ${usd} {mark} — {why}{pnl}")
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
    return {"ok": True, "orders": placed, "buys": buys, "sells": sells + forced,
            "rotated": True}


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
    client = _connect(cfg.live, cfg.margin)
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
                universe = fetch_top_symbols(cfg.universe_size, min_quote_volume=cfg.min_quote_volume_usd,
                                             adaptive=cfg.adaptive_liquidity)
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
        candidates.append((sym, usd, price, qty))
        remaining += usd
    candidates.sort(key=lambda x: x[1], reverse=True)
    candidates = candidates[:cap]
    led = load_ledger()
    state.log(("♻️ بداية نظيفة: تصفية كل الأصول لـUSDT" if full else "🛑 طوارئ: تصفية المراكز لنقد")
              + f" ({len(candidates)} عملة)")
    placed = 0
    for sym, usd, price, qty in candidates:
        try:
            # full-qty exit (LOT_SIZE-floored) empties the wallet with no 8% dust;
            # fall back to a quote-qty sell if the exact-qty route is rejected.
            try:
                client.market_sell_all(sym, qty)
                amt = round(usd, 2)
            except Exception:  # noqa: BLE001
                amt = round(usd * SELL_MARGIN, 2)
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


def _transfer_amount(free: float) -> float:
    """Transferable USDT: everything minus a 1-cent buffer, floored to cents."""
    import math
    return max(0.0, math.floor((free - 0.01) * 100) / 100)


def do_margin_switch(cfg: AppConfig, state: AppState, *, on: bool) -> dict:
    """One-click REAL-leverage switch: spot <-> cross-margin.

    ON : flatten spot strategy coins -> move ALL free USDT into the cross-margin
         wallet as collateral -> cfg.margin=True (orders switch to
         MARGIN_BUY/AUTO_REPAY = actual borrowing, not just more cash).
    OFF: sell margin positions (AUTO_REPAY settles the loan), clear residual
         interest, move USDT back to spot -> cfg.margin=False.
    Both directions book their sells in the ledger, so history stays honest."""
    if not cfg.live:
        return {"ok": False, "error": "المارجن للتداول الحقيقي فقط — شغّل اللايف أولاً (live.ps1)"}
    try:
        safety_gate(live=True)
    except RuntimeError as exc:
        return {"ok": False, "error": str(exc)}
    try:
        keys = load_keys(testnet=False)
    except RuntimeError:
        return {"ok": False, "error": "لا مفاتيح حقيقية"}
    mc = BinanceMargin(keys)
    mc.sync_time()

    if on:
        if cfg.margin:
            return {"ok": True, "note": "المارجن مفعّل أصلاً"}
        state.log("🏦 تفعيل الرافعة الحقيقية (مارجن): تصفية سبوت → تحويل الضمان → تشغيل")
        do_flatten(cfg, state, full=True)  # cfg.margin still False -> sells run on SPOT
        moved = 0.0
        try:
            spot = BinanceSpot(keys, testnet=False)
            spot.sync_time()
            amt = _transfer_amount(spot.balances().get("USDT", 0.0))
            if amt >= 1.0:
                mc.transfer("USDT", amt, to_margin=True)
                moved = amt
                state.log(f"💸 تحويل ${amt:.2f} USDT من سبوت إلى محفظة المارجن (ضمان)")
        except Exception as exc:  # noqa: BLE001
            state.log(f"⚠️ فشل التحويل التلقائي: {exc} — حوّل USDT لمحفظة المارجن من تطبيق بينانس")
        try:
            ms = mc.margin_stats()
            net = float(ms.get("net_equity_usd") or 0.0)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"تعذّرت قراءة محفظة المارجن: {exc}"}
        if net < MIN_NOTIONAL_USD:
            return {"ok": False, "moved": moved,
                    "error": "محفظة المارجن شبه فارغة — حوّل USDT إليها (سبوت→مارجن متقاطع) ثم أعد المحاولة"}
        cfg.margin = True
        _save_config(cfg)
        state.log(f"✅ المارجن مفعّل — ضمان ${net:.2f} · الشراء يقترض فعلياً (MARGIN_BUY) "
                  f"بسقف إجمالي {cfg.lev_gross_cap:g}x وحارس تصفية عند مستوى {MARGIN_LEVEL_DELEVERAGE}")
        return {"ok": True, "margin": True, "net_equity": net, "moved": moved}

    if not cfg.margin:
        return {"ok": True, "note": "المارجن مطفأ أصلاً"}
    state.log("🏦 إيقاف المارجن: بيع مراكز المارجن + سداد القرض + إرجاع USDT لسبوت")
    led = load_ledger()
    balances = mc.balances()
    try:
        allp = mc.all_prices()
    except Exception:  # noqa: BLE001
        allp = {}
    sellable = sorted(
        ((b, q) for b, q in balances.items() if b != "USDT" and q > 0),
        key=lambda kv: -(kv[1] * allp.get(f"{kv[0]}USDT", 0.0)))
    for base, qty in sellable:
        sym = f"{base}USDT"
        px = allp.get(sym, 0.0)
        if px <= 0 or qty * px < MIN_NOTIONAL_USD:
            continue
        try:
            res = mc.market_sell_all(sym, qty)
            qe = float(res.get("executedQty", 0) or 0)
            qf = float(res.get("cummulativeQuoteQty", 0) or 0)
            if qe > 0 and qf > 0:
                rec = led.record("SELL", sym, round(qf, 2), qf / qe)
                append_trade({**rec, "mode": "live", "why": "إيقاف المارجن (تصفية)"})
        except Exception as exc:  # noqa: BLE001
            state.log(f"✗ فشل بيع {sym}: {exc}")
        time.sleep(0.12)
    save_ledger(led)
    try:  # residual interest crumbs that AUTO_REPAY didn't cover
        debt = float(mc.margin_stats().get("debt_usdt", 0.0))
        free = mc.balances().get("USDT", 0.0)
        if debt > 0.001 and free > 0:
            mc.repay("USDT", min(debt, free))
    except Exception as exc:  # noqa: BLE001
        state.log(f"⚠️ سداد الفائدة المتبقية فشل: {exc}")
    moved = 0.0
    try:
        amt = _transfer_amount(mc.balances().get("USDT", 0.0))
        if amt >= 1.0:
            mc.transfer("USDT", amt, to_margin=False)
            moved = amt
            state.log(f"💸 إرجاع ${amt:.2f} USDT إلى محفظة سبوت")
    except Exception as exc:  # noqa: BLE001
        state.log(f"⚠️ فشل إرجاع USDT لسبوت: {exc} — أرجعها من تطبيق بينانس")
    cfg.margin = False
    _save_config(cfg)
    state.log("✅ المارجن مطفأ — التنفيذ رجع سبوت نقدي بدون اقتراض")
    return {"ok": True, "margin": False, "moved": moved}


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
        symbols, total, min_bars = fetch_top_symbols(cfg.universe_size, min_quote_volume=cfg.min_quote_volume_usd, adaptive=cfg.adaptive_liquidity), 500, 300
    frames = fetch_frames(symbols, interval=cfg.interval, total=total, min_bars=120)
    ppy = {"1d": 365, "12h": 730, "8h": 1095, "6h": 1460, "4h": 2190, "1h": 8760}.get(cfg.interval, 365)
    # realistic frictions: 0.1% fee + ~0.1% slippage per side (testnet is frictionless,
    # so an un-costed backtest massively overstates a high-turnover strategy's edge).
    common = dict(top_n=cfg.top_n, target_vol=cfg.target_vol, max_total=cfg.max_total,
                  min_bars=min_bars, periods_per_year=ppy, stop_pct=cfg.stop_pct,
                  conviction_power=cfg.conviction_power, vol_power=cfg.vol_power,
                  cap_vol_ref=cfg.cap_vol_ref, stop_cooldown_days=cfg.stop_cooldown_hours / 24.0,
                  max_weight=cfg.max_weight, cost_bps=20.0,
                  starter_frac=cfg.starter_frac, starter_max_vol=cfg.starter_max_vol,
                  starter_min_mom30=cfg.starter_min_mom30,
                  starter_regime_min=cfg.starter_regime_min,
                  dd_penalty=cfg.entry_quality_dd_penalty,
                  entry_max_dd=cfg.entry_max_dd,
                  max_spike_1d=cfg.max_spike_1d, spike_base_max=cfg.spike_base_max,
                  min_score_frac=cfg.min_score_frac,
                  # EXECUTION PARITY: with margin ON the backtest simulates the same
                  # levered execution (advisor + gross cap + borrow cost + liquidation);
                  # margin OFF = pure spot 1x, exactly what do_execute places.
                  max_lev=(cfg.max_lev if cfg.margin else 0.0),
                  lev_target_vol=cfg.lev_target_vol,
                  lev_gross_cap=cfg.lev_gross_cap,
                  lev_overrides=cfg.lev_overrides)
    res = backtest_scan(frames, **common)
    res["scope"] = "years" if long_history else "recent"
    res["interval"] = cfg.interval
    # walk-forward efficiency: split 70/30 and measure how much of the in-sample
    # Sharpe survives out-of-sample. WFE < ~0.5 => the result is likely overfit and
    # should NOT be trusted for live sizing. This is the honesty check on tuning.
    if res.get("ok") and res.get("days", 0) > 60:
        warmup = 210
        split = warmup + int(res["days"] * 0.7)
        try:
            is_res = backtest_scan(frames, end_index=split, **common)
            oos_res = backtest_scan(frames, start_index=split, **common)
            is_sh = is_res.get("sharpe") if is_res.get("ok") else None
            oos_sh = oos_res.get("sharpe") if oos_res.get("ok") else None
            res["is_sharpe"] = is_sh
            res["oos_sharpe"] = oos_sh
            if is_sh and is_sh != 0:
                res["wfe"] = round(oos_sh / is_sh, 2)
                res["overfit_warning"] = res["wfe"] < 0.5
        except Exception as exc:  # noqa: BLE001
            res["wfe_error"] = str(exc)
    # survivorship caveat: the universe is TODAY's liquid coins, so delisted/failed
    # coins that would have hurt returns are absent -> real-world results run lower.
    res["survivorship_warning"] = (
        "الباك-تست يستخدم العملات السائلة حاليًا فقط (لا يشمل المشطوبة/الفاشلة) — "
        "توقّع أداءً واقعيًا أقل من المعروض."
    )
    with state.lock:
        state.backtest = res
    if res.get("ok"):
        btc = res.get("btc_hodl_return")
        scope_ar = "سنوات" if long_history else "حديث"
        wfe = res.get("wfe")
        wfe_txt = ""
        if wfe is not None:
            flag = " ⚠ overfit" if res.get("overfit_warning") else ""
            wfe_txt = f" · WFE {wfe}{flag}"
        state.log(f"باك-تست ({scope_ar}): عائد {int(res['total_return'] * 100)}% · "
                  f"تراجع {int(res['max_drawdown'] * 100)}% · Sharpe {res['sharpe']}"
                  + (f" مقابل BTC {int(btc * 100)}%" if btc is not None else "") + wfe_txt)
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
                    "last_rebalance_candle": state.last_rebalance_candle,
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
                    "margin": cfg.margin,
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
                    "starter_frac": cfg.starter_frac,
                    "starter_max_vol": cfg.starter_max_vol,
                    "starter_min_mom30": cfg.starter_min_mom30,
                    "starter_regime_min": cfg.starter_regime_min,
                    "max_entry_gap_pct": cfg.max_entry_gap_pct,
                    "entry_quality_dd_penalty": cfg.entry_quality_dd_penalty,
                    "entry_max_dd": cfg.entry_max_dd,
                    "max_spike_1d": cfg.max_spike_1d,
                    "spike_base_max": cfg.spike_base_max,
                    "min_score_frac": cfg.min_score_frac,
                    "max_lev": cfg.max_lev,
                    "lev_target_vol": cfg.lev_target_vol,
                    "lev_gross_cap": cfg.lev_gross_cap,
                    "lev_overrides": dict(cfg.lev_overrides),
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
            d["readiness"] = compute_readiness()
            d["benchmark"] = compute_benchmark()
            d["research"] = research_digest()
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
                if cfg.live:  # spot can't lever — >1 would break regime cash-scaling
                    cfg.max_total = min(cfg.max_total, 1.0)
            if "universe_size" in body:
                cfg.universe_size = int(max(5, min(120, int(body["universe_size"]))))
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
            if "max_entry_gap_pct" in body:
                cfg.max_entry_gap_pct = max(0.0, min(0.5, float(body["max_entry_gap_pct"])))
            if "entry_quality_dd_penalty" in body:
                cfg.entry_quality_dd_penalty = max(0.0, min(3.0, float(body["entry_quality_dd_penalty"])))
            if "entry_max_dd" in body:
                cfg.entry_max_dd = max(0.0, min(0.5, float(body["entry_max_dd"])))
            if "max_spike_1d" in body:
                cfg.max_spike_1d = max(0.0, min(1.0, float(body["max_spike_1d"])))
            if "spike_base_max" in body:
                cfg.spike_base_max = max(-0.5, min(0.5, float(body["spike_base_max"])))
            if "min_score_frac" in body:
                cfg.min_score_frac = max(0.0, min(0.9, float(body["min_score_frac"])))
            if "max_lev" in body:
                cfg.max_lev = max(0.0, min(20.0, float(body["max_lev"])))
            if "lev_target_vol" in body:
                cfg.lev_target_vol = max(0.1, min(3.0, float(body["lev_target_vol"])))
            if "lev_gross_cap" in body:
                cfg.lev_gross_cap = max(0.0, min(10.0, float(body["lev_gross_cap"])))
            if body.get("lev_overrides_clear"):
                cfg.lev_overrides = {}
            if "lev_overrides" in body and isinstance(body["lev_overrides"], dict):
                ovs = dict(cfg.lev_overrides)
                for sym, val in body["lev_overrides"].items():
                    key = sym.upper()
                    if not key.endswith("USDT"):
                        key += "USDT"
                    try:
                        v = float(val)
                    except (TypeError, ValueError):
                        continue
                    if v < 1.0:  # 0/blank removes the override
                        ovs.pop(key, None)
                    else:
                        ovs[key] = min(cfg.max_lev, v)
                cfg.lev_overrides = ovs
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
            if "starter_frac" in body:
                cfg.starter_frac = max(0.0, min(1.0, float(body["starter_frac"])))
            if "starter_max_vol" in body:
                cfg.starter_max_vol = max(0.1, min(10.0, float(body["starter_max_vol"])))
            if "starter_min_mom30" in body:
                cfg.starter_min_mom30 = max(-0.5, min(0.0, float(body["starter_min_mom30"])))
            if "starter_regime_min" in body:
                cfg.starter_regime_min = max(0.0, min(1.0, float(body["starter_regime_min"])))
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
            if self.path == "/api/readiness":
                return self._send(200, compute_readiness())
            if self.path == "/api/benchmark":
                return self._send(200, compute_benchmark())
            if self.path == "/api/research":
                return self._send(200, research_digest())
            if self.path == "/api/state":
                return self._send(200, self._state_dict())
            return self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path == "/api/check":
                do_check(cfg, state, with_portfolio=True)
                return self._send(200, self._state_dict())
            if self.path == "/api/execute":
                res = do_execute(cfg, state, force_rebalance=True)  # manual button = act now
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
                            do_execute(cfg, state, force_rebalance=True)  # enabling auto = deploy now
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
                # reset the PnL high-water too, else the ratchet compares a flat
                # (cash) book against a stale peak and "banks profit" every cycle
                with state.lock:
                    state.pnl_peak_usd = 0.0
                    state.port_tp_cooldown_until = 0.0
                _save_auto(state)
                state.log("تصفير سجل الصفقات والأرباح المحقّقة")
                return self._send(200, self._state_dict())
            if self.path == "/api/flatten":
                full = bool(self._read_json().get("full", False))
                res = do_flatten(cfg, state, full=full)
                do_check(cfg, state)
                return self._send(200, {**self._state_dict(), "result": res})
            if self.path == "/api/margin":
                res = do_margin_switch(cfg, state, on=bool(self._read_json().get("on")))
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
            refresh_readiness(state)  # keep READINESS.json + GO/NO-GO fresh, hands-off
            refresh_benchmark()  # local vs BTC/EW — no third-party platform needed
            with state.lock:
                ready = (state.auto_enabled and state.auto_execute and not state.halted
                         and time.time() >= state.port_tp_cooldown_until)
            prices = (state.account or {}).get("_prices") or {}
            if ready and prices:
                _led = load_ledger()
                cur = _led.summary(prices).get("strategy_pnl")
                # only react if we actually HOLD something to bank — otherwise a
                # stale peak vs a flat (cash) book would log/execute every cycle.
                if _led.invested() > 0 and _port_tp_should_bank(
                        cur, state.pnl_peak_usd,
                        max(cfg.port_tp_arm_usd, 0.05 * cfg.max_total_usd),
                        cfg.port_tp_giveback):
                    state.log("⚡ تراجع المحفظة عن القمّة — جني ربح فوري")
                    do_execute(cfg, state)
        except Exception:  # noqa: BLE001
            pass


class _SingleInstanceServer(ThreadingHTTPServer):
    # allow_reuse_address MUST be False on Windows: the default True lets a 2nd, 3rd...
    # process bind the SAME port via SO_REUSEADDR, which is exactly how duplicate agents
    # piled up. False makes any extra launch fail to bind (WinError 10048) -> we exit.
    allow_reuse_address = False


def main(cfg: AppConfig | None = None, *, open_browser: bool = True) -> None:
    cfg = cfg or AppConfig()
    url = f"http://127.0.0.1:{cfg.port}"
    _load_config(cfg)  # restore saved budget/settings across restarts (not live)
    state = AppState()
    state.equity_history = _load_equity_history()
    _load_auto(state)  # resume autonomous trading after a restart (testnet-safe)
    # SINGLE-INSTANCE GUARD: bind the port before starting threads/trading. If it's
    # already taken, another agent owns it -> exit immediately without starting a second
    # server, auto-loop, or trading. This is the authoritative lock: no matter how many
    # times the launcher fires, only one Zambahola runs per port (stops the pile-up that
    # was eating the machine). allow_reuse_address=False makes the extra bind fail fast.
    try:
        httpd = _SingleInstanceServer(("127.0.0.1", cfg.port), make_handler(cfg, state))
    except OSError:
        # another instance already owns the port. Force-exit HARD (os._exit) so a loser
        # of a simultaneous double-launch can never linger as a zombie python — a plain
        # return could be held open by any stray import-time thread.
        print(f"[beta] ZAMBAHOLA already running on {url} — this instance will exit (no duplicate).")
        os._exit(0)
    if cfg.margin and not cfg.live:
        # margin persisted from a live session but this launch is testnet: funds sit in
        # the LIVE margin wallet while orders would hit the testnet — trade nothing until
        # the user relaunches live (live.ps1) or switches margin off from the dashboard.
        state.log("⚠️ المارجن محفوظ لكن التشغيل الحالي testnet — أعد التشغيل بـ live.ps1 (الأموال في محفظة المارجن الحقيقية)")
    state.log("بدء اللوحة" + (" · استئناف التداول التلقائي" if state.auto_enabled else ""))
    threading.Thread(target=_auto_loop, args=(cfg, state), daemon=True).start()
    threading.Thread(target=_refresh_loop, args=(cfg, state), daemon=True).start()
    # initial signal fetch in background so the page loads instantly
    threading.Thread(target=lambda: do_check(cfg, state, with_portfolio=True), daemon=True).start()
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
