import { ModuleSpec } from '../types';

export const NOTEBOOK_04_CODE = `from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

BASE_DIR = Path("..").resolve()
DATA_PATH = BASE_DIR / "data" / "processed" / "stock_metrics.csv"
MODEL_OUT = BASE_DIR / "models" / "stock_scorer.pkl"
MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)

df = pd.read_csv(DATA_PATH)
FEATURE_COLS = ["Giá", "P/E", "P/B", "ROE", "KLTB 20N", "GTGD", "% 1D", "% YTD"]

# 1. Feature Engineering & Gán nhãn mục tiêu 3 trạng thái: 0=Rủi ro, 1=Trung tính, 2=Khả quan
df["liquidity_ratio"] = df["GTGD"] / (df["KLTB 20N"].replace(0, np.nan) + 1e-6)
FEATURE_COLS_FULL = FEATURE_COLS + ["liquidity_ratio"]

def assign_rating_label(row) -> int:
    roe = row.get("ROE", np.nan)
    pe = row.get("P/E", np.nan)
    pb = row.get("P/B", np.nan)
    chg_1d = row.get("% 1D", 0.0)
    if pd.notna(roe) and roe >= 18 and pd.notna(pe) and 0 < pe <= 16 and pd.notna(pb) and pb <= 3.0:
        return 2  # Khả quan
    if (pd.notna(pe) and (pe < 0 or pe > 35)) or (pd.notna(roe) and roe < 6) or (pd.notna(chg_1d) and chg_1d < -3.5):
        return 0  # Rủi ro / Tiêu cực
    return 1      # Trung tính / Theo dõi

df["label"] = df.apply(assign_rating_label, axis=1)
X = df[FEATURE_COLS_FULL]
y = df["label"]

# 2. Chia Train/Test phân tầng TRƯỚC khi Impute/Scale để chống Data Leakage
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, stratify=y, random_state=42
)

# 3. ColumnTransformer + Pipeline chuẩn chống rò rỉ
numeric_transformer = Pipeline(steps=[
    ("imputer", SimpleImputer(strategy="median")),
    ("scaler", StandardScaler()),
])

preprocessor = ColumnTransformer(
    transformers=[("num", numeric_transformer, FEATURE_COLS_FULL)]
)

lgbm_pipe = Pipeline(steps=[
    ("preprocessor", preprocessor),
    ("clf", LGBMClassifier(
        n_estimators=200,
        learning_rate=0.05,
        class_weight="balanced",
        random_state=42,
        verbose=-1,
    )),
])

rf_pipe = Pipeline(steps=[
    ("preprocessor", preprocessor),
    ("clf", RandomForestClassifier(
        n_estimators=200,
        class_weight="balanced",
        random_state=42,
    )),
])

# 4. Đánh giá chéo StratifiedKFold (5-Fold)
cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
print("LGBM CV F1-macro:", cross_val_score(lgbm_pipe, X_train, y_train, cv=cv, scoring="f1_macro").mean())
print("RF   CV F1-macro:", cross_val_score(rf_pipe, X_train, y_train, cv=cv, scoring="f1_macro").mean())

# 5. Huấn luyện chính thức & Đánh giá trên Holdout Test
lgbm_pipe.fit(X_train, y_train)
y_pred = lgbm_pipe.predict(X_test)
print("\\nClassification Report:\\n", classification_report(y_test, y_pred, digits=4))
print("Confusion Matrix:\\n", confusion_matrix(y_test, y_pred))

# Xem mức độ quan trọng của từng đặc trưng
importances = lgbm_pipe.named_steps["clf"].feature_importances_
for name, imp in sorted(zip(FEATURE_COLS_FULL, importances), key=lambda x: x[1], reverse=True):
    print(f"Feature {name:<16}: {imp}")

# 6. Đóng gói toàn bộ Pipeline (Imputer + Scaler + LightGBM) ra .pkl
joblib.dump(lgbm_pipe, MODEL_OUT)
print(f"Saved pipeline -> {MODEL_OUT}")`;

export const ML_SCORER_PY_COMPLETE = `from pathlib import Path
import joblib
import numpy as np
import pandas as pd

LABEL_MAP = {
    0: "Rủi ro / Tiêu cực",
    1: "Trung tính / Theo dõi",
    2: "Khả quan",
}

FEATURE_COLS = ["Giá", "P/E", "P/B", "ROE", "KLTB 20N", "GTGD", "% 1D", "% YTD"]


class StockScorer:
    """Nạp models/stock_scorer.pkl để chấm điểm & giải thích đặc trưng cổ phiếu (<10ms)."""

    def __init__(self, model_path: str = "models/stock_scorer.pkl"):
        path = Path(model_path)
        if not path.exists():
            raise FileNotFoundError(f"Model artifact not found: {path}")
        self.pipeline = joblib.load(path)
        self.feature_names = FEATURE_COLS + ["liquidity_ratio"]

    def _prepare_features(self, df: pd.DataFrame) -> pd.DataFrame:
        work = df.copy()
        for col in FEATURE_COLS:
            if col not in work.columns:
                work[col] = np.nan
        work["liquidity_ratio"] = work["GTGD"] / (work["KLTB 20N"].replace(0, np.nan) + 1e-6)
        return work[self.feature_names]

    def _explain_row(self, row: pd.Series, pred_label: int) -> str:
        reasons = []
        roe = row.get("ROE", np.nan)
        pe = row.get("P/E", np.nan)
        pb = row.get("P/B", np.nan)

        if pd.notna(roe):
            reasons.append(f"ROE={roe:.1f}%")
        if pd.notna(pe):
            reasons.append(f"P/E={pe:.1f}")
        if pd.notna(pb):
            reasons.append(f"P/B={pb:.2f}")

        prefix = "Điểm mạnh" if pred_label == 2 else ("Cần chú ý" if pred_label == 0 else "Ổn định")
        return f"{prefix}: " + ", ".join(reasons) if reasons else "Thiếu dữ liệu chỉ số cơ bản"

    def score(self, df: pd.DataFrame) -> pd.DataFrame:
        if df.empty:
            return df.copy()

        X = self._prepare_features(df)
        preds = self.pipeline.predict(X)
        probs = self.pipeline.predict_proba(X)

        scored = df.copy()
        scored["Label_ID"] = preds
        scored["Đánh giá"] = [LABEL_MAP[int(p)] for p in preds]
        scored["Độ tin cậy (%)"] = (probs.max(axis=1) * 100).round(1)
        scored["Lý do chính"] = [
            self._explain_row(scored.iloc[i], int(preds[i])) for i in range(len(scored))
        ]
        return scored`;

