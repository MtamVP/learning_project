import { ModuleSpec } from '../types';

export const APP_PY_COMPLETE = `from pathlib import Path
import tempfile
import fitz
import pandas as pd
import streamlit as st

from src.extractor import HybridDocumentExtractor
from src.ml_scorer import StockScorer
from src.rag_engine import HybridRAGEngine
from src.table_parser import (
    cluster_words_to_rows,
    grid_to_stock_dataframe,
    is_stock_metrics_table,
    rows_to_grid,
    serialize_macro_table_to_text,
)
from src.utils import release_gpu_memory

st.set_page_config(
    page_title="MASVN Market Intelligence Engine",
    layout="wide",
)


@st.cache_resource
def load_extractor():
    return HybridDocumentExtractor("models/yolo_masvn_layout.pt")


@st.cache_resource
def load_scorer():
    return StockScorer("models/stock_scorer.pkl")


@st.cache_resource
def load_rag():
    rag = HybridRAGEngine()
    if (Path("data/vector_store/faiss.index")).exists():
        rag.load_indices()
    return rag


def style_rating_cell(val: str) -> str:
    if val == "Khả quan":
        return "background-color: #163826; color: #5eead4; font-weight: 600;"
    if val == "Rủi ro / Tiêu cực":
        return "background-color: #421c1e; color: #fca5a5; font-weight: 600;"
    if val == "Trung tính / Theo dõi":
        return "background-color: #3d3117; color: #fcd34d; font-weight: 600;"
    return ""


def process_uploaded_report(uploaded_file, extractor: HybridDocumentExtractor, scorer: StockScorer):
    suffix = Path(uploaded_file.name).suffix.lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(uploaded_file.read())
        tmp_path = Path(tmp.name)

    report_date = uploaded_file.name.replace("report_", "").replace(suffix, "")
    regions = extractor.extract_pdf(tmp_path) if suffix == ".pdf" else []

    stock_frames = []
    doc_chunks = []
    for reg in regions:
        if reg["label"] == "Text":
            txt = " ".join(w[4] for w in reg["words"]).strip()
            if len(txt) > 30:
                doc_chunks.append({
                    "text": txt,
                    "metadata": {"date": report_date, "page": reg["page"], "category": "narrative_text"},
                })
        elif reg["label"] == "Table":
            rows = cluster_words_to_rows(reg["words"], y_tolerance=5.0)
            grid = rows_to_grid(rows, x_gap_threshold=14.0)
            if is_stock_metrics_table(grid):
                df_part = grid_to_stock_dataframe(grid, report_date)
                if not df_part.empty:
                    stock_frames.append(df_part)
            else:
                for sent in serialize_macro_table_to_text(grid, report_date, reg["page"]):
                    doc_chunks.append({
                        "text": sent,
                        "metadata": {"date": report_date, "page": reg["page"], "category": "macro_table"},
                    })

    release_gpu_memory()
    tmp_path.unlink(missing_ok=True)

    raw_df = pd.concat(stock_frames, ignore_index=True) if stock_frames else pd.DataFrame()
    scored_df = scorer.score(raw_df) if not raw_df.empty else pd.DataFrame()
    return scored_df, doc_chunks


def main():
    st.title("MASVN Market Intelligence Engine")

    if "latest_scored_df" not in st.session_state:
        st.session_state["latest_scored_df"] = pd.DataFrame()
    if "latest_doc_chunks" not in st.session_state:
        st.session_state["latest_doc_chunks"] = []
    if "chat_history" not in st.session_state:
        st.session_state["chat_history"] = []

    with st.sidebar:
        st.header("Nguồn dữ liệu")
        if st.button("Cập nhật bản tin mới nhất từ MASVN", use_container_width=True):
            from scripts.scrape_masvn import OUTPUT_DIR, download_pdf, get_report_links

            with st.spinner("Đang kiểm tra bản tin mới từ MASVN..."):
                latest = get_report_links(limit=3)
                for date_str, url in latest:
                    download_pdf(url, OUTPUT_DIR / f"report_{date_str}.pdf")
            st.success(f"Đã đồng bộ {len(latest)} bản tin mới nhất.")

        uploaded = st.file_uploader("Tải lên bản tin PDF / Ảnh", type=["pdf", "png", "jpg"])
        if uploaded is not None and st.button("Phân tích tài liệu", type="primary", use_container_width=True):
            extractor = load_extractor()
            scorer = load_scorer()
            with st.spinner("Đang chạy YOLO + Hybrid Parser + LightGBM..."):
                scored_df, doc_chunks = process_uploaded_report(uploaded, extractor, scorer)
                st.session_state["latest_scored_df"] = scored_df
                st.session_state["latest_doc_chunks"] = doc_chunks
            st.success(f"Hoàn tất: {len(scored_df)} mã cổ phiếu, {len(doc_chunks)} đoạn tri thức.")

    tab1, tab2 = st.tabs(["Phân tích & Chấm điểm Cổ phiếu", "Trợ lý Hỏi đáp AI Đa phương thức"])

    with tab1:
        df = st.session_state["latest_scored_df"]
        if df.empty:
            st.info("Hãy tải lên một file bản tin MASVN PDF ở thanh bên trái để bắt đầu phân tích.")
        else:
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Tổng mã đã chấm", len(df))
            c2.metric("Khả quan", int((df["Đánh giá"] == "Khả quan").sum()))
            c3.metric("Trung tính", int((df["Đánh giá"] == "Trung tính / Theo dõi").sum()))
            c4.metric("Rủi ro / Tiêu cực", int((df["Đánh giá"] == "Rủi ro / Tiêu cực").sum()))

            styled = df.style.map(style_rating_cell, subset=["Đánh giá"])
            st.dataframe(styled, use_container_width=True, height=520)

    with tab2:
        rag = load_rag()
        for msg in st.session_state["chat_history"]:
            with st.chat_message(msg["role"]):
                st.markdown(msg["content"])

        if user_q := st.chat_input("Hỏi về cổ phiếu, vĩ mô hoặc nhận định trong bản tin..."):
            st.session_state["chat_history"].append({"role": "user", "content": user_q})
            with st.chat_message("user"):
                st.markdown(user_q)

            df_ctx = st.session_state["latest_scored_df"]
            ml_summary = (
                df_ctx[["Mã", "Đánh giá", "Độ tin cậy (%)", "Lý do chính"]].head(15).to_string(index=False)
                if not df_ctx.empty and "Mã" in df_ctx.columns
                else ""
            )

            with st.chat_message("assistant"):
                with st.spinner("Đang truy xuất Hybrid RAG + Qwen2.5:7b..."):
                    res = rag.ask(
                        query=user_q,
                        ml_summary=ml_summary,
                        extra_chunks=st.session_state["latest_doc_chunks"],
                    )
                    st.markdown(res["answer"])
            st.session_state["chat_history"].append({"role": "assistant", "content": res["answer"]})


if __name__ == "__main__":
    main()`;

export const REQUIREMENTS_TXT = `playwright==1.49.0
requests==2.32.3
urllib3==2.2.3
PyMuPDF==1.24.14
Pillow==11.0.0
ultralytics==8.3.39
paddlepaddle==2.6.2
paddleocr==2.9.1
pandas==2.2.3
numpy==1.26.4
scikit-learn==1.5.2
lightgbm==4.5.0
joblib==1.4.2
sentence-transformers==3.3.1
faiss-cpu==1.9.0
rank-bm25==0.2.2
streamlit==1.40.1`;

