# ZAMBAHOLA — حزمة تقارير للمراجعة

> انسخ هذا الملف كامل أو ارفعه في محادثة Cursor قبل تعليم الوكيل.
> المجلد المصدر: `C:\Users\pc\zambahola-one-agent\apps\one-agent\knowledge\user-reports`
> التاريخ: 2026-06-06T03:29:55.028Z
> عدد الملفات: 5

---

## 📄 ابي تتعمق اكثر وتجيب اكثر عن دقة التنبوء ورفعه.md

<!-- source: C:\Users\pc\zambahola-one-agent\apps\one-agent\knowledge\user-reports\ابي تتعمق اكثر وتجيب اكثر عن دقة التنبوء ورفعه.md -->

<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# ابي تتعمق اكثر وتجيب اكثر عن دقة التنبوء ورفعه

جوهر الموضوع: دقة التنبؤ على أفق 30–60 ثانية لها سقف طبيعي، لكن تستطيع رفع **الدقة “المُفيدة”** بشكل كبير عبر: ضبط الـ labels بعناية، هندسة خصائص غنية من الـ order book والـ microstructure، استخدام نماذج قوية (XGBoost/Ensembles + شبكات تسلسلية)، ثم طبقة meta‑labeling + abstention تضرب الضوضاء وتُبقي فقط الإشارات عالية الجودة.[^1][^2][^3]

سأقسم الكلام إلى “رافعات” عملية تستطيع ترجمتها مباشرة إلى كود داخل مشروعك في Cursor.

***

## 1. حدود واقعية لدقة التنبؤ القصير الأجل

- دراسات على أسهم وكريبتو بتردد عالي (1–2 دقيقة) تظهر أن حتى النماذج القوية (Linear, XGBoost, LSTM) غالباً ما تدور حول دقة اتجاهية 52–60٪ فقط عند محاولة التنبؤ بالحركة التالية مباشرة، بسبب الضوضاء العالية والسوق شبه الكفؤ.[^4][^2][^3]
- نفس الأبحاث تؤكد أن **إضافة خصائص high‑frequency** مثل realized volatility, order‑flow, volume‑price dynamics ترفع الدقة بشكل ملحوظ مقارنة بالمؤشرات الكلاسيكية فقط.[^3][^4]

الفكرة: استهدف تحسينين متوازيين:

1) رفع الدقة الكلية بقدر الإمكان،
2) والأهم: رفع الدقة **الشرطية** في الحالات التي تقرر فيها الدخول (بمساعدة meta‑labeling والامتناع).

***

## 2. هندسة الـ Label نفسها (Target Engineering)

تعريف الـ label له تأثير هائل على الدقة:

- معظم أبحاث الكريبتو تستخدم:
    - mid‑price بعد $\Delta t$ (مثل 30 ثانية) ثم تصنف Up/Down/Flat بناءً على عتبة basis points.[^5][^6]
- مراجعات حديثة توصي بـ:
    - استبعاد الحركات الصغيرة جداً (flat zone) لأنها ضوضاء بحتة وتربك النموذج؛ هذا يرفع الدقة على حساب تقليل عدد الإشارات.[^7][^1]

تطبيق عملي لرفع الدقة:

- زد `threshold_bp` في دالة بناء الـ label:
    - مثال: بدلاً من ±1 bp استخدم ±2–3 bp، بحيث لا تُوسم الحركات الصغيرة كـ up/down بل flat.
- جرّب عدة قيم للthreshold، وقارن:
    - accuracy, precision, recall لكل threshold.
    - ratio عدد الإشارات / حجم البيانات (حتى لا تقل الإشارات جداً).

***

## 3. Feature Engineering متقدم لبيانات high‑frequency

الأبحاث التي تحسن دقة التنبؤ القصير الأجل عادة تبني Features على 3 محاور:[^6][^4][^5][^3]

1. **Microstructure \& Order Book**
    - spread (bp)، depth على مستويات متعددة، order‑flow imbalance.
    - “Power imbalance” كما في مشروع BitPredict لـ BTC: وزن الطلبات حسب المسافة عن الـ mid‑price وقوتها، وإنتاج features متعددة (power 2, 4, 8).[^6]
    - volume‑weighted price levels (VWAP محلي في نافذة قصيرة).
2. **إشارات Volatility و “تعب السوق”**
    - realized volatility (σ) على 10–30 ثانية.
    - range-based volatility (high–low) داخل النافذة.
    - burstiness indicators (نسبة الزمن الذي تتجاوز فيه الحركة threshold معيّن).
3. **مؤشرات فنية + temporal lags**
    - EMA/Fast vs Slow، RSI، stochastic، لكن على إطارات زمنية مصغرة تناسب high‑frequency.[^1][^5]
    - lagged returns: $\text{ret}_{1s}, \text{ret}_{5s}, \text{ret}_{15s}$.
    - rolling correlations بين السعر والحجم.

رفع الدقة هنا يأتي من:

- زيادة “معلومية” المزايا (Information content).
- جعل النموذج يلتقط context غني حول النقطة الحالية بدلاً من النظر إلى السعر فقط.

***

## 4. اختيار النموذج وضبطه (Model Choice \& Tuning)

### نماذج شجرية مع Gradient Boosting / XGBoost

- عدد من الدراسات على intraday و crypto وجدت أن XGBoost يغلب النماذج الخطية التقليدية خصوصاً عندما تُغذّى بـ intraday/high‑frequency features (volatility, order‑flow, etc.).[^2][^4][^3]
- مميزات:
    - يتعامل مع non‑linearities والتفاعلات بين features مباشرة.
    - يعطيك feature importance لرؤية ما يؤثر فعلياً على التنبؤ.

أفضل ممارسة لرفع الدقة:

- Hyperparameter tuning جاد:
    - depth صغيرة نسبياً (3–6) لمنع overfitting.
    - subsampling للـ rows والـ features.
    - learning rate صغير + عدد شجرات أكبر.
- استخدام **TimeSeriesCV** وليس K‑Fold عادي لمنع التسرب الزمني (leakage).[^2][^3]


### نماذج Deep Learning (LSTM / CNN / DFFNN)

- LSTM/GRU على بيانات كريبتو ساعة–ساعة أو دقيقة–دقيقة أظهرت تحسن في MAE/RMSE مقارنة بالخطية، مع R² يصل إلى ~0.87 لبعض الأصول، ما يدل على قدرة على التقاط non‑linear temporal patterns.[^8]
- دراسة على BTC high‑frequency استخدمت DFFNN مع خوارزميات تدريب مختلفة، ووجدت أن Levenberg–Marquardt يعطي RMSE أقل من طرق تدريب أخرى، يعني دقة أعلى.[^5]

لك، كنقطة عملية:

- استخدم Gradient Boosting/XGBoost كـ baseline،
- ثم جرّب:
    - 1D‑CNN على سلسلة features الزمنية القصيرة (مثلاً نافذة 60–120 نقطة زمنية).
    - أو LSTM صغيرة مع regularization قوي (dropout + weight decay).

***

## 5. Ensembles ودمج النماذج لرفع الدقة

- مراجع متخصصة في الكريبتو تستخدم **Ensemble Methods** (Bagging/Boosting/Stacking) وتجد أنها تعطي تحسن ملحوظ في دقة اتجاه السعر مقارنة بنموذج واحد فقط.[^9][^10][^11]
- دراسات على “price direction ensembles” تؤكد أن:
    - دمج نماذج مختلفة (tree‑based + deep + linear) بتصويت weighted أو meta‑learner (stacking) يقلل variance ويحسن الاستقرار والأداء.[^10]

كيف تستفيد في وكيلك:

- احتفظ بنماذج متعددة:
    - Model_A: XGBoost على order‑book features.
    - Model_B: LSTM على سلسلة returns/volatility.
    - Model_C: Logistic baseline على مؤشرات فنية.
- استخدم:
    - Weighted voting حيث الأوزان = performance في آخر N أيام.
    - أو meta‑learner (مثلاً Logistic Regression) يأخذ الـ probabilities من A/B/C كـ inputs ويتعلم الدمج الأمثل.

***

## 6. Meta‑Labeling بشكل منهجي لرفع “دقة الدخول”

Meta‑labeling يُعالج سؤال: *متى أصدق الإشارة؟* وليس فقط *ما اتجاه السعر؟*.[^9][^10]

الخطوات العملية:

1. درّب النموذج الأساسي على اتجاه السعر (كما ناقشنا).
2. نفّذ Backtest نظري على البيانات التاريخية:
    - لكل إشارة (تنبؤ) سجّل:
        - direction، probability/confidence من النموذج الأساسي.
        - PnL المحقق بعد الخروج (مع تكاليف التداول).
        - خصائص إضافية عند الدخول (spread, volatility, imbalance, regime indicators…).
3. ببناء meta‑dataset:
    - meta_y = 1 إذا كانت الصفقة رابحة (أو PnL > حد معيّن).
    - meta_y = 0 إذا كانت خاسرة أو ضعيفة.
4. درّب Meta‑Model (مثلاً XGBoost آخر أو Logistic) على هذا meta‑dataset.

في الإنتاج:

- Model1 يعطي الاتجاه + probability.
- Model2 (meta) يعطي “احتمال أن تكون هذه الصفقة رابحة”.
- قرارات:
    - trade فقط إذا:
        - prob_main > threshold_main (مثلاً 0.55–0.6)،
        - prob_meta > threshold_meta (مثلاً 0.6–0.7).

