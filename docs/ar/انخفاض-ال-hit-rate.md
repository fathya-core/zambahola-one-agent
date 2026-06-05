# لماذا ينزل الـ Hit Rate من 83% إلى 50%؟

## أسباب طبيعية

1. **البداية محظوظة** — أول دقائق قليلة عينات قليلة (83% من 10 تنبؤات ≠ 83% حقيقية)
2. **السوق يتغير** — ترند جديد يخسر استراتيجيات كانت تربح
3. **التعلم السريع** — أوزان تتغير كثير فتخرب التوازن (تم إصلاحه بـ **Stabilize mode**)
4. **تيكات سريعة** — `fast_tick` أكثر ضوضاء من تدريب mock

## ما أضفناه (حماية تلقائية)

- **Rolling hit** آخر 60 تنبؤ
- عند هبوط **12%+** من الذروة → **Stabilize ON**
  - تعلم ML أبطأ/موقوف مؤقتاً
  - أوزان تتغير بلطف (1.008 بدل 1.04)
  - استرجاع أفضل snapshot محفوظ
- **Directional hit** — دقة up/down فقط (أصدق من الإجمالي)
- **Guard الاتجاهي** — `ZAMBAHOLA_GUARD_METRIC=directional` (افتراضي في max-accuracy)
- **Omni train** — تعليم معزّز قبل Binance: `npm run agent:omni-train`

## على جهازك

```powershell
git pull origin main
npm run agent:research-import -- apps\one-agent\knowledge\research-imports.example.json
npm run agent:omni-train
npm run agent:stop
npm run agent:restore-weights
npm run agent:max-accuracy:start
```

`restore-weights` يرجع أوزان أفضل لحظة (مثلاً قرب 83%).

## لو تبي ثبات أعلى

```powershell
$env:ZAMBAHOLA_STABILIZE="1"
npm run agent:max-accuracy:start
```

يفرض وضع الحماية دائماً (تعلم أبطأ، استقرار أعلى).
