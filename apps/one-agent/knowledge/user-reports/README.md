# تقاريرك من Perplexity / Downloads

انسخ ملفات `.md` من جهازك إلى هذا المجلد، ثم:

```powershell
npm run agent:import-md-reports
npm run agent:omni-train
```

## ملفاتك المقترحة (من Downloads)

| الملف على جهازك | انسخه هنا باسم |
|-----------------|----------------|
| `تنبوء-2.md` | `تنبوء-2.md` |
| `ابي تتعمق اكثر وتجيب اكثر عن دقة التنبوء ورفعه.md` | `دقة-التنبوء.md` |
| `ابي كل ما يخص تعلم الاله و التداول بالذكاء الاصطنا.md` | `تعلم-الالة.md` |
| `ايه.md` | `ايه.md` |
| `ايه بس بدون تدقيق لل قيود...md` | `قيود-يدوية.md` |

## ماذا يستخرج البرنامج؟

- أي بلوك ` ```json ` فيه `weightAdjustments`
- أي سطر مثل `momentum: 1.25` أو `"order_imbalance": 1.4`
- أهداف hit rate مذكورة في النص

## مسار Windows كامل

```powershell
cd C:\Users\pc\zambahola-one-agent
git pull origin main
mkdir apps\one-agent\knowledge\user-reports -Force
copy C:\Users\pc\Downloads\تنبوء-2.md apps\one-agent\knowledge\user-reports\
copy "C:\Users\pc\Downloads\ابي تتعمق اكثر وتجيب اكثر عن دقة التنبوء ورفعه.md" apps\one-agent\knowledge\user-reports\دقة-التنبوء.md
copy "C:\Users\pc\Downloads\ابي كل ما يخص تعلم الاله و التداول بالذكاء الاصطنا.md" apps\one-agent\knowledge\user-reports\تعلم-الالة.md
copy C:\Users\pc\Downloads\ايه.md apps\one-agent\knowledge\user-reports\
npm run agent:import-md-reports
npm run agent:omni-train
```