نتيجة ذلك:

- يمكن أن تبقى الدقة الكلية للـ model1 متواضعة، لكن الدقة **بعد تطبيق meta‑filter** ترتفع كثيراً، لأنك تستبعد الحالات التي يتوقع meta‑model أنها خاسرة.

***

## 7. الامتناع (Abstention) كوسيلة لرفع دقة التنبؤ الفعّالة

بدلاً من المطاردة وراء دقة عالمية عالية، ركّز على:

> دقة التنبؤ في subset من الحالات التي تسمح بها قواعد الامتناع + meta‑labeling.

طرق عملية:

1. **قواعد يدوية مبنية على السوق**:
    - لا تتداول عندما:
        - spread_bp كبير (تكلفة ضخمة)،
        - order‑book imbalance ≈ 0 مع volatility شديدة (سوق ضوضائي)،
        - volume منخفض جداً (slippage مرتفع).
هذه القواعد مدعومة بممارسات HFT وتوصيات في أبحاث high‑frequency microstructure.[^7][^6]
2. **تعلم الامتناع ضمن الـ meta‑model**:
    - اعتبر threshold_meta “مفتاح” الامتناع:
        - كلما رفعته، يقل عدد الصفقات ولكن تزداد دقة النتائج (precision).
        - جرّب رسم curve لـ precision مقابل نسبة الصفقات المنفذة.
3. **حظر mean‑reversion في trend قوي**:
    - كما ذكرت في الرد السابق: عندما يكون trend_up واضح (EMA fast > EMA slow, momentum_z > 1, order‑imbalance لصالح الشراء)، امنع إشارات mean‑reversion واستمر في الاتجاه.[^4][^7]

***

## 8. تقسيم الأنظمة (Regime Segmentation) لتحسين الدقة

الكثير من الأبحاث تشير إلى أن النماذج تختلف قوتها حسب نظام السوق (Regime): ترند، تذبذب، هدوء، إلخ.[^1][^7]

لرفع الدقة:

1. عرّف regimes بسيطة:
    - ترند صاعد / ترند هابط / Range‑bound.
    - high‑vol / low‑vol.
2. درّب:
    - نموذج منفصل لكل regime، أو
    - استخدم regime كـ feature رئيسية في النموذج.

مثال عملي:

- model_trend_up يُستخدم فقط عندما regime == trend_up.
- model_range يُستخدم عندما volatility منخفضة وRSI في النطاق.

هذا يقلل heterogeneity داخل التدريب ويجعل النموذج “مُتخصص” في بيئة محددة، مما يرفع دقته.

***

## 9. Calibration للـ Probabilities واستخدام العتبات الذكية

حتى لو كان model يعطي احتمال 0.7، هذا لا يعني بالضرورة أن 70٪ من هذه الإشارات تربح؛ calibration يعالج هذا.[^3]

خطوات عملية:

1. بعد التدريب، استخدم مجموعة validation لعكس:
    - reliability curve (calibration plot): plot predicted prob مقابل actual freq.
2. استخدم تقنيات مثل:
    - Platt Scaling أو Isotonic Regression على مخرجات النموذج.
3. اختر thresholds بناءً على target:
    - إذا تريد رفع precision (دقة عالية على حساب عدد صفقات أقل): ارفع threshold_main/threshold_meta.
    - يمكنك اختيار threshold الذي يعطي أفضل trade‑off بين Sharpe, win‑rate, drawdown.

***

## 10. إطار تقييم صارم يمنع “وهم الدقة”

كل الخطوات السابقة لن تفيد إذا كان التقييم غير واقعي:

- استخدم Time‑Series Cross‑Validation مع حظر التداخل (purged CV) بين train/test لتجنب leakage.[^2][^3]
- backtest يجب أن يشمل:
    - transaction costs, slippage, latency تقريبية.
    - قيود volume/position sizing.
- المقاييس المهمة ليست accuracy فقط:
    - directional accuracy.
    - precision/recall للإشارات المنفذة.
    - Sharpe, max drawdown, hit‑rate على مستوى الصفقات.

هذا يمنعك من الانخداع بنموذج “دقته 70٪” على الورق لكنه يفشل في الواقع.

***

## 11. خطة عملية لرفع الدقة داخل مشروعك في Cursor

قائمة تنفيذية يمكنك العمل بها مباشرة:

1. إعادة تصميم الـ labels:
    - جرّب عدة thresholds للـ bp واستبعد الحركات الصغيرة، وقارن النتائج.
2. إثراء الـ features:
    - أضف order‑book imbalance المتقدم (على أكثر من مستوى)، realized volatility، volume‑price dynamics كما في BitPredict والأبحاث المشابهة.[^4][^6][^3]
3. نموذج baseline قوي:
    - درّب XGBoost/LightGBM مع TimeSeriesCV + hyperparameter tuning منظم.
4. Ensemble:
    - أضف CNN/LSTM بسيط، وجرّب stacking أو weighted voting بينه وبين XGBoost.
5. Meta‑Labeling:
    - نفّذ backtest لإشارات model1، ابنِ meta‑dataset، درّب meta‑model لتصفية الصفقات الخاسرة.
6. Abstention Rules:
    - نفّذ طبقة قواعد بسيطة (spread, volatility, imbalance) + thresholds للـ meta‑prob.
7. Regime‑Aware Models:
    - استخرج regimes (trend/volatility) ودرب نماذج متخصصة أو استخدمها كـ features رئيسية.
8. Calibration:
    - طبّق Platt/Isotonic على مخرجات النموذج، واضبط thresholds لتحقيق أعلى precision ممكنة في subset الذي تتداول فيه.

إذا أحببت، في الرسالة القادمة أستطيع أن أكتب لك Skeleton أكثر تفصيلاً (ملفات + دوال + signatures) بحيث:

- ملف للتجارب على thresholds والـ features،
- ملف لتجارب ensembles/meta‑labeling،
- وملف تقييم يطبع لك جدول واضح: accuracy, precision, recall, Sharpe قبل/بعد كل تحسين، لتتابع أثر كل خطوة على دقة التنبؤ.
<span style="display:none">[^12][^13][^14][^15][^16][^17]</span>

<div align="center">⁂</div>

[^1]: https://journal.uinsgd.ac.id/index.php/kubik/article/view/33423

[^2]: https://ieeexplore.ieee.org/document/11254075/

[^3]: https://pmc.ncbi.nlm.nih.gov/articles/PMC12571449/

[^4]: https://aemps.ewapub.com/article/view/25205

[^5]: https://iris.unito.it/handle/2318/1924253

[^6]: https://github.com/cbyn/bitpredict

[^7]: https://www.sciencedirect.com/science/article/pii/S1544612325015223

[^8]: https://jdmdc.com/index.php/JDMDC/article/view/43

[^9]: https://norma.ncirl.ie/8550/1/samarasimhareddydevireddy.pdf

[^10]: https://fenix.tecnico.ulisboa.pt/downloadFile/1126295043839545/89516-Pedro-Fernandes-dissertacao.pdf

[^11]: https://www.diva-portal.org/smash/get/diva2:1778251/FULLTEXT03.pdf

[^12]: https://journals.asianresassoc.org/index.php/irjmt/article/view/3961

[^13]: https://dl.acm.org/doi/10.1145/3715335.3735485

[^14]: https://ijarsct.co.in/Paper25857.pdf

[^15]: https://dl.acm.org/doi/10.1145/3768801.3768871

[^16]: https://www.diva-portal.org/smash/get/diva2:2002936/FULLTEXT01.pdf

[^17]: https://arxiv.org/html/2405.11431v1

---

## 📄 ابي كل ما يخص تعلم الاله و التداول بالذكاء الاصطنا.md

<!-- source: C:\Users\pc\zambahola-one-agent\apps\one-agent\knowledge\user-reports\ابي كل ما يخص تعلم الاله و التداول بالذكاء الاصطنا.md -->

<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# ابي كل ما يخص تعلم الاله و التداول بالذكاء الاصطناعي ورفع دقة التنبوء فيه موجهه الى cursor حتى يطور الوكيل الخاص بي

سأعطيك خارطة طريق عملية + هيكلة مشروع جاهزة لـ Cursor لبناء وكيل تداول يعتمد على تعلّم الآلة مع تركيز واضح على رفع دقة التنبؤ للاتجاه القصير الأجل. هدف كل جزء أن تُلصقه مباشرة داخل مشروعك في Cursor وتبدأ التطوير خطوة بخطوة.

***

## الصورة الكاملة (Pipeline التداول بالذكاء الاصطناعي)

لبناء وكيل تداول ذكي دقيق، فكّر في pipeline من 5 مراحل:

1. جمع البيانات:
    - بيانات سعرية tick أو 1s/5s (OHLCV).
    - Order book / order flow (bid/ask, imbalance, spread).
    - مؤشرات مشتقة (volume profile, volatility, indicators).
2. بناء الـ labels:
    - مثال لكريبتو: تصنيف الاتجاه خلال 30–60 ثانية قادمة (up / down / flat).
    - يمكن استخدام mid-price بعد 30–60 ثانية ومقارنته بالسعر الحالي لتعريف label.