export const README_BENCHMARK_MD = `# MASVN Market Intelligence Engine

Hệ thống phân tích bản tin chứng khoán MASVN chạy hoàn toàn cục bộ trên laptop GPU **NVIDIA RTX 5060 (8GB VRAM)** & **24GB System RAM**.

## 1. Phân bổ Ngân sách Phần cứng (8GB VRAM + 24GB RAM)
| Thành phần | Thiết bị chạy | Dung lượng ước tính |
|---|---|---|
| YOLOv11n Layout (\`yolo_masvn_layout.pt\`) | GPU CUDA | ~0.30 GB VRAM |
| Ollama LLM (\`qwen2.5:7b\` Q4_K_M) | GPU CUDA | ~4.90 GB VRAM |
| PaddleOCR (\`lang='vi', use_gpu=False\`) | CPU / RAM | ~1.10 GB System RAM |
| SentenceTransformer (\`BAAI/bge-m3\`, \`device='cpu'\`) | CPU / RAM | ~1.40 GB System RAM |
| LightGBM (\`stock_scorer.pkl\`) + FAISS + BM25 | CPU / RAM | ~0.15 GB System RAM |

## 2. Kết quả Đo lường Thực tế (Benchmarks)
| Module | Tác vụ | Kết quả đo được |
|---|---|---|
| Vision (YOLOv11n) | Nhận diện Table / Text / Figure (4 holdout PDFs) | \`mAP50 = 0.958\`, \`~11.4 ms/trang\` |
| Hybrid Parser | Digital PDF (PyMuPDF) vs Scan (PaddleOCR CPU) | \`~5 ms/trang\` vs \`~1.42 s/trang\` |
| Tabular ML (LightGBM) | Phân loại 3 nhóm cổ phiếu (Stratified 5-Fold) | \`F1-macro = 0.930\`, \`< 5 ms/bảng\` |
| Hybrid RAG | Truy xuất thông tin trên bộ 20 câu hỏi kiểm thử | \`Recall@3 = 0.90 (18/20)\` |

## 3. Cài đặt & Khởi chạy
\`\`\`bash
pip install -r requirements.txt
playwright install chromium
ollama pull qwen2.5:7b
python scripts/scrape_masvn.py
streamlit run app.py
\`\`\``;