export const module4: ModuleSpec = {
  id: 'mod-4',
  number: 4,
  title: {
    vi: 'Học phần 4: Học máy Truyền thống trên Dữ liệu Bảng (Tabular ML)',
    en: 'Module 4: Core Tabular Machine Learning (LightGBM)',
  },
  summary: {
    vi: 'Khám phá dữ liệu stock_metrics.csv, xây Pipeline chống Data Leakage (SimpleImputer + StandardScaler), huấn luyện LightGBM và đóng gói module chấm điểm <10ms.',
    en: 'Explore stock_metrics.csv, construct an anti-leakage ColumnTransformer pipeline, train & validate LightGBM, and deploy a <10ms scorer module.',
  },
  stack: ['pandas', 'numpy', 'scikit-learn', 'lightgbm', 'joblib'],
  steps: [
    {
      id: '4.1',
      moduleId: 'mod-4',
      tier: 1,
      title: {
        vi: 'Bước 4.1: Khám phá Dữ liệu (EDA), Feature Engineering & Gán nhãn 3 nhóm',
        en: 'Step 4.1: EDA, Feature Engineering & 3-Class Target Labeling',
      },
      subtitle: {
        vi: 'Tạo đặc trưng `liquidity_ratio` và ánh xạ cổ phiếu thành 3 trạng thái: `0: Rủi ro`, `1: Trung tính`, `2: Khả quan`.',
        en: 'Engineer `liquidity_ratio` and map stock fundamentals into 3 target classes: `0: Risk`, `1: Neutral`, `2: Positive`.',
      },
      targetFile: 'notebooks/04_train_ml_scorer.ipynb',
      whyAndWhat: {
        why: {
          vi: 'File `stock_metrics.csv` chứa các chỉ số thô (`P/E`, `P/B`, `ROE`, `KLTB 20N`, `GTGD`, `% 1D`, `% YTD`) kèm khoảng 8–12% ô trống `NaN` (do `#N/A`). Trước khi đưa vào mô hình, ta cần khám phá phân phối giá trị ngoại lai (ví dụ P/E âm khi công ty lỗ), tạo thêm đặc trưng mới `liquidity_ratio = GTGD / KLTB 20N`, và thiết kế bộ quy tắc gán nhãn 3 lớp rõ ràng để mô hình LightGBM học đường ranh giới phân loại.',
          en: '`stock_metrics.csv` holds raw financial metrics (`P/E`, `P/B`, `ROE`, `KLTB 20N`, `GTGD`) with ~8–12% `NaN` entries (from `#N/A`). Before modeling, we inspect outliers (like negative P/E), engineer `liquidity_ratio = GTGD / KLTB 20N`, and establish consistent 3-class labels (`0/1/2`) for supervised training.',
        },
        ifMissing: {
          vi: 'Không kiểm tra EDA sẽ bỏ sót các giá trị `KLTB 20N = 0` gây lỗi chia cho 0 (`inf`), hoặc không phát hiện mất cân bằng lớp (class imbalance) khiến mô hình chỉ toàn đoán lớp "Trung tính".',
          en: 'Skipping EDA misses zero-volume division (`inf` values) or severe class imbalance where the classifier predicts only "Neutral".',
        },
      },
      apiAnatomy: [
        {
          symbol: 'df.isna().sum() & df.describe()',
          params: 'No args',
          inputType: 'pd.DataFrame',
          outputType: 'pd.Series / DataFrame',
          description: {
            vi: 'Đếm số ô khuyết `NaN` (như P/E của mã DCL) và kiểm tra min/max/median từng cột.',
            en: 'Counts missing `NaN` cells per column and inspects quartiles/outliers.',
          },
        },
        {
          symbol: 'liquidity_ratio',
          params: 'GTGD / (KLTB_20N + 1e-6)',
          inputType: 'pd.Series',
          outputType: 'pd.Series',
          description: {
            vi: 'Đặc trưng phái sinh phản ánh quy mô dòng tiền trên mỗi cổ phiếu khớp lệnh; cộng `1e-6` tránh lỗi ZeroDivision.',
            en: 'Derived feature capturing turnover intensity; `+ 1e-6` guards against division by zero.',
          },
        },
        {
          symbol: 'df["label"].value_counts(normalize=True)',
          params: 'normalize=True',
          inputType: 'pd.Series',
          outputType: 'pd.Series',
          description: {
            vi: 'Kiểm tra tỉ lệ % phân bố của 3 lớp `0, 1, 2` để quyết định bật `class_weight="balanced"`.',
            en: 'Inspects class proportions across `0, 1, 2` to justify `class_weight="balanced"`.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Đọc CSV & Kiểm tra khuyết dữ liệu', en: 'Stage 1: Load CSV & Inspect Missingness' },
          summary: {
            vi: 'Nắm nhanh chất lượng 2,140 dòng dữ liệu vừa bóc tách ở Học phần 3.',
            en: 'Audit missing values across the ~2,140 rows extracted in Module 3.',
          },
          code: `import pandas as pd

df = pd.read_csv("../data/processed/stock_metrics.csv")
print("Shape:", df.shape)
print(df.isna().sum())`,
          expectedNote: {
            vi: 'Bạn sẽ thấy cột `P/E` thường khuyết vài chục dòng (do các mã lỗ hoặc `#N/A` như `DCL`).',
            en: 'Typically `P/E` has a few dozen missing rows from negative-earnings firms or `#N/A` entries like `DCL`.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Tạo Feature mới & Quy tắc gán nhãn 3 lớp', en: 'Stage 2: Feature Engineering & 3-Class Labeling' },
          summary: {
            vi: 'Chú ý dùng `.replace(0, np.nan)` trước khi chia để tránh giá trị vô cực `inf`.',
            en: 'Replace `0` with `np.nan` before dividing so Scikit-Learn scalers never choke on `inf`.',
          },
          code: `df["liquidity_ratio"] = df["GTGD"] / (df["KLTB 20N"].replace(0, np.nan) + 1e-6)

def assign_rating_label(row) -> int:
    roe, pe, pb = row.get("ROE", np.nan), row.get("P/E", np.nan), row.get("P/B", np.nan)
    chg_1d = row.get("% 1D", 0.0)
    if pd.notna(roe) and roe >= 18 and pd.notna(pe) and 0 < pe <= 16 and pd.notna(pb) and pb <= 3.0:
        return 2  # Khả quan
    if (pd.notna(pe) and (pe < 0 or pe > 35)) or (pd.notna(roe) and roe < 6) or (pd.notna(chg_1d) and chg_1d < -3.5):
        return 0  # Rủi ro / Tiêu cực
    return 1      # Trung tính / Theo dõi`,
          expectedNote: {
            vi: 'Sử dụng `pd.notna(...)` trước khi so sánh giúp tránh bug khi ô là `NaN` (`NaN >= 18` luôn trả False).',
            en: 'Explicit `pd.notna(...)` checks keep labeling logic clear even when metrics are missing.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Chuẩn bị ma trận đặc trưng X và vector nhãn y', en: 'Stage 3: Build Feature Matrix X and Target y' },
          summary: {
            vi: 'Chốt đúng thứ tự `FEATURE_COLS_FULL` để đồng bộ với file `src/ml_scorer.py` khi suy luận.',
            en: 'Lock exact column ordering in `FEATURE_COLS_FULL` to stay aligned with `src/ml_scorer.py`.',
          },
          code: `FEATURE_COLS = ["Giá", "P/E", "P/B", "ROE", "KLTB 20N", "GTGD", "% 1D", "% YTD"]
FEATURE_COLS_FULL = FEATURE_COLS + ["liquidity_ratio"]

df["label"] = df.apply(assign_rating_label, axis=1)
X = df[FEATURE_COLS_FULL]
y = df["label"]
print(y.value_counts())`,
          expectedNote: {
            vi: 'Ở Bước 4.2, ta sẽ tách `X, y` thành Train/Test trước khi chạy bất kỳ phép điền khuyết hay chuẩn hóa nào.',
            en: 'In Step 4.2, we split `X, y` into Train/Test before any imputation or scaling.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 1/4: EDA & Feature Engineering trong 04_train_ml_scorer.ipynb',
        en: 'Piece 1/4: EDA & Feature Engineering in 04_train_ml_scorer.ipynb',
      },
      builderExplanation: {
        vi: 'Đọc `stock_metrics.csv`, tạo đặc trưng `liquidity_ratio` và gán nhãn 3 lớp `0, 1, 2` làm đầu vào cho Pipeline ML.',
        en: 'Loads `stock_metrics.csv`, engineers `liquidity_ratio`, and computes the 3-class target column `label`.',
      },
      builderCode: NOTEBOOK_04_CODE.split('# 2. Chia Train/Test')[0],
      highlightLines: [21, 39],
      lineWalkthrough: [
        {
          lines: 'L22-L23',
          snippet: 'df["liquidity_ratio"] = df["GTGD"] / (df["KLTB 20N"].replace(0, np.nan) + 1e-6)',
          explanation: {
            vi: 'Tránh chia cho 0 bằng `.replace(0, np.nan)` và `+ 1e-6`.',
            en: 'Prevents `inf` results via `.replace(0, np.nan)` and epsilon `+ 1e-6`.',
          },
        },
        {
          lines: 'L25-L35',
          snippet: 'def assign_rating_label(row) -> int:',
          explanation: {
            vi: 'Đặt rõ 3 ngưỡng tài chính cho `2: Khả quan`, `0: Rủi ro`, và `1: Trung tính`.',
            en: 'Maps fundamentals cleanly into `2: Positive`, `0: Risk`, and `1: Neutral`.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện đoạn kiểm tra giá trị hợp lệ không phải `NaN` và gán nhãn `2` (Khả quan):',
          en: 'Complete the non-missing check and assign class `2` (Positive):',
        },
        codeTemplate: `if pd.___0___(roe) and roe >= 18 and pd.notna(pe) and 0 < pe <= 16:
    return ___1___`,
        answers: ['notna', '2'],
        hints: [
          { vi: 'Hàm Pandas kiểm tra giá trị không phải NaN', en: 'Pandas helper checking a scalar is not NaN' },
          { vi: 'Mã số nguyên đại diện cho nhóm Khả quan', en: 'Integer label representing Positive' },
        ],
        explanation: {
          vi: '`pd.notna(roe)` xác nhận ô không trống trước khi xét điều kiện `roe >= 18`, trả về nhãn `2` (Khả quan).',
          en: '`pd.notna(roe)` ensures non-null before checking `roe >= 18`, returning label `2`.',
        },
      },
      quiz: {
        question: {
          vi: 'Tại sao khi tính `liquidity_ratio = GTGD / KLTB 20N`, ta phải dùng `.replace(0, np.nan)`?',
          en: 'Why apply `.replace(0, np.nan)` to `KLTB 20N` when computing `liquidity_ratio`?',
        },
        options: [
          {
            vi: 'Vì cổ phiếu mất thanh khoản có `KLTB 20N = 0` sẽ tạo ra giá trị vô cực `inf`, làm `StandardScaler` ở bước sau bị lỗi.',
            en: 'Zero-volume stocks create `inf` values that break `StandardScaler` downstream; `np.nan` lets the imputer handle them cleanly.',
          },
          {
            vi: 'Vì Pandas không chia được cho số nguyên 0.0.',
            en: 'Because Pandas forbids dividing by float 0.0.',
          },
          {
            vi: 'Để xóa bỏ hoàn toàn cột `GTGD`.',
            en: 'To delete the `GTGD` column.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Chính xác! Biến `0` thành `np.nan` giúp `SimpleImputer` điền giá trị hợp lý thay vì để `inf` phá hỏng phép tính phương sai của `StandardScaler`.',
          en: 'Correct! Converting `0` to `np.nan` avoids `inf` poisoning mean/variance in `StandardScaler`.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'EDA & Target Distribution on stock_metrics.csv',
        terminalLines: [
          'Shape: (2140, 10) | Missing values -> P/E: 64, P/B: 12, ROE: 19, KLTB 20N: 4',
          'Class distribution after labeling:',
          '  1 (Trung tính / Theo dõi): 1218 rows (56.9%)',
          '  2 (Khả quan):               584 rows (27.3%)',
          '  0 (Rủi ro / Tiêu cực):      338 rows (15.8%)',
          '[Note] Imbalance detected (15.8% vs 56.9%) -> Will enable class_weight="balanced"',
        ],
      },
      checkpointItems: [
        {
          vi: 'Biết cách tạo feature mới an toàn trước giá trị 0 và `NaN`.',
          en: 'Safely engineer ratio features without introducing `inf`.',
        },
        {
          vi: 'Hiểu ý nghĩa của 3 nhãn `0 / 1 / 2` và vấn đề mất cân bằng lớp.',
          en: 'Understand the `0 / 1 / 2` target classes and class imbalance.',
        },
      ],
      studyApis: ['pd.read_csv', 'pd.notna', 'Series.replace', 'value_counts'],
    },
    {
      id: '4.2',
      moduleId: 'mod-4',
      tier: 2,
      title: {
        vi: 'Bước 4.2: Pipeline Chống Rò rỉ Dữ liệu với ColumnTransformer',
        en: 'Step 4.2: Anti-Leakage Pipeline with ColumnTransformer',
      },
      subtitle: {
        vi: 'Đóng gói `SimpleImputer(strategy="median")` + `StandardScaler()` bên trong `Pipeline` sau khi đã `train_test_split`.',
        en: 'Encapsulate `SimpleImputer(strategy="median")` + `StandardScaler()` inside a `Pipeline` strictly after `train_test_split`.',
      },
      targetFile: 'notebooks/04_train_ml_scorer.ipynb',
      whyAndWhat: {
        why: {
          vi: 'Lỗi kinh điển của sinh viên mới học ML là gọi `df.fillna(df.median())` và `StandardScaler().fit_transform(X)` trên **toàn bộ bảng dữ liệu** rồi mới chia Train/Test. Làm vậy khiến thông tin trung vị, trung bình và độ lệch chuẩn của tập Test bị rò rỉ vào tập Train (**Preprocessing Leakage**). Khi bọc cả `SimpleImputer` và `StandardScaler` vào `ColumnTransformer` + `Pipeline`, lệnh `pipe.fit(X_train, y_train)` chỉ học `median` và `mean/std` từ riêng `X_train` rồi dùng chính tham số đó để transform `X_test`!',
          en: 'A classic ML bug is running `df.fillna(df.median())` and `StandardScaler().fit_transform(X)` on the full dataset before splitting. That leaks test-set statistics into training (**Preprocessing Leakage**). Wrapping `SimpleImputer` + `StandardScaler` inside `ColumnTransformer` and `Pipeline` guarantees `fit()` learns medians, means, and stds strictly from `X_train`.',
        },
        ifMissing: {
          vi: 'Điểm CV/Test bị thổi phồng giả tạo do rò rỉ thống kê từ tập kiểm thử; khi mang ra thực tế chấm 1 bản tin mới (có mã `#N/A`), code sẽ không nhớ giá trị trung vị lúc train để điền vào.',
          en: 'Validation scores inflate artificially, and at inference time on new reports with `#N/A`, there is no saved median/scaler state to transform single rows consistently.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'train_test_split(..., stratify=y)',
          params: 'test_size=0.2, stratify=y, random_state=42',
          inputType: 'X, y',
          outputType: 'X_train, X_test, y_train, y_test',
          description: {
            vi: 'Chia 80/20 nhưng giữ nguyên tỉ lệ 3 lớp `0/1/2` (tham số `stratify=y`) ở cả 2 tập.',
            en: 'Splits 80/20 while preserving exact class ratios across Train and Test (`stratify=y`).',
          },
        },
        {
          symbol: 'SimpleImputer(strategy="median")',
          params: 'strategy="median"',
          inputType: 'array with np.nan',
          outputType: 'imputed array',
          description: {
            vi: 'Điền các ô `np.nan` bằng giá trị trung vị (median) — bền vững trước ngoại lai hơn `mean` khi có cổ phiếu P/E = 300.',
            en: 'Fills `np.nan` with column medians—robust against extreme financial outliers like P/E = 300.',
          },
        },
        {
          symbol: 'StandardScaler()',
          params: 'No args',
          inputType: 'numeric array',
          outputType: 'z-score array (mean=0, std=1)',
          description: {
            vi: 'Đưa các cột lệch thang đo lớn (`GTGD` hàng trăm tỷ vs `P/B` 1.5) về cùng thang chuẩn z-score.',
            en: 'Standardizes wildly different feature scales (`GTGD` in billions vs `P/B` ~1.5).',
          },
        },
        {
          symbol: 'ColumnTransformer([...])',
          params: 'transformers=[("num", numeric_transformer, cols)]',
          inputType: 'list of (name, transformer, columns)',
          outputType: 'ColumnTransformer',
          description: {
            vi: 'Áp dụng đúng phép biến đổi cho đúng danh sách cột đã chọn, ngăn biến đổi nhầm cột không liên quan.',
            en: 'Applies numeric preprocessing cleanly to the exact feature column subset.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Chia Train/Test giữ tỉ lệ lớp với stratify=y', en: 'Stage 1: Stratified Train/Test Split' },
          summary: {
            vi: 'Luôn thực hiện bước này TRƯỚC mọi phép tiền xử lý.',
            en: 'Always split before fitting any imputer or scaler.',
          },
          code: `from sklearn.model_selection import train_test_split

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, stratify=y, random_state=42
)`,
          expectedNote: {
            vi: 'Cả `y_train` và `y_test` đều giữ đúng ~15.8% lớp `0` và ~27.3% lớp `2`.',
            en: 'Both `y_train` and `y_test` preserve exact ~15.8% class `0` and ~27.3% class `2`.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Ghép SimpleImputer + StandardScaler vào ColumnTransformer', en: 'Stage 2: Compose SimpleImputer + StandardScaler' },
          summary: {
            vi: 'Tại sao chọn `median` thay vì `mean`? Vì một cổ phiếu P/E = 500 sẽ kéo `mean` lên sai lệch hoàn toàn.',
            en: 'Choose `median` over `mean` so extreme outlier P/E values do not skew missing-value imputation.',
          },
          code: `numeric_transformer = Pipeline(steps=[
    ("imputer", SimpleImputer(strategy="median")),
    ("scaler", StandardScaler()),
])

preprocessor = ColumnTransformer(
    transformers=[("num", numeric_transformer, FEATURE_COLS_FULL)]
)`,
          expectedNote: {
            vi: 'Khi đóng gói thành `Pipeline`, file `.pkl` sẽ tự động mang theo cả giá trị `median` lẫn `mean/std` của tập Train!',
            en: 'Bundled inside a `Pipeline`, the `.pkl` file remembers training medians and scaling parameters automatically!',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Nối vào toàn bộ code Pipeline chuẩn bị cho LightGBM', en: 'Stage 3: Attach Preprocessor to Classifiers' },
          summary: {
            vi: 'Cả `LGBMClassifier` và `RandomForestClassifier` đều dùng chung `preprocessor` để so sánh công bằng.',
            en: 'Share the identical `preprocessor` across `LGBMClassifier` and `RandomForestClassifier` for a fair comparison.',
          },
          code: NOTEBOOK_04_CODE.split('# 4. Đánh giá chéo')[0],
          expectedNote: {
            vi: 'Tuyệt đối sạch Data Leakage kể cả khi chạy Cross-Validation 5-Fold.',
            en: 'Zero preprocessing leakage even inside 5-fold Cross-Validation.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 2/4: Pipeline tiền xử lý chống rò rỉ dữ liệu',
        en: 'Piece 2/4: Anti-Leakage Preprocessing Pipeline',
      },
      builderExplanation: {
        vi: 'Nối thêm `train_test_split(..., stratify=y)`, `ColumnTransformer(SimpleImputer + StandardScaler)` và cấu trúc `Pipeline` cho LightGBM & RandomForest.',
        en: 'Adds `train_test_split(..., stratify=y)`, `ColumnTransformer(SimpleImputer + StandardScaler)`, and classifier pipelines.',
      },
      builderCode: NOTEBOOK_04_CODE.split('# 4. Đánh giá chéo')[0],
      highlightLines: [41, 71],
      lineWalkthrough: [
        {
          lines: 'L42-L44',
          snippet: 'X_train, X_test, y_train, y_test = train_test_split(\n    X, y, test_size=0.2, stratify=y, random_state=42\n)',
          explanation: {
            vi: '`random_state=42` giúp kết quả chia lặp lại giống hệt nhau mỗi lần chạy lại notebook.',
            en: '`random_state=42` guarantees deterministic splits across runs.',
          },
        },
        {
          lines: 'L47-L54',
          snippet: 'numeric_transformer = Pipeline(steps=[\n    ("imputer", SimpleImputer(strategy="median")),\n    ("scaler", StandardScaler()),\n])\npreprocessor = ColumnTransformer(...)',
          explanation: {
            vi: 'Thứ tự bắt buộc: điền khuyết (`SimpleImputer`) TRƯỚC rồi mới chuẩn hóa (`StandardScaler`) SAU.',
            en: 'Mandatory order: impute `NaN` first, then standardize scale.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện pipeline điền khuyết bằng trung vị và chia tách giữ nguyên tỉ lệ lớp:',
          en: 'Complete median imputation and stratified splitting:',
        },
        codeTemplate: `X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, ___0___=y, random_state=42)
numeric_transformer = Pipeline(steps=[
    ("imputer", SimpleImputer(strategy="___1___")),
    ("scaler", StandardScaler()),
])`,
        answers: ['stratify', 'median'],
        hints: [
          { vi: 'Tham số giúp giữ tỉ lệ nhãn 0/1/2 đồng đều giữa Train và Test', en: 'Parameter preserving class ratios across splits' },
          { vi: 'Chiến lược lấy trung vị bền vững với ngoại lai', en: 'Outlier-robust imputation strategy' },
        ],
        explanation: {
          vi: '`stratify=y` đảm bảo lớp hiếm `0` không bị dồn hết vào Train hoặc Test; `strategy="median"` chống nhiễu ngoại lai P/E.',
          en: '`stratify=y` preserves minority class ratios and `strategy="median"` resists extreme financial outliers.',
        },
      },
      quiz: {
        question: {
          vi: 'Vì sao KHÔNG được chạy `SimpleImputer().fit_transform(X)` trước khi gọi `train_test_split(X, y)`?',
          en: 'Why must you NOT call `SimpleImputer().fit_transform(X)` before `train_test_split(X, y)`?',
        },
        options: [
          {
            vi: 'Vì làm vậy sẽ khiến giá trị trung vị của tập Test rò rỉ vào tập Train (Data Leakage) và khi triển khai thực tế không có sẵn đối tượng Imputer đóng gói trong `.pkl`.',
            en: 'It leaks test-set medians into training (Preprocessing Leakage) and prevents bundling the fitted imputer inside the `.pkl` pipeline.',
          },
          {
            vi: 'Vì Scikit-Learn báo lỗi SyntaxError.',
            en: 'Because Scikit-Learn raises a SyntaxError.',
          },
          {
            vi: 'Vì LightGBM không nhận dữ liệu đã điền khuyết.',
            en: 'Because LightGBM cannot accept imputed inputs.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Đặt toàn bộ tiền xử lý bên trong `Pipeline` là tiêu chuẩn vàng trong kỹ thuật ML.',
          en: 'Correct! Keeping preprocessing inside `Pipeline` avoids leakage and ensures identical inference transforms.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'Inspect fitted Pipeline steps on X_train',
        terminalLines: [
          '[Split] X_train: (1712, 9) | X_test: (428, 9) — stratified',
          '[SimpleImputer] Learned medians from X_train ONLY -> P/E median=14.20, ROE median=13.80',
          '[StandardScaler] Learned mean/std from X_train ONLY -> ready to transform X_test cleanly',
          '[Zero Leakage] X_test never touched during fit()',
        ],
      },
      checkpointItems: [
        {
          vi: 'Giải thích được khái niệm Preprocessing Data Leakage và cách `Pipeline` ngăn chặn nó.',
          en: 'Explain Preprocessing Leakage and how `Pipeline` prevents it.',
        },
        {
          vi: 'Nắm được thứ tự `SimpleImputer` -> `StandardScaler` trong `ColumnTransformer`.',
          en: 'Know why `SimpleImputer` runs before `StandardScaler` inside `ColumnTransformer`.',
        },
      ],
      studyApis: ['train_test_split', 'SimpleImputer', 'StandardScaler', 'ColumnTransformer', 'Pipeline'],
    },
    {
      id: '4.3',
      moduleId: 'mod-4',
      tier: 3,
      title: {
        vi: 'Bước 4.3: Huấn luyện LightGBM, Cross-Validation & Giải thích Mô hình',
        en: 'Step 4.3: Training LightGBM, Cross-Validation & Feature Importance',
      },
      subtitle: {
        vi: 'So sánh `LGBMClassifier` vs `RandomForestClassifier` bằng `StratifiedKFold`, đọc `classification_report` & `feature_importances_`.',
        en: 'Benchmark `LGBMClassifier` vs `RandomForestClassifier` with `StratifiedKFold`, `classification_report`, and `feature_importances_`.',
      },
      targetFile: 'notebooks/04_train_ml_scorer.ipynb',
      whyAndWhat: {
        why: {
          vi: 'Trên dữ liệu bảng nhỏ/vừa (~2,000 dòng), các thuật toán cây quyết định tăng cường độ dốc (GBDT) như **LightGBM** thường vượt trội mạng nơ-ron sâu về cả độ chính xác lẫn tốc độ suy luận (<10ms trên CPU). Ta sử dụng `class_weight="balanced"` để mô hình không bỏ quên lớp `0: Rủi ro` (chỉ chiếm ~15.8%), kiểm chứng bằng `StratifiedKFold(5)`, và trích xuất `feature_importances_` để biết mô hình quyết định dựa vào `ROE`, `P/E` hay `P/B`.',
          en: 'On ~2,000-row tabular financial data, gradient-boosted trees like **LightGBM** outperform deep networks in accuracy and speed (<10ms CPU inference). Using `class_weight="balanced"` prevents ignoring the minority `0: Risk` class (15.8%), `StratifiedKFold(5)` checks stability, and `feature_importances_` explains model decisions.',
        },
        ifMissing: {
          vi: 'Nếu không dùng `class_weight="balanced"` và chỉ nhìn `Accuracy` tổng thể, một mô hình lười biếng đoán toàn lớp `1` cũng đạt ~57% accuracy nhưng Recall của nhóm `0: Rủi ro` bằng **0%** — cực kỳ nguy hiểm cho người dùng!',
          en: 'Without `class_weight="balanced"` and macro-F1 checks, a model could achieve ~57% accuracy while having **0% recall** on Risky stocks!',
        },
      },
      apiAnatomy: [
        {
          symbol: 'LGBMClassifier(...)',
          params: 'n_estimators=200, learning_rate=0.05, class_weight="balanced", random_state=42',
          inputType: 'X_train, y_train',
          outputType: 'Fitted Classifier',
          description: {
            vi: '200 cây quyết định học tuần tự với tốc độ học chậm `0.05` để tránh overfit và cân bằng trọng số lớp hiếm.',
            en: '200 boosted trees with conservative `0.05` learning rate and inverse-frequency class weights.',
          },
        },
        {
          symbol: 'cross_val_score(..., cv=StratifiedKFold(5), scoring="f1_macro")',
          params: 'estimator, X, y, cv, scoring',
          inputType: 'Pipeline, data',
          outputType: 'array of 5 F1 scores',
          description: {
            vi: 'Đánh giá chéo 5 lần bằng `f1_macro` (coi trọng 3 lớp ngang nhau, không bị lớp đa số che lấp).',
            en: '5-fold CV scored by `f1_macro` so minority Risk and Positive classes count equally.',
          },
        },
        {
          symbol: 'classification_report & confusion_matrix',
          params: 'y_test, y_pred',
          inputType: 'arrays',
          outputType: 'text report & 3x3 matrix',
          description: {
            vi: 'Kiểm tra Precision, Recall, F1 của từng lớp riêng lẻ và xem lớp `0` có bị nhầm sang lớp `2` (rất nguy hiểm) hay không.',
            en: 'Inspects per-class Precision/Recall/F1 and verifies Risk (`0`) is not misclassified as Positive (`2`).',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Khởi tạo & So sánh LightGBM với RandomForest qua 5-Fold CV', en: 'Stage 1: 5-Fold CV Benchmark (LightGBM vs RandomForest)' },
          summary: {
            vi: 'Luôn có mô hình cơ sở (Baseline) như RandomForest để chứng minh LightGBM tốt hơn.',
            en: 'Always benchmark against a baseline like RandomForest using `f1_macro`.',
          },
          code: `cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
print("LGBM CV F1-macro:", cross_val_score(lgbm_pipe, X_train, y_train, cv=cv, scoring="f1_macro").mean())
print("RF   CV F1-macro:", cross_val_score(rf_pipe, X_train, y_train, cv=cv, scoring="f1_macro").mean())`,
          expectedNote: {
            vi: 'Thường `LGBMClassifier` đạt F1-macro ~0.91–0.94, nhỉnh hơn `RandomForest` và nhẹ hơn khi lưu file.',
            en: 'LightGBM typically hits ~0.91–0.94 macro-F1 with smaller serialized model size.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Đọc Confusion Matrix & Feature Importances', en: 'Stage 2: Confusion Matrix & Feature Importances' },
          summary: {
            vi: 'Truy cập bước `"clf"` bên trong `Pipeline` qua `.named_steps["clf"].feature_importances_`.',
            en: 'Access `.named_steps["clf"].feature_importances_` inside the fitted `Pipeline`.',
          },
          code: `lgbm_pipe.fit(X_train, y_train)
y_pred = lgbm_pipe.predict(X_test)
print(classification_report(y_test, y_pred, digits=4))

importances = lgbm_pipe.named_steps["clf"].feature_importances_
for name, imp in sorted(zip(FEATURE_COLS_FULL, importances), key=lambda x: x[1], reverse=True):
    print(f"{name:<16}: {imp}")`,
          expectedNote: {
            vi: 'Thấy rõ `ROE`, `P/E`, `P/B` đứng đầu bảng đóng góp vào quyết định của mô hình.',
            en: 'Confirms `ROE`, `P/E`, and `P/B` rank highest in split importance.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Notebook 04_train_ml_scorer.ipynb hoàn chỉnh + Lưu .pkl', en: 'Stage 3: Complete Training Notebook + joblib Export' },
          summary: {
            vi: 'Lưu toàn bộ `lgbm_pipe` (gồm cả `Imputer + Scaler + LightGBM`) xuống `models/stock_scorer.pkl`.',
            en: 'Serialize the complete `lgbm_pipe` (`Imputer + Scaler + LightGBM`) to `models/stock_scorer.pkl`.',
          },
          code: NOTEBOOK_04_CODE,
          expectedNote: {
            vi: 'Bước 4.4 sẽ viết lớp `StockScorer` đọc chính file `.pkl` này.',
            en: 'Step 4.4 builds `StockScorer` to consume this exact `.pkl` artifact.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 3/4: Toàn bộ notebook notebooks/04_train_ml_scorer.ipynb',
        en: 'Piece 3/4: Complete notebooks/04_train_ml_scorer.ipynb',
      },
      builderExplanation: {
        vi: 'Ghép thêm vòng đánh giá chéo `StratifiedKFold`, báo cáo chi tiết trên `X_test`, giải thích `feature_importances_` và lệnh `joblib.dump(lgbm_pipe, MODEL_OUT)`.',
        en: 'Completes `04_train_ml_scorer.ipynb` with 5-fold CV, test classification report, feature importances, and `joblib.dump`.',
      },
      builderCode: NOTEBOOK_04_CODE,
      highlightLines: [73, 94],
      lineWalkthrough: [
        {
          lines: 'L74-L76',
          snippet: 'cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)\nprint("LGBM CV F1-macro:", cross_val_score(..., scoring="f1_macro").mean())',
          explanation: {
            vi: '`cross_val_score` tự động fit `preprocessor` riêng trong từng fold — đảm bảo không rò rỉ dữ liệu.',
            en: '`cross_val_score` refits `preprocessor` independently per fold with zero leakage.',
          },
        },
        {
          lines: 'L86-L94',
          snippet: 'importances = lgbm_pipe.named_steps["clf"].feature_importances_\n...\njoblib.dump(lgbm_pipe, MODEL_OUT)',
          explanation: {
            vi: 'Đóng gói cả Pipeline vào 1 file duy nhất `models/stock_scorer.pkl`.',
            en: 'Saves the entire preprocessing + LightGBM pipeline into one portable `models/stock_scorer.pkl`.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện cấu hình `LGBMClassifier` chống mất cân bằng lớp và lưu pipeline bằng `joblib`:',
          en: 'Complete `LGBMClassifier` imbalance handling and `joblib` export:',
        },
        codeTemplate: `LGBMClassifier(n_estimators=200, learning_rate=0.05, class_weight="___0___", random_state=42)
...
joblib.___1___(lgbm_pipe, MODEL_OUT)`,
        answers: ['balanced', 'dump'],
        hints: [
          { vi: 'Giá trị của class_weight để tự cân bằng lớp hiếm', en: 'String value enabling inverse class-frequency weighting' },
          { vi: 'Hàm của joblib dùng để ghi đối tượng Python ra đĩa', en: 'joblib function that serializes a model object to disk' },
        ],
        explanation: {
          vi: '`class_weight="balanced"` tự tăng trọng số cho lớp ít mẫu (Rủi ro), và `joblib.dump()` lưu toàn bộ pipeline ra đĩa.',
          en: '`class_weight="balanced"` upweights minority classes and `joblib.dump()` writes the pipeline to disk.',
        },
      },
      quiz: {
        question: {
          vi: 'Vì sao ta dùng `scoring="f1_macro"` thay vì `"accuracy"` khi đánh giá mô hình chấm điểm cổ phiếu?',
          en: 'Why evaluate with `scoring="f1_macro"` instead of `"accuracy"` on this 3-class stock dataset?',
        },
        options: [
          {
            vi: 'Vì các lớp bị mất cân bằng (~15.8% Rủi ro vs ~56.9% Trung tính); `f1_macro` tính trung bình cộng F1 của cả 3 lớp nên lớp Rủi ro được đánh giá công bằng.',
            en: 'Because classes are imbalanced (~15.8% Risk vs ~56.9% Neutral); `f1_macro` weights all 3 classes equally.',
          },
          {
            vi: 'Vì `accuracy` chỉ dùng cho bài toán hồi quy.',
            en: 'Because `accuracy` only works for regression.',
          },
          {
            vi: 'Vì LightGBM không tính được `accuracy`.',
            en: 'Because LightGBM cannot compute accuracy.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Chính xác! Trong tài chính, bỏ sót một cổ phiếu Rủi ro (`0`) gây thiệt hại lớn hơn nhiều so với đoán nhầm cổ phiếu Trung tính.',
          en: 'Exactly! In finance, missing a Risky stock (`0`) is far costlier than misclassifying a Neutral stock.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'python notebooks/04_train_ml_scorer.py',
        terminalLines: [
          'LGBM CV F1-macro: 0.9342',
          'RF   CV F1-macro: 0.9018',
          '',
          'Classification Report (Test Set, n=428):',
          '              precision    recall  f1-score   support',
          '           0     0.9118    0.9118    0.9118        68',
          '           1     0.9504    0.9426    0.9465       244',
          '           2     0.9237    0.9397    0.9316       116',
          '    macro avg    0.9286    0.9314    0.9300       428',
          '',
          'Feature ROE            : 612',
          'Feature P/E            : 548',
          'Feature P/B            : 384',
          'Feature % 1D           : 291',
          'Saved pipeline -> models/stock_scorer.pkl (412 KB)',
        ],
      },
      checkpointItems: [
        {
          vi: 'Biết cách thiết lập `StratifiedKFold` và chọn metric `f1_macro` cho dữ liệu mất cân bằng.',
          en: 'Know how to run `StratifiedKFold` with `f1_macro` on imbalanced classes.',
        },
        {
          vi: 'Biết đọc `classification_report` và `feature_importances_` từ `Pipeline`.',
          en: 'Read `classification_report` and extract `feature_importances_` from a `Pipeline`.',
        },
      ],
      studyApis: ['LGBMClassifier', 'StratifiedKFold', 'classification_report', 'feature_importances_', 'joblib.dump'],
      completeFiles: [
        {
          path: 'notebooks/04_train_ml_scorer.ipynb',
          language: 'python',
          code: NOTEBOOK_04_CODE,
          notebookCells: [
            { type: 'markdown', content: '# 04 - Train Anti-Leakage LightGBM Stock Scorer Pipeline' },
            { type: 'code', content: NOTEBOOK_04_CODE },
          ],
        },
      ],
    },
    {
      id: '4.4',
      moduleId: 'mod-4',
      tier: 3,
      title: {
        vi: 'Bước 4.4: Viết module suy luận `src/ml_scorer.py` (<10ms)',
        en: 'Step 4.4: Inference Module `src/ml_scorer.py` (<10ms)',
      },
      subtitle: {
        vi: 'Load `models/stock_scorer.pkl`, chấm điểm DataFrame mới từ Học phần 3, trả về nhãn + xác suất `predict_proba()`.',
        en: 'Load `models/stock_scorer.pkl`, score live DataFrames from Module 3, and return labels, `predict_proba()`, and concise reasons.',
      },
      targetFile: 'src/ml_scorer.py',
      whyAndWhat: {
        why: {
          vi: 'Trên giao diện Streamlit (Học phần 6), khi người dùng vừa upload 1 file bản tin PDF mới, hệ thống cần chấm điểm ngay ~40–100 cổ phiếu chỉ trong vài mili-giây mà không huấn luyện lại. Lớp `StockScorer` trong `src/ml_scorer.py` làm đúng 1 nhiệm vụ: nạp `stock_scorer.pkl`, tái tạo đúng cột `liquidity_ratio` như lúc train, gọi `.predict()` và `.predict_proba()`, rồi đính kèm cột `"Lý do chính"` để giải thích kết quả một cách minh bạch cho nhà đầu tư.',
          en: 'In Streamlit (Module 6), uploading a fresh PDF must score 40–100 stocks instantaneously without retraining. `StockScorer` in `src/ml_scorer.py` loads `stock_scorer.pkl`, recomputes `liquidity_ratio` identically to training, runs `.predict()` + `.predict_proba()`, and attaches human-readable `"Lý do chính"` explanations.',
        },
        ifMissing: {
          vi: 'Nếu suy luận thiếu cột `liquidity_ratio` hoặc đặt sai thứ tự cột so với lúc `fit()`, Scikit-Learn sẽ báo lỗi `ValueError: X has 8 features, but ColumnTransformer is expecting 9 features` hoặc trả kết quả sai lệch.',
          en: 'Omitting `liquidity_ratio` or changing column order throws `ValueError` in `ColumnTransformer` or silently corrupts predictions.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'joblib.load(path)',
          params: 'filename: Path',
          inputType: 'Path',
          outputType: 'Pipeline',
          description: {
            vi: 'Nạp lại cả `SimpleImputer`, `StandardScaler` và `LGBMClassifier` từ đĩa chỉ trong ~15ms.',
            en: 'Restores the fitted imputer, scaler, and LightGBM classifier from disk in ~15ms.',
          },
        },
        {
          symbol: 'self.pipeline.predict_proba(X)',
          params: 'X: pd.DataFrame',
          inputType: 'DataFrame (N, 9)',
          outputType: 'np.ndarray (N, 3)',
          description: {
            vi: 'Trả về xác suất cho cả 3 lớp `[P(0), P(1), P(2)]`; lấy `probs.max(axis=1) * 100` làm cột `"Độ tin cậy (%)"`.',
            en: 'Returns class probabilities `[P(0), P(1), P(2)]`; `probs.max(axis=1) * 100` gives confidence %.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Nạp .pkl và chạy predict trên 1 DataFrame mẫu', en: 'Stage 1: Load .pkl & Score a Toy DataFrame' },
          summary: {
            vi: 'Kiểm tra tốc độ suy luận siêu nhanh (<10ms) trên CPU.',
            en: 'Verify sub-10ms CPU inference latency on sample rows.',
          },
          code: `import joblib, pandas as pd

pipe = joblib.load("models/stock_scorer.pkl")
sample = pd.DataFrame([{
    "Giá": 138.5, "P/E": 21.4, "P/B": 4.8, "ROE": 26.2,
    "KLTB 20N": 3.2, "GTGD": 642.1, "% 1D": 1.4, "% YTD": 42.0,
    "liquidity_ratio": 642.1 / 3.2
}])
print("Pred:", pipe.predict(sample), "Proba:", pipe.predict_proba(sample))`,
          expectedNote: {
            vi: 'Pipeline tự động impute/scale giống hệt tập Train mà bạn không cần viết lại bất kỳ phép chia hay trừ trung bình nào.',
            en: 'The pipeline automatically applies saved training medians and scalers with zero manual math.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Bảo vệ các cột bị thiếu & Sinh lời giải thích dễ hiểu', en: 'Stage 2: Missing-Column Guard & Human Explanation' },
          summary: {
            vi: 'Nếu một bản tin thiếu cột `% YTD`, `_prepare_features()` tự chèn `np.nan` thay vì crash app.',
            en: 'If a daily report omits `% YTD`, `_prepare_features()` fills `np.nan` instead of crashing.',
          },
          code: `for col in FEATURE_COLS:
    if col not in work.columns:
        work[col] = np.nan`,
          expectedNote: {
            vi: 'Nhờ `SimpleImputer` trong `.pkl`, ngay cả khi thiếu nguyên 1 cột hoặc mã `DCL` có `#N/A`, app vẫn chạy mượt.',
            en: 'Thanks to `SimpleImputer` inside `.pkl`, missing columns or `#N/A` tickers never crash inference.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Hoàn chỉnh module src/ml_scorer.py', en: 'Stage 3: Complete src/ml_scorer.py' },
          summary: {
            vi: 'Sẵn sàng để `app.py` (Tab 1) import và hiển thị bảng màu trực quan.',
            en: 'Ready for `app.py` Tab 1 to render color-coded stock scorecards.',
          },
          code: ML_SCORER_PY_COMPLETE,
          expectedNote: {
            vi: 'Tải file `src/ml_scorer.py` ở Tab 4 hoặc copy về VS Code.',
            en: 'Download `src/ml_scorer.py` from Tab 4 into your local repo.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 4/4: Hoàn chỉnh module src/ml_scorer.py',
        en: 'Piece 4/4: Complete src/ml_scorer.py',
      },
      builderExplanation: {
        vi: 'File `src/ml_scorer.py` hoàn chỉnh: nạp `models/stock_scorer.pkl`, chuẩn bị đúng 9 đặc trưng, chấm điểm bằng `.predict()` + `.predict_proba()` và sinh lý do giải thích.',
        en: 'Complete `src/ml_scorer.py`: loads `models/stock_scorer.pkl`, aligns all 9 features, computes predictions + probabilities, and generates explanations.',
      },
      builderCode: ML_SCORER_PY_COMPLETE,
      highlightLines: [15, 62],
      lineWalkthrough: [
        {
          lines: 'L23-L29',
          snippet: 'def _prepare_features(self, df: pd.DataFrame) -> pd.DataFrame:\n    ...\n    work["liquidity_ratio"] = work["GTGD"] / (work["KLTB 20N"].replace(0, np.nan) + 1e-6)\n    return work[self.feature_names]',
          explanation: {
            vi: 'Tái tạo chính xác phép biến đổi `liquidity_ratio` giống hệt lúc train (Training-Serving Skew = 0).',
            en: 'Replicates the exact training feature transformation so training-serving skew is zero.',
          },
        },
        {
          lines: 'L51-L59',
          snippet: 'preds = self.pipeline.predict(X)\nprobs = self.pipeline.predict_proba(X)\n...\nscored["Độ tin cậy (%)"] = (probs.max(axis=1) * 100).round(1)',
          explanation: {
            vi: 'Lấy xác suất lớn nhất trong 3 lớp để hiển thị mức độ tự tin cho từng mã cổ phiếu trên Streamlit.',
            en: 'Takes the maximum class probability across `[0, 1, 2]` to display model confidence per stock.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện bước nạp model và lấy xác suất tự tin cao nhất cho từng dòng cổ phiếu:',
          en: 'Complete loading the `.pkl` pipeline and extracting the highest class probability per stock:',
        },
        codeTemplate: `self.pipeline = joblib.___0___(path)
...
probs = self.pipeline.___1___(X)
scored["Độ tin cậy (%)"] = (probs.max(axis=1) * 100).round(1)`,
        answers: ['load', 'predict_proba'],
        hints: [
          { vi: 'Hàm của joblib dùng để đọc lại file .pkl từ đĩa', en: 'joblib function that deserializes a .pkl file' },
          { vi: 'Phương thức Scikit-Learn trả về mảng xác suất thay vì nhãn cứng', en: 'Scikit-Learn method returning class probability vectors' },
        ],
        explanation: {
          vi: '`joblib.load(path)` nạp pipeline đã train, và `predict_proba(X)` trả về xác suất của cả 3 lớp.',
          en: '`joblib.load(path)` restores the fitted pipeline, and `predict_proba(X)` returns per-class probabilities.',
        },
      },
      quiz: {
        question: {
          vi: 'Khái niệm "Training-Serving Skew" là gì và `StockScorer._prepare_features` xử lý nó như thế nào?',
          en: 'What is "Training-Serving Skew" and how does `StockScorer._prepare_features` prevent it?',
        },
        options: [
          {
            vi: 'Là sự sai khác giữa cách tính đặc trưng lúc train và lúc dự đoán thật; `_prepare_features` dùng cùng công thức `liquidity_ratio` và thứ tự cột với notebook train.',
            en: 'Mismatch between training and inference feature logic; `_prepare_features` enforces the exact `liquidity_ratio` formula and column order.',
          },
          {
            vi: 'Là hiện tượng GPU chạy nhanh hơn CPU.',
            en: 'The speed difference between GPU and CPU.',
          },
          {
            vi: 'Là lỗi thiếu font tiếng Việt trong CSV.',
            en: 'Vietnamese font encoding corruption in CSV.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Giữ đồng nhất tuyệt đối quy trình tạo đặc trưng giữa train và inference giúp mô hình giữ đúng độ chính xác ngoài thực tế.',
          en: 'Correct! Identical feature pipelines at training and inference guarantee reliable production accuracy.',
        },
      },
      simulation: {
        kind: 'dataframe',
        commandLabel: 'StockScorer("models/stock_scorer.pkl").score(df_page4)  # 4.8 ms',
        statusColumn: 'Đánh giá',
        dataframeColumns: ['Mã', 'Giá', 'P/E', 'ROE', 'Đánh giá', 'Độ tin cậy (%)', 'Lý do chính'],
        dataframeRows: [
          { Mã: 'MBB', Giá: 25.4, 'P/E': 6.1, ROE: 22.8, 'Đánh giá': 'Khả quan', 'Độ tin cậy (%)': 96.4, 'Lý do chính': 'Điểm mạnh: ROE=22.8%, P/E=6.1, P/B=1.20' },
          { Mã: 'FPT', Giá: 138.5, 'P/E': 21.4, ROE: 26.2, 'Đánh giá': 'Trung tính / Theo dõi', 'Độ tin cậy (%)': 88.2, 'Lý do chính': 'Ổn định: ROE=26.2%, P/E=21.4, P/B=4.80' },
          { Mã: 'DCL', Giá: 28.9, 'P/E': 'NaN', ROE: 9.4, 'Đánh giá': 'Trung tính / Theo dõi', 'Độ tin cậy (%)': 81.5, 'Lý do chính': 'Ổn định: ROE=9.4%, P/B=1.90' },
          { Mã: 'NVL', Giá: 10.6, 'P/E': -12.4, ROE: -4.1, 'Đánh giá': 'Rủi ro / Tiêu cực', 'Độ tin cậy (%)': 97.1, 'Lý do chính': 'Cần chú ý: ROE=-4.1%, P/E=-12.4, P/B=0.52' },
        ],
      },
      checkpointItems: [
        {
          vi: 'Biết cách load `.pkl` và gọi `predict()` + `predict_proba()`.',
          en: 'Know how to load `.pkl` and combine `predict()` with `predict_proba()`.',
        },
        {
          vi: 'Đảm bảo xử lý trơn tru cả mã bị khuyết số liệu như `DCL` (`#N/A` -> `NaN`).',
          en: 'Verify graceful inference even when tickers like `DCL` have `NaN` metrics.',
        },
      ],
      studyApis: ['joblib.load', 'Pipeline.predict', 'Pipeline.predict_proba', 'src/ml_scorer.py'],
      completeFiles: [
        {
          path: 'src/ml_scorer.py',
          language: 'python',
          code: ML_SCORER_PY_COMPLETE,
        },
      ],
    },
    {
      id: '4.5',
      moduleId: 'mod-4',
      tier: 3,
      title: {
        vi: 'Bước 4.5: Mở rộng Tabular ML — Giải thích SHAP & TimeSeriesSplit chống trôi thời gian',
        en: 'Step 4.5: Tabular ML Beyond Defaults — SHAP Explanations & TimeSeriesSplit',
      },
      subtitle: {
        vi: 'Dùng `shap.TreeExplainer` giải thích từng mã cổ phiếu cụ thể và so sánh `TimeSeriesSplit` với `StratifiedKFold` cho dữ liệu chuỗi thời gian.',
        en: 'Use `shap.TreeExplainer` for per-ticker attribution and compare `TimeSeriesSplit` vs `StratifiedKFold` on temporal stock panels.',
      },
      targetFile: 'notebooks/04_train_ml_scorer.ipynb',
      whyAndWhat: {
        why: {
          vi: '`feature_importances_` của LightGBM chỉ cho biết cột nào quan trọng *trên toàn bộ tập dữ liệu*, không giải thích riêng tại sao mã `MBB` hôm nay được cộng điểm hay trừ điểm. **SHAP (`TreeExplainer`)** tính giá trị đóng góp cụ thể của từng chỉ số cho *từng mã cổ phiếu*. Ngoài ra, với dữ liệu tài chính theo ngày, `TimeSeriesSplit` giúp kiểm tra mô hình huấn luyện trên tháng 9–10 có còn chính xác khi thị trường đổi trạng thái ở tháng 11 hay không (Temporal Drift).',
          en: 'Global `feature_importances_` cannot explain why a *specific* stock like `MBB` scored Positive today. **SHAP (`TreeExplainer`)** computes exact per-ticker feature contributions. Meanwhile, `TimeSeriesSplit` tests whether models trained on Sept–Oct data still hold up on November market regimes (Temporal Drift).',
        },
        ifMissing: {
          vi: 'Dùng thuần `StratifiedKFold` ngẫu nhiên trên dữ liệu theo ngày có thể để dữ liệu ngày 13/11 lọt vào tập Train khi đánh giá ngày 12/11 (Look-ahead Bias).',
          en: 'Random `StratifiedKFold` across daily snapshots risks look-ahead leakage across adjacent trading days.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'shap.TreeExplainer(lgbm_model)',
          params: 'model: LGBMClassifier',
          inputType: 'Fitted tree model',
          outputType: 'TreeExplainer',
          description: {
            vi: 'Tính SHAP values theo thời gian đa thức cực nhanh dành riêng cho mô hình cây như LightGBM / XGBoost.',
            en: 'Exact fast polynomial-time SHAP value computation tailored to tree ensembles.',
          },
        },
        {
          symbol: 'TimeSeriesSplit(n_splits=5)',
          params: 'n_splits: int = 5',
          inputType: 'Chronologically sorted X',
          outputType: 'Walk-forward folds',
          description: {
            vi: 'Luôn dùng quá khứ để train và tương lai ngay sau đó để kiểm thử (Walk-forward Validation).',
            en: 'Strictly trains on past dates and validates on subsequent future windows.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Kiểm thử cuốn chiếu theo thời gian với TimeSeriesSplit', en: 'Stage 1: Walk-Forward Validation with TimeSeriesSplit' },
          summary: {
            vi: 'Sắp xếp `df` theo `report_date` tăng dần trước khi truyền vào `TimeSeriesSplit`.',
            en: 'Sort `df` chronologically by `report_date` before running `TimeSeriesSplit`.',
          },
          code: `from sklearn.model_selection import TimeSeriesSplit, cross_val_score

df_sorted = df.sort_values("report_date")
tscv = TimeSeriesSplit(n_splits=5)
scores = cross_val_score(lgbm_pipe, df_sorted[FEATURE_COLS_FULL], df_sorted["label"], cv=tscv, scoring="f1_macro")
print("Walk-forward F1-macro:", scores.round(4))`,
          expectedNote: {
            vi: 'Giúp kiểm chứng mô hình không bị "ăn gian" nhìn trước tương lai.',
            en: 'Proves there is zero future-to-past leakage across trading days.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Tính SHAP value giải thích riêng 1 cổ phiếu (vd: MBB)', en: 'Stage 2: Per-Ticker SHAP Attribution' },
          summary: {
            vi: 'Biến đổi dữ liệu qua `preprocessor` rồi đưa vào `shap.TreeExplainer`.',
            en: 'Transform rows through `preprocessor` before computing SHAP values on `clf`.',
          },
          code: `import shap

X_trans = lgbm_pipe.named_steps["preprocessor"].transform(X_test)
explainer = shap.TreeExplainer(lgbm_pipe.named_steps["clf"])
shap_vals = explainer.shap_values(X_trans[:5])
# Lớp 2 (Khả quan) cho mẫu đầu tiên:
for fname, val in zip(FEATURE_COLS_FULL, shap_vals[2][0]):
    print(f"{fname:<16}: {val:+.3f}")`,
          expectedNote: {
            vi: 'Giá trị `+` đẩy xác suất Khả quan lên, giá trị `-` kéo xuống.',
            en: 'Positive SHAP contributions push toward class `2`, negative pull away.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Tối ưu siêu tham số nhanh bằng Optuna (30 trials)', en: 'Stage 3: Hyperparameter Tuning with Optuna' },
          summary: {
            vi: 'Tìm `num_leaves`, `learning_rate`, `min_child_samples` tốt nhất tự động.',
            en: 'Automatically search `num_leaves`, `learning_rate`, and `min_child_samples`.',
          },
          code: `import optuna

def objective(trial):
    params = {
        "n_estimators": trial.suggest_int("n_estimators", 100, 400),
        "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.15, log=True),
        "num_leaves": trial.suggest_int("num_leaves", 15, 63),
        "class_weight": "balanced",
        "random_state": 42,
        "verbose": -1,
    }
    pipe = Pipeline([("prep", preprocessor), ("clf", LGBMClassifier(**params))])
    return cross_val_score(pipe, X_train, y_train, cv=cv, scoring="f1_macro").mean()`,
          expectedNote: {
            vi: 'Optuna dùng Bayesian TPE hiệu quả hơn GridSearchCV gấp nhiều lần.',
            en: 'Optuna TPE finds strong hyperparameters much faster than exhaustive GridSearchCV.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mở rộng Tabular ML: Walk-forward CV & SHAP Explainer',
        en: 'Tabular ML Extension: Walk-Forward CV & SHAP',
      },
      builderExplanation: {
        vi: 'Kết hợp kiểm chứng theo trình tự thời gian `TimeSeriesSplit` và giải thích từng mã bằng `shap.TreeExplainer`.',
        en: 'Combines chronological `TimeSeriesSplit` validation with per-stock `shap.TreeExplainer` attributions.',
      },
      builderCode: `import shap
from sklearn.model_selection import TimeSeriesSplit, cross_val_score

def validate_and_explain(lgbm_pipe, df_sorted, feature_cols):
    tscv = TimeSeriesSplit(n_splits=5)
    scores = cross_val_score(
        lgbm_pipe,
        df_sorted[feature_cols],
        df_sorted["label"],
        cv=tscv,
        scoring="f1_macro",
    )
    print("TimeSeriesSplit F1-macro:", scores.round(4))

    X_sample = lgbm_pipe.named_steps["preprocessor"].transform(df_sorted[feature_cols].tail(5))
    explainer = shap.TreeExplainer(lgbm_pipe.named_steps["clf"])
    return explainer.shap_values(X_sample)`,
      highlightLines: [4, 16],
      lineWalkthrough: [
        {
          lines: 'L5-L12',
          snippet: 'tscv = TimeSeriesSplit(n_splits=5)\nscores = cross_val_score(..., cv=tscv, scoring="f1_macro")',
          explanation: {
            vi: 'Đảm bảo fold kiểm thử luôn nằm sau fold huấn luyện về mặt thời gian.',
            en: 'Guarantees test folds always chronologically follow training folds.',
          },
        },
        {
          lines: 'L15-L16',
          snippet: 'X_sample = lgbm_pipe.named_steps["preprocessor"].transform(...)\nexplainer = shap.TreeExplainer(lgbm_pipe.named_steps["clf"])',
          explanation: {
            vi: 'Lưu ý luôn cho dữ liệu đi qua `preprocessor` trước khi đưa vào `TreeExplainer`.',
            en: 'Always pass raw DataFrames through `preprocessor` before calling `TreeExplainer`.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện kiểm chứng cuốn chiếu theo thời gian và khởi tạo bộ giải thích SHAP cho cây quyết định:',
          en: 'Complete walk-forward `TimeSeriesSplit` and `TreeExplainer` initialization:',
        },
        codeTemplate: `tscv = ___0___(n_splits=5)
scores = cross_val_score(lgbm_pipe, X_sorted, y_sorted, cv=tscv, scoring="f1_macro")
explainer = shap.___1___(lgbm_pipe.named_steps["clf"])`,
        answers: ['TimeSeriesSplit', 'TreeExplainer'],
        hints: [
          { vi: 'Lớp chia CV của Scikit-Learn dành cho chuỗi thời gian', en: 'Scikit-Learn CV splitter for chronological data' },
          { vi: 'Lớp giải thích SHAP tối ưu cho mô hình cây (LightGBM)', en: 'SHAP explainer class specialized for tree models' },
        ],
        explanation: {
          vi: '`TimeSeriesSplit` ngăn nhìn trước tương lai; `shap.TreeExplainer` giải thích đóng góp từng đặc trưng cho mỗi cổ phiếu.',
          en: '`TimeSeriesSplit` prevents look-ahead leakage, and `TreeExplainer` gives exact per-stock attributions.',
        },
      },
      quiz: {
        question: {
          vi: 'Sự khác biệt lớn nhất giữa `feature_importances_` của LightGBM và `SHAP values` là gì?',
          en: 'What is the key advantage of `SHAP values` over LightGBM `feature_importances_`?',
        },
        options: [
          {
            vi: '`SHAP` giải thích hướng (+/-) và mức độ đóng góp cho từng dòng cổ phiếu cụ thể, còn `feature_importances_` chỉ là tổng hợp chung toàn tập.',
            en: '`SHAP` quantifies directional (+/-) feature contributions per individual stock row, whereas `feature_importances_` is only a global summary.',
          },
          {
            vi: '`SHAP` dùng để thay thế bước `SimpleImputer`.',
            en: '`SHAP` replaces `SimpleImputer`.',
          },
          {
            vi: '`SHAP` tự động tải PDF từ MASVN.',
            en: '`SHAP` scrapes PDFs automatically.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Giải thích cục bộ (Local Explainability) giúp nhà đầu tư hiểu rõ tại sao cụ thể mã `MBB` được chấm Khả quan.',
          en: 'Correct! Local explainability shows exactly why a given stock received its score.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'validate_and_explain(lgbm_pipe, df_sorted)',
        terminalLines: [
          'TimeSeriesSplit F1-macro: [0.8912, 0.9104, 0.9188, 0.9241, 0.9275]',
          'SHAP attribution for MBB (Pred: 2 - Khả quan, P=96.4%):',
          '  ROE (+22.8%)      : +1.842  (strong positive driver)',
          '  P/E (6.1)         : +1.215  (attractive valuation)',
          '  P/B (1.20)        : +0.630',
          '  liquidity_ratio   : +0.118',
        ],
      },
      checkpointItems: [
        {
          vi: 'Hiểu khái niệm Look-ahead Bias và cách dùng `TimeSeriesSplit` trong tài chính.',
          en: 'Understand look-ahead bias and chronological `TimeSeriesSplit`.',
        },
        {
          vi: 'Biết cách trích xuất `SHAP` giải thích cho từng dự đoán riêng lẻ.',
          en: 'Generate per-prediction `SHAP` attributions from a Scikit-Learn Pipeline.',
        },
      ],
      studyApis: ['TimeSeriesSplit', 'shap.TreeExplainer', 'optuna'],
    },
  ],
};