3. المزايا (Features):
    - مؤشرات price action (returns, volatility, microstructure features).
    - order book features (imbalance, spread, depth).
    - مؤشرات فنية (EMA, RSI, VWAP, …).
4. النمذجة:
    - بدايةً بنماذج كلاسيكية (Logistic Regression, Random Forest, Gradient Boosting).
    - ثم الانتقال إلى شبكات عصبية (LSTM/Temporal CNN/Transformer) حسب تعقيد البيانات.
5. النشر (Deployment) كوكلاء:
    - خدمة inference (Python process/REST/gRPC).
    - Agent logic يقرأ من feed مباشر، يبني features، يستدعي النموذج، يقرر (trade/skip).

***

## هيكلة مشروع مقترحة لـ Cursor

استخدم هذه الهيكلة كمشروع Python في Cursor:

```txt
ai-trading-agent/
  data/
    raw/
    processed/
  notebooks/
  src/
    __init__.py
    config.py
    data_loader.py
    feature_engineering.py
    labeling.py
    models/
      __init__.py
      baseline_logit.py
      gradient_boosting.py
      deep_model.py
    training/
      train_supervised.py
      cross_validation.py
      meta_labeling.py
    evaluation/
      metrics.py
      backtest.py
    live/
      live_features.py
      agent_loop.py
      risk_manager.py
  tests/
  requirements.txt
  README.md
```

في Cursor يمكنك فتح المشروع، ووضع تعليقات من نوع:
`# TODO: implement feature: order_book_imbalance`
ليساعدك الـ AI في توليد الكود بسرعة.

***

## الأساس النظري المختصر لتعلم الآلة في التداول

### تعريف المشكلة

- نوع المشكلة: تصنيف ثنائي/ثلاثي (up / down / flat) لعودة السعر خلال نافذة قصيرة (مثلاً 30s–60s).
- الهدف: دقة اتجاهية أعلى من 50٪ + precision/recall جيد في الحالات التي يتم فيها الدخول فعلاً (بعد تطبيق meta-labeling/abstention).


### أنواع النماذج المفيدة

- نماذج تبادلية بسيطة:
    - Logistic Regression, Linear SVM كـ baseline سهل الفهم.
- نماذج غير خطية:
    - Random Forest, XGBoost, LightGBM مفيدة جداً كمرحلة أولى لأنها:
        - تتعامل مع non-linearities.
        - تعطي Feature Importance.
- نماذج تسلسلية/عميقة:
    - 1D CNN على سلاسل زمنية (price/volume/imbalance).
    - LSTM/GRU لسلاسل زمنية.
    - Temporal Transformer لو أردت مستوى أعلى.

ابدأ بنماذج Gradient Boosting (XGBoost/LightGBM) قبل القفز إلى deep learning لأنها تعطيك سرعة وتجربة أسهل، خصوصاً على horizon قصير.

***

## بناء البيانات والـ labels

### مثال label لاتجاه 30–60 ثانية

في ملف `labeling.py`:

```python
import pandas as pd

def make_direction_label(df: pd.DataFrame, horizon_secs: int = 30, threshold_bp: float = 1.0):
    """
    df: يحتوي على أعمدة ['timestamp', 'mid_price']
    horizon_secs: الأفق الزمني (30 أو 60 ثانية)
    threshold_bp: حد الحركة (basis points) لتصنيف up/down/flat
    """
    df = df.sort_values("timestamp").copy()
    df["mid_future"] = df["mid_price"].shift(-horizon_secs)
    ret = (df["mid_future"] - df["mid_price"]) / df["mid_price"] * 10000.0  # basis points
    cond_up = ret > threshold_bp
    cond_down = ret < -threshold_bp
    df["y"] = 0  # flat
    df.loc[cond_up, "y"] = 1  # up
    df.loc[cond_down, "y"] = -1  # down
    return df.dropna(subset=["y"])
```

- يمكنك تعديل `threshold_bp` لضبط حساسية الاتجاه (كلما زاد الحد قلّ عدد الإشارات لكن زادت وضوح الحركة).

***

## Feature Engineering عملي

في `feature_engineering.py`:

```python
import pandas as pd
import numpy as np

def add_returns_and_vol(df: pd.DataFrame, window: int = 30):
    df = df.copy()
    df["ret_1s"] = df["mid_price"].pct_change(1)
    df["ret_5s"] = df["mid_price"].pct_change(5)
    df["ret_30s"] = df["mid_price"].pct_change(30)
    df["vol_30s"] = df["ret_1s"].rolling(window).std()
    return df

def add_orderbook_features(df: pd.DataFrame):
    # يفترض وجود أعمدة: bid_price, ask_price, bid_size, ask_size
    df = df.copy()
    df["spread_bp"] = (df["ask_price"] - df["bid_price"]) / df["mid_price"] * 10000.0
    df["ob_imbalance"] = (df["bid_size"] - df["ask_size"]) / (df["bid_size"] + df["ask_size"] + 1e-6)
    return df

def add_technical_indicators(df: pd.DataFrame):
    df = df.copy()
    df["ema_fast"] = df["mid_price"].ewm(span=20, adjust=False).mean()
    df["ema_slow"] = df["mid_price"].ewm(span=50, adjust=False).mean()
    df["ema_cross"] = (df["ema_fast"] - df["ema_slow"]) / df["mid_price"]
    df["rsi_14"] = compute_rsi(df["mid_price"], 14)
    return df

def compute_rsi(series: pd.Series, period: int = 14):
    delta = series.diff()
    gain = (delta.where(delta > 0, 0.0)).rolling(period).mean()
    loss = (-delta.where(delta < 0, 0.0)).rolling(period).mean()
    rs = gain / (loss + 1e-6)
    rsi = 100 - (100 / (1 + rs))
    return rsi
```

- اجمع هذه الوظائف في pipeline واحدة لبناء `X` features و `y` labels من نفس DataFrame.

***

## تدريب النماذج مع Cross-Validation مناسبة للزمن

في التداول، الـ k-fold العادي غير مناسب بسبب leakage؛ استعمل:

- TimeSeriesSplit أو walk-forward validation.
- Purged cross-validation (تجاهل الفترات القريبة من بعضها لتفادي التأثير بين train/test).

في `training/cross_validation.py`:

```python
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import accuracy_score, f1_score
import numpy as np

def time_series_cv(model_cls, X, y, n_splits: int = 5, model_kwargs=None):
    if model_kwargs is None:
        model_kwargs = {}
    tscv = TimeSeriesSplit(n_splits=n_splits)
    accs, f1s = [], []
    for train_idx, test_idx in tscv.split(X):
        model = model_cls(**model_kwargs)
        model.fit(X[train_idx], y[train_idx])
        y_pred = model.predict(X[test_idx])
        accs.append(accuracy_score(y[test_idx], y_pred))
        f1s.append(f1_score(y[test_idx], y_pred, average="macro"))
    return np.mean(accs), np.mean(f1s)
```


***

## Meta-Labeling ورفع دقة التنبؤ

Meta-labeling = نموذج ثاني يتعلم متى نثق في النموذج الأساسي ومتى نمتنع (abstain):

1. النموذج الأساسي يعطي:
    - إشارة اتجاه (up/down).
    - احتمال/score للإشارة.
2. بناء meta-label:
    - لكل صف، label meta = 1 إذا كانت الصفقة كانت رابحة (بعد backtest بسيط)، و 0 إذا كانت خاسرة.
    - Model 2 يتعلم من features إضافية (confidence, volatility, spread, imbalance…) ليقرر الدخول أو الامتناع.
3. في الإنتاج:
    - Model 1 يقرر الاتجاه.
    - Model 2 يقرر if execute or skip.

هيكل بسيط في `training/meta_labeling.py`:

```python
def build_meta_labels(trades_df):
    """
    trades_df: نتيجة backtest تحتوي على أعمدة:
      ['entry_time', 'exit_time', 'direction', 'pnl', 'features_at_entry...']
    meta_y = 1 إذا pnl > 0 (أو أكبر من حد معين)، وإلا 0.
    """
    trades_df = trades_df.copy()
    trades_df["meta_y"] = (trades_df["pnl"] > 0.0).astype(int)
    return trades_df

def train_meta_model(X_meta, y_meta, model_cls, model_kwargs=None):
    if model_kwargs is None:
        model_kwargs = {}
    model = model_cls(**model_kwargs)
    model.fit(X_meta, y_meta)
    return model
```

- استخدم meta-model لتحديد عتبة احتمال الدخول:
    - مثال: لا ندخل إلا إذا model1_prob > 0.6 AND meta_model_prob > 0.55.

***

## قواعد الامتناع (Abstention) لرفع الجودة

لقصير الأجل، الامتناع في الحالات السيئة أهم من الدخول في كل فرصة:

- أمثلة مبسطة لقواعد يمكن ترميزها في `live/agent_loop.py`:
    - لا تتداول إذا:
        - spread_bp > حد معين (مثلاً 5 basis points).
        - order_book_imbalance قريب من الصفر (سوق متوازن جداً).
        - volatility_30s في أعلى 10% من التوزيع (ضوضاء عالية).
    - لا تأخذ mean-reversion في ترند واضح لأعلى:
        - price > ema_slow.
        - ema_fast > ema_slow.
        - momentum_z_score > 1.0.
        - حينها، تجاهل استراتيجيات mean-reversion، واعتمد more on momentum/follow-trend.