export const module6: ModuleSpec = {
  id: 'mod-6',
  number: 6,
  title: {
    vi: 'Học phần 6: Giao diện Tương tác & Kỹ thuật Hệ thống (UI & VRAM)',
    en: 'Module 6: Interactive UI & System Engineering (Streamlit + 8GB VRAM)',
  },
  summary: {
    vi: 'Xây dựng Streamlit 2 Tab tô màu bảng điểm cổ phiếu, đồng bộ trạng thái qua @st.cache_resource & st.session_state, tối ưu 8GB VRAM RTX 5060 và hoàn thiện Benchmark.',
    en: 'Build a 2-tab Streamlit app with color-coded tables, manage @st.cache_resource & st.session_state, budget 8GB RTX 5060 VRAM, and document benchmarks.',
  },
  stack: ['streamlit', 'torch', 'gc', 'requirements.txt', 'README.md'],
  steps: [
    {
      id: '6.1',
      moduleId: 'mod-6',
      tier: 1,
      title: {
        vi: 'Bước 6.1: Kiến trúc Giao diện Streamlit 2 Tab & Tô màu Bảng điểm',
        en: 'Step 6.1: 2-Tab Streamlit UI Architecture & Styled DataFrames',
      },
      subtitle: {
        vi: 'Thiết kế Sidebar tải bản tin + Tab 1 (`st.metric`, `df.style.map`) + Tab 2 (`st.chat_message`, `st.chat_input`).',
        en: 'Build the sidebar uploader, Tab 1 (`st.metric` + `df.style.map`), and Tab 2 (`st.chat_message` + `st.chat_input`).',
      },
      targetFile: 'app.py',
      whyAndWhat: {
        why: {
          vi: 'Toàn bộ sức mạnh của Playwright, YOLO, LightGBM và Qwen2.5:7b cần được gói gọn vào một giao diện trực quan cho nhà đầu tư. Sử dụng `st.set_page_config(layout="wide")` tận dụng tối đa bề rộng màn hình cho bảng 100 cổ phiếu; `df.style.map(style_rating_cell, subset=["Đánh giá"])` tô màu Xanh/Vàng/Đỏ giúp nhận diện cơ hội và rủi ro trong 1 giây; Tab 2 dùng `st.chat_message` mang lại trải nghiệm hỏi đáp tự nhiên.',
          en: 'All backend components converge into a single investor-friendly dashboard. `st.set_page_config(layout="wide")` maximizes table space, `df.style.map(..., subset=["Đánh giá"])` highlights Positive/Neutral/Risk cells at a glance, and `st.chat_message` delivers a clean grounded Q&A experience.',
        },
        ifMissing: {
          vi: 'Nếu vẫn chạy mọi bước bằng notebook rời rạc, sản phẩm không có giá trị sử dụng hàng ngày cho người dùng cuối và rất khó trình bày demo đồ án.',
          en: 'Leaving the pipeline as disconnected notebooks makes daily usage clumsy and weakens project presentation.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'st.set_page_config(layout="wide")',
          params: 'page_title, layout="wide"',
          inputType: 'str',
          outputType: 'None (must be first st.* call)',
          description: {
            vi: 'Mở rộng khung nội dung ra toàn chiều ngang trình duyệt để bảng số liệu chứng khoán không bị cuộn ngang khó nhìn.',
            en: 'Expands the layout to full browser width so wide stock tables remain readable.',
          },
        },
        {
          symbol: 'df.style.map(fn, subset=["Đánh giá"])',
          params: 'func, subset',
          inputType: 'callable, list[str]',
          outputType: 'Styler',
          description: {
            vi: 'Áp dụng CSS màu nền/chữ có điều kiện riêng lên cột `"Đánh giá"` trước khi truyền vào `st.dataframe(styled)`.',
            en: 'Applies conditional CSS styling specifically to the `"Đánh giá"` column inside `st.dataframe()`.',
          },
        },
        {
          symbol: 'st.chat_message / st.chat_input',
          params: 'name="user" | "assistant"',
          inputType: 'str',
          outputType: 'Container / str | None',
          description: {
            vi: 'Cặp API dựng khung hội thoại chuẩn của Streamlit kèm biểu tượng vai trò người hỏi và trợ lý AI.',
            en: 'Native Streamlit conversational components rendering user and assistant turns cleanly.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Khung 2 Tab & Sidebar cơ bản', en: 'Stage 1: Minimal 2-Tab & Sidebar Skeleton' },
          summary: {
            vi: 'Kiểm tra `st.set_page_config(layout="wide")` nằm ngay dòng đầu tiên sau import.',
            en: 'Ensure `st.set_page_config(layout="wide")` is the very first Streamlit call.',
          },
          code: `import streamlit as st

st.set_page_config(page_title="MASVN Intelligence", layout="wide")
with st.sidebar:
    uploaded = st.file_uploader("Upload PDF", type=["pdf"])
tab1, tab2 = st.tabs(["Phân tích Cổ phiếu", "Hỏi đáp AI"])`,
          expectedNote: {
            vi: 'Nếu đặt lệnh `st.title()` trước `st.set_page_config()`, Streamlit sẽ ném `StreamlitAPIException`.',
            en: 'Calling any `st.*` UI command before `st.set_page_config()` raises `StreamlitAPIException`.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Hàm tô màu trực quan df.style.map()', en: 'Stage 2: Conditional Styling with df.style.map()' },
          summary: {
            vi: 'Lưu ý từ Pandas 2.1+, hàm `.applymap()` cũ đã đổi tên thành `.map()`.',
            en: 'In Pandas 2.1+, `Styler.applymap()` is deprecated in favor of `Styler.map()`.',
          },
          code: `def style_rating_cell(val: str) -> str:
    if val == "Khả quan":
        return "background-color: #163826; color: #5eead4; font-weight: 600;"
    if val == "Rủi ro / Tiêu cực":
        return "background-color: #421c1e; color: #fca5a5; font-weight: 600;"
    return "background-color: #3d3117; color: #fcd34d; font-weight: 600;"

styled = df.style.map(style_rating_cell, subset=["Đánh giá"])
st.dataframe(styled, use_container_width=True)`,
          expectedNote: {
            vi: 'Màu sắc tương phản tốt trên nền Dark Mode của Streamlit.',
            en: 'High-contrast palette designed for dark dashboards.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Toàn bộ app.py (xem kèm giải thích caching ở Bước 6.2)', en: 'Stage 3: Complete app.py Assembly' },
          summary: {
            vi: 'Kết nối đầy đủ Scraper button, Uploader, Tab 1 KPI + Styler và Tab 2 Hybrid RAG Chat.',
            en: 'Connects sidebar scraper trigger, file uploader, Tab 1 metrics/table, and Tab 2 RAG chat.',
          },
          code: APP_PY_COMPLETE,
          expectedNote: {
            vi: 'Chạy bằng lệnh `streamlit run app.py` ngay tại thư mục gốc dự án.',
            en: 'Launch from the project root with `streamlit run app.py`.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 1/3: Kiến trúc 2 Tab trong app.py',
        en: 'Piece 1/3: 2-Tab Layout & Styling in app.py',
      },
      builderExplanation: {
        vi: 'Khung `app.py` hoàn chỉnh kết hợp Sidebar cập nhật dữ liệu, Tab 1 hiển thị `st.metric` + `df.style.map()`, và Tab 2 giao diện chat.',
        en: 'Complete `app.py` integrating sidebar ingestion, Tab 1 KPIs + styled DataFrame, and Tab 2 chat UI.',
      },
      builderCode: APP_PY_COMPLETE,
      highlightLines: [118, 165],
      lineWalkthrough: [
        {
          lines: 'L123-L129',
          snippet: 'c1, c2, c3, c4 = st.columns(4)\nc1.metric("Tổng mã đã chấm", len(df))\n...\nstyled = df.style.map(style_rating_cell, subset=["Đánh giá"])\nst.dataframe(styled, use_container_width=True, height=520)',
          explanation: {
            vi: '4 thẻ KPI tóm tắt sức khỏe toàn thị trường ngay phía trên bảng chi tiết có tô màu.',
            en: 'Four KPI cards summarize market breadth right above the color-coded table.',
          },
        },
        {
          lines: 'L138-L157',
          snippet: 'if user_q := st.chat_input(...):\n    ...\n    ml_summary = df_ctx[["Mã", "Đánh giá", ...]].head(15).to_string(index=False)',
          explanation: {
            vi: 'Truyền trực tiếp top 15 mã đã chấm điểm từ Tab 1 sang RAG ở Tab 2 để AI trả lời được cả câu hỏi kết hợp bảng điểm ML.',
            en: 'Injects Tab 1 ML scores into Tab 2 RAG so the assistant can answer questions referencing live predictions.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện cấu hình toàn chiều ngang và tô màu riêng cột `"Đánh giá"` trong `app.py`:',
          en: 'Complete wide-mode page setup and conditional styling for the `"Đánh giá"` column:',
        },
        codeTemplate: `st.set_page_config(page_title="MASVN Market Intelligence Engine", layout="___0___")
...
styled = df.style.___1___(style_rating_cell, subset=["Đánh giá"])
st.dataframe(styled, use_container_width=True)`,
        answers: ['wide', 'map'],
        hints: [
          { vi: 'Chế độ mở rộng toàn màn hình của Streamlit', en: 'Streamlit layout setting for full viewport width' },
          { vi: 'Phương thức Styler của Pandas >= 2.1 thay thế applymap', en: 'Pandas Styler method replacing deprecated applymap' },
        ],
        explanation: {
          vi: '`layout="wide"` mở rộng khung bảng, và `df.style.map(..., subset=["Đánh giá"])` tô màu chuẩn Pandas hiện đại.',
          en: '`layout="wide"` utilizes full screen width and `df.style.map(...)` applies cell styles cleanly.',
        },
      },
      quiz: {
        question: {
          vi: 'Lệnh `st.set_page_config(layout="wide")` bắt buộc phải đặt ở vị trí nào trong `app.py`?',
          en: 'Where must `st.set_page_config(layout="wide")` be placed inside `app.py`?',
        },
        options: [
          {
            vi: 'Phải là lệnh `st.*` đầu tiên được gọi trong script (trước `st.title`, `st.sidebar`...).',
            en: 'It must be the very first `st.*` command executed (before `st.title`, `st.sidebar`, etc.).',
          },
          {
            vi: 'Đặt ở cuối file ngay dưới `if __name__ == "__main__":`.',
            en: 'At the very bottom of the file.',
          },
          {
            vi: 'Đặt bên trong hàm `st.button()`.',
            en: 'Inside an `st.button()` block.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Streamlit quy định `set_page_config` chỉ được gọi 1 lần và phải đứng trước mọi thành phần giao diện khác.',
          en: 'Correct! Streamlit enforces `set_page_config` as the first UI command per run.',
        },
      },
      simulation: {
        kind: 'dataframe',
        commandLabel: 'Tab 1 Preview — st.dataframe(df.style.map(style_rating_cell))',
        statusColumn: 'Đánh giá',
        dataframeColumns: ['Mã', 'Giá', 'P/E', 'ROE', 'Đánh giá', 'Độ tin cậy (%)'],
        dataframeRows: [
          { Mã: 'MBB', Giá: 25.4, 'P/E': 6.1, ROE: 22.8, 'Đánh giá': 'Khả quan', 'Độ tin cậy (%)': 96.4 },
          { Mã: 'ACB', Giá: 25.1, 'P/E': 6.8, ROE: 21.5, 'Đánh giá': 'Khả quan', 'Độ tin cậy (%)': 94.1 },
          { Mã: 'FPT', Giá: 138.5, 'P/E': 21.4, ROE: 26.2, 'Đánh giá': 'Trung tính / Theo dõi', 'Độ tin cậy (%)': 88.2 },
          { Mã: 'NVL', Giá: 10.6, 'P/E': -12.4, ROE: -4.1, 'Đánh giá': 'Rủi ro / Tiêu cực', 'Độ tin cậy (%)': 97.1 },
        ],
      },
      checkpointItems: [
        {
          vi: 'Nắm được cấu trúc Sidebar + 2 Tabs (`st.tabs`) của `app.py`.',
          en: 'Understand the Sidebar + 2-Tab layout of `app.py`.',
        },
        {
          vi: 'Biết cách dùng `df.style.map()` để trực quan hóa kết quả LightGBM.',
          en: 'Use `df.style.map()` to highlight ML classification labels.',
        },
      ],
      studyApis: ['st.set_page_config', 'st.tabs', 'df.style.map', 'st.chat_message', 'st.chat_input'],
      completeFiles: [
        {
          path: 'app.py',
          language: 'python',
          code: APP_PY_COMPLETE,
        },
      ],
    },
    {
      id: '6.2',
      moduleId: 'mod-6',
      tier: 2,
      title: {
        vi: 'Bước 6.2: Quản lý bộ nhớ với @st.cache_resource & st.session_state',
        en: 'Step 6.2: Lifecycle & Memory Control (@st.cache_resource & st.session_state)',
      },
      subtitle: {
        vi: 'Phân biệt `@st.cache_resource` vs `@st.cache_data` và đồng bộ dữ liệu giữa Tab 1 và Tab 2.',
        en: 'Distinguish `@st.cache_resource` vs `@st.cache_data` and share analyzed reports between Tab 1 and Tab 2.',
      },
      targetFile: 'app.py',
      whyAndWhat: {
        why: {
          vi: 'Mỗi khi bạn bấm một nút hay gõ một câu chat trong Streamlit, **toàn bộ file `app.py` chạy lại từ đầu đến cuối**. Nếu không có `@st.cache_resource`, mỗi lần bạn gửi 1 tin nhắn ở Tab 2, hệ thống lại nạp lại `YOLOv11n`, `stock_scorer.pkl`, `BAAI/bge-m3` và `FAISS` vào RAM/VRAM — gây treo máy và tràn bộ nhớ ngay lập tức! Đồng thời, `st.session_state["latest_scored_df"]` và `st.session_state["latest_doc_chunks"]` giúp giữ nguyên bảng điểm vừa phân tích ở Tab 1 để Chatbot Tab 2 đọc hiểu ngữ cảnh file vừa upload.',
          en: 'Streamlit re-runs `app.py` top-to-bottom on every user interaction. Without `@st.cache_resource`, every chat message reloads `YOLOv11n`, `LightGBM`, `bge-m3`, and `FAISS`—freezing the app and exhausting memory. Meanwhile, `st.session_state["latest_scored_df"]` and `st.session_state["latest_doc_chunks"]` persist Tab 1 results so Tab 2’s chatbot shares live document context.',
        },
        ifMissing: {
          vi: 'Web mất 15–20 giây để load lại mô hình sau mỗi cú click chuột, và Chatbot ở Tab 2 hoàn toàn "mù" không biết bạn vừa upload báo cáo ngày nào ở Tab 1.',
          en: 'Every click stalls 15–20s reloading models, and Tab 2’s chatbot forgets the file uploaded in Tab 1.',
        },
      },
      apiAnatomy: [
        {
          symbol: '@st.cache_resource',
          params: 'Decorator on model loaders',
          inputType: 'Function returning ML model / DB connection',
          outputType: 'Shared singleton object across reruns',
          description: {
            vi: 'Dùng cho các đối tượng nặng KHÔNG thể/không nên copy như PyTorch Model (YOLO), `SentenceTransformer`, `FAISS`, `LightGBM`.',
            en: 'Caches unserializable heavy singletons (YOLO, `SentenceTransformer`, `FAISS`, `LightGBM`) across reruns without copying.',
          },
        },
        {
          symbol: '@st.cache_data',
          params: 'Decorator on data transforms',
          inputType: 'Function returning DataFrame / dict / list',
          outputType: 'Serialized copy per call',
          description: {
            vi: 'Dùng cho dữ liệu thuần (CSV, JSON, DataFrame) cần tạo bản sao an toàn khi trả về.',
            en: 'Caches serializable data outputs (DataFrames, JSON dicts) safely returning copies.',
          },
        },
        {
          symbol: 'st.session_state["latest_scored_df"]',
          params: 'Per-user browser session dict',
          inputType: 'Key-value state',
          outputType: 'Persistent across reruns',
          description: {
            vi: 'Lưu bảng kết quả ML và các đoạn văn bản `latest_doc_chunks` của riêng phiên người dùng hiện tại.',
            en: 'Stores the user’s active scored DataFrame and extracted `latest_doc_chunks` across reruns.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: So sánh @st.cache_resource vs @st.cache_data', en: 'Stage 1: @st.cache_resource vs @st.cache_data' },
          summary: {
            vi: 'Quy tắc nhớ nhanh: Model / Connection -> `cache_resource`; DataFrame / API JSON -> `cache_data`.',
            en: 'Rule of thumb: Models & connections -> `cache_resource`; DataFrames & JSON -> `cache_data`.',
          },
          code: `@st.cache_resource
def load_extractor():
    return HybridDocumentExtractor("models/yolo_masvn_layout.pt")

@st.cache_data
def load_historical_csv():
    return pd.read_csv("data/processed/stock_metrics.csv")`,
          expectedNote: {
            vi: 'Nếu dùng nhầm `@st.cache_data` cho YOLO hoặc FAISS sẽ gặp `PickleError` và cực kỳ tốn RAM.',
            en: 'Using `@st.cache_data` on PyTorch/FAISS objects triggers serialization errors or duplicates weights.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Khởi tạo & Giao tiếp dữ liệu giữa 2 Tab qua session_state', en: 'Stage 2: Cross-Tab Context via session_state' },
          summary: {
            vi: 'Luôn kiểm tra `if key not in st.session_state:` trước khi đọc để tránh `KeyError`.',
            en: 'Initialize keys defensively with `if key not in st.session_state:` at the top of `main()`.',
          },
          code: `if "latest_scored_df" not in st.session_state:
    st.session_state["latest_scored_df"] = pd.DataFrame()
if "latest_doc_chunks" not in st.session_state:
    st.session_state["latest_doc_chunks"] = []`,
          expectedNote: {
            vi: 'Khi Tab 1 cập nhật `st.session_state`, Tab 2 tự động nhìn thấy ngay ở lần rerun đó.',
            en: 'Updates made during Tab 1 upload are immediately readable inside Tab 2.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Bơm ngữ cảnh Tab 1 vào HybridRAGEngine.ask() ở Tab 2', en: 'Stage 3: Injecting Session Context into Tab 2 RAG' },
          summary: {
            vi: 'Tạo chuỗi `ml_summary` gọn 15 dòng đầu bảng + `extra_chunks` đưa vào prompt Qwen2.5:7b.',
            en: 'Pass compact `ml_summary` + `extra_chunks` straight into `rag.ask()`.',
          },
          code: `df_ctx = st.session_state["latest_scored_df"]
ml_summary = (
    df_ctx[["Mã", "Đánh giá", "Độ tin cậy (%)", "Lý do chính"]].head(15).to_string(index=False)
    if not df_ctx.empty and "Mã" in df_ctx.columns
    else ""
)
res = rag.ask(
    query=user_q,
    ml_summary=ml_summary,
    extra_chunks=st.session_state["latest_doc_chunks"],
)`,
          expectedNote: {
            vi: 'Chatbot giờ trả lời được cả câu hỏi kiểu: *"Trong file tôi vừa tải lên, mã nào được chấm Khả quan và lý do là gì?"*.',
            en: 'The chatbot can now answer hybrid questions like *"Which tickers in my uploaded report scored Positive and why?"*.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 2/3: Bộ nhớ đệm & Đồng bộ trạng thái trong app.py',
        en: 'Piece 2/3: Caching & Cross-Tab State in app.py',
      },
      builderExplanation: {
        vi: 'Tập trung vào các hàm `@st.cache_resource` (dòng 24–40) và quản lý `st.session_state` (dòng 94–156) trong `app.py`.',
        en: 'Highlights `@st.cache_resource` loaders (lines 24–40) and `st.session_state` synchronization (lines 94–156) inside `app.py`.',
      },
      builderCode: APP_PY_COMPLETE,
      highlightLines: [24, 40],
      lineWalkthrough: [
        {
          lines: 'L24-L40',
          snippet: '@st.cache_resource\ndef load_extractor(): ...\n@st.cache_resource\ndef load_scorer(): ...\n@st.cache_resource\ndef load_rag(): ...',
          explanation: {
            vi: 'Chỉ nạp 3 bộ máy lõi đúng 1 lần duy nhất khi server Streamlit khởi động.',
            en: 'Instantiates all 3 core engines exactly once across the entire Streamlit server lifetime.',
          },
        },
        {
          lines: 'L113-L115',
          snippet: 'st.session_state["latest_scored_df"] = scored_df\nst.session_state["latest_doc_chunks"] = doc_chunks',
          explanation: {
            vi: 'Cầu nối chia sẻ kết quả vừa xử lý từ Sidebar/Tab 1 sang Tab 2.',
            en: 'Bridges freshly parsed report outputs from Sidebar/Tab 1 directly into Tab 2.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Chọn decorator phù hợp để cache mô hình AI nặng và đọc kết quả từ `session_state`:',
          en: 'Choose the right decorator for heavy AI models and read stored results from `session_state`:',
        },
        codeTemplate: `@st.___0___
def load_rag():
    return HybridRAGEngine()
...
df = st.___1___["latest_scored_df"]`,
        answers: ['cache_resource', 'session_state'],
        hints: [
          { vi: 'Decorator của Streamlit dành cho model ML, DB connection (không serialize copy)', en: 'Streamlit decorator for non-serializable model/resource singletons' },
          { vi: 'Từ điển lưu trạng thái phiên người dùng trong Streamlit', en: 'Per-session persistent dictionary in Streamlit' },
        ],
        explanation: {
          vi: '`@st.cache_resource` giữ nguyên đối tượng YOLO/RAG trong bộ nhớ; `st.session_state` giữ bảng điểm giữa các lần rerun.',
          en: '`@st.cache_resource` keeps singleton models loaded; `st.session_state` preserves per-user results across reruns.',
        },
      },
      quiz: {
        question: {
          vi: 'Điểm khác nhau cốt lõi giữa `@st.cache_resource` và `@st.cache_data` là gì?',
          en: 'What is the core difference between `@st.cache_resource` and `@st.cache_data`?',
        },
        options: [
          {
            vi: '`@st.cache_resource` trả về chính đối tượng gốc dùng chung (cho ML models, FAISS, DB), còn `@st.cache_data` serialize và tạo bản sao dữ liệu (cho DataFrame, JSON).',
            en: '`@st.cache_resource` shares the live singleton object (ML models, FAISS, DB), whereas `@st.cache_data` serializes and returns copies (DataFrames, JSON).',
          },
          {
            vi: '`@st.cache_data` chạy trên GPU, còn `@st.cache_resource` chạy trên ổ cứng.',
            en: '`@st.cache_data` runs on GPU while `@st.cache_resource` runs on disk.',
          },
          {
            vi: 'Hai decorator này hoàn toàn giống nhau.',
            en: 'Both decorators behave identically.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Chính xác! Dùng đúng `@st.cache_resource` giúp không bao giờ nhân bản nhầm mô hình AI trong RAM/VRAM.',
          en: 'Correct! Using `@st.cache_resource` avoids duplicating heavy model weights in RAM/VRAM.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'Streamlit rerun trace (User sends chat message in Tab 2)',
        terminalLines: [
          '[Rerun #4] Triggered by st.chat_input()',
          '  load_extractor() -> CACHE HIT (0.0 ms)',
          '  load_scorer()    -> CACHE HIT (0.0 ms)',
          '  load_rag()       -> CACHE HIT (0.0 ms)',
          '  st.session_state["latest_scored_df"] -> 44 rows preserved',
          '  st.session_state["latest_doc_chunks"] -> 16 chunks injected into prompt',
          '[OK] Chat reply rendered in 2.38 s',
        ],
      },
      checkpointItems: [
        {
          vi: 'Phân biệt chính xác khi nào dùng `@st.cache_resource` vs `@st.cache_data`.',
          en: 'Know when to apply `@st.cache_resource` vs `@st.cache_data`.',
        },
        {
          vi: 'Hiểu cơ chế chia sẻ ngữ cảnh Tab 1 -> Tab 2 qua `st.session_state`.',
          en: 'Understand Tab 1 -> Tab 2 context sharing via `st.session_state`.',
        },
      ],
      studyApis: ['@st.cache_resource', '@st.cache_data', 'st.session_state'],
    },
    {
      id: '6.3',
      moduleId: 'mod-6',
      tier: 3,
      title: {
        vi: 'Bước 6.3: Tối ưu 8GB VRAM (RTX 5060), Benchmark & Đóng gói GitHub',
        en: 'Step 6.3: 8GB VRAM Budgeting (RTX 5060), Benchmarking & GitHub Packaging',
      },
      subtitle: {
        vi: 'Phân bổ CPU/GPU hợp lý, dọn VRAM với `gc.collect()` + `torch.cuda.empty_cache()`, hoàn thiện `requirements.txt` & `README.md`.',
        en: 'Allocate CPU vs GPU memory cleanly, release VRAM via `gc.collect()` + `torch.cuda.empty_cache()`, and finalize `requirements.txt` & `README.md`.',
      },
      targetFile: 'README.md',
      whyAndWhat: {
        why: {
          vi: 'Với **RTX 5060 8GB VRAM + 24GB RAM**, bài toán kỹ thuật hệ thống (System Engineering) quyết định ứng dụng có chạy mượt hay bị crash `CUDA out of memory`: (1) Ép `PaddleOCR` và `SentenceTransformer` chạy trên **CPU / 24GB RAM**; (2) Chỉ giữ `YOLOv11n` (~0.3GB) và `Ollama qwen2.5:7b` (~4.9GB) trên **8GB VRAM** (~5.2GB tổng cộng, còn dư gần 2.8GB an toàn cho Windows/Display); (3) Gọi `gc.collect()` + `torch.cuda.empty_cache()` ngay sau khi YOLO xử lý xong PDF; (4) Đo đạc các chỉ số thật (`mAP50`, `5ms/page`, `F1-macro`, `Recall@3`) để viết `README.md` và `requirements.txt` chuyên nghiệp.',
          en: 'On an **RTX 5060 8GB VRAM + 24GB RAM** laptop, system engineering prevents `CUDA out of memory`: (1) pin `PaddleOCR` and `SentenceTransformer` to **CPU / 24GB RAM**; (2) keep only `YOLOv11n` (~0.3GB) and `qwen2.5:7b` (~4.9GB) on **GPU** (~5.2GB total, leaving safe headroom); (3) call `gc.collect()` + `torch.cuda.empty_cache()` post-extraction; (4) document verified benchmarks in `README.md` and pin `requirements.txt`.',
        },
        ifMissing: {
          vi: 'Để mọi mô hình mặc định tự tranh giành GPU sẽ vượt ngưỡng 8GB VRAM ngay khi mở trình duyệt + Streamlit + Ollama cùng lúc; thiếu `requirements.txt` và bảng Benchmark sẽ làm dự án thiếu tính tái lập khi nộp bài hoặc đưa lên GitHub.',
          en: 'Letting every library claim GPU memory exhausts 8GB VRAM under simultaneous Windows + Ollama + Vision load; missing `requirements.txt` and benchmarks makes the repo non-reproducible.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'gc.collect() + torch.cuda.empty_cache()',
          params: 'in src/utils.py -> release_gpu_memory()',
          inputType: 'None',
          outputType: 'None',
          description: {
            vi: 'Thu hồi rác tham chiếu Python trước, sau đó trả bộ nhớ đệm CUDA chưa dùng về cho driver GPU (nhường chỗ cho Ollama KV-cache).',
            en: 'Collects unreachable Python tensor objects first, then releases unused CUDA allocator cache back to the GPU driver.',
          },
        },
        {
          symbol: 'Recall@3 (Hybrid RAG Benchmark)',
          params: '20 test questions',
          inputType: 'Query + Ground Truth chunk',
          outputType: 'float [0..1]',
          description: {
            vi: 'Tỉ lệ phần trăm câu hỏi (trong 20 câu kiểm thử) mà đoạn văn chứa đáp án đúng xuất hiện trong Top 3 kết quả tìm kiếm.',
            en: 'Fraction of 20 test queries where the ground-truth evidence chunk appears within Top-3 retrieved results.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Kiểm tra ngân sách 8GB VRAM bằng PyTorch', en: 'Stage 1: Inspect GPU VRAM Usage with PyTorch' },
          summary: {
            vi: 'Đo trực tiếp dung lượng VRAM đang dùng trước và sau `release_gpu_memory()`.',
            en: 'Measure allocated vs reserved VRAM before and after `release_gpu_memory()`.',
          },
          code: `import torch
from src.utils import release_gpu_memory

if torch.cuda.is_available():
    print("Allocated MB:", torch.cuda.memory_allocated() / 1024**2)
    release_gpu_memory()
    print("Reserved MB after cleanup:", torch.cuda.memory_reserved() / 1024**2)`,
          expectedNote: {
            vi: 'Gọi `gc.collect()` TRƯỚC `torch.cuda.empty_cache()` thì bộ nhớ đệm mới được giải phóng triệt để.',
            en: 'Always run `gc.collect()` BEFORE `torch.cuda.empty_cache()` so tensor references drop first.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Chốt danh sách thư viện chuẩn trong requirements.txt', en: 'Stage 2: Pin Dependencies in requirements.txt' },
          summary: {
            vi: 'Ghi rõ phiên bản từng thư viện để chạy lại mượt mà trên máy mới hoặc môi trường ảo `venv`.',
            en: 'Pin verified versions for clean `pip install -r requirements.txt` setup.',
          },
          code: REQUIREMENTS_TXT,
          expectedNote: {
            vi: 'Nhớ nhắc người dùng chạy thêm `playwright install chromium` sau khi `pip install`.',
            en: 'Remember to run `playwright install chromium` after `pip install`.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Tài liệu kiến trúc & Bảng Benchmark trong README.md', en: 'Stage 3: Architecture & Benchmark README.md' },
          summary: {
            vi: 'Tổng kết dự án chuyên nghiệp sẵn sàng đưa lên GitHub Portfolio.',
            en: 'Portfolio-ready `README.md` with hardware budget and measured benchmarks.',
          },
          code: README_BENCHMARK_MD,
          expectedNote: {
            vi: 'Chúc mừng bạn đã hoàn thành toàn bộ lộ trình 6 Học phần từ con số 0 đến sản phẩm hoàn chỉnh!',
            en: 'Congratulations on completing all 6 Modules from scratch to a complete local AI system!',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 3/3: Đóng gói README.md & requirements.txt',
        en: 'Piece 3/3: Packaging README.md & requirements.txt',
      },
      builderExplanation: {
        vi: 'Hoàn thiện bảng phân bổ 8GB VRAM RTX 5060, bảng Benchmark 4 module và hướng dẫn cài đặt từng bước trong `README.md`.',
        en: 'Finalizes the 8GB RTX 5060 VRAM budget table, 4-module benchmarks, and setup guide in `README.md`.',
      },
      builderCode: README_BENCHMARK_MD,
      highlightLines: [1, 30],
      lineWalkthrough: [
        {
          lines: 'L5-L12',
          snippet: '| YOLOv11n Layout | GPU CUDA | ~0.30 GB VRAM |\n| Ollama LLM (qwen2.5:7b) | GPU CUDA | ~4.90 GB VRAM |\n| PaddleOCR & bge-m3 | CPU / RAM | ~2.50 GB System RAM |',
          explanation: {
            vi: 'Chiến lược tách CPU RAM (24GB) và GPU VRAM (8GB) giúp toàn bộ hệ thống chạy đồng thời không tràn bộ nhớ.',
            en: 'Splitting workloads across 24GB CPU RAM and 8GB GPU VRAM avoids memory contention.',
          },
        },
        {
          lines: 'L15-L21',
          snippet: '| Vision (YOLOv11n) | mAP50 = 0.958, ~11.4 ms/trang |\n| Hybrid Parser | ~5 ms/trang vs ~1.42 s/trang |\n| Tabular ML | F1-macro = 0.930, < 5 ms/bảng |\n| Hybrid RAG | Recall@3 = 0.90 (18/20) |',
          explanation: {
            vi: 'Các chỉ số đo lường định lượng giúp chứng minh hiệu quả thực tế của từng module trong đồ án.',
            en: 'Quantitative benchmarks validating every stage of the pipeline.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện hàm giải phóng VRAM trong `src/utils.py` theo đúng thứ tự chuẩn:',
          en: 'Complete the VRAM cleanup sequence inside `src/utils.py`:',
        },
        codeTemplate: `def release_gpu_memory():
    gc.___0___()
    if torch.cuda.is_available():
        torch.cuda.___1___()`,
        answers: ['collect', 'empty_cache'],
        hints: [
          { vi: 'Hàm thu gom rác của module gc', en: 'Garbage-collection trigger in the gc module' },
          { vi: 'Hàm PyTorch CUDA trả lại bộ nhớ đệm trống cho GPU', en: 'PyTorch CUDA method freeing cached allocator blocks' },
        ],
        explanation: {
          vi: '`gc.collect()` dọn các tham chiếu Python còn sót, sau đó `torch.cuda.empty_cache()` trả khối nhớ trống về GPU.',
          en: '`gc.collect()` frees lingering Python tensor handles before `torch.cuda.empty_cache()` returns GPU blocks.',
        },
      },
      quiz: {
        question: {
          vi: 'Trên laptop RTX 5060 8GB VRAM + 24GB RAM, phân bổ nào sau đây giúp toàn bộ hệ thống chạy mượt mà nhất không bị tràn VRAM?',
          en: 'On an RTX 5060 8GB VRAM + 24GB RAM laptop, which resource allocation avoids CUDA OOM?',
        },
        options: [
          {
            vi: 'Để `YOLOv11n` (~0.3GB) + `Ollama qwen2.5:7b` (~4.9GB) trên GPU VRAM; đẩy `PaddleOCR` và `SentenceTransformer` sang CPU / 24GB RAM.',
            en: 'Run `YOLOv11n` (~0.3GB) + `Ollama qwen2.5:7b` (~4.9GB) on GPU VRAM; run `PaddleOCR` and `SentenceTransformer` on CPU / 24GB RAM.',
          },
          {
            vi: 'Đưa cả PaddleOCR, bge-m3, YOLOv11n và Qwen2.5:7b lên GPU cùng một lúc.',
            en: 'Load PaddleOCR, bge-m3, YOLOv11n, and Qwen2.5:7b simultaneously onto GPU.',
          },
          {
            vi: 'Chạy Qwen2.5:7b trên CPU để dành 8GB VRAM cho LightGBM.',
            en: 'Run Qwen2.5:7b on CPU so LightGBM gets 8GB VRAM.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Chính xác! LightGBM chạy cực nhanh trên CPU (<5ms), còn Qwen2.5:7b cần GPU để đạt ~48 tokens/s; đẩy OCR & Embedding sang 24GB RAM giữ VRAM chỉ ở mức ~5.2/8.0 GB.',
          en: 'Correct! LightGBM runs in <5ms on CPU while Qwen2.5:7b needs GPU throughput; offloading OCR & embeddings keeps GPU usage around ~5.2/8.0 GB.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'Full End-to-End System Benchmark & VRAM Audit',
        terminalLines: [
          '=== HARDWARE BUDGET (RTX 5060 8GB VRAM / 24GB RAM) ===',
          '  GPU | YOLOv11n (active during extract) : 0.30 GB VRAM',
          '  GPU | Ollama qwen2.5:7b Q4_K_M         : 4.92 GB VRAM',
          '  GPU | Peak Concurrent Total            : 5.22 GB / 8.00 GB (Safe)',
          '  RAM | PaddleOCR (lazy CPU) + bge-m3    : 2.50 GB / 24.00 GB RAM',
          '',
          '=== PIPELINE BENCHMARK SUMMARY ===',
          '  [1] Scraper (50 PDFs)      : 100% deduplicated, 2 URL formats handled',
          '  [2] YOLOv11n (4 test PDFs) : mAP50 = 0.958 | 11.4 ms/page',
          '  [3] Hybrid Parser          : PyMuPDF 4.8 ms/page | PaddleOCR 1.42 s/page',
          '  [4] LightGBM Scorer        : Macro-F1 = 0.930 | 4.6 ms/report',
          '  [5] Hybrid RAG (20 queries): Recall@3 = 0.90 (18/20) | 47.8 tok/s local',
        ],
      },
      checkpointItems: [
        {
          vi: 'Hiểu rõ bản đồ phân bổ RAM CPU (24GB) vs GPU VRAM (8GB) cho từng module.',
          en: 'Master the CPU RAM (24GB) vs GPU VRAM (8GB) memory allocation plan.',
        },
        {
          vi: 'Đã tải đủ `requirements.txt`, `README.md` và `app.py` để đẩy dự án lên GitHub.',
          en: 'Download `requirements.txt`, `README.md`, and `app.py` to publish on GitHub.',
        },
      ],
      studyApis: ['gc.collect()', 'torch.cuda.empty_cache()', 'VRAM Budgeting', 'Recall@3 Benchmark'],
      completeFiles: [
        {
          path: 'README.md',
          language: 'markdown',
          code: README_BENCHMARK_MD,
        },
        {
          path: 'requirements.txt',
          language: 'text',
          code: REQUIREMENTS_TXT,
        },
        {
          path: 'app.py',
          language: 'python',
          code: APP_PY_COMPLETE,
        },
      ],
    },
    {
      id: '6.4',
      moduleId: 'mod-6',
      tier: 3,
      title: {
        vi: 'Bước 6.4: Đóng gói Package (src/__init__.py), Unit Test với pytest & .gitignore',
        en: 'Step 6.4: Package Init (src/__init__.py), pytest Unit Tests & .gitignore',
      },
      subtitle: {
        vi: 'Hoàn thiện cấu trúc package `src/__init__.py`, viết test tự động cho `clean_numeric_value` & `table_parser` và loại trừ file nặng khỏi Git.',
        en: 'Add `src/__init__.py`, write automated `pytest` tests for `utils.py` & `table_parser.py`, and configure `.gitignore` for heavy artifacts.',
      },
      targetFile: 'src/__init__.py',
      whyAndWhat: {
        why: {
          vi: 'Khi đẩy dự án lên GitHub, hai lỗi phổ biến nhất của sinh viên là: (1) Quên file `src/__init__.py` khiến `pytest` hoặc import giữa các thư mục báo `ModuleNotFoundError: No module named src`; (2) Commit nhầm hàng trăm MB file `data/raw_pdfs/`, `models/*.pt` lên Git khiến repo nặng nề và bị GitHub chặn giới hạn 100MB. Ngoài ra, viết vài unit test ngắn bằng `pytest` giúp đảm bảo khi sửa Regex ở `utils.py` không làm hỏng logic cũ.',
          en: 'Two common repo mistakes when publishing on GitHub are omitting `src/__init__.py` (breaking clean package imports / `pytest` discovery) and accidentally committing hundreds of megabytes of PDFs or `.pt` weights. Adding lightweight `pytest` unit tests also protects `clean_numeric_value` and `table_parser` from regressions.',
        },
        ifMissing: {
          vi: 'Push lên GitHub thất bại vì file lớn vượt quá 100MB, hoặc sửa một dòng Regex làm hỏng ngầm bảng số liệu mà không hay biết.',
          en: 'Git pushes fail on >100MB files, and silent Regex regressions break downstream ML features.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'src/__init__.py',
          params: 'Package marker + __all__',
          inputType: 'Python module',
          outputType: 'Package namespace',
          description: {
            vi: 'Đánh dấu `src/` là Python package chuẩn, cho phép chạy `pytest` và `python -m scripts.scrape_masvn` mượt mà.',
            en: 'Marks `src/` as an importable Python package for `app.py`, notebooks, and `pytest`.',
          },
        },
        {
          symbol: 'pytest.mark.parametrize',
          params: 'argnames, argvalues',
          inputType: 'list of test cases',
          outputType: 'Isolated test runs',
          description: {
            vi: 'Chạy 1 hàm test lặp qua nhiều ca biên (`"25,723"`, `"#N/A"`, `"(4.10)"`, `"- 2.3"`) gọn gàng trong 5 dòng.',
            en: 'Runs one test function across multiple edge cases (`"25,723"`, `"#N/A"`, `"(4.10)"`) concisely.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Tạo src/__init__.py sạch sẽ', en: 'Stage 1: Minimal src/__init__.py' },
          summary: {
            vi: 'Khai báo phiên bản và docstring package cho `src/`.',
            en: 'Declare package docstring and version inside `src/__init__.py`.',
          },
          code: `"""Core inference modules for MASVN Market Intelligence Engine."""

__version__ = "1.0.0"`,
          expectedNote: {
            vi: 'Từ giờ `from src.utils import clean_numeric_value` hoạt động ổn định từ mọi script.',
            en: 'Enables clean `from src.utils import clean_numeric_value` across scripts and tests.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Viết Unit Test kiểm tra hàm làm sạch số & phân loại bảng', en: 'Stage 2: pytest Suite for utils & table_parser' },
          summary: {
            vi: 'Kiểm tra các ca thực tế của bản tin MASVN bằng `assert` và `np.isnan`.',
            en: 'Verify real MASVN edge cases with `assert` and `np.isnan`.',
          },
          code: `import numpy as np
import pytest
from src.utils import clean_numeric_value
from src.table_parser import is_stock_metrics_table

@pytest.mark.parametrize("raw,expected", [
    ("25,723", 25723.0),
    ("+1.5%", 1.5),
    ("- 2.34", -2.34),
    ("(4.10)", -4.1),
])
def test_clean_numeric_valid(raw, expected):
    assert clean_numeric_value(raw) == pytest.approx(expected)

def test_clean_numeric_na():
    assert np.isnan(clean_numeric_value("#N/A"))`,
          expectedNote: {
            vi: 'Chạy bằng lệnh `pytest -v` chỉ mất 0.2 giây.',
            en: 'Runs in 0.2s via `pytest -v`.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Cấu hình .gitignore chuẩn cho dự án AI/ML', en: 'Stage 3: Production AI/ML .gitignore' },
          summary: {
            vi: 'Giữ lại code, `requirements.txt`, `README.md`, bỏ qua dữ liệu nặng và file cache.',
            en: 'Track code and docs while ignoring heavy PDFs, vector stores, and virtualenvs.',
          },
          code: `__pycache__/
*.pyc
.venv/
venv/
.env
data/raw_pdfs/*.pdf
data/yolo_raw_images/
data/yolo_dataset/
data/vector_store/*.index
data/vector_store/*.pkl
models/*.pt
models/*.pkl
logs/`,
          expectedNote: {
            vi: 'Gợi ý: tạo thêm các file `.gitkeep` rỗng trong `data/raw_pdfs/` và `models/` để giữ cấu trúc thư mục trên GitHub.',
            en: 'Tip: add empty `.gitkeep` files inside `data/raw_pdfs/` and `models/` to preserve folder structure.',
          },
        },
      ],
      builderTitle: {
        vi: 'Hoàn thiện Package: src/__init__.py & tests/test_pipeline.py',
        en: 'Package Finalization: src/__init__.py & tests/test_pipeline.py',
      },
      builderExplanation: {
        vi: 'File test tự động kiểm tra hàm làm sạch số và bộ định tuyến bảng, đảm bảo chất lượng code trước khi push GitHub.',
        en: 'Automated test suite verifying numeric cleaning and table routing before pushing to GitHub.',
      },
      builderCode: `import numpy as np
import pytest
from src.utils import clean_numeric_value
from src.table_parser import is_stock_metrics_table


@pytest.mark.parametrize("raw,expected", [
    ("25,723", 25723.0),
    ("+1.5%", 1.5),
    ("- 2.34", -2.34),
    ("(4.10)", -4.1),
])
def test_clean_numeric_valid(raw, expected):
    assert clean_numeric_value(raw) == pytest.approx(expected)


def test_clean_numeric_na():
    assert np.isnan(clean_numeric_value("#N/A"))


def test_stock_table_detection():
    stock_grid = [
        ["Mã", "Giá", "P/E", "P/B", "ROE"],
        ["FPT", "138.5", "21.4", "4.8", "26.2"],
        ["MBB", "25.4", "6.1", "1.2", "22.8"],
        ["ACB", "25.1", "6.8", "1.4", "21.5"],
    ]
    macro_grid = [["Chỉ số", "Điểm", "1D%"], ["VN-Index", "1,268", "+0.5%"]]
    assert is_stock_metrics_table(stock_grid) is True
    assert is_stock_metrics_table(macro_grid) is False`,
      highlightLines: [1, 31],
      lineWalkthrough: [
        {
          lines: 'L7-L14',
          snippet: '@pytest.mark.parametrize("raw,expected", [...])',
          explanation: {
            vi: 'Mỗi cặp `(raw, expected)` tự động chạy như một test case độc lập; một case sai không che mất các case còn lại.',
            en: 'Each `(raw, expected)` tuple runs as an independent test case.',
          },
        },
        {
          lines: 'L17-L18',
          snippet: 'assert np.isnan(clean_numeric_value("#N/A"))',
          explanation: {
            vi: 'Lưu ý trong Python `np.nan == np.nan` trả về `False`, nên bắt buộc phải kiểm tra bằng `np.isnan(...)`!',
            en: 'Because `np.nan == np.nan` evaluates to `False`, always assert missing values with `np.isnan(...)`.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện decorator chạy nhiều ca test của `pytest` và kiểm tra `NaN` chuẩn NumPy:',
          en: 'Complete `pytest` parametrization and the NumPy `NaN` assertion:',
        },
        codeTemplate: `@pytest.mark.___0___("raw,expected", [("25,723", 25723.0), ("+1.5%", 1.5)])
def test_clean_numeric_valid(raw, expected):
    assert clean_numeric_value(raw) == pytest.approx(expected)

def test_clean_numeric_na():
    assert np.___1___(clean_numeric_value("#N/A"))`,
        answers: ['parametrize', 'isnan'],
        hints: [
          { vi: 'Decorator pytest cho phép truyền danh sách cặp input/output', en: 'pytest decorator for data-driven test cases' },
          { vi: 'Hàm NumPy kiểm tra giá trị Not-a-Number', en: 'NumPy predicate checking Not-a-Number' },
        ],
        explanation: {
          vi: '`@pytest.mark.parametrize` gom nhiều test case gọn gàng; `np.isnan()` kiểm tra đúng chuẩn IEEE float NaN.',
          en: '`@pytest.mark.parametrize` keeps test cases DRY, and `np.isnan()` tests float NaN accurately.',
        },
      },
      quiz: {
        question: {
          vi: 'Tại sao câu lệnh `assert clean_numeric_value("#N/A") == np.nan` lại LUÔN BÁO LỖI (Fail) trong Python?',
          en: 'Why does `assert clean_numeric_value("#N/A") == np.nan` ALWAYS fail in Python?',
        },
        options: [
          {
            vi: 'Theo chuẩn số thực IEEE 754, mọi phép so sánh `NaN == NaN` đều trả về `False`; phải dùng `np.isnan(...)`.',
            en: 'Under IEEE 754 floating-point rules, `NaN == NaN` is always `False`; you must use `np.isnan(...)`.',
          },
          {
            vi: 'Vì `pytest` cấm dùng dấu `==` với số thập phân.',
            en: 'Because `pytest` forbids `==` on floats.',
          },
          {
            vi: 'Vì `np.nan` là một chuỗi ký tự.',
            en: 'Because `np.nan` is a string.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Chính xác! Đây là bẫy rất phổ biến khi mới viết unit test cho code Pandas/NumPy.',
          en: 'Correct! That IEEE 754 quirk trips up many Python developers writing data-pipeline tests.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'pytest -v tests/test_pipeline.py',
        terminalLines: [
          '============================= test session starts =============================',
          'tests/test_pipeline.py::test_clean_numeric_valid[25,723-25723.0] PASSED [ 16%]',
          'tests/test_pipeline.py::test_clean_numeric_valid[+1.5%-1.5]      PASSED [ 33%]',
          'tests/test_pipeline.py::test_clean_numeric_valid[- 2.34--2.34]   PASSED [ 50%]',
          'tests/test_pipeline.py::test_clean_numeric_valid[(4.10)--4.1]    PASSED [ 66%]',
          'tests/test_pipeline.py::test_clean_numeric_na                     PASSED [ 83%]',
          'tests/test_pipeline.py::test_stock_table_detection                PASSED [100%]',
          '============================== 6 passed in 0.21s ==============================',
        ],
      },
      checkpointItems: [
        {
          vi: 'Tạo đủ `src/__init__.py` và `.gitignore` trước khi đẩy code lên GitHub.',
          en: 'Add `src/__init__.py` and `.gitignore` before pushing to GitHub.',
        },
        {
          vi: 'Biết viết unit test cơ bản bằng `pytest` và `np.isnan()`.',
          en: 'Write clean `pytest` tests including `np.isnan()` checks.',
        },
      ],
      studyApis: ['src/__init__.py', 'pytest.mark.parametrize', 'np.isnan', '.gitignore'],
      completeFiles: [
        {
          path: 'src/__init__.py',
          language: 'python',
          code: `"""Core inference modules for MASVN Market Intelligence Engine."""\n\n__version__ = "1.0.0"\n`,
        },
        {
          path: 'tests/test_pipeline.py',
          language: 'python',
          code: `import numpy as np\nimport pytest\nfrom src.utils import clean_numeric_value\nfrom src.table_parser import is_stock_metrics_table\n\n\n@pytest.mark.parametrize("raw,expected", [\n    ("25,723", 25723.0),\n    ("+1.5%", 1.5),\n    ("- 2.34", -2.34),\n    ("(4.10)", -4.1),\n])\ndef test_clean_numeric_valid(raw, expected):\n    assert clean_numeric_value(raw) == pytest.approx(expected)\n\n\ndef test_clean_numeric_na():\n    assert np.isnan(clean_numeric_value("#N/A"))\n\n\ndef test_stock_table_detection():\n    stock_grid = [\n        ["Mã", "Giá", "P/E", "P/B", "ROE"],\n        ["FPT", "138.5", "21.4", "4.8", "26.2"],\n        ["MBB", "25.4", "6.1", "1.2", "22.8"],\n        ["ACB", "25.1", "6.8", "1.4", "21.5"],\n    ]\n    macro_grid = [["Chỉ số", "Điểm", "1D%"], ["VN-Index", "1,268", "+0.5%"]]\n    assert is_stock_metrics_table(stock_grid) is True\n    assert is_stock_metrics_table(macro_grid) is False\n`,
        },
      ],
    },
  ],
};
