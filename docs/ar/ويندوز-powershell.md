# ويندوز (PowerShell)

## التحديث نجح — ماذا بعد؟

`git pull` + `npm run setup` ✅ — أنت على النسخة الصحيحة.

## إذا ظهر `'ZAMBAHOLA_FEED' is not recognized` (ويندوز)

```powershell
git pull origin main
npm run agent:deep-learn
```

تم إصلاح سكربتات `deep-learn` و `ultra-learn` لتعمل على CMD/PowerShell.

## إذا `agent:max-accuracy` يوقف فوراً عند `=== learn ===`

1. حدّث السكربتات:
```powershell
git pull origin main
```

2. أعد التشغيل (لا تغلق النافذة — كل دورة ~65 ثانية × 30 ≈ 35 دقيقة للمرحلة الأولى فقط):
```powershell
npm run agent:max-accuracy
```

3. اختبار سريع (دقيقتان) قبل التدريب الطويل:
```powershell
npm run agent:max-accuracy:quick
```

## بديل يدوي (يعمل دائماً على ويندوز)

```powershell
cd C:\Users\pc\zambahola-one-agent
$env:ZAMBAHOLA_ACCURACY_MODE="max"
$env:ZAMBAHOLA_ACCURACY_FILTER="off"
$env:ZAMBAHOLA_LEARN_CYCLES="30"
npm run agent:learn
```

بعدها بالترتيب:
```powershell
npm run agent:deep-learn
npm run agent:mega-train
npm run agent:mega-backtest
npm run agent:ultra-learn
npm run agent:export-models
```

تشغيل حي:
```powershell
npm run agent:max-accuracy:start
```

## ماذا تتوقع أثناء `agent:learn`؟

يجب أن ترى:
```
[zambahola] learn: 30 cycles × 65s
Cycle 1/30 — predictions: ...
```

إذا رجع الـ prompt فوراً بدون هذا النص — الأمر لم يشتغل.

## إذا توقف عند `Unexpected end of JSON input` (بعد دورة 7 مثلاً)

حدّث ثم أكمل من الدورة التالية (لا تبدأ من صفر):

```powershell
git pull origin main
$env:ZAMBAHOLA_LEARN_FROM="8"
$env:ZAMBAHOLA_LEARN_CYCLES="30"
npm run agent:learn
```

بعد ما يخلص learn، أكمل باقي المراحل:

```powershell
npm run agent:deep-learn
npm run agent:mega-train
npm run agent:ultra-learn
npm run agent:max-accuracy:start
```