يمكنك كتابة منطق الامتناع كطبقة منفصلة:

```python
def should_abstain(features: dict) -> bool:
    if features["spread_bp"] > 5.0:
        return True
    if abs(features["ob_imbalance"]) < 0.05 and features["vol_30s_pct"] > 90:
        return True
    return False
```


***

## دمج كل شيء في وكيل حي (Live Agent Loop)

في `live/agent_loop.py`:

```python
import time
from .live_features import build_live_features
from .risk_manager import RiskManager

class TradingAgent:
    def __init__(self, model_main, model_meta=None, broker_api=None, config=None):
        self.model_main = model_main
        self.model_meta = model_meta
        self.broker_api = broker_api
        self.config = config or {}
        self.risk_manager = RiskManager(self.config)

    def step(self, market_snapshot):
        features_vec, features_dict = build_live_features(market_snapshot)

        if should_abstain(features_dict):
            return  # لا دخول

        proba = self.model_main.predict_proba(features_vec)[^0]
        direction = 1 if proba[^1] > proba[^0] else -1

        if self.model_meta is not None:
            meta_proba = self.model_meta.predict_proba(features_vec)[^0][^1]
            if meta_proba < self.config.get("meta_min_conf", 0.55):
                return  # امتناع

        if not self.risk_manager.allow_new_trade():
            return

        self.execute_trade(direction)

    def execute_trade(self, direction):
        # استدعاء API الفيوتشَر/سبوت للتنفيذ
        pass

    def run_forever(self, data_feed):
        for snapshot in data_feed:
            self.step(snapshot)
            time.sleep(self.config.get("loop_sleep", 0.5))
```


***

## كيف توظّف Cursor بفعالية لبناء هذا الوكيل

في Cursor يمكنك استغلال الـ AI كالتالي:

- ابدأ بإنشاء الملفات والهيكلة أعلاه، ثم:
    - ضع Docstrings واضحة في كل دالة توضّح المدخلات والمخرجات.
    - اكتب تعليقات مثل:
        - `# Implement Backtest class to simulate trades with transaction costs`
        - `# Add unit tests for time_series_cv to ensure no data leakage`
- اطلب من Cursor:
    - توليد اختبارات `pytest` لكل module أساسي.
    - توليد Config class (pydantic) لإدارة إعدادات النموذج والوكيل.
    - توليد سكريبتات CLI صغيرة:
        - `train_model.py`
        - `run_backtest.py`
        - `run_live_agent.py`

بهذا الشكل، Cursor يصبح “accelerator” فوق التصميم الهندسي الذي تحدده أنت.

***

## خطوات عملية مقترحة لك

1. إنشاء مشروع `ai-trading-agent` في Cursor بالهيكلة المقترحة.
2. إضافة:
    - `data_loader.py` لتحميل بيانات BTC (من Binance/Exchange آخر).
    - `labeling.py` لتوليد labels 30–60 ثانية.
    - `feature_engineering.py` لبناء features الأساسية.
3. تجربة نموذج Gradient Boosting:
    - Train + TimeSeries CV.
    - تسجيل performance (accuracy, F1, confusion matrix).
4. بناء Backtest بسيط لإشارات النموذج:
    - تحويل تنبؤات الاتجاه إلى أوامر (long/short/flat).
    - حساب PnL مع تكاليف التداول.
5. بناء meta-labels من نتائج الـ backtest، وتدريب meta-model.
6. إضافة قواعد abstention (spread, imbalance, volatility).
7. بناء `TradingAgent` وتشغيله على data feed تجريبي (replay historical data) قبل أي تشغيل حي.

إذا أردت، في رسالة لاحقة يمكننا تصميم config كامل (YAML/JSON) + نماذج prompts محددة لـ Cursor لكل ملف (مثلاً “اكتب لي Backtest engine يدعم fees, slippage, stop loss”) بحيث تطورها تدريجياً داخل IDE.

<div align="center">⁂</div>

---

## 📄 ايه بس بدون تدقيق لل قيود لانه انا الي ابكتبها بمل.md

<!-- source: C:\Users\pc\zambahola-one-agent\apps\one-agent\knowledge\user-reports\ايه بس بدون تدقيق لل قيود لانه انا الي ابكتبها بمل.md -->

<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# ايه بس بدون تدقيق لل قيود لانه انا الي ابكتبها بملف خاص

تمام، سأعطيك الآن **هياكل (signatures) نظيفة** فقط، بدون أي قواعد أو قيود داخلية، بحيث تضع أنت كل المنطق الخاص بالقيود في ملفاتك (config / constraints) وتستخدم Cursor ليملأ التفاصيل داخل هذه الهياكل.[^1][^2]

كل الكود أدناه مهيّأ ليستخدم في مشروعك مباشرة.

***

## 1) واجهة Backtest أساسية

```python
# src/backtest/core.py
from dataclasses import dataclass
from typing import Protocol, Any, Dict, List, Optional


@dataclass
class TradeResult:
    entry_time: Any
    exit_time: Any
    direction: int          # +1 / -1
    entry_price: float
    exit_price: float
    pnl: float
    meta: Dict[str, Any]    # أي معلومات إضافية (features_at_entry, fees, الخ)


class ExecutionModel(Protocol):
    def simulate_fill(
        self,
        timestamp: Any,
        direction: int,
        price: float,
        size: float,
        context: Dict[str, Any],
    ) -> float:
        """
        Return effective fill price given raw price and context (slippage, fees, etc.).
        """
        ...


class BacktestEngine:
    def __init__(
        self,
        price_series: Any,
        execution_model: ExecutionModel,
    ) -> None:
        """
        price_series: بنية بيانات تحتوي على السعر والزمن (DataFrame أو غيره).
        execution_model: كائن ينفّذ منطق التنفيذ (slippage, fees, ...).
        """
        self.price_series = price_series
        self.execution_model = execution_model

    def simulate_trade(
        self,
        entry_index: int,
        direction: int,
        size: float,
        exit_index: int,
        extra_meta: Optional[Dict[str, Any]] = None,
    ) -> TradeResult:
        """
        يحاكي صفقة واحدة بين entry_index و exit_index.
        لا يفرض أي قواعد مخاطرة أو قيود، فقط يحسب PnL.
        """
        raise NotImplementedError

    def run_backtest(
        self,
        signal_indices: List[int],
        directions: List[int],
        sizes: List[float],
        exit_indices: List[int],
        metas: Optional[List[Dict[str, Any]]] = None,
    ) -> List[TradeResult]:
        """
        ينفذ backtest لمجموعة من الإشارات.
        كل منطق اختيار نقاط الدخول/الخروج/الحجم يبقى خارج هذه الطبقة.
        """
        raise NotImplementedError
```


***

## 2) بناء Meta‑Dataset وتدريب Meta‑Model

```python
# src/meta_labeling/core.py
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple
import numpy as np


@dataclass
class MetaSample:
    features: Dict[str, Any]
    meta_label: int          # 1 = صفقة جيدة, 0 = سيئة
    base_direction: int
    base_confidence: float
    pnl: float
    raw: Dict[str, Any]      # المرجع الكامل إذا احتجته لاحقاً


class MetaDatasetBuilder:
    def __init__(self) -> None:
        """
        يبني meta-dataset من نتائج الـ backtest.
        لا يفرض تعريف معيّن لـ "صفقة جيدة"؛ أنت تحدده خارجياً.
        """
        ...

    def build_meta_samples(
        self,
        trades: List[TradeResult],
        base_features_at_entry: List[Dict[str, Any]],
        base_confidences: List[float],
        meta_label_func: callable,
    ) -> List[MetaSample]:
        """
        meta_label_func: دالة أنت تكتبها تعيد 0/1 من TradeResult + أي سياق تريده.
        """
        raise NotImplementedError

    def to_numpy(
        self,
        samples: List[MetaSample],
        feature_keys: List[str],
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        يحول MetaSample إلى X_meta, y_meta حسب feature_keys المحددة.
        """
        raise NotImplementedError
```

```python
# src/meta_labeling/model.py
from typing import Any, Tuple
import numpy as np
from sklearn.base import BaseEstimator


class MetaModelWrapper:
    def __init__(self, base_model: BaseEstimator) -> None:
        """
        base_model: أي مصنف (XGBoost, RandomForest, Logistic...) يدعم fit/predict_proba.
        """
        self.base_model = base_model

    def fit(self, X_meta: np.ndarray, y_meta: np.ndarray) -> None:
        """
        تدريب نموذج meta-labeling.
        """
        raise NotImplementedError

    def predict_proba(self, X_meta: np.ndarray) -> np.ndarray:
        """
        يعيد احتمالات meta_label (مثل [:, 1] = احتمال صفقة جيدة).
        """
        raise NotImplementedError
```


***

## 3) غلاف Ensemble لنماذجك الأساسية

```python
# src/models/ensemble.py
from typing import Dict, Any, Protocol
import numpy as np


class ProbabilisticModel(Protocol):
    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        ...


class EnsembleModel:
    def __init__(
        self,
        models: Dict[str, ProbabilisticModel],
        weights: Dict[str, float],
    ) -> None:
        """
        models: dict اسم -> نموذج
        weights: dict اسم -> وزن (يجب أن تضمن أنت التوزيع/التطبيع).
        """
        self.models = models
        self.weights = weights

    def predict_proba(
        self,
        X_per_model: Dict[str, np.ndarray],
    ) -> np.ndarray:
        """
        X_per_model: dict اسم النموذج -> features المناسبة له.
        لا يفرض أي منطق دمج إضافي غير المزج الخطي للـ probabilities.
        """
        raise NotImplementedError
```


