# استيراد البحث من Perplexity فقط (بدون Manus)

**لا تحتاج Manus** — حسابك منتهي أو غير متوفر؟ المسار الكامل يعمل بـ **Perplexity** أو لصق يدوي.

## الخطوات السريعة

1. افتح `apps/one-agent/knowledge/research-imports.example.json` — فيه **5 أسئلة جاهزة** لـ Perplexity.
2. انسخ كل سؤال إلى Perplexity واطلب **JSON فقط** في الإجابة.
3. الصق كل إجابة كـ `entry` داخل `entries[]` (أو استبدل المثالين الموجودين).
4. استورد:

```powershell
npm run agent:research-import -- apps/one-agent/knowledge/research-imports.example.json
```

5. شغّل التعلم:

```powershell
npm run agent:omni-train
```

## أسئلة Perplexity (جاهزة للنسخ)

من `perplexityPrompts[]` في الملف أعلاه. الأهم:

| # | الموضوع |
|---|---------|
| 1 | meta-labeling + أوزان ensemble |
| 2 | walk-forward + triple-barrier |
| 3 | إشارات Binance (funding, premium, OI) |
| 4 | López de Prado لـ 17 استراتيجية |
| 5 | Chan vs Murphy — حظر mean_reversion في الترند |

### شكل JSON المطلوب من Perplexity

```json
{
  "weightAdjustments": {
    "momentum": 1.1,
    "order_imbalance": 1.08,
    "funding_fade": 1.12
  },
  "minDirectionalHitTarget": 0.58,
  "rules": [
    {
      "id": "trend_block_mr",
      "regime": "trend_up",
      "blockStrategies": ["mean_reversion"],
      "unlessAgreement": 0.72
    }
  ]
}
```

لفّ كل إجابة داخل `entries[]`:

```json
{
  "source": "perplexity",
  "importedAt": "2026-06-05",
  "query": "وصف السؤال",
  "weightAdjustments": { ... }
}
```

### بدون Perplexity أيضاً؟

عدّل الأوزان يدوياً واستخدم `"source": "manual"` — نفس الأمر `agent:research-import`.

## ماذا يفعل الاستيراد؟

| الحقل | التأثير |
|--------|---------|
| `weightAdjustments` | يضرب أوزان الاستراتيجيات (حد أقصى 2.5) |
| `rules` | يُسجَّل في research-log |
| `minDirectionalHitTarget` | هدف — راقب `directionalHitRate` |

## المقياس قبل Binance

| المقياس | الهدف |
|---------|--------|
| `directionalHitRate` | ≥ **0.58** |
| `Dir. rolling (60)` | مستقر فوق 55% |

```powershell
git pull origin main
npm run setup
npm run agent:omni-train
npm run agent:max-accuracy:start
```

ثم `docs/ar/ربط-بينانس.md`.
