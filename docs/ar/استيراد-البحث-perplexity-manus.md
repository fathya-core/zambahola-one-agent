# استيراد البحث من Perplexity و Manus AI

قبل ربط Binance، يمكنك تقوية الوكيل ببحث خارجي دون تعديل الكود.

## الخطوات السريعة

1. افتح `apps/one-agent/knowledge/research-imports.example.json` — فيه **أسئلة جاهزة** لـ Perplexity و Manus.
2. الصق إجابة كل أداة كـ `entry` جديد داخل `entries[]`.
3. احفظ الملف في:
   - `apps/one-agent/data/learning/research-imports.json` (مفضل — محلي فقط)
   - أو استخدم الأمر:

```powershell
npm run agent:research-import -- path\to\paste.json
```

4. شغّل التعلم المعزّز:

```powershell
npm run agent:omni-train
```

## ماذا يفعل الاستيراد؟

| الحقل | التأثير |
|--------|---------|
| `weightAdjustments` | يضرب أوزان الاستراتيجيات (حد أقصى 2.5) |
| `rules` | يُسجَّل في research-log (قواعد خبير مستقبلية) |
| `minDirectionalHitTarget` | هدف مرجعي — راقب `directionalHitRate` في اللوحة |

## أسئلة مقترحة لـ Perplexity

انسخ من `research-imports.example.json` → `perplexityPrompts[]`.

ركّز على:
- meta-labeling و abstention
- walk-forward لأفق 30–60 ثانية
- إشارات Binance futures (funding, premium, OI)

## أسئلة مقترحة لـ Manus

انسخ من `manusPrompts[]`. اطلب **JSON فقط** في الإخراج:

```json
{
  "weightAdjustments": { "momentum": 1.1 },
  "minDirectionalHitTarget": 0.58
}
```

## المقياس الصحيح قبل Binance

لا تعتمد على `hitRate` العام إذا كان `abstainRate` عالياً.

| المقياس | الهدف قبل Demo |
|---------|----------------|
| `directionalHitRate` | ≥ **0.58** |
| `abstainRate` | معقول (ليس 90%+) |
| `rollingHitRate` (guard) | يستخدم **اتجاهي** افتراضياً |

## بعد الاستيراد

```powershell
git pull origin main
npm run setup
npm run agent:omni-train
npm run agent:max-accuracy:start
npm run agent:status
```

عند استقرار `directionalHitRate` → `docs/ar/ربط-بينانس.md`.