***

## 4) معايرة (Calibration) واختيار Thresholds (بدون منطق جاهز)

```python
# src/evaluation/calibration.py
from typing import Tuple, Dict
import numpy as np
from sklearn.base import BaseEstimator


def calibrate_classifier(
    base_model: BaseEstimator,
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    method: str = "isotonic",
) -> BaseEstimator:
    """
    يعيد نموذجاً معايراً (Platt / Isotonic).
    لا يفرض طريقة اختيار الـ method أو معايير الجودة؛ كلها ترجع لك.
    """
    raise NotImplementedError


def sweep_thresholds(
    proba_main: np.ndarray,
    proba_meta: np.ndarray,
    pnl: np.ndarray,
    candidate_main: np.ndarray,
    candidate_meta: np.ndarray,
    scorer: callable,
) -> Dict[str, float]:
    """
    generic threshold sweep:
      - proba_main: احتمالات النموذج الأساسي.
      - proba_meta: احتمالات meta-model.
      - pnl: أرباح/خسائر لكل إشارة.
      - candidate_main/meta: مجموعة العتبات التي تختبرها.
      - scorer: دالة تقييم تكتبها أنت (Sharpe, win_rate, any).
    يعيد قاموس مثلاً {"best_main": ..., "best_meta": ..., "score": ...}.
    """
    raise NotImplementedError
```


***

## 5) Agent حي بدون قيود داخلية (كل القيود تأتي من خارج)

الفكرة: الـ Agent لا يعرف أي قواعد؛ فقط:

- يستدعي دالة `constraints.should_trade(...)` التي تكتبها أنت في ملف منفصل.
- يستلم thresholds من config خارجي.

```python
# src/live/agent.py
from dataclasses import dataclass
from typing import Any, Dict, Protocol
import numpy as np


class BasePredictor(Protocol):
    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        ...


class MetaPredictor(Protocol):
    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        ...


class Constraints(Protocol):
    def should_trade(
        self,
        features: Dict[str, Any],
        base_prob: float,
        meta_prob: float,
    ) -> bool:
        """
        هنا تضع منطق القيود بالكامل في ملف خاص بك.
        """
        ...


@dataclass
class AgentConfig:
    threshold_main: float
    threshold_meta: float
    # أي إعدادات أخرى…


class TradingAgent:
    def __init__(
        self,
        base_model: BasePredictor,
        meta_model: MetaPredictor,
        constraints: Constraints,
        config: AgentConfig,
    ) -> None:
        self.base_model = base_model
        self.meta_model = meta_model
        self.constraints = constraints
        self.config = config

    def step(
        self,
        features_array: np.ndarray,
        features_dict: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        ينفذ خطوة واحدة:
          - يحسب احتمالات الاتجاه من النموذج الأساسي.
          - يحسب meta_prob من meta-model.
          - يسأل constraints.should_trade إذا كان مسموح التنفيذ.
        لا ينفّذ أي أوامر حقيقية؛ فقط يرجع قراراً structured.
        """
        raise NotImplementedError
```

ثم في ملف مستقل تضع قيودك كما تريد:

```python
# src/live/constraints_impl.py
from typing import Any, Dict
from .agent import Constraints


class MyConstraints(Constraints):
    def __init__(self, params: Dict[str, Any]) -> None:
        self.params = params

    def should_trade(
        self,
        features: Dict[str, Any],
        base_prob: float,
        meta_prob: float,
    ) -> bool:
        """
        هنا فقط تكتب منطقك الخاص (spread, regimes, إلخ).
        لن أضع أي شرط؛ اتركه لـ Cursor أو لنفسك.
        """
        # TODO: implement your rules here
        return True
```


***

## 6) نقطة ربط واحدة تسهّل على Cursor إكمال التفاصيل

ملف orchestrator بسيط:

```python
# src/app/run_live_agent.py
from typing import Any, Dict
import numpy as np

from live.agent import TradingAgent, AgentConfig
from live.constraints_impl import MyConstraints
from models.ensemble import EnsembleModel
from meta_labeling.model import MetaModelWrapper


def build_agent(
    base_model: EnsembleModel,
    meta_model: MetaModelWrapper,
    constraints_params: Dict[str, Any],
    config_params: Dict[str, Any],
) -> TradingAgent:
    constraints = MyConstraints(constraints_params)
    config = AgentConfig(**config_params)
    agent = TradingAgent(
        base_model=base_model,
        meta_model=meta_model,
        constraints=constraints,
        config=config,
    )
    return agent


def run_loop(agent: TradingAgent, data_stream: Any) -> None:
    """
    data_stream: أي مولّد snapshots؛ أنت تحدد شكله.
    """
    for snapshot in data_stream:
        features_arr, features_dict = snapshot["X"], snapshot["features"]
        decision = agent.step(features_arr, features_dict)
        # TODO: ربط decision بمنفذ الأوامر الحقيقي
```


***

بهذا الشكل:

- كل الهياكل جاهزة لرميها في Cursor.
- لا يوجد داخلها **أي قيود أو قواعد**؛ كلها تُحقن عبر:
    - `meta_label_func`،
    - `Constraints.should_trade`،
    - `scorer` في `sweep_thresholds`,
    - وملفات config منفصلة.

لو أحببت، أستطيع في رسالة لاحقة أن أكتب لك فقط:

- أمثلة بسيطة لـ docstrings بالعربية/الإنجليزية لكل دالة،
حتى تساعد Cursor يفهم نيتك بشكل أدق وهو يكمّل المنطق الداخلي.
<span style="display:none">[^10][^11][^12][^13][^14][^15][^16][^17][^18][^19][^20][^3][^4][^5][^6][^7][^8][^9]</span>

<div align="center">⁂</div>

[^1]: https://github.com/hudson-and-thames/meta-labeling

[^2]: https://hudsonthames.org/meta-labeling-a-toy-example/

[^3]: https://aclanthology.org/2021.emnlp-main.255.pdf

[^4]: https://arxiv.org/pdf/2301.03462.pdf

[^5]: https://pmc.ncbi.nlm.nih.gov/articles/PMC11959184/

[^6]: https://pmc.ncbi.nlm.nih.gov/articles/PMC9525592/

[^7]: https://pmc.ncbi.nlm.nih.gov/articles/PMC9653497/

[^8]: https://medium.com/@liangnguyen612/meta-labeling-in-cryptocurrencies-market-95f761410fac

[^9]: https://github.com/hzjken/HFT-price-prediction

[^10]: https://github.com/hudson-and-thames/mlfinlab/blob/master/mlfinlab/labeling/labeling.py

[^11]: https://papers.ssrn.com/sol3/Delivery.cfm/5156285.pdf?abstractid=5156285

[^12]: https://github.com/cbyn/bitpredict

[^13]: https://hudsonthames.org/does-meta-labeling-add-to-signal-efficacy-triple-barrier-method/

[^14]: https://arxiv.org/html/2509.09751v1

[^15]: https://github.com/topics/bitcoin-price-prediction

[^16]: https://www.youtube.com/watch?v=ZCFmZFBtqsQ

[^17]: https://github.com/LNshuti/meta-labelling-architecture

[^18]: https://github.com/upathare1/Bitcoin-Price-Prediction

[^19]: https://www.reddit.com/r/algotrading/comments/1lnm48w/meta_labeling_for_algorithmic_trading_how_to/

[^20]: https://github.com/alimohammadiamirhossein/CryptoPredictions

---

## 📄 ايه.md

<!-- source: C:\Users\pc\zambahola-one-agent\apps\one-agent\knowledge\user-reports\ايه.md -->

<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# ايه

أوكي، هذه نفس الهياكل السابقة لكن مع Docstrings بالعربي + إنجليزي، بدون أي منطق داخلي وبدون أي قيود؛ الهدف أن تستخدمها كـ “prompt” واضح لـ Cursor وهو يكمّل التفاصيل.[^1]

***

### 1) BacktestEngine + TradeResult

