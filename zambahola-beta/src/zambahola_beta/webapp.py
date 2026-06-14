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
import threading
import time
import webbrowser
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .data import fetch_many
from .executor import (
    BinanceSpot,
    RiskLimits,
    load_keys,
    plan_rebalance,
    safety_gate,
)
from .strategy import compare_portfolios, current_allocation

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

<div class="card"><div class="flex">
<button id="check">🔄 افحص الآن</button>
<button id="exec" class="sec">⚡ نفّذ (testnet)</button>
<button id="auto" class="sec">▶ شغّل الوضع التلقائي</button>
<span class="sw"><small id="mode"></small></span>
</div></div>

<div id="assets" class="row"></div>

<div class="card"><div class="flex"><b>الحساب</b><span class="sw" id="acctstatus"></span></div>
<div class="big" id="equity">—</div><div class="k">إجمالي القيمة (USDT)</div>
<div id="balances" class="sub" style="margin-top:8px"></div></div>

<div class="card"><b>مقارنة الاستراتيجيات</b><div id="pf" class="sub">اضغط "افحص الآن" لتحميلها…</div></div>

<div class="card"><b>سجل الإجراءات</b><div class="log" id="log"></div></div>
<div class="sub" style="margin-top:10px">لا يوجد ربح مضمون. التنفيذ على testnet افتراضياً؛ الحقيقي يتطلّب تأكيداً صريحاً. الإشارة قد تكون "نقد" لتجنّب الهبوط.</div>
</div>
<script>
const $=id=>document.getElementById(id);
function actionBadge(a){if(a&&a.includes("INVEST"))return'<span class="badge b-up">استثمر</span>';
if(a&&a.includes("PARTIAL"))return'<span class="badge b-warn">جزئي</span>';return'<span class="badge b-mut">نقد</span>';}
async function api(path,method="GET",body){const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return r.json();}
function render(s){
 $("sub").textContent="آخر تحديث: "+(s.updated||"—")+" · بيانات حتى "+(s.signal?.as_of||"—");
 $("mode").textContent="الوضع: "+(s.live?"حقيقي ⚠":"testnet")+" · أوامر حتى $"+s.max_order_usd+" / إجمالي $"+s.max_total_usd;
 $("autodot").className="dot "+(s.auto_enabled?"on":"off");
 $("autotxt").textContent="تلقائي: "+(s.auto_enabled?("يعمل كل "+s.auto_interval_hours+"س"+(s.auto_execute?" + تنفيذ":" (فحص فقط)")):"متوقف");
 $("auto").textContent=s.auto_enabled?"⏸ أوقف التلقائي":"▶ شغّل الوضع التلقائي";
 const a=$("assets");a.innerHTML="";
 const rs=s.signal?s.signal.reasons:{};
 for(const sym in rs){const r=rs[sym];const pct=Math.round((r.trend_consensus||0)*100);
  a.innerHTML+=`<div class="card"><div class="flex"><b>${sym}</b><span class="sw">${actionBadge(r.action)}</span></div>
  <div class="big">${r.price}</div><div class="k">السعر</div>
  <div style="margin-top:8px">قوة الترند: ${pct}%<div class="bar"><i style="width:${pct}%"></i></div></div>
  <div class="k" style="margin-top:8px">الوزن الهدف: ${Math.round((r.target_weight||0)*100)}% · تقلّب: ${Math.round((r.realized_vol_ann||0)*100)}%</div></div>`;}
 if(s.cash_weight!=null)a.innerHTML+=`<div class="card"><div class="flex"><b>نقد</b><span class="sw badge b-mut">${Math.round(s.cash_weight*100)}%</span></div><div class="k" style="margin-top:8px">غير مستثمر — حماية من الهبوط</div></div>`;
 $("acctstatus").innerHTML=s.account?.connected?'<span class="badge b-up">متصل</span>':'<span class="badge b-mut">غير متصل (أضف المفاتيح)</span>';
 $("equity").textContent=s.account?.equity_usd!=null?("$"+s.account.equity_usd):"—";
 $("balances").textContent=s.account?.balances?Object.entries(s.account.balances).map(([k,v])=>k+": "+v).join("  ·  "):"";
 $("exec").disabled=!s.account?.connected;
 if(s.portfolio&&s.portfolio.length){let h='<table><tr><th>استراتيجية</th><th>عائد</th><th>CAGR</th><th>Sharpe</th><th>أقصى تراجع</th></tr>';
  for(const r of s.portfolio)h+=`<tr><td>${r.strategy}</td><td>${(r.total_return*100).toFixed(0)}%</td><td>${(r.cagr*100).toFixed(0)}%</td><td>${r.sharpe}</td><td>${(r.max_drawdown*100).toFixed(0)}%</td></tr>`;
  $("pf").innerHTML=h+'</table>';}
 $("log").textContent=(s.actions||[]).slice().reverse().join("\\n");
}
async function refresh(){render(await api('/api/state'));}
$("check").onclick=async()=>{$("check").disabled=true;$("check").textContent="…جارٍ";render(await api('/api/check','POST'));$("check").disabled=false;$("check").textContent="🔄 افحص الآن";};
$("exec").onclick=async()=>{if(!confirm("تنفيذ إعادة التوازن على testnet الآن؟"))return;$("exec").disabled=true;render(await api('/api/execute','POST',{}));$("exec").disabled=false;};
$("auto").onclick=async()=>{render(await api('/api/auto','POST',{}));};
refresh();setInterval(refresh,15000);
</script></body></html>"""


@dataclass
class AppConfig:
    assets: tuple[str, ...] = ("BTCUSDT", "ETHUSDT")
    interval: str = "1d"
    bars: int = 400
    mode: str = "ensemble"
    target_vol: float = 0.6
    max_order_usd: float = 20.0
    max_total_usd: float = 100.0
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
    auto_interval_hours: float = 12.0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def log(self, msg: str) -> None:
        stamp = time.strftime("%Y-%m-%d %H:%M")
        self.actions.append(f"[{stamp}] {msg}")
        self.actions[:] = self.actions[-100:]


# ---------- testable core ----------

def compute_signal(frames: dict, *, mode: str, target_vol: float) -> dict:
    """Pure: target allocation from already-fetched klines frames."""
    return current_allocation(frames, mode=mode, target_vol=target_vol)


def account_snapshot(client: BinanceSpot, assets: tuple[str, ...]) -> dict:
    balances = client.balances()
    prices = {s: client.price(s) for s in assets}
    quote = "USDT"
    equity = balances.get(quote, 0.0)
    shown = {quote: round(balances.get(quote, 0.0), 2)}
    for s in assets:
        base = s.replace(quote, "")
        qty = balances.get(base, 0.0)
        equity += qty * prices.get(s, 0.0)
        if qty > 0:
            shown[base] = round(qty, 6)
    return {"connected": True, "equity_usd": round(equity, 2), "balances": shown, "_prices": prices}


# ---------- actions ----------

def _connect(live: bool) -> BinanceSpot | None:
    try:
        keys = load_keys()
    except RuntimeError:
        return None
    return BinanceSpot(keys, testnet=not live)


def do_check(cfg: AppConfig, state: AppState, *, with_portfolio: bool = False) -> None:
    frames = fetch_many(list(cfg.assets), interval=cfg.interval, total=max(cfg.bars, 400))
    sig = compute_signal(frames, mode=cfg.mode, target_vol=cfg.target_vol)
    client = _connect(cfg.live)
    account = {"connected": False}
    if client is not None:
        try:
            account = account_snapshot(client, cfg.assets)
        except Exception as exc:  # noqa: BLE001
            account = {"connected": False, "error": str(exc)}
    pf = None
    if with_portfolio:
        try:
            pf = compare_portfolios(frames, cost_bps=10.0, target_vol=cfg.target_vol).to_dict("records")
        except Exception:  # noqa: BLE001
            pf = None
    with state.lock:
        state.signal = sig
        state.account = account
        if pf is not None:
            state.portfolio = pf
        state.updated = time.strftime("%Y-%m-%d %H:%M:%S")


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
    frames = fetch_many(list(cfg.assets), interval=cfg.interval, total=max(cfg.bars, 400))
    sig = compute_signal(frames, mode=cfg.mode, target_vol=cfg.target_vol)
    acct = account_snapshot(client, cfg.assets)
    limits = RiskLimits(max_order_usd=cfg.max_order_usd, max_total_usd=cfg.max_total_usd,
                        whitelist=tuple(cfg.assets))
    plan = plan_rebalance(sig["targets"], client.balances(), acct["_prices"], limits)
    if not plan.orders:
        state.log("لا حاجة لإعادة توازن (ضمن الحدود)")
        return {"ok": True, "orders": 0}
    placed = 0
    for o in plan.orders:
        try:
            res = client.market_order(o.symbol, o.side, quote_qty=o.usd)
            placed += 1
            state.log(f"{'حقيقي' if cfg.live else 'testnet'} {o.side} {o.symbol} ${o.usd} → {res.get('status')}")
        except Exception as exc:  # noqa: BLE001
            state.log(f"فشل {o.side} {o.symbol}: {exc}")
    return {"ok": True, "orders": placed}


def _auto_loop(cfg: AppConfig, state: AppState) -> None:
    while True:
        time.sleep(2)
        with state.lock:
            enabled = state.auto_enabled
            execute = state.auto_execute
            interval = state.auto_interval_hours
            last = state.updated
        if not enabled:
            continue
        # run if never run or interval elapsed
        due = True
        if last:
            due = (time.time() - time.mktime(time.strptime(last, "%Y-%m-%d %H:%M:%S"))) >= interval * 3600
        if not due:
            continue
        try:
            do_check(cfg, state)
            state.log("فحص تلقائي")
            if execute:
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
                return {
                    "signal": state.signal,
                    "account": state.account,
                    "portfolio": state.portfolio,
                    "actions": list(state.actions),
                    "updated": state.updated,
                    "auto_enabled": state.auto_enabled,
                    "auto_execute": state.auto_execute,
                    "auto_interval_hours": state.auto_interval_hours,
                    "cash_weight": state.signal.get("cash_weight") if state.signal else None,
                    "live": cfg.live,
                    "max_order_usd": cfg.max_order_usd,
                    "max_total_usd": cfg.max_total_usd,
                }

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
                with state.lock:
                    state.auto_enabled = not state.auto_enabled
                state.log("الوضع التلقائي " + ("تشغيل" if state.auto_enabled else "إيقاف"))
                return self._send(200, self._state_dict())
            return self._send(404, {"error": "not found"})

    return Handler


def main(cfg: AppConfig | None = None, *, open_browser: bool = True) -> None:
    cfg = cfg or AppConfig()
    state = AppState()
    state.log("بدء اللوحة")
    threading.Thread(target=_auto_loop, args=(cfg, state), daemon=True).start()
    # initial signal fetch in background so the page loads instantly
    threading.Thread(target=lambda: do_check(cfg, state, with_portfolio=True), daemon=True).start()
    httpd = ThreadingHTTPServer(("127.0.0.1", cfg.port), make_handler(cfg, state))
    url = f"http://127.0.0.1:{cfg.port}"
    print(f"[beta] ZAMBAHOLA BETA Console → {url}")
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
