# لصق رد Perplexity — شرح بسيط

## ماذا يعني رد Perplexity؟

| الجزء | المعنى | هل يشتغل في الوكيل؟ |
|--------|--------|---------------------|
| `weightAdjustments` | يقوّي أو يضعف كل استراتيجية (رقم أعلى = أهمية أكبر) | **نعم — فوراً** |
| `minDirectionalHitTarget` | هدف دقة up/down (مثلاً 62%) | مرجع للمراقبة في اللوحة |
| `rules` | متى نمنع mean_reversion في الترند | **جزئياً** — الوكيل عنده expert-consensus مشابه |

### أوزانك من Perplexity (باختصار)

| الاستراتيجية | الرقم | المعنى |
|--------------|-------|--------|
| order_imbalance | 1.40 | **الأقوى** — ثق بإشارة السيولة |
| momentum | 1.25 | قوي في الترند |
| ema_cross | 1.15 | دعم اتجاه |
| rsi | 0.95 | محايد تقريباً |
| funding_fade | 0.85 | أضعف في ترند قوي (Perplexity محق) |
| mean_reversion | 0.70 | **أضعف** — لا تعتمد عليه في صعود قوي |

## ماذا تفعل؟ (أمران فقط)

### الطريقة 1 — الصق JSON كما هو (بدون تعديل)

احفظ رد Perplexity في ملف مثلاً `perplexity-answer.json` ثم:

```powershell
npm run agent:research-import -- perplexity-answer.json
npm run agent:omni-train
```

البرنامج يلفّه تلقائياً ويطبّق الأوزان.

### الطريقة 2 — ملف جاهز في المشروع

```powershell
npm run agent:research-import -- apps/one-agent/knowledge/perplexity-paste-ready.json
npm run agent:omni-train
npm run agent:max-accuracy:start
```

## بعد التشغيل

افتح `http://127.0.0.1:8787` وراقب **Directional hit** — الهدف من Perplexity كان **62%** (`0.62`).