```python
# src/backtest/core.py
from dataclasses import dataclass
from typing import Protocol, Any, Dict, List, Optional


@dataclass
class TradeResult:
    """
    EN:
        Container for the result of a single backtested trade.

    AR:
        حاوية تمثل نتيجة صفقة واحدة في الـ backtest، تتضمن أوقات الدخول والخروج
        والأسعار والـ PnL وأي بيانات إضافية (مثل الخصائص لحظة الدخول).
    """
    entry_time: Any
    exit_time: Any
    direction: int          # +1 / -1
    entry_price: float
    exit_price: float
    pnl: float
    meta: Dict[str, Any]


class ExecutionModel(Protocol):
    """
    EN:
        Protocol for execution logic (slippage, fees, etc.). Implementations
        can use order book snapshots, volatility, or any other context.

    AR:
        بروتوكول يمثل منطق التنفيذ (slippage, العمولات، إلخ). يمكن للتطبيقات
        استخدام الـ order book أو التقلب أو أي سياق آخر لحساب سعر التنفيذ الفعلي.
    """

    def simulate_fill(
        self,
        timestamp: Any,
        direction: int,
        price: float,
        size: float,
        context: Dict[str, Any],
    ) -> float:
        """
        EN:
            Return the effective fill price for an order given the raw mid/last
            price and any contextual information.

        AR:
            يعيد سعر التنفيذ الفعلي للأمر اعتماداً على السعر الخام (mid/last)
            وأي معلومات سياقية إضافية (مثل حالة الـ order book).
        """
        ...


class BacktestEngine:
    """
    EN:
        Generic backtesting engine. It does NOT enforce any trading rules,
        constraints, or position sizing. It only simulates PnL given
        entry/exit indices and an execution model.

    AR:
        محرك backtest عام. لا يفرض أي قواعد تداول أو قيود أو إدارة حجم.
        فقط يحاكي الـ PnL بناءً على نقاط الدخول والخروج ونموذج التنفيذ.
    """

    def __init__(
        self,
        price_series: Any,
        execution_model: ExecutionModel,
    ) -> None:
        """
        EN:
            Initialize the engine with a time‑ordered price series and an
            execution model.

        AR:
            تهيئة المحرك بسلسلة أسعار مرتبة زمنياً ونموذج تنفيذ (slippage/fees).
        """
        self.price_series = price_series
        self.execution_model = execution_model

    def simulate_trade(
        self,
        entry_index: int,
        direction: int,
        size: float,
        exit_index: int,
        extra_meta: Optional[Dict[str, Any]] = None,
    ) -> TradeResult:
        """
        EN:
            Simulate a single trade between entry_index and exit_index.
            All logic for when/how to enter or exit lives outside this method.

        AR:
            يحاكي صفقة واحدة بين entry_index و exit_index.
            منطق متى وكيف ندخل أو نخرج يبقى خارج هذه الدالة.
        """
        raise NotImplementedError

    def run_backtest(
        self,
        signal_indices: List[int],
        directions: List[int],
        sizes: List[float],
        exit_indices: List[int],
        metas: Optional[List[Dict[str, Any]]] = None,
    ) -> List[TradeResult]:
        """
        EN:
            Run a backtest for a list of pre‑computed entry/exit decisions.
            This engine assumes signals are already prepared.

        AR:
            ينفذ backtest لمجموعة من قرارات الدخول والخروج الجاهزة.
            يفترض أن الإشارات والـ exits تم تجهيزها مسبقاً خارج المحرك.
        """
        raise NotImplementedError
```


***

### 2) Meta‑Dataset Builder + MetaModelWrapper

```python
# src/meta_labeling/core.py
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple, Callable
import numpy as np
from backtest.core import TradeResult


@dataclass
class MetaSample:
    """
    EN:
        One training sample for the meta‑model. It captures:
        - features at entry time,
        - binary meta label (good/bad trade),
        - base model direction and confidence,
        - realized PnL.

    AR:
        عينة تدريب واحدة لـ meta‑model، تحتوي على:
        - الخصائص لحظة الدخول،
        - meta_label ثنائي (صفقة جيدة/سيئة)،
        - اتجاه النموذج الأساسي وثقته،
        - الـ PnL المحقق.
    """
    features: Dict[str, Any]
    meta_label: int
    base_direction: int
    base_confidence: float
    pnl: float
    raw: Dict[str, Any]


class MetaDatasetBuilder:
    """
    EN:
        Utility to transform raw TradeResult objects and base model outputs
        into a clean meta‑labeling dataset.

    AR:
        أداة لتحويل نتائج الـ backtest ومخرجات النموذج الأساسي إلى
        meta‑dataset جاهز للتدريب في إطار meta‑labeling.
    """

    def build_meta_samples(
        self,
        trades: List[TradeResult],
        base_features_at_entry: List[Dict[str, Any]],
        base_confidences: List[float],
        meta_label_func: Callable[[TradeResult, Dict[str, Any]], int],
    ) -> List[MetaSample]:
        """
        EN:
            Build a list of MetaSample from backtested trades.
            meta_label_func is a user‑defined function that maps
            (trade, features) -> {0,1}.

        AR:
            يبني قائمة من MetaSample انطلاقاً من صفقات backtest.
            meta_label_func دالة يحددها المستخدم تُحوّل (الصفقة، الخصائص)
            إلى 0 أو 1 حسب تعريفه للصفقة الجيدة.
        """
        raise NotImplementedError

    def to_numpy(
        self,
        samples: List[MetaSample],
        feature_keys: List[str],
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        EN:
            Convert a list of MetaSample into (X_meta, y_meta) numpy arrays
            using the specified feature_keys.

        AR:
            يحوّل قائمة MetaSample إلى مصفوفات (X_meta, y_meta) باستخدام
            أسماء الخصائص المحددة في feature_keys.
        """
        raise NotImplementedError
```

```python
# src/meta_labeling/model.py
from typing import Any
import numpy as np
from sklearn.base import BaseEstimator


class MetaModelWrapper:
    """
    EN:
        Thin wrapper around any sklearn‑compatible classifier
        used as the meta‑labeling model.

    AR:
        غلاف بسيط لأي مصنف متوافق مع sklearn يُستخدم كنموذج meta‑labeling.
    """

    def __init__(self, base_model: BaseEstimator) -> None:
        """
        EN:
            Store the underlying sklearn model instance.

        AR:
            تخزين نسخة من نموذج sklearn الأساسي المستخدم في meta‑labeling.
        """
        self.base_model = base_model

    def fit(self, X_meta: np.ndarray, y_meta: np.ndarray) -> None:
        """
        EN:
            Fit the meta‑model on the meta‑dataset.

        AR:
            تدريب نموذج meta‑labeling على بيانات (X_meta, y_meta).
        """
        raise NotImplementedError

    def predict_proba(self, X_meta: np.ndarray) -> np.ndarray:
        """
        EN:
            Return class probabilities for the meta label.
            Typically [:,1] is the probability of a "good" trade.

        AR:
            يعيد احتمالات التصنيف للـ meta_label.
            غالباً [:,1] تمثل احتمال أن تكون الصفقة جيدة.
        """
        raise NotImplementedError
```


***

### 3) EnsembleModel

```python
# src/models/ensemble.py
from typing import Dict, Protocol
import numpy as np


class ProbabilisticModel(Protocol):
    """
    EN:
        Minimal protocol for models that expose predict_proba.

    AR:
        بروتوكول بسيط لنماذج توفر دالة predict_proba.
    """

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """
        EN:
            Return class probabilities for each row in X.

        AR:
            يعيد احتمالات الفئات لكل صف في X.
        """
        ...


class EnsembleModel:
    """
    EN:
        Generic ensemble that linearly combines the probabilities
        of multiple base models using user‑provided weights.

    AR:
        Ensemble عام يمزج احتمالات عدة نماذج أساسية بخطية
        باستخدام أوزان يحددها المستخدم.
    """

    def __init__(
        self,
        models: Dict[str, ProbabilisticModel],
        weights: Dict[str, float],
    ) -> None:
        """
        EN:
            models: mapping from model name to model instance.
            weights: mapping from model name to its ensemble weight.

        AR:
            models: خريطة من اسم النموذج إلى الكائن نفسه.
            weights: خريطة من اسم النموذج إلى الوزن داخل الـ ensemble.
        """
        self.models = models
        self.weights = weights

    def predict_proba(
        self,
        X_per_model: Dict[str, np.ndarray],
    ) -> np.ndarray:
        """
        EN:
            Compute the weighted average of probabilities produced by
            each base model. Assumes that X_per_model provides the
            correct feature matrix for each model.

        AR:
            يحسب المتوسط الموزون لاحتمالات كل نموذج أساسي.
            يفترض أن X_per_model يحتوي على مصفوفة الخصائص الصحيحة لكل نموذج.
        """
        raise NotImplementedError
```


***

### 4) Calibration + Threshold Sweep

```python
# src/evaluation/calibration.py
from typing import Tuple, Dict, Callable
import numpy as np
from sklearn.base import BaseEstimator


def calibrate_classifier(
    base_model: BaseEstimator,
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    method: str = "isotonic",
) -> BaseEstimator:
    """
    EN:
        Calibrate an existing classifier using a validation set.
        The implementation may use Platt scaling or isotonic regression.

    AR:
        يقوم بمعايرة مصنف موجود باستخدام بيانات validation.
        يمكن أن تعتمد الترجمة على Platt scaling أو isotonic regression
        حسب اختيارك في التطبيق.
    """
    raise NotImplementedError


def sweep_thresholds(
    proba_main: np.ndarray,
    proba_meta: np.ndarray,
    pnl: np.ndarray,
    candidate_main: np.ndarray,
    candidate_meta: np.ndarray,
    scorer: Callable[[np.ndarray, np.ndarray, np.ndarray], float],
) -> Dict[str, float]:
    """
    EN:
        Grid search over main/meta probability thresholds.
        scorer(proba_main_masked, proba_meta_masked, pnl_masked) should return
        a scalar quality score (e.g. Sharpe, win rate).

    AR:
        يجري بحثاً شبكياً على عتبات احتمالات النموذج الأساسي و meta‑model.
        دالة scorer (التي تكتبها أنت) تعيد درجة جودة (مثل Sharpe أو win_rate)
        للصفقات التي تتجاوز العتبات.
    """
    raise NotImplementedError
```


***

### 5) TradingAgent + Constraints واجهة فقط

```python
# src/live/agent.py
from dataclasses import dataclass
from typing import Any, Dict, Protocol
import numpy as np


class BasePredictor(Protocol):
    """
    EN:
        Protocol for the primary direction‑prediction model.

    AR:
        بروتوكول يمثل نموذج التنبؤ باتجاه السعر الأساسي.
    """

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """
        EN:
            Return class probabilities for the next price direction.

        AR:
            يعيد احتمالات اتجاه السعر القادم (مثلاً up/down/flat).
        """
        ...


class MetaPredictor(Protocol):
    """
    EN:
        Protocol for the meta‑labeling model that evaluates trade quality.

    AR:
        بروتوكول لنموذج meta‑labeling الذي يقيم جودة الصفقة.
    """

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """
        EN:
            Return probabilities for the meta label (good vs bad trade).

        AR:
            يعيد احتمالات meta_label (صفقة جيدة مقابل سيئة).
        """
        ...


class Constraints(Protocol):
    """
    EN:
        User‑defined trading constraints. All custom rules
        (regimes, spreads, volatility filters, etc.) live here.

    AR:
        قيود التداول المعرفة من قبلك. كل القواعد المخصصة
        (الأنظمة، السبريد، فلاتر التقلب، إلخ) توضع هنا.
    """

    def should_trade(
        self,
        features: Dict[str, Any],
        base_prob: float,
        meta_prob: float,
    ) -> bool:
        """
        EN:
            Decide whether the agent is allowed to open a trade
            under the current context.

        AR:
            يقرر ما إذا كان الوكيل مسموحاً له بفتح صفقة في
            السياق الحالي أم لا.
        """
        ...


@dataclass
class AgentConfig:
    """
    EN:
        Static configuration for the trading agent. Thresholds and other
        knobs can be loaded from an external config file.

    AR:
        إعدادات ثابتة للوكيل، مثل العتبات وغيرها، يمكن تحميلها
        من ملف إعدادات خارجي (JSON/YAML).
    """
    threshold_main: float
    threshold_meta: float


class TradingAgent:
    """
    EN:
        Online trading agent that combines:
        - a base predictor for direction,
        - a meta predictor for trade quality,
        - user‑defined constraints for when to trade.

    AR:
        وكيل تداول حي يجمع بين:
        - نموذج أساسي لتنبؤ الاتجاه،
        - نموذج meta لتقييم جودة الصفقة،
        - قيود مخصصة تحدد متى يتم الدخول فعلياً.
    """

    def __init__(
        self,
        base_model: BasePredictor,
        meta_model: MetaPredictor,
        constraints: Constraints,
        config: AgentConfig,
    ) -> None:
        """
        EN:
            Store references to all components required for live decisions.

        AR:
            يخزن المكونات اللازمة لاتخاذ قرارات التداول الحية.
        """
        self.base_model = base_model
        self.meta_model = meta_model
        self.constraints = constraints
        self.config = config

    def step(
        self,
        features_array: np.ndarray,
        features_dict: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        EN:
            Perform a single decision step:
            1) get base_prob from the base model,
            2) get meta_prob from the meta model,
            3) ask Constraints if trading is allowed.
            Returns a structured decision dict (e.g. {action, direction, size}).

        AR:
            ينفذ خطوة قرار واحدة:
            1) يحسب base_prob من النموذج الأساسي،
            2) يحسب meta_prob من meta‑model،
            3) يسأل القيود إذا كان مسموح الدخول.
            يعيد قراراً منظماً (مثلاً {action, direction, size}).
        """
        raise NotImplementedError
```

```python
# src/live/constraints_impl.py
from typing import Any, Dict
from .agent import Constraints


class MyConstraints(Constraints):
    """
    EN:
        Concrete implementation of Constraints where you define
        all your domain‑specific rules in a separate file.

    AR:
        تطبيق فعلي لواجهة Constraints حيث تضع كل قواعدك
        الخاصة بمجال التداول في هذا الملف المنفصل.
    """

    def __init__(self, params: Dict[str, Any]) -> None:
        """
        EN:
            Store any user‑defined parameters required by the rules.

        AR:
            تخزين أي بارامترات يحددها المستخدم وتحتاجها القواعد.
        """
        self.params = params

    def should_trade(
        self,
        features: Dict[str, Any],
        base_prob: float,
        meta_prob: float,
    ) -> bool:
        """
        EN:
            Return True if the current context passes all user‑defined
            constraints, False otherwise.

        AR:
            يعيد True إذا كان السياق الحالي ينجح في جميع القيود
            المعرفة من قبلك، و False إذا لم يتحقق أي شرط.
        """
        # TODO: implement your custom constraints here
        return True
```

بهذا عندك الآن:

- هياكل + Docstrings واضحة،
- بدون منطق أو قيود،
- جاهزة ترميها في Cursor وتخليه يملأ الـ `NotImplementedError` / الـ TODO حسب أسلوبك وقواعدك الخاصة.
<span style="display:none">[^10][^11][^12][^13][^14][^15][^16][^2][^3][^4][^5][^6][^7][^8][^9]</span>

<div align="center">⁂</div>

[^1]: https://www.youtube.com/watch?v=ZCFmZFBtqsQ\&list=PLfv9eTYgatm3vZdwgqUsvARTdZtdO3Z9J\&index=5

[^2]: http://ijaahnet.com/vol-7-no-2-december-2019-abstract-1-ijaah

[^3]: https://www.semanticscholar.org/paper/81973bc44573908b77b5960f4bc6a490cb07e63d

[^4]: https://www.mdpi.com/1911-8074/15/2/54/pdf?version=1643351044

[^5]: https://aclanthology.org/2021.emnlp-main.255.pdf

[^6]: https://arxiv.org/html/2503.09988v1

[^7]: https://downloads.hindawi.com/journals/ijis/2024/6176898.pdf

[^8]: https://hudsonthames.org/tag/machine-learning/page/2/

[^9]: https://hudsonthames.org/tag/research/

[^10]: https://www.scribd.com/document/714837777/mlfinlab-Release-Hudson-Thames

[^11]: https://www.linkedin.com/posts/hudson-thames-quantiative-research_ensemble-meta-labeling-activity-7018224479893913600-pxaH

[^12]: https://github.com/orgs/hudson-and-thames/repositories

[^13]: https://www.youtube.com/watch?v=BIBSv_gwBgs

[^14]: https://www.youtube.com/watch?v=WbgglcXfEzA

[^15]: https://www.youtube.com/watch?v=tpLCMVyMOaM

[^16]: https://www.quantconnect.com/forum/discussion/14706/why-meta-labeling-is-not-a-silver-bullet/

---

## 📄 تنبوء-2.md

<!-- source: C:\Users\pc\zambahola-one-agent\apps\one-agent\knowledge\user-reports\تنبوء-2.md -->

<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# ايه

حلو، نكمل بالجزء العملي اللي تقدر ترميه مباشرة في Cursor وتبني عليه لرفع الدقة بشكل منهجي.[^1][^2]

***

## 1) مجلد تجارب “رفع الدقة” داخل المشروع

أضف مجلد مخصص للتجارب:

```txt
experiments/
  01_label_threshold_sweep.py
  02_feature_ablation.py
  03_models_vs_horizons.py
  04_ensembles_and_meta.py
  05_calibration_and_thresholds.py
```


### 01_label_threshold_sweep.py

هدفه: تعرف أي threshold للحركة (basis points) يعطي أحسن دقة/ربحية على 30–60 ثانية.[^2][^3]

الفكرة:

```python
thresholds = [1.0, 1.5, 2.0, 3.0]  # basis points
horizons = [30, 60]

for H in horizons:
    for th in thresholds:
        df_labeled = make_direction_label(df, horizon_secs=H, threshold_bp=th)
        X, y = build_features_and_labels(df_labeled)
        acc, f1 = time_series_cv(XGBoostClassifier, X, y)
        print(H, th, acc, f1)
```

- من هذا السكربت تطلع بجدول واضح: أي combination (أفق، threshold) يعطي أعلى دقة اتجاهية بدون overfitting.

***

## 2) تجارب Features لمعرفة ما يرفع الدقة فعلياً

### 02_feature_ablation.py

هدفه: تقيس وزن كل “حزمة” features (order‑book, volatility, technicals) على الدقة.[^4][^5][^6]

أمثلة مجموعات:

```python
feature_sets = {
  "price_only": ["ret_1s", "ret_5s"],
  "price_vol": ["ret_1s", "ret_5s", "vol_30s"],
  "orderbook_only": ["spread_bp", "ob_imbalance", "depth_1_3_5"],
  "full": ALL_FEATURES
}
```

لكل set:

- درّب XGBoost مع TimeSeriesCV، سجّل:
    - accuracy, F1, ROC‑AUC، وأهم شيء feature importances.
- هكذا تعرف أي نوع features يعطي أكبر قفزة في الدقة على أفقك.

***

## 3) مقارنة نماذج مختلفة vs الأفق الزمني

### 03_models_vs_horizons.py

هدفه: مقارنة Logistic, XGBoost, LSTM/CNN على آفاق 30s و60s.[^7][^8][^9][^10][^4]

هيكل:

```python
models = {
  "logit": make_logit_model,
  "xgb": make_xgb_model,
  "lstm": make_lstm_model,
}

horizons = [30, 60]

for H in horizons:
    df_labeled = make_direction_label(df, horizon_secs=H, threshold_bp=best_th_for_H)
    X_seq, y_seq = build_sequence_features(df_labeled)  # للـ LSTM/CNN
    X_tab, y_tab = build_tabular_features(df_labeled)   # لـ logit/xgb

    for name, model_fn in models.items():
        if name in ["logit", "xgb"]:
            acc, f1 = time_series_cv(model_fn, X_tab, y_tab)
        else:
            acc, f1 = time_series_cv_seq(model_fn, X_seq, y_seq)
        print(H, name, acc, f1)
```

- الهدف: تثبت لنفسك بس بالأرقام أي نموذج “قاعد يضيف” فعلياً على أفقك.

***

## 4) Ensemble + Meta‑Labeling في سكربت واحد

### 04_ensembles_and_meta.py

هنا نربط ثلاث أشياء:
(1) Ensemble من نماذج،
(2) Backtest بسيط،
(3) Meta‑labeling حسب منهجية López de Prado / Hudson \& Thames.[^8][^11][^12][^13][^1]

#### 4.1 Ensemble تنبؤ الاتجاه

مثال:

```python
base_models = {
  "xgb": train_xgb(X_tab, y),
  "lstm": train_lstm(X_seq, y),
  "logit": train_logit(X_tab, y),
}

def ensemble_predict_proba(features_tab, features_seq):
    p_xgb = base_models["xgb"].predict_proba(features_tab)
    p_logit = base_models["logit"].predict_proba(features_tab)
    p_lstm = base_models["lstm"].predict_proba(features_seq)

    # أوزان حسب أداء كل نموذج في CV
    w_xgb, w_logit, w_lstm = 0.5, 0.2, 0.3
    p_ens = w_xgb * p_xgb + w_logit * p_logit + w_lstm * p_lstm
    return p_ens
```


#### 4.2 Backtest لتكوين Meta‑Dataset

```python
signals = []
for t in range(start_idx, end_idx):
    features_tab_t, features_seq_t = get_features_at_t(t)
    p_ens = ensemble_predict_proba(features_tab_t, features_seq_t)
    direction = 1 if p_ens[^1] > p_ens[^0] else -1
    prob_long = max(p_ens)

    trade = simulate_trade_from_t(t, direction)  # backtest بسيط مع fees/slippage
    signals.append({
        "t": t,
        "direction": direction,
        "prob_main": prob_long,
        "pnl": trade.pnl,
        "spread_bp": features_tab_t["spread_bp"],
        "vol_30s": features_tab_t["vol_30s"],
        "ob_imbalance": features_tab_t["ob_imbalance"],
        # أضف أي خصائص مهمة
    })
```


#### 4.3 بناء وتدريب Meta‑Model

```python
import pandas as pd

signals_df = pd.DataFrame(signals)
signals_df["meta_y"] = (signals_df["pnl"] > 0).astype(int)

X_meta = signals_df[["prob_main", "spread_bp", "vol_30s", "ob_imbalance"]].values
y_meta = signals_df["meta_y"].values

meta_model = train_xgb_meta(X_meta, y_meta)
```

في الإنتاج:

- تستخدم ensemble لإخراج الاتجاه + prob_main.
- تسحب features المطلوبة وتغذي meta_model:
    - إذا meta_prob < threshold_meta → امتنع.
    - إذا meta_prob ≥ threshold_meta → نفّذ الصفقة.

***

## 5) سكربت Calibration + اختيار عتبات دكية

### 05_calibration_and_thresholds.py

هدفه:
(1) معايرة probabilities،
(2) إيجاد العتبة التي تعطي أعلى win‑rate أو أعلى Sharpe في subset الصفقات المنفذة.[^6][^8]

خطوط عامة:

```python
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import brier_score_loss

# 1) calibration لنموذجك الأساسي أو الـ ensemble
cal_model = CalibratedClassifierCV(base_models["xgb"], cv=TimeSeriesSplit(n_splits=3), method="isotonic")
cal_model.fit(X_tab_train, y_train)
cal_proba = cal_model.predict_proba(X_tab_val)

print("Brier:", brier_score_loss(y_val, cal_proba[:, 1]))

# 2) sweep thresholds
thresholds_main = [0.5, 0.55, 0.6, 0.65, 0.7]
thresholds_meta = [0.5, 0.55, 0.6, 0.65, 0.7]

best_config = None
best_score = -1

for th_m in thresholds_main:
    for th_meta in thresholds_meta:
        trades = run_backtest_with_thresholds(th_m, th_meta)  # تستخدم ensemble + meta_model
        win_rate = trades.win_rate
        sharpe = trades.sharpe
        score = sharpe  # أو مزيج من win_rate و sharpe
        if score > best_score:
            best_score = score
            best_config = (th_m, th_meta)
```

النتيجة:

- تخرج بـ pair أفضل (threshold_main, threshold_meta) بناءً على أرقام حقيقية وليس إحساس.

***

## 6) ربط كل شيء في الـ Live Agent (من منظور “رفع الدقة”)

في `live/agent_loop.py`:

- الخطوات في كل tick:

```python
features_tab, features_seq, features_dict = build_live_features(snapshot)

# 1) قواعد الامتناع السريعة (spread, vol, imbalance)
if should_abstain_basic(features_dict):
    return

# 2) ensemble prediction
p_ens = ensemble_predict_proba(features_tab, features_seq)
direction = 1 if p_ens[^1] > p_ens[^0] else -1
prob_main = max(p_ens)

if prob_main < best_threshold_main:
    return  # confidence من النموذج الأساسي ضعيف

# 3) meta-model decision
meta_x = build_meta_features(features_dict, prob_main)
meta_prob = meta_model.predict_proba(meta_x)[0, 1]

if meta_prob < best_threshold_meta:
    return  # meta-labeling يقول احتمال الربح ضعيف

# 4) مرّ بالـ RiskManager ثم نفّذ الصفقة
if risk_manager.allow_new_trade():
    execute_trade(direction)
```

بهذا التصميم:

- “دقة التنبؤ” اللي تهمك هي win‑rate للصفقات التي تمر عبر:
    - قواعد abstention اليدوية،
    - عتبة prob_main،
    - طبقة meta‑labeling.

عملياً هذه هي الطريقة التي تستخدمها الأبحاث الحديثة والمكتبات المتخصصة (مثل GitHub `meta-labeling` من Hudson \& Thames) لرفع جودة الإشارات بدلاً من مطاردة accuracy خام أعلى على كامل الداتا.[^14][^11][^1]

***

إذا حاب، أقدر في الرسالة الجاية:

- أكتب لك signatures جاهزة للدوال (type hints + docstrings) لكل جزء (backtest, meta‑labeling, calibration) بحيث تستخدمها كـ prompts لـ Cursor وتخليه يكمل التفاصيل الداخلية للكود بالأسلوب اللي يناسبك.
<span style="display:none">[^15][^16][^17][^18][^19][^20]</span>

<div align="center">⁂</div>

[^1]: https://github.com/hudson-and-thames/meta-labeling

[^2]: https://www.diva-portal.org/smash/get/diva2:2002936/FULLTEXT01.pdf

[^3]: https://www.sciencedirect.com/science/article/pii/S1544612325015223

[^4]: https://aemps.ewapub.com/article/view/25205

[^5]: https://github.com/cbyn/bitpredict

[^6]: https://pmc.ncbi.nlm.nih.gov/articles/PMC12571449/

[^7]: https://www.mdpi.com/1999-4893/13/5/121/pdf

[^8]: https://www.mdpi.com/2571-9394/5/1/10/pdf?version=1674981847

[^9]: https://jdmdc.com/index.php/JDMDC/article/view/43

[^10]: https://ieeexplore.ieee.org/document/11254075/

[^11]: https://medium.com/@liangnguyen612/meta-labeling-in-cryptocurrencies-market-95f761410fac

[^12]: https://norma.ncirl.ie/8550/1/samarasimhareddydevireddy.pdf

[^13]: https://fenix.tecnico.ulisboa.pt/downloadFile/1126295043839545/89516-Pedro-Fernandes-dissertacao.pdf

[^14]: https://www.reddit.com/r/algotrading/comments/1lnm48w/meta_labeling_for_algorithmic_trading_how_to/

[^15]: https://www.mdpi.com/2227-7390/10/8/1307/pdf?version=1649931079

[^16]: https://arxiv.org/html/2501.11906v1

[^17]: https://dergipark.org.tr/en/download/article-file/4733730

[^18]: https://revistas.usal.es/cinco/index.php/2255-2863/article/download/31490/30390?inline=1

[^19]: https://www.sciencedirect.com/science/article/pii/S1057521923005719

[^20]: https://fenix.tecnico.ulisboa.pt/downloadFile/1970719973968665/89516-Pedro-Fernandes-resumo.pdf

---

## 🤖 معاينة ما سيستورده الوكيل (لا تطبّق تلقائياً)

```json
{
  "version": "1",
  "entries": []
}
```

## الخطوة التالية (بعد موافقة AI)

```powershell
npm run agent:import-md-reports
npm run agent:omni-train
```