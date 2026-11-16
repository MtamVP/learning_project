import { ModuleSpec } from '../types';

export const UTILS_PY_PARTIAL = `import gc
import re
import numpy as np


def clean_numeric_value(raw_val) -> float:
    """Làm sạch chuỗi số chứng khoán: '25,723', '+1.5%', '- 2.3', '#N/A' -> float hoặc np.nan."""
    if raw_val is None:
        return np.nan

    text = str(raw_val).strip()
    if not text or text.upper() in {"#N/A", "N/A", "NA", "-", "--", "NULL"}:
        return np.nan

    # Chuẩn hóa dấu trừ bị tách khoảng trắng ('- 2.3' -> '-2.3') và bỏ dấu phẩy/phần trăm
    text = text.replace(",", "").replace("%", "")
    text = re.sub(r"\\s+", "", text)
    # Xử lý trường hợp số âm viết dạng '(1.25)' trong bảng tài chính
    if text.startswith("(") and text.endswith(")"):
        text = "-" + text[1:-1]

    match = re.search(r"-?\\d+(?:\\.\\d+)?", text)
    if not match:
        return np.nan
    return float(match.group(0))


def release_gpu_memory():
    """Giải phóng RAM Python & VRAM PyTorch sau khi chạy xong YOLO/trích xuất."""
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass`;

export const EXTRACTOR_PY_COMPLETE = `from pathlib import Path
import fitz  # PyMuPDF
import numpy as np
from PIL import Image
from ultralytics import YOLO


class HybridDocumentExtractor:
    """Bóc tách lai: YOLO định vị vùng + PyMuPDF (PDF số) hoặc Lazy PaddleOCR (Scan/Ảnh)."""

    CLASS_NAMES = {0: "Table", 1: "Text", 2: "Figure"}

    def __init__(
        self,
        yolo_weights: str = "models/yolo_masvn_layout.pt",
        conf: float = 0.4,
        dpi: int = 150,
    ):
        self.yolo = YOLO(yolo_weights)
        self.conf = conf
        self.dpi = dpi
        self._ocr_engine = None  # Lazy loading: chỉ nạp PaddleOCR khi thực sự cần

    def _get_ocr(self):
        if self._ocr_engine is None:
            from paddleocr import PaddleOCR

            # Ép chạy CPU (use_gpu=False) để nhường trọn 8GB VRAM cho YOLO & Qwen2.5:7b
            self._ocr_engine = PaddleOCR(
                use_angle_cls=False,
                lang="vi",
                show_log=False,
                use_gpu=False,
            )
        return self._ocr_engine

    @staticmethod
    def _scale_pdf_word_to_image(word_tuple, scale_x: float, scale_y: float):
        x0, y0, x1, y1, text, *_ = word_tuple
        return (x0 * scale_x, y0 * scale_y, x1 * scale_x, y1 * scale_y, text)

    @staticmethod
    def _words_inside_bbox(words, bbox):
        bx0, by0, bx1, by1 = bbox
        matched = []
        for wx0, wy0, wx1, wy1, text in words:
            cx = (wx0 + wx1) / 2.0
            cy = (wy0 + wy1) / 2.0
            if bx0 <= cx <= bx1 and by0 <= cy <= by1:
                matched.append((wx0, wy0, wx1, wy1, text))
        return matched

    def _ocr_crop_region(self, pil_img: Image.Image, bbox):
        bx0, by0, bx1, by1 = [int(v) for v in bbox]
        cropped = pil_img.crop((bx0, by0, bx1, by1))
        ocr = self._get_ocr()
        result = ocr.ocr(np.array(cropped), cls=False)
        words = []
        if not result or not result[0]:
            return words

        for line in result[0]:
            box_pts, (text, _score) = line
            lx0 = min(pt[0] for pt in box_pts) + bx0
            ly0 = min(pt[1] for pt in box_pts) + by0
            lx1 = max(pt[0] for pt in box_pts) + bx0
            ly1 = max(pt[1] for pt in box_pts) + by0
            words.append((lx0, ly0, lx1, ly1, text.strip()))
        return words

    def extract_page(self, page: fitz.Page, page_num: int):
        pix = page.get_pixmap(dpi=self.dpi)
        pil_img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # Kiểm tra nhanh xem trang PDF có lớp văn bản gốc không
        raw_words = page.get_text("words")
        is_digital = len(raw_words) >= 15

        scale_x = pix.width / page.rect.width
        scale_y = pix.height / page.rect.height
        scaled_words = [
            self._scale_pdf_word_to_image(w, scale_x, scale_y) for w in raw_words
        ]

        results = self.yolo.predict(source=pil_img, conf=self.conf, verbose=False)
        boxes = results[0].boxes
        regions = []
        if boxes is None or len(boxes) == 0:
            return regions

        xyxy = boxes.xyxy.cpu().numpy()
        classes = boxes.cls.cpu().numpy().astype(int)

        for bbox, cls_id in zip(xyxy, classes):
            label = self.CLASS_NAMES.get(cls_id, "Unknown")
            if label == "Figure":
                continue  # Loại bỏ biểu đồ tránh làm nhiễu văn bản & bảng

            bbox_list = [float(v) for v in bbox]
            if is_digital:
                region_words = self._words_inside_bbox(scaled_words, bbox_list)
            else:
                region_words = self._ocr_crop_region(pil_img, bbox_list)

            regions.append({
                "page": page_num,
                "label": label,
                "bbox": bbox_list,
                "mode": "pymupdf" if is_digital else "paddleocr",
                "words": region_words,
            })

        regions.sort(key=lambda r: r["bbox"][1])
        return regions

    def extract_pdf(self, pdf_path: Path):
        doc = fitz.open(pdf_path)
        all_regions = []
        for idx in range(len(doc)):
            all_regions.extend(self.extract_page(doc[idx], page_num=idx + 1))
        doc.close()
        return all_regions`;

export const TABLE_PARSER_PY_COMPLETE = `import pandas as pd
from src.utils import clean_numeric_value

STOCK_REQUIRED_KEYWORDS = {"MÃ", "GIÁ", "P/E", "P/B", "ROE"}


def cluster_words_to_rows(words, y_tolerance: float = 5.0):
    """Gom các từ rời rạc theo trục dọc y (sai số <= y_tolerance px), rồi sắp trái->phải theo x."""
    if not words:
        return []

    sorted_words = sorted(words, key=lambda w: ((w[1] + w[3]) / 2.0, w[0]))
    rows = []
    current_row = [sorted_words[0]]
    current_y = (sorted_words[0][1] + sorted_words[0][3]) / 2.0

    for word in sorted_words[1:]:
        wy = (word[1] + word[3]) / 2.0
        if abs(wy - current_y) <= y_tolerance:
            current_row.append(word)
        else:
            current_row.sort(key=lambda w: w[0])
            rows.append(current_row)
            current_row = [word]
            current_y = wy

    if current_row:
        current_row.sort(key=lambda w: w[0])
        rows.append(current_row)
    return rows


def rows_to_grid(rows, x_gap_threshold: float = 14.0):
    """Ghép các từ đứng gần nhau trong cùng ô thành chuỗi hoàn chỉnh, tách cột khi khoảng trống > threshold."""
    grid = []
    for row in rows:
        cells = []
        buf = [row[0][4]]
        prev_x1 = row[0][2]
        for wx0, _wy0, wx1, _wy1, text in row[1:]:
            if wx0 - prev_x1 <= x_gap_threshold:
                buf.append(text)
            else:
                cells.append(" ".join(buf))
                buf = [text]
            prev_x1 = wx1
        cells.append(" ".join(buf))
        grid.append(cells)
    return grid


def is_stock_metrics_table(grid) -> bool:
    """Phân biệt bảng cổ phiếu lớn (Trang 4-6, 11) vs bảng vĩ mô nhỏ (Trang 1-3)."""
    if len(grid) < 4:
        return False
    header_text = " ".join(" ".join(r) for r in grid[:2]).upper()
    hits = sum(1 for kw in STOCK_REQUIRED_KEYWORDS if kw in header_text)
    return hits >= 3


def serialize_macro_table_to_text(grid, report_date: str, page_num: int) -> list[str]:
    """Table-to-Text Serialization: biến bảng vĩ mô nhỏ thành câu tự nhiên cho RAG."""
    if len(grid) < 2:
        return []
    headers = grid[0]
    sentences = []
    for row in grid[1:]:
        if len(row) < 2:
            continue
        item_name = row[0]
        pairs = []
        for col_idx in range(1, min(len(headers), len(row))):
            pairs.append(f"{headers[col_idx]}: {row[col_idx]}")
        detail = ", ".join(pairs)
        sentences.append(
            f"[Ngày {report_date} - Trang {page_num}] Chỉ số/Hạng mục {item_name} ghi nhận {detail}."
        )
    return sentences


def grid_to_stock_dataframe(grid, report_date: str) -> pd.DataFrame:
    """Chuẩn hóa bảng cổ phiếu lớn thành DataFrame số sạch đưa vào LightGBM."""
    if len(grid) < 2:
        return pd.DataFrame()

    raw_cols = [c.strip() for c in grid[0]]
    records = []
    for row in grid[1:]:
        if len(row) < len(raw_cols):
            continue
        record = {"report_date": report_date}
        for col_name, val in zip(raw_cols, row):
            record[col_name] = val
        records.append(record)

    df = pd.DataFrame(records)
    numeric_candidates = ["Giá", "P/E", "P/B", "ROE", "KLTB 20N", "GTGD", "% 1D", "% YTD"]
    for col in numeric_candidates:
        if col in df.columns:
            df[col] = df[col].apply(clean_numeric_value)
    return df`;

export const NOTEBOOK_03_CODE = `import json
from pathlib import Path
import pandas as pd
from src.extractor import HybridDocumentExtractor
from src.table_parser import (
    cluster_words_to_rows,
    rows_to_grid,
    is_stock_metrics_table,
    grid_to_stock_dataframe,
    serialize_macro_table_to_text,
)
from src.utils import release_gpu_memory

BASE_DIR = Path("..").resolve()
RAW_DIR = BASE_DIR / "data" / "raw_pdfs"
OUT_DIR = BASE_DIR / "data" / "processed"
OUT_DIR.mkdir(parents=True, exist_ok=True)

extractor = HybridDocumentExtractor(yolo_weights=str(BASE_DIR / "models" / "yolo_masvn_layout.pt"))

all_stock_frames = []
knowledge_docs = []

for pdf_path in sorted(RAW_DIR.glob("report_*.pdf")):
    report_date = pdf_path.stem.replace("report_", "")
    regions = extractor.extract_pdf(pdf_path)

    for reg in regions:
        if reg["label"] == "Text":
            text_content = " ".join(w[4] for w in reg["words"]).strip()
            if len(text_content) > 30:
                knowledge_docs.append({
                    "date": report_date,
                    "page": reg["page"],
                    "category": "narrative_text",
                    "text": text_content,
                })
        elif reg["label"] == "Table":
            rows = cluster_words_to_rows(reg["words"], y_tolerance=5.0)
            grid = rows_to_grid(rows, x_gap_threshold=14.0)
            if is_stock_metrics_table(grid):
                df_part = grid_to_stock_dataframe(grid, report_date)
                if not df_part.empty:
                    all_stock_frames.append(df_part)
            else:
                for sent in serialize_macro_table_to_text(grid, report_date, reg["page"]):
                    knowledge_docs.append({
                        "date": report_date,
                        "page": reg["page"],
                        "category": "macro_table",
                        "text": sent,
                    })

release_gpu_memory()

final_df = pd.concat(all_stock_frames, ignore_index=True) if all_stock_frames else pd.DataFrame()
final_df.to_csv(OUT_DIR / "stock_metrics.csv", index=False, encoding="utf-8-sig")

with open(OUT_DIR / "market_knowledge.json", "w", encoding="utf-8") as f:
    json.dump(knowledge_docs, f, ensure_ascii=False, indent=2)

print(f"Saved stock_metrics.csv: {len(final_df)} rows | market_knowledge.json: {len(knowledge_docs)} chunks")`;

export const module3: ModuleSpec = {
  id: 'mod-3',
  number: 3,
  title: {
    vi: 'Học phần 3: Bóc tách Lai & Khôi phục Cấu trúc Bảng',
    en: 'Module 3: Hybrid Parsing & Table Reconstruction',
  },
  summary: {
    vi: 'Kết hợp nhánh Digital PDF siêu tốc (PyMuPDF ~5ms/trang) với nhánh Scan/Ảnh (Lazy PaddleOCR CPU), gom hàng/cột theo tọa độ không gian và phân luồng ML vs RAG.',
    en: 'Combine fast PyMuPDF extraction (~5ms/page) with lazy CPU PaddleOCR fallback, cluster words into rows/columns, and route tables to ML or RAG.',
  },
  stack: ['PyMuPDF', 'PaddleOCR (CPU)', 'Pillow', 'pandas', 're'],
  steps: [
    {
      id: '3.1',
      moduleId: 'mod-3',
      tier: 1,
      title: {
        vi: 'Bước 3.1: Nhánh Digital PDF — Trích xuất siêu tốc với get_text("words")',
        en: 'Step 3.1: Digital PDF Branch — Fast Extraction via get_text("words")',
      },
      subtitle: {
        vi: 'Hiểu cấu trúc 8-tuple của PyMuPDF, quy đổi hệ tọa độ PDF sang Pixel và kiểm tra tâm từ `(cx, cy)` nằm trong Bounding Box.',
        en: 'Understand PyMuPDF 8-tuples, scale PDF points to image pixels, and test word-center `(cx, cy)` containment inside YOLO boxes.',
      },
      targetFile: 'src/extractor.py',
      whyAndWhat: {
        why: {
          vi: '95% bản tin PDF của MASVN là **Digital PDF** (có sẵn lớp chữ vector bên trong). Nếu đem toàn bộ 50 file (~450 trang) chạy OCR, máy sẽ mất hàng chục phút và đôi lúc nhận nhầm số `6` thành `8`. Dùng `page.get_text("words")` đọc trực tiếp tọa độ và chữ gốc chính xác **100%** với tốc độ chỉ **~5ms/trang**! Sau đó ta kiểm tra tâm `(cx, cy)` của mỗi từ có nằm trong khung YOLO `(bx0, by0, bx1, by1)` hay không.',
          en: '95% of MASVN reports are native Digital PDFs containing embedded vector text. Running OCR across ~450 pages wastes minutes and risks misreading digits (`6` vs `8`). `page.get_text("words")` extracts exact text + coordinates in **~5ms/page** with 100% character fidelity, and checking whether each word’s center `(cx, cy)` falls inside a YOLO box filters regions cleanly.',
        },
        ifMissing: {
          vi: 'Nếu quên nhân hệ số tỉ lệ `pix.width / page.rect.width`, tọa độ PyMuPDF (tính bằng 72 DPI points) sẽ lệch hoàn toàn so với tọa độ YOLO (tính bằng 150 DPI pixels), làm mất sạch dữ liệu bên trong khung bảng.',
          en: 'Forgetting to scale PyMuPDF 72-DPI points to 150-DPI image pixels misaligns every bounding box and drops table cells.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'page.get_text("words")',
          params: 'option="words"',
          inputType: 'fitz.Page',
          outputType: 'list[tuple(8)]',
          description: {
            vi: 'Trả về danh sách các tuple `(x0, y0, x1, y1, "word", block_no, line_no, word_no)` theo đơn vị PDF points (72 DPI).',
            en: 'Returns 8-tuples `(x0, y0, x1, y1, "word", block_no, line_no, word_no)` in 72-DPI PDF points.',
          },
        },
        {
          symbol: 'scale_x = pix.width / page.rect.width',
          params: 'Coordinate alignment',
          inputType: 'float, float',
          outputType: 'float (~2.083 at 150 DPI)',
          description: {
            vi: 'Tỉ lệ phóng đổi tọa độ 72 DPI sang tọa độ ảnh 150 DPI nơi YOLO đang chạy dự đoán.',
            en: 'Scale factor (~2.083 at 150 DPI) mapping PDF point space to YOLO pixel space.',
          },
        },
        {
          symbol: '(cx, cy) inside bbox',
          params: 'bx0 <= cx <= bx1 and by0 <= cy <= by1',
          inputType: 'word box, YOLO box',
          outputType: 'bool',
          description: {
            vi: 'Dùng tâm của từ thay vì toàn bộ 4 góc giúp tránh mất từ nếu đường viền YOLO cắt sát chữ 1–2 pixel.',
            en: 'Testing the word center `(cx, cy)` prevents losing words when a YOLO box clips 1–2 edge pixels.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Xem cấu trúc 8 phần tử của get_text("words")', en: 'Stage 1: Inspect PyMuPDF 8-Tuple Output' },
          summary: {
            vi: 'Đọc 3 từ đầu tiên của một trang PDF để nắm vị trí `x0, y0, x1, y1, text`.',
            en: 'Inspect the first 3 word tuples to see `x0, y0, x1, y1, text` positions.',
          },
          code: `import fitz

doc = fitz.open("data/raw_pdfs/report_20261113.pdf")
words = doc[3].get_text("words")  # Trang 4 (index 3)
for w in words[:3]:
    print(f"rect=({w[0]:.1f}, {w[1]:.1f}, {w[2]:.1f}, {w[3]:.1f}) text={w[4]!r}")`,
          expectedNote: {
            vi: 'Nếu `len(words) == 0` thì đó là PDF dạng ảnh scan -> sang Bước 3.2 dùng PaddleOCR.',
            en: 'If `len(words) == 0`, the page is scanned imagery -> route to PaddleOCR in Step 3.2.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Quy đổi hệ tọa độ 72 DPI -> 150 DPI & Giao nhau hình học', en: 'Stage 2: DPI Scaling & Center Containment' },
          summary: {
            vi: 'Đưa cả PyMuPDF lẫn YOLO về cùng hệ quy chiếu pixel của ảnh `pix`.',
            en: 'Align PyMuPDF points and YOLO pixel coordinates before testing center containment.',
          },
          code: `scale_x = pix.width / page.rect.width
scale_y = pix.height / page.rect.height

def words_inside_bbox(raw_words, bbox):
    bx0, by0, bx1, by1 = bbox
    inside = []
    for x0, y0, x1, y1, text, *_ in raw_words:
        wx0, wy0, wx1, wy1 = x0 * scale_x, y0 * scale_y, x1 * scale_x, y1 * scale_y
        cx, cy = (wx0 + wx1) / 2.0, (wy0 + wy1) / 2.0
        if bx0 <= cx <= bx1 and by0 <= cy <= by1:
            inside.append((wx0, wy0, wx1, wy1, text))
    return inside`,
          expectedNote: {
            vi: 'Nhanh ~5ms/trang và đạt độ chính xác ký tự tuyệt đối 100%.',
            en: 'Executes in ~5ms/page with 100% character accuracy.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Tách thành các helper trong src/extractor.py', en: 'Stage 3: Extractor Helper Methods' },
          summary: {
            vi: 'Tổ chức sạch thành `_scale_pdf_word_to_image` và `_words_inside_bbox` bên trong `HybridDocumentExtractor`.',
            en: 'Refactor into clean static helpers `_scale_pdf_word_to_image` and `_words_inside_bbox`.',
          },
          code: EXTRACTOR_PY_COMPLETE.split('    def _ocr_crop_region')[0],
          expectedNote: {
            vi: 'Bước 3.2 ngay tiếp theo sẽ thêm nhánh OCR dự phòng vào ngay lớp này.',
            en: 'Step 3.2 adds the lazy-loaded PaddleOCR fallback branch directly to this class.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 1/5: Nhánh Digital PDF trong src/extractor.py',
        en: 'Piece 1/5: Digital PDF Branch in src/extractor.py',
      },
      builderExplanation: {
        vi: 'Khởi tạo khung lớp `HybridDocumentExtractor` với phần quy đổi tỉ lệ DPI và kiểm tra tâm từ `(cx, cy)` nằm trong khung bounding box YOLO.',
        en: 'Sets up `HybridDocumentExtractor` with DPI coordinate scaling and word-center containment filtering.',
      },
      builderCode: EXTRACTOR_PY_COMPLETE.split('    def _ocr_crop_region')[0],
      highlightLines: [36, 51],
      lineWalkthrough: [
        {
          lines: 'L37-L39',
          snippet: 'def _scale_pdf_word_to_image(word_tuple, scale_x: float, scale_y: float):\n    x0, y0, x1, y1, text, *_ = word_tuple\n    return (x0 * scale_x, y0 * scale_y, x1 * scale_x, y1 * scale_y, text)',
          explanation: {
            vi: 'Unpack 8 phần tử của PyMuPDF, bỏ 3 số block/line/word bằng `*_` và nhân tọa độ với tỉ lệ DPI.',
            en: 'Unpacks PyMuPDF 8-tuples, ignores trailing indices with `*_`, and scales coords to pixel space.',
          },
        },
        {
          lines: 'L42-L50',
          snippet: 'cx = (wx0 + wx1) / 2.0\ncy = (wy0 + wy1) / 2.0\nif bx0 <= cx <= bx1 and by0 <= cy <= by1:\n    matched.append(...)',
          explanation: {
            vi: 'Chỉ cần tâm của từ rơi vào trong khung YOLO là giữ lại từ đó.',
            en: 'Includes the word whenever its geometric center falls inside the YOLO box.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện phép tính tâm `(cx, cy)` của một từ và kiểm tra nó có nằm trong `(bx0, by0, bx1, by1)`:',
          en: 'Complete the word center `(cx, cy)` calculation and bounding box check:',
        },
        codeTemplate: `cx = (wx0 + wx1) / 2.0
cy = (wy0 + wy1) / 2.0
if bx0 <= ___0___ <= bx1 and by0 <= ___1___ <= by1:
    matched.append((wx0, wy0, wx1, wy1, text))`,
        answers: ['cx', 'cy'],
        hints: [
          { vi: 'Tọa độ ngang tâm của từ', en: 'Horizontal center coordinate of the word' },
          { vi: 'Tọa độ dọc tâm của từ', en: 'Vertical center coordinate of the word' },
        ],
        explanation: {
          vi: 'So sánh `cx` với `[bx0, bx1]` và `cy` với `[by0, by1]` xác định từ có thuộc vùng Table/Text đó không.',
          en: 'Comparing `cx` against `[bx0, bx1]` and `cy` against `[by0, by1]` assigns each word to its YOLO region.',
        },
      },
      quiz: {
        question: {
          vi: 'Vì sao phải nhân tọa độ của `page.get_text("words")` với `pix.width / page.rect.width` trước khi so sánh với khung YOLO?',
          en: 'Why multiply `page.get_text("words")` coordinates by `pix.width / page.rect.width` before comparing with YOLO boxes?',
        },
        options: [
          {
            vi: 'Vì PyMuPDF trả tọa độ theo hệ 72 DPI points, còn YOLO suy luận trên ảnh kết xuất 150 DPI pixels.',
            en: 'PyMuPDF returns coordinates in 72-DPI PDF points, whereas YOLO detects on 150-DPI rasterized pixels.',
          },
          {
            vi: 'Vì PyMuPDF tính tọa độ từ góc dưới bên trái thay vì trên bên trái.',
            en: 'Because PyMuPDF uses bottom-left origin.',
          },
          {
            vi: 'Để làm tròn tọa độ thành số nguyên.',
            en: 'To round coordinates to integers.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Chính xác! Nếu không nhân hệ số ~2.083, mọi hộp YOLO sẽ bị lệch gấp đôi so với chữ của PyMuPDF.',
          en: 'Exactly! Without the ~2.083 scale factor, YOLO pixel boxes and PDF point boxes live in different coordinate spaces.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'extract_page(page=4) [Digital PDF fast path]',
        terminalLines: [
          '[PyMuPDF] get_text("words") returned 612 words in 4.2 ms (is_digital=True)',
          '[YOLO] Detected 2 regions: Text (0.95), Table (0.97)',
          '[Geometry] Matched 548 words inside Table bbox [58.0, 148.6, 1184.0, 1620.8]',
          '[Filter] Ignored 0 Figure regions',
          '[OK] Page 4 extracted in 15.6 ms (PaddleOCR NOT loaded — 0 MB extra RAM)',
        ],
      },
      checkpointItems: [
        {
          vi: 'Nắm được cấu trúc 8-tuple của `page.get_text("words")`.',
          en: 'Understand the 8-tuple structure returned by `page.get_text("words")`.',
        },
        {
          vi: 'Biết cách đồng bộ hệ tọa độ PDF 72 DPI sang ảnh 150 DPI và lọc tâm từ.',
          en: 'Know how to align 72-DPI PDF coords to 150-DPI image coords and test word centers.',
        },
      ],
      studyApis: ['page.get_text("words")', 'page.rect', 'center containment'],
    },
    {
      id: '3.2',
      moduleId: 'mod-3',
      tier: 2,
      title: {
        vi: 'Bước 3.2: Nhánh Scan/Ảnh — Lazy Loading & PaddleOCR (CPU)',
        en: 'Step 3.2: Scanned PDF / Image Branch — Lazy Loading & PaddleOCR (CPU)',
      },
      subtitle: {
        vi: 'Chỉ nạp `PaddleOCR` khi gặp trang ảnh, cắt vùng `PIL.Image.crop()` và quy đổi tọa độ cục bộ về toàn trang.',
        en: 'Load `PaddleOCR` lazily on demand, crop regions with `PIL.Image.crop()`, and offset local box coords back to page space.',
      },
      targetFile: 'src/extractor.py',
      whyAndWhat: {
        why: {
          vi: 'Nếu người dùng upload lên Streamlit một ảnh chụp màn hình bảng cổ phiếu hoặc một file PDF bản scan, `page.get_text("words")` sẽ trả về rỗng. Ta kích hoạt nhánh 2: dùng **Lazy Loading** khởi tạo `PaddleOCR(use_angle_cls=False, lang="vi", show_log=False, use_gpu=False)` (ép chạy CPU trên 24GB RAM để bảo vệ 8GB VRAM), cắt từng vùng `Table`/`Text` rồi cộng lại góc `(+bx0, +by0)` để đồng bộ đầu ra với nhánh PyMuPDF.',
          en: 'When a user uploads a screenshot or scanned PDF, `get_text("words")` returns empty. Branch 2 activates **Lazy Loading** for `PaddleOCR(..., use_gpu=False)` (running on 24GB CPU RAM to preserve 8GB GPU VRAM), crops each `Table`/`Text` region, and offsets local OCR coordinates by `(+bx0, +by0)` so both branches emit identical output schemas.',
        },
        ifMissing: {
          vi: 'Khởi tạo `PaddleOCR` ngay trong `__init__` làm web Streamlit khởi động chậm 10 giây dù file PDF là digital; hoặc bật `use_gpu=True` sẽ chiếm mất ~2GB VRAM làm Qwen2.5:7b bị tràn VRAM.',
          en: 'Eagerly loading `PaddleOCR` in `__init__` slows startup on digital PDFs, while `use_gpu=True` steals ~2GB VRAM needed by Qwen2.5:7b.',
        },
      },
      apiAnatomy: [
        {
          symbol: '_get_ocr() (Lazy Loading)',
          params: 'if self._ocr_engine is None:',
          inputType: 'None',
          outputType: 'PaddleOCR',
          description: {
            vi: 'Chỉ import và tải model PaddleOCR vào RAM ở lần đầu tiên thực sự gặp trang scan/ảnh.',
            en: 'Defers importing and loading PaddleOCR weights until the first scanned page or image is encountered.',
          },
        },
        {
          symbol: 'pil_img.crop((bx0, by0, bx1, by1))',
          params: '4-tuple box (int)',
          inputType: 'PIL.Image',
          outputType: 'PIL.Image',
          description: {
            vi: 'Cắt riêng phần bảng hoặc đoạn văn bản ra khỏi trang để OCR không phải quét vùng trắng hay biểu đồ.',
            en: 'Crops strictly the detected Table/Text region so OCR skips whitespace and charts.',
          },
        },
        {
          symbol: 'lx0 = min(pt[0] for pt in box_pts) + bx0',
          params: 'Local-to-global offset',
          inputType: 'list[4 points]',
          outputType: 'float',
          description: {
            vi: 'Cộng bù tọa độ góc cắt `(bx0, by0)` để quy đổi tọa độ cục bộ trong ảnh cắt về lại tọa độ chuẩn của cả trang.',
            en: 'Adds crop origin `(bx0, by0)` back to local OCR polygons so downstream table clustering works identically.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Kỹ thuật Lazy Loading tiết kiệm RAM', en: 'Stage 1: Lazy Loading Pattern' },
          summary: {
            vi: 'Biến `self._ocr_engine = None` giúp phần lớn phiên chạy PDF số không bao giờ tốn RAM cho PaddleOCR.',
            en: 'Keeping `self._ocr_engine = None` means digital-PDF sessions consume zero OCR memory.',
          },
          code: `class DemoExtractor:
    def __init__(self):
        self._ocr_engine = None

    def _get_ocr(self):
        if self._ocr_engine is None:
            print("First scanned page seen -> Loading PaddleOCR on CPU...")
            from paddleocr import PaddleOCR
            self._ocr_engine = PaddleOCR(use_angle_cls=False, lang="vi", show_log=False, use_gpu=False)
        return self._ocr_engine`,
          expectedNote: {
            vi: 'Tham số `use_gpu=False` cực kỳ quan trọng trong chiến lược phân bổ phần cứng RTX 5060 8GB.',
            en: '`use_gpu=False` is vital for the RTX 5060 8GB VRAM budget.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Cắt ảnh & Quy đổi tọa độ cục bộ về toàn trang', en: 'Stage 2: Crop & Local-to-Global Offset' },
          summary: {
            vi: 'PaddleOCR trả tọa độ tính từ góc `(0, 0)` của ảnh cắt; cộng thêm `(bx0, by0)` để đưa về hệ tọa độ trang.',
            en: 'PaddleOCR returns coords relative to the cropped image `(0, 0)`; add `(bx0, by0)` to restore page coordinates.',
          },
          code: `cropped = pil_img.crop((bx0, by0, bx1, by1))
result = ocr.ocr(np.array(cropped), cls=False)
for box_pts, (text, _score) in result[0]:
    lx0 = min(pt[0] for pt in box_pts) + bx0
    ly0 = min(pt[1] for pt in box_pts) + by0
    lx1 = max(pt[0] for pt in box_pts) + bx0
    ly1 = max(pt[1] for pt in box_pts) + by0`,
          expectedNote: {
            vi: 'Cả nhánh Digital lẫn Scan đều trả về tuple `(x0, y0, x1, y1, text)` y hệt nhau!',
            en: 'Both Digital and OCR branches now emit the exact same `(x0, y0, x1, y1, text)` tuple format!',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Hoàn chỉnh toàn bộ file src/extractor.py', en: 'Stage 3: Complete src/extractor.py' },
          summary: {
            vi: 'Tự động chọn nhánh `pymupdf` nếu `len(raw_words) >= 15`, ngược lại kích hoạt `paddleocr`.',
            en: 'Automatically pick `pymupdf` when `len(raw_words) >= 15`, otherwise run `paddleocr`.',
          },
          code: EXTRACTOR_PY_COMPLETE,
          expectedNote: {
            vi: 'File `src/extractor.py` đã hoàn thiện 100% và sẵn sàng chạy.',
            en: '`src/extractor.py` is now complete and ready for batch or interactive calls.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 2/5: Hoàn chỉnh file src/extractor.py',
        en: 'Piece 2/5: Complete src/extractor.py',
      },
      builderExplanation: {
        vi: 'Ghép nhánh `_ocr_crop_region` và hàm `extract_page` tự động chuyển đổi giữa PyMuPDF và PaddleOCR dựa trên số lượng chữ gốc trên trang.',
        en: 'Completes `src/extractor.py` with `_ocr_crop_region` and `extract_page` auto-switching between PyMuPDF and PaddleOCR.',
      },
      builderCode: EXTRACTOR_PY_COMPLETE,
      highlightLines: [52, 118],
      lineWalkthrough: [
        {
          lines: 'L52-L67',
          snippet: 'cropped = pil_img.crop((bx0, by0, bx1, by1))\nresult = ocr.ocr(np.array(cropped), cls=False)\n...\nlx0 = min(pt[0] for pt in box_pts) + bx0',
          explanation: {
            vi: 'Cắt đúng vùng bảng rồi cộng bù `(bx0, by0)` để `table_parser.py` phía sau không cần phân biệt nguồn từ PyMuPDF hay OCR.',
            en: 'Crops the region and adds `(bx0, by0)` back so downstream `table_parser.py` stays completely source-agnostic.',
          },
        },
        {
          lines: 'L73-L75',
          snippet: 'raw_words = page.get_text("words")\nis_digital = len(raw_words) >= 15',
          explanation: {
            vi: 'Ngưỡng `>= 15` từ giúp xử lý cả trường hợp PDF scan có dính vài chữ watermark ẩn vẫn được đẩy sang OCR.',
            en: 'Requiring `>= 15` words handles scanned PDFs that contain a stray watermark header, safely routing them to OCR.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện cấu hình Lazy PaddleOCR chạy trên CPU và phép cộng bù tọa độ góc cắt `bx0`:',
          en: 'Complete the CPU PaddleOCR config and local-to-global `bx0` coordinate offset:',
        },
        codeTemplate: `self._ocr_engine = PaddleOCR(
    use_angle_cls=False, lang="vi", show_log=False, use_gpu=___0___
)
...
lx0 = min(pt[0] for pt in box_pts) + ___1___`,
        answers: ['False', 'bx0'],
        hints: [
          { vi: 'Tắt GPU cho PaddleOCR để chừa VRAM cho LLM', en: 'Boolean disabling GPU so VRAM is reserved for the LLM' },
          { vi: 'Tọa độ X góc trái-trên của vùng ảnh cắt', en: 'Top-left X coordinate of the cropped region' },
        ],
        explanation: {
          vi: '`use_gpu=False` chạy PaddleOCR trên CPU 24GB RAM; `+ bx0` quy đổi tọa độ cục bộ về toàn trang.',
          en: '`use_gpu=False` keeps OCR on CPU RAM, and `+ bx0` maps local crop X back to full-page coordinates.',
        },
      },
      quiz: {
        question: {
          vi: 'Vì sao lớp `HybridDocumentExtractor` không khởi tạo `PaddleOCR(...)` ngay trong `__init__` mà dùng `_get_ocr()` (Lazy Loading)?',
          en: 'Why does `HybridDocumentExtractor` defer initializing `PaddleOCR(...)` via `_get_ocr()` instead of loading it in `__init__`?',
        },
        options: [
          {
            vi: 'Để khi xử lý 95% file PDF Digital (dùng PyMuPDF), hệ thống không mất thời gian khởi tạo và không tốn RAM cho model OCR.',
            en: 'So that the 95% digital PDFs handled by PyMuPDF pay zero startup latency or RAM overhead for OCR weights.',
          },
          {
            vi: 'Vì PaddleOCR không cho phép khởi tạo trong `__init__`.',
            en: 'Because Python forbids initializing PaddleOCR inside `__init__`.',
          },
          {
            vi: 'Để tăng độ phân giải DPI của ảnh cắt.',
            en: 'To increase crop DPI resolution.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Lazy Loading giúp tối ưu cả thời gian khởi động Streamlit lẫn bộ nhớ khi hầu hết file đầu vào là Digital PDF.',
          en: 'Correct! Lazy loading keeps startup snappy and memory footprint minimal whenever digital PDFs dominate.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'extract_page(page=1) [Scanned image fallback]',
        terminalLines: [
          '[PyMuPDF] get_text("words") returned 0 words -> is_digital=False',
          '[LazyLoad] Initializing PaddleOCR(lang="vi", use_gpu=False) on CPU...',
          '[YOLO] Detected 2 regions: Text (0.93), Table (0.95)',
          '[PaddleOCR] Cropped [58, 148, 1184, 1590] -> extracted 486 words in 1.42 s (0.00 GB VRAM used)',
        ],
      },
      checkpointItems: [
        {
          vi: 'Hiểu và tự viết được mẫu thiết kế Lazy Loading trong Python.',
          en: 'Understand and implement the Lazy Loading pattern in Python.',
        },
        {
          vi: 'Nắm được quy đổi tọa độ cục bộ ảnh cắt về hệ tọa độ toàn trang.',
          en: 'Know how to convert crop-local OCR boxes back to global page space.',
        },
      ],
      studyApis: ['PaddleOCR', 'PIL.Image.crop', 'Lazy Loading', 'src/extractor.py'],
      completeFiles: [
        {
          path: 'src/extractor.py',
          language: 'python',
          code: EXTRACTOR_PY_COMPLETE,
        },
      ],
    },
    {
      id: '3.3',
      moduleId: 'mod-3',
      tier: 2,
      title: {
        vi: 'Bước 3.3: Thuật toán Gom Dòng/Cột (y_tolerance=5px) & Làm sạch số (src/utils.py)',
        en: 'Step 3.3: Spatial Row/Column Clustering (y_tolerance=5px) & Cleaning (src/utils.py)',
      },
      subtitle: {
        vi: 'Xếp lại hàng trăm từ rời rạc thành ma trận bảng chuẩn và làm sạch `25,723`, `%`, dấu trừ, `#N/A` (mã DCL).',
        en: 'Reconstruct unordered word tokens into rows/columns and sanitize `25,723`, `%`, negative signs, and `#N/A` (e.g., ticker DCL).',
      },
      targetFile: 'src/utils.py',
      whyAndWhat: {
        why: {
          vi: 'Đầu ra từ `extractor.py` chỉ là một túi các từ rời rạc kèm tọa độ `(x0, y0, x1, y1, text)`. Có khi hai ô cùng một dòng trong bảng lại có tọa độ `y` lệch nhau 1–3 pixel do căn lề trên/giữa khác nhau. Thuật toán **Spatial Clustering** gom mọi từ có `|wy - current_y| <= 5.0` vào cùng 1 hàng (Row), rồi sắp xếp trái-sang-phải theo `x0` để khôi phục chính xác từng ô cột. Sau đó `clean_numeric_value()` xử lý các ca thực tế của bản tin MASVN như `25,723`, `+1.5%`, hoặc `#N/A` (như cổ phiếu `DCL` ở trang 5).',
          en: '`extractor.py` outputs a flat bag of `(x0, y0, x1, y1, text)` tokens where cells on the same visual row often differ by 1–3px in `y`. **Spatial Clustering** groups words within `y_tolerance = 5.0px` into rows and sorts horizontally by `x0`. Then `clean_numeric_value()` parses real MASVN quirks like `25,723`, `+1.5%`, and `#N/A` (e.g., DCL on page 5).',
        },
        ifMissing: {
          vi: 'Nếu so sánh `wy == current_y` tuyệt đối, chỉ lệch 0.5px là 1 dòng cổ phiếu bị xé làm 2 dòng hỏng cấu trúc; còn không xử lý `#N/A` và dấu phẩy sẽ làm `float("25,723")` hoặc `float("#N/A")` văng `ValueError`.',
          en: 'Exact `y` equality splits single table rows on 0.5px jitter, while uncleaned `25,723` or `#N/A` values crash `float()` with `ValueError`.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'cluster_words_to_rows(words, y_tolerance=5.0)',
          params: 'words: list[tuple], y_tolerance: float',
          inputType: 'list[(x0,y0,x1,y1,text)]',
          outputType: 'list[list[word]]',
          description: {
            vi: 'Sắp xếp từ theo tâm dọc `(y0+y1)/2`, gom các từ lệch dọc <= 5px vào cùng 1 hàng, rồi sort từng hàng theo `x0`.',
            en: 'Sorts words by vertical midpoint, merges tokens within 5px into the same row, and sorts each row left-to-right.',
          },
        },
        {
          symbol: 'rows_to_grid(rows, x_gap_threshold=14.0)',
          params: 'rows, x_gap_threshold',
          inputType: 'list[list[word]]',
          outputType: 'list[list[str]]',
          description: {
            vi: 'Các từ cạnh nhau có khoảng hở ngang <= 14px (ví dụ tên "Ngân hàng TMCP") được ghép chung 1 ô; khoảng hở > 14px tách thành cột mới.',
            en: 'Joins adjacent words separated by <= 14px into one cell and splits into a new column when horizontal gap exceeds 14px.',
          },
        },
        {
          symbol: 'clean_numeric_value(raw_val)',
          params: 'raw_val: Any',
          inputType: 'str | None',
          outputType: 'float | np.nan',
          description: {
            vi: 'Chuẩn hóa `#N/A`, `--` thành `np.nan`; bỏ dấu `,` và `%`; sửa dấu trừ dính/khoảng trắng và trả về `float`.',
            en: 'Maps `#N/A` / `--` to `np.nan`, strips `,` and `%`, fixes spaced minus signs, and extracts a clean `float`.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Làm sạch 4 ca số chứng khoán thường gặp', en: 'Stage 1: Clean 4 Real Stock Number Edge Cases' },
          summary: {
            vi: 'Thử nghiệm `clean_numeric_value` trên chuỗi thực tế từ bảng MASVN.',
            en: 'Test `clean_numeric_value` against real MASVN table strings.',
          },
          code: `samples = ["25,723", "+1.5%", "- 2.34", "#N/A", "(4.10)"]
for s in samples:
    print(f"{s:>8} -> {clean_numeric_value(s)}")`,
          expectedNote: {
            vi: 'Kết quả: `25723.0`, `1.5`, `-2.34`, `nan`, `-4.1` — sẵn sàng cho Pandas & Scikit-Learn.',
            en: 'Outputs `25723.0`, `1.5`, `-2.34`, `nan`, `-4.1`—ready for Pandas & Scikit-Learn.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Thuật toán gom dòng theo ngưỡng y_tolerance = 5.0', en: 'Stage 2: y_tolerance = 5.0 Row Clustering' },
          summary: {
            vi: 'Theo dõi biến `current_y` để biết khi nào bắt đầu một dòng cổ phiếu mới.',
            en: 'Track `current_y` to decide when tokens belong to the current row vs a new row.',
          },
          code: `sorted_words = sorted(words, key=lambda w: ((w[1] + w[3]) / 2.0, w[0]))
rows = []
current_row = [sorted_words[0]]
current_y = (sorted_words[0][1] + sorted_words[0][3]) / 2.0

for word in sorted_words[1:]:
    wy = (word[1] + word[3]) / 2.0
    if abs(wy - current_y) <= 5.0:
        current_row.append(word)
    else:
        current_row.sort(key=lambda w: w[0])
        rows.append(current_row)
        current_row = [word]
        current_y = wy`,
          expectedNote: {
            vi: 'Nhớ đừng quên dòng cuối `if current_row: rows.append(...)` sau khi kết thúc vòng `for`!',
            en: 'Never forget flushing the final `current_row` after the loop ends!',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Hoàn thiện src/utils.py (kèm dọn VRAM)', en: 'Stage 3: Complete src/utils.py' },
          summary: {
            vi: 'Gộp `clean_numeric_value` và `release_gpu_memory` vào `src/utils.py`.',
            en: 'Combine `clean_numeric_value` and `release_gpu_memory` into `src/utils.py`.',
          },
          code: UTILS_PY_PARTIAL,
          expectedNote: {
            vi: '`src/utils.py` hoàn chỉnh dùng chung cho Học phần 3, 4 và 6.',
            en: 'Complete `src/utils.py` shared across Modules 3, 4, and 6.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 3/5: Hoàn chỉnh module tiện ích src/utils.py',
        en: 'Piece 3/5: Complete Utility Module src/utils.py',
      },
      builderExplanation: {
        vi: 'File `src/utils.py` chứa bộ làm sạch chuỗi số (`#N/A`, dấu phẩy, `%`, số âm) và hàm `release_gpu_memory()` gọi `gc.collect()` + `torch.cuda.empty_cache()`.',
        en: '`src/utils.py` provides numeric sanitization (`#N/A`, commas, `%`, negatives) plus `release_gpu_memory()` calling `gc.collect()` and `torch.cuda.empty_cache()`.',
      },
      builderCode: UTILS_PY_PARTIAL,
      highlightLines: [6, 36],
      lineWalkthrough: [
        {
          lines: 'L12-L13',
          snippet: 'if not text or text.upper() in {"#N/A", "N/A", "NA", "-", "--", "NULL"}:\n    return np.nan',
          explanation: {
            vi: 'Đưa toàn bộ giá trị thiếu như `#N/A` ở mã `DCL` về `np.nan` để `SimpleImputer` ở Học phần 4 xử lý chuẩn xác.',
            en: 'Normalizes missing tokens such as `#N/A` (seen in ticker `DCL`) to `np.nan` for `SimpleImputer` in Module 4.',
          },
        },
        {
          lines: 'L16-L20',
          snippet: 'text = text.replace(",", "").replace("%", "")\ntext = re.sub(r"\\s+", "", text)\nif text.startswith("(") and text.endswith(")"):\n    text = "-" + text[1:-1]',
          explanation: {
            vi: 'Xóa dấu phẩy hàng nghìn, xóa `%`, gộp khoảng trắng sau dấu trừ và xử lý số âm trong ngoặc đơn kế toán.',
            en: 'Strips thousand commas and `%`, collapses spaces after minus signs, and converts accounting parentheses to negative floats.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện điều kiện gom các từ vào cùng 1 dòng dựa trên `y_tolerance` và sắp xếp theo trục ngang:',
          en: 'Complete the vertical `y_tolerance` row-grouping condition and horizontal sorting:',
        },
        codeTemplate: `if abs(wy - current_y) <= ___0___:
    current_row.append(word)
else:
    current_row.sort(key=lambda w: w[___1___])`,
        answers: ['y_tolerance', '0'],
        hints: [
          { vi: 'Tên tham số ngưỡng sai số trục Y (mặc định 5.0px)', en: 'Parameter name for vertical pixel tolerance (default 5.0)' },
          { vi: 'Chỉ số của x0 trong tuple (x0, y0, x1, y1, text)', en: 'Index of x0 inside the (x0, y0, x1, y1, text) tuple' },
        ],
        explanation: {
          vi: 'So sánh độ lệch dọc `<= y_tolerance` để gom hàng, rồi sắp xếp theo `w[0]` (`x0`) từ trái sang phải.',
          en: 'Compare vertical delta against `y_tolerance`, then sort tokens left-to-right by `w[0]` (`x0`).',
        },
      },
      quiz: {
        question: {
          vi: 'Khi bảng MASVN có mã cổ phiếu `DCL` bị thiếu P/E ghi là `#N/A`, hàm `clean_numeric_value("#N/A")` nên trả về gì?',
          en: 'When MASVN reports `#N/A` for ticker `DCL` P/E, what should `clean_numeric_value("#N/A")` return?',
        },
        options: [
          {
            vi: 'Trả về `np.nan` (Missing value chuẩn) để bước `SimpleImputer(strategy="median")` tự điền sau khi chia Train/Test.',
            en: '`np.nan` so `SimpleImputer(strategy="median")` handles it safely inside the ML pipeline after Train/Test splitting.',
          },
          {
            vi: 'Trả về số `0.0` ngay lập tức.',
            en: 'Return `0.0` immediately.',
          },
          {
            vi: 'Xóa luôn cả dòng cổ phiếu `DCL` khỏi bảng.',
            en: 'Drop ticker `DCL` completely.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Gán `0.0` sẽ làm model tưởng cổ phiếu có P/E = 0 (rẻ bất thường), còn xóa dòng sẽ mất mã cổ phiếu khi dự báo thực tế.',
          en: 'Correct! Filling `0.0` fakes an ultra-cheap P/E, whereas `np.nan` preserves the stock for proper pipeline imputation.',
        },
      },
      simulation: {
        kind: 'dataframe',
        commandLabel: 'cluster_words_to_rows() + clean_numeric_value() output preview',
        dataframeColumns: ['Ticker', 'Giá', 'P/E', 'P/B', 'ROE (%)', 'GTGD (Tỷ)'],
        dataframeRows: [
          { Ticker: 'FPT', Giá: 138.5, 'P/E': 21.4, 'P/B': 4.8, 'ROE (%)': 26.2, 'GTGD (Tỷ)': 642.1 },
          { Ticker: 'MBB', Giá: 25.4, 'P/E': 6.1, 'P/B': 1.2, 'ROE (%)': 22.8, 'GTGD (Tỷ)': 418.5 },
          { Ticker: 'DCL', Giá: 28.9, 'P/E': 'NaN (#N/A)', 'P/B': 1.9, 'ROE (%)': 9.4, 'GTGD (Tỷ)': 12.3 },
          { Ticker: 'VNM', Giá: 66.2, 'P/E': 15.8, 'P/B': 4.1, 'ROE (%)': 28.5, 'GTGD (Tỷ)': 215.0 },
        ],
      },
      checkpointItems: [
        {
          vi: 'Hiểu cơ chế gom dòng (`y_tolerance`) và tách cột (`x_gap_threshold`).',
          en: 'Understand `y_tolerance` row clustering and `x_gap_threshold` column splitting.',
        },
        {
          vi: 'Nắm các quy tắc làm sạch số chứng khoán Việt Nam trong `src/utils.py`.',
          en: 'Know all numeric sanitization rules implemented in `src/utils.py`.',
        },
      ],
      studyApis: ['cluster_words_to_rows', 'clean_numeric_value', 'np.nan', 'src/utils.py'],
      completeFiles: [
        {
          path: 'src/utils.py',
          language: 'python',
          code: UTILS_PY_PARTIAL,
        },
      ],
    },
    {
      id: '3.4',
      moduleId: 'mod-3',
      tier: 3,
      title: {
        vi: 'Bước 3.4: Phân luồng Bảng thông minh & Table-to-Text Serialization',
        en: 'Step 3.4: Smart Table Routing & Table-to-Text Serialization',
      },
      subtitle: {
        vi: 'Tách bảng cổ phiếu lớn (ML) khỏi bảng vĩ mô nhỏ (RAG) và viết câu mô tả tự nhiên trong `src/table_parser.py`.',
        en: 'Route large stock tables to ML DataFrames and serialize small macro tables into rich sentences for RAG in `src/table_parser.py`.',
      },
      targetFile: 'src/table_parser.py',
      whyAndWhat: {
        why: {
          vi: 'Không phải vùng `Table` nào YOLO tìm thấy cũng giống nhau! Bản tin MASVN có **2 loại bảng hoàn toàn khác nhau**: (1) Bảng danh sách Top 100 cổ phiếu / VN30 (Trang 4–6, 11) có các cột `Mã, Giá, P/E, P/B, ROE, KLTB 20N, GTGD` -> đưa vào `DataFrame` cho Học phần 4; (2) Bảng chỉ số vĩ mô nhỏ ở Trang 1–3 (VN-Index, Tỷ giá USD/VND, Giá dầu, Lãi suất) -> nếu giữ dạng ma trận rời rạc thì Embedding RAG tìm rất kém, nên ta dùng **Table-to-Text Serialization** biến từng dòng thành câu hoàn chỉnh: *"[Ngày 20261113 - Trang 1] Chỉ số/Hạng mục USD/VND ghi nhận Điểm/Giá: 25,723, 1D%: +0.2%, YTD%: +1.5%."*',
          en: 'YOLO detects two very different table types: (1) large Top-100/VN30 stock tables (p.4–6, 11) with `Mã, Giá, P/E, P/B, ROE` -> DataFrame for Module 4; (2) small macro tables (p.1–3: VN-Index, USD/VND, oil, rates). Embeddings retrieve raw table cells poorly, so **Table-to-Text Serialization** converts each macro row into a natural sentence for RAG.',
        },
        ifMissing: {
          vi: 'Nếu trộn bảng vĩ mô 4 dòng vào file CSV cổ phiếu, bảng dữ liệu ML bị hỏng cấu trúc cột; còn nếu ném nguyên ma trận số thô vào Vector DB, câu hỏi "Tỷ giá USD/VND hôm nay bao nhiêu?" rất dễ trượt mất ngữ cảnh tên cột.',
          en: 'Mixing 4-row macro tables into `stock_metrics.csv` corrupts ML columns, while indexing raw detached numbers breaks semantic RAG retrieval.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'is_stock_metrics_table(grid)',
          params: 'grid: list[list[str]]',
          inputType: '2D string grid',
          outputType: 'bool',
          description: {
            vi: 'Kiểm tra 2 dòng đầu có chứa >= 3 từ khóa (`MÃ`, `GIÁ`, `P/E`, `P/B`, `ROE`) và đủ >= 4 dòng dữ liệu không.',
            en: 'Checks whether the top 2 header rows contain >= 3 stock keywords (`MÃ`, `GIÁ`, `P/E`, `P/B`, `ROE`) and >= 4 rows.',
          },
        },
        {
          symbol: 'serialize_macro_table_to_text(...)',
          params: 'grid, report_date, page_num',
          inputType: 'grid, str, int',
          outputType: 'list[str]',
          description: {
            vi: 'Ghép tên tiêu đề cột với giá trị từng ô thành câu tiếng Việt tự nhiên kèm thẻ `[Ngày ... - Trang ...]` để LLM trích dẫn chính xác.',
            en: 'Pairs column headers with cell values into natural prose tagged with `[Ngày ... - Trang ...]` for grounded citations.',
          },
        },
        {
          symbol: 'grid_to_stock_dataframe(grid, report_date)',
          params: 'grid, report_date',
          inputType: 'grid, str',
          outputType: 'pd.DataFrame',
          description: {
            vi: 'Chuyển bảng cổ phiếu lớn thành DataFrame, áp dụng `clean_numeric_value` lên toàn bộ các cột chỉ tiêu tài chính.',
            en: 'Converts stock tables into a clean DataFrame and applies `clean_numeric_value` to all numeric metric columns.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Bộ nhận diện bảng cổ phiếu vs bảng vĩ mô', en: 'Stage 1: Heuristic Classifier for Stock vs Macro Tables' },
          summary: {
            vi: 'Đếm số từ khóa tài chính xuất hiện trong phần tiêu đề bảng.',
            en: 'Count stock metric header hits in the first two rows.',
          },
          code: `STOCK_REQUIRED_KEYWORDS = {"MÃ", "GIÁ", "P/E", "P/B", "ROE"}
header_text = "MÃ GIÁ KLGD P/E P/B ROE".upper()
hits = sum(1 for kw in STOCK_REQUIRED_KEYWORDS if kw in header_text)
print("Is stock table:", hits >= 3)`,
          expectedNote: {
            vi: 'Đơn giản, minh bạch và giải thích được 100%, không cần thêm model phân loại phức tạp.',
            en: 'Fast, deterministic, and zero extra model overhead.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Biến dòng bảng vĩ mô thành câu văn cho RAG', en: 'Stage 2: Table-to-Text Serialization' },
          summary: {
            vi: 'Ghép cặp `headers[i]: row[i]` kèm ngày và số trang.',
            en: 'Pair `headers[i]: row[i]` with report date and page metadata.',
          },
          code: `grid = [
    ["Chỉ số", "Điểm/Giá", "1D%", "YTD%"],
    ["USD/VND", "25,723", "+0.2%", "+1.5%"],
]
for sent in serialize_macro_table_to_text(grid, "20261113", 1):
    print(sent)`,
          expectedNote: {
            vi: 'Câu văn sinh ra chứa đủ thực thể `USD/VND`, tên cột `YTD%`, số liệu `25,723` và nguồn `[Ngày 20261113 - Trang 1]`.',
            en: 'The output sentence preserves entity `USD/VND`, column names, values, and exact `[Date - Page]` citation.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Toàn bộ file src/table_parser.py', en: 'Stage 3: Complete src/table_parser.py' },
          summary: {
            vi: 'Ghép nối `cluster_words_to_rows`, `rows_to_grid`, `is_stock_metrics_table`, `serialize_macro_table_to_text`, và `grid_to_stock_dataframe`.',
            en: 'Assemble clustering, grid splitting, routing, serialization, and DataFrame conversion.',
          },
          code: TABLE_PARSER_PY_COMPLETE,
          expectedNote: {
            vi: 'Module `src/table_parser.py` hoàn chỉnh sẵn sàng phục vụ cả batch notebook lẫn Streamlit app.',
            en: '`src/table_parser.py` is complete for both batch dataset creation and live Streamlit uploads.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 4/5: Hoàn chỉnh file src/table_parser.py',
        en: 'Piece 4/5: Complete src/table_parser.py',
      },
      builderExplanation: {
        vi: 'Toàn bộ module phân tích và định tuyến bảng `src/table_parser.py`: gom từ -> lưới ô -> phân loại bảng lớn/nhỏ -> xuất DataFrame (ML) hoặc câu văn (RAG).',
        en: 'Full `src/table_parser.py` pipeline: word clustering -> grid reconstruction -> routing -> DataFrame (ML) or serialized prose (RAG).',
      },
      builderCode: TABLE_PARSER_PY_COMPLETE,
      highlightLines: [49, 98],
      lineWalkthrough: [
        {
          lines: 'L50-L56',
          snippet: 'def is_stock_metrics_table(grid) -> bool:\n    if len(grid) < 4:\n        return False\n    header_text = " ".join(" ".join(r) for r in grid[:2]).upper()\n    hits = sum(1 for kw in STOCK_REQUIRED_KEYWORDS if kw in header_text)\n    return hits >= 3',
          explanation: {
            vi: 'Kiểm tra cả chiều dài bảng và sự hiện diện của ít nhất 3 cột đặc trưng cổ phiếu.',
            en: 'Checks both minimum row count and at least 3 signature stock table headers.',
          },
        },
        {
          lines: 'L59-L74',
          snippet: 'def serialize_macro_table_to_text(grid, report_date: str, page_num: int) -> list[str]:',
          explanation: {
            vi: 'Chuyển đổi từng dòng bảng vĩ mô thành câu hoàn chỉnh giúp cả BM25 lẫn Embedding RAG truy xuất chính xác.',
            en: 'Converts each macro row into a self-contained sentence searchable by both BM25 and dense embeddings.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện hàm Table-to-Text ghép tên cột `headers[col_idx]` với giá trị `row[col_idx]`:',
          en: 'Complete Table-to-Text serialization pairing `headers[col_idx]` with `row[col_idx]`:',
        },
        codeTemplate: `for col_idx in range(1, min(len(headers), len(row))):
    pairs.append(f"{___0___[col_idx]}: {___1___[col_idx]}")
detail = ", ".join(pairs)`,
        answers: ['headers', 'row'],
        hints: [
          { vi: 'Danh sách tên cột ở dòng đầu tiên của bảng', en: 'First row containing column header names' },
          { vi: 'Dòng dữ liệu hiện tại đang duyệt', en: 'Current data row being serialized' },
        ],
        explanation: {
          vi: 'Ghép tên cột với giá trị tương ứng để giữ nguyên ý nghĩa ngữ cảnh khi chuyển bảng thành văn bản.',
          en: 'Pairing header names with values preserves semantic context inside serialized RAG chunks.',
        },
      },
      quiz: {
        question: {
          vi: 'Tại sao ta phải dùng kỹ thuật **Table-to-Text Serialization** cho các bảng vĩ mô nhỏ ở trang 1–3 trước khi đưa vào RAG?',
          en: 'Why apply **Table-to-Text Serialization** to small macro tables on pages 1–3 before indexing them into RAG?',
        },
        options: [
          {
            vi: 'Vì câu văn tự nhiên giữ nguyên liên kết giữa tên chỉ số, tên cột và con số, giúp mô hình Embedding hiểu và LLM trích dẫn chính xác.',
            en: 'Natural sentences preserve links between metric names, column headers, and numbers so embeddings retrieve accurately and LLMs cite reliably.',
          },
          {
            vi: 'Vì FAISS không thể lưu chuỗi có chứa dấu phẩy.',
            en: 'Because FAISS forbids strings containing commas.',
          },
          {
            vi: 'Để giảm số lượng file PDF trong `raw_pdfs/`.',
            en: 'To shrink the number of PDFs in `raw_pdfs/`.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Một chuỗi rời rạc `"USD/VND 25,723 +0.2% +1.5%"` mất ngữ nghĩa cột, còn câu mô tả đầy đủ giúp RAG trả lời chuẩn xác.',
          en: 'Correct! Detached cell strings lose column meaning, whereas serialized sentences anchor every number to its header.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'table_parser.route_tables(report_20261113.pdf)',
        terminalLines: [
          '[Page 1 | Table] 5 rows, keywords=0/5 -> Routed to RAG (Table-to-Text Serialization):',
          '  -> "[Ngày 20261113 - Trang 1] Chỉ số/Hạng mục VN-Index ghi nhận Điểm: 1,268.4, 1D%: +0.5%, YTD%: +12.1%."',
          '  -> "[Ngày 20261113 - Trang 1] Chỉ số/Hạng mục USD/VND ghi nhận Điểm: 25,723, 1D%: +0.2%, YTD%: +1.5%."',
          '[Page 4 | Table] 38 rows, keywords=5/5 -> Routed to ML DataFrame (37 stock records parsed)',
          '[Page 5 | Table] 36 rows, keywords=5/5 -> Routed to ML DataFrame (35 stock records parsed, DCL P/E -> NaN)',
        ],
      },
      checkpointItems: [
        {
          vi: 'Phân biệt rõ tiêu chí tách bảng cổ phiếu (ML) và bảng vĩ mô (RAG).',
          en: 'Distinguish routing rules between stock tables (ML) and macro tables (RAG).',
        },
        {
          vi: 'Biết viết hàm Table-to-Text Serialization gắn đủ ngày và số trang.',
          en: 'Implement Table-to-Text Serialization with `[Date - Page]` provenance.',
        },
      ],
      studyApis: ['is_stock_metrics_table', 'serialize_macro_table_to_text', 'grid_to_stock_dataframe', 'src/table_parser.py'],
      completeFiles: [
        {
          path: 'src/table_parser.py',
          language: 'python',
          code: TABLE_PARSER_PY_COMPLETE,
        },
      ],
    },
    {
      id: '3.5',
      moduleId: 'mod-3',
      tier: 3,
      title: {
        vi: 'Bước 3.5: Chạy Batch xây dựng `stock_metrics.csv` & `market_knowledge.json`',
        en: 'Step 3.5: Batch Dataset Builder (`03_build_datasets.ipynb`)',
      },
      subtitle: {
        vi: 'Nối `extractor.py` + `table_parser.py` + `utils.py` quét hàng loạt 50 file PDF để xuất 2 bộ dữ liệu sạch.',
        en: 'Connect `extractor.py`, `table_parser.py`, and `utils.py` across 50 PDFs to generate clean ML & RAG datasets.',
      },
      targetFile: 'notebooks/03_build_datasets.ipynb',
      whyAndWhat: {
        why: {
          vi: 'Đây là trạm hội tụ toàn bộ nửa đầu pipeline (Thu thập -> YOLO -> Bóc tách lai -> Tái tạo bảng). Notebook `03_build_datasets.ipynb` duyệt qua 50 file `report_*.pdf` trong `data/raw_pdfs/`, gom mọi bảng cổ phiếu thành ~2,000 dòng trong `data/processed/stock_metrics.csv` (lưu ý `utf-8-sig` để mở bằng Excel tiếng Việt không bị lỗi font), và gom toàn bộ khối `Text` + bảng vĩ mô thành `data/processed/market_knowledge.json`, cuối cùng giải phóng VRAM bằng `release_gpu_memory()`.',
          en: 'This notebook unifies the entire ingestion & parsing pipeline across all 50 PDFs in `data/raw_pdfs/`. It outputs ~2,000 cleaned stock rows to `data/processed/stock_metrics.csv` (encoded as `utf-8-sig` for Excel Vietnamese support) and structured text/macro chunks to `data/processed/market_knowledge.json`, finishing with `release_gpu_memory()`.',
        },
        ifMissing: {
          vi: 'Học phần 4 (LightGBM) và Học phần 5 (Hybrid RAG) sẽ không có dữ liệu đầu vào sạch để huấn luyện và lập chỉ mục.',
          en: 'Modules 4 (LightGBM) and 5 (Hybrid RAG) have no clean training or indexing datasets.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'pd.concat(all_stock_frames, ignore_index=True)',
          params: 'objs, ignore_index=True',
          inputType: 'list[pd.DataFrame]',
          outputType: 'pd.DataFrame',
          description: {
            vi: 'Nối hàng trăm bảng DataFrame từ nhiều ngày thành một bảng lớn liên tục và đánh lại index `0..N-1`.',
            en: 'Concatenates daily stock DataFrames into one contiguous table with a fresh `0..N-1` index.',
          },
        },
        {
          symbol: 'final_df.to_csv(..., encoding="utf-8-sig")',
          params: 'index=False, encoding="utf-8-sig"',
          inputType: 'Path',
          outputType: 'CSV file',
          description: {
            vi: 'Thêm BOM UTF-8 (`utf-8-sig`) để Excel trên Windows hiển thị đúng tiếng Việt có dấu.',
            en: 'Includes UTF-8 BOM (`utf-8-sig`) so Windows Excel renders Vietnamese diacritics properly.',
          },
        },
        {
          symbol: 'json.dump(..., ensure_ascii=False, indent=2)',
          params: 'ensure_ascii=False, indent=2',
          inputType: 'list[dict]',
          outputType: 'JSON file',
          description: {
            vi: 'Lưu chữ tiếng Việt nguyên dạng trong JSON thay vì chuỗi mã hóa `\\u00e1` khó đọc.',
            en: 'Writes human-readable Vietnamese characters directly instead of escaped `\\uXXXX` sequences.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Nối kết quả của 1 file PDF thử nghiệm', en: 'Stage 1: Smoke-Test Pipeline on 1 PDF' },
          summary: {
            vi: 'Chạy thử 1 bản tin mới nhất xem trích xuất được bao nhiêu vùng Text và bao nhiêu dòng cổ phiếu.',
            en: 'Verify region counts and parsed stock rows on a single PDF first.',
          },
          code: `regions = extractor.extract_pdf(Path("data/raw_pdfs/report_20261113.pdf"))
print("Total regions:", len(regions))`,
          expectedNote: {
            vi: 'Kiểm tra nhanh trước khi chạy vòng lặp toàn bộ 50 file.',
            en: 'Sanity check on one file before running the 50-PDF batch.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Lọc nhiễu đoạn văn ngắn (< 30 ký tự) & xuất UTF-8', en: 'Stage 2: Noise Filtering & UTF-8 Export' },
          summary: {
            vi: 'Bỏ qua các mẩu chữ vụn như số trang hoặc header lặp ở chân trang (< 30 ký tự) trước khi đưa vào `market_knowledge.json`.',
            en: 'Filter short header/footer fragments (< 30 chars) before writing `market_knowledge.json`.',
          },
          code: `text_content = " ".join(w[4] for w in reg["words"]).strip()
if len(text_content) > 30:
    knowledge_docs.append({
        "date": report_date,
        "page": reg["page"],
        "category": "narrative_text",
        "text": text_content,
    })`,
          expectedNote: {
            vi: 'Giúp kho tri thức RAG sạch sẽ, không chứa các dòng "Trang 4/12" vô nghĩa.',
            en: 'Keeps the RAG knowledge base free of boilerplate page-number fragments.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Notebook 03_build_datasets.ipynb hoàn chỉnh', en: 'Stage 3: Complete 03_build_datasets.ipynb' },
          summary: {
            vi: 'Chạy trọn vẹn 50 PDF, xuất `stock_metrics.csv` + `market_knowledge.json` và dọn GPU VRAM.',
            en: 'Batch-process all 50 PDFs, export both files, and call `release_gpu_memory()`.',
          },
          code: NOTEBOOK_03_CODE,
          expectedNote: {
            vi: 'Mở Tab "4. File hoàn chỉnh" để tải về thành file `.ipynb` chạy ngay trên VS Code.',
            en: 'Download directly as `.ipynb` from Tab 4 to run locally in VS Code.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 5/5: Pipeline tổng hợp notebooks/03_build_datasets.ipynb',
        en: 'Piece 5/5: Batch Dataset Builder notebooks/03_build_datasets.ipynb',
      },
      builderExplanation: {
        vi: 'Kết nối toàn bộ 3 module của Học phần 3 (`extractor`, `table_parser`, `utils`) để biến 50 file PDF thô thành 2 tập dữ liệu chuẩn cho ML & RAG.',
        en: 'Connects `extractor`, `table_parser`, and `utils` to transform 50 raw PDFs into clean ML and RAG datasets.',
      },
      builderCode: NOTEBOOK_03_CODE,
      highlightLines: [24, 59],
      lineWalkthrough: [
        {
          lines: 'L25-L27',
          snippet: 'report_date = pdf_path.stem.replace("report_", "")\nregions = extractor.extract_pdf(pdf_path)',
          explanation: {
            vi: 'Lấy ngay ngày chuẩn `YYYYMMDD` từ tên file `report_YYYYMMDD.pdf` đã chuẩn hóa ở Học phần 1.',
            en: 'Parses `YYYYMMDD` straight from the standardized `report_YYYYMMDD.pdf` naming established in Module 1.',
          },
        },
        {
          lines: 'L52-L58',
          snippet: 'release_gpu_memory()\nfinal_df = pd.concat(all_stock_frames, ignore_index=True)\nfinal_df.to_csv(..., encoding="utf-8-sig")',
          explanation: {
            vi: 'Dọn dẹp VRAM ngay khi YOLO chạy xong lô PDF và lưu CSV với `utf-8-sig`.',
            en: 'Frees GPU memory once YOLO finishes the batch and exports Excel-friendly `utf-8-sig` CSV.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện lệnh nối các DataFrame ngày và xuất CSV không lỗi font tiếng Việt trên Excel:',
          en: 'Complete concatenating daily DataFrames and exporting an Excel-safe Vietnamese CSV:',
        },
        codeTemplate: `final_df = pd.___0___(all_stock_frames, ignore_index=True)
final_df.to_csv(OUT_DIR / "stock_metrics.csv", index=False, encoding="___1___")`,
        answers: ['concat', 'utf-8-sig'],
        hints: [
          { vi: 'Hàm của pandas ghép nối danh sách DataFrame theo chiều dọc', en: 'Pandas function to concatenate a list of DataFrames' },
          { vi: 'Chuẩn encoding UTF-8 có BOM cho Excel Windows', en: 'UTF-8 encoding with BOM for Windows Excel' },
        ],
        explanation: {
          vi: '`pd.concat(..., ignore_index=True)` ghép nối bảng sạch chỉ mục, và `utf-8-sig` giúp Excel đọc chuẩn dấu tiếng Việt.',
          en: '`pd.concat(..., ignore_index=True)` merges tables with a clean index and `utf-8-sig` prevents mojibake in Excel.',
        },
      },
      quiz: {
        question: {
          vi: 'Tại sao ta truyền `ensure_ascii=False` khi gọi `json.dump()` lưu `market_knowledge.json`?',
          en: 'Why pass `ensure_ascii=False` to `json.dump()` when writing `market_knowledge.json`?',
        },
        options: [
          {
            vi: 'Để lưu trực tiếp ký tự tiếng Việt dễ đọc khi kiểm tra file, thay vì biến đổi thành mã thoát `\\uXXXX`.',
            en: 'To store readable UTF-8 Vietnamese text directly instead of escaped `\\uXXXX` sequences.',
          },
          {
            vi: 'Để bỏ qua lỗi khi file PDF bị hỏng.',
            en: 'To ignore corrupt PDF errors.',
          },
          {
            vi: 'Vì Python `json.load()` không đọc được file ASCII.',
            en: 'Because `json.load()` cannot read ASCII files.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! `ensure_ascii=False` giữ nguyên tiếng Việt có dấu giúp việc kiểm tra chất lượng dữ liệu RAG rất trực quan.',
          en: 'Correct! `ensure_ascii=False` keeps JSON human-inspectable for QA.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'python notebooks/03_build_datasets.py',
        terminalLines: [
          'Processing 50 PDFs in data/raw_pdfs/...',
          '  [1/50] report_20260902.pdf -> +42 stock rows, +14 knowledge chunks (pymupdf)',
          '  ...',
          '  [50/50] report_20261113.pdf -> +44 stock rows, +16 knowledge chunks (pymupdf)',
          '[VRAM] gc.collect() + torch.cuda.empty_cache() -> VRAM freed',
          'Saved stock_metrics.csv: 2140 rows | market_knowledge.json: 712 chunks',
        ],
      },
      checkpointItems: [
        {
          vi: 'Kiểm tra đã hiểu luồng dữ liệu nối từ `raw_pdfs/` sang `stock_metrics.csv` và `market_knowledge.json`.',
          en: 'Trace the full flow from `raw_pdfs/` to `stock_metrics.csv` and `market_knowledge.json`.',
        },
        {
          vi: 'Nhớ gọi `release_gpu_memory()` sau khi xử lý xong tác vụ Vision.',
          en: 'Remember to call `release_gpu_memory()` after Vision batch jobs.',
        },
      ],
      studyApis: ['pd.concat', 'DataFrame.to_csv', 'json.dump', 'release_gpu_memory'],
      completeFiles: [
        {
          path: 'notebooks/03_build_datasets.ipynb',
          language: 'python',
          code: NOTEBOOK_03_CODE,
          notebookCells: [
            { type: 'markdown', content: '# 03 - Build Clean ML CSV & RAG JSON Datasets from 50 MASVN PDFs' },
            { type: 'code', content: NOTEBOOK_03_CODE },
          ],
        },
      ],
    },
    {
      id: '3.6',
      moduleId: 'mod-3',
      tier: 3,
      title: {
        vi: 'Bước 3.6: Mở rộng công cụ — PyMuPDF Font Dict & Xử lý bảng nối nhiều trang',
        en: 'Step 3.6: Tool Deep Dive — PyMuPDF Font Metadata & Multi-Page Tables',
      },
      subtitle: {
        vi: 'Dùng `page.get_text("dict")` đọc font chữ in đậm để nhận diện tiêu đề mục và ghép bảng Top 100 vắt qua Trang 4–6.',
        en: 'Use `page.get_text("dict")` bold flags to isolate section headers and merge multi-page tables spanning Pages 4–6.',
      },
      targetFile: 'src/table_parser.py',
      whyAndWhat: {
        why: {
          vi: 'Ngoài `get_text("words")`, **PyMuPDF** còn có `page.get_text("dict")` trả về cỡ chữ (`size`) và cờ in đậm (`flags & 16`) của từng span chữ. Kỹ năng này rất mạnh khi bạn xử lý các báo cáo tài chính phức tạp có tiêu đề phân cấp hoặc khi bảng Top 100 cổ phiếu bị ngắt qua Trang 4, Trang 5, Trang 6 (trang sau không lặp lại dòng tiêu đề cột `Mã, Giá, P/E...`).',
          en: 'Beyond `get_text("words")`, **PyMuPDF** `get_text("dict")` exposes font `size` and bold bitmasks (`flags & 16`). This helps detect nested section headings and stitch continuation tables across Pages 4–6 when subsequent pages omit header rows.',
        },
        ifMissing: {
          vi: 'Nếu bảng cổ phiếu Trang 5 bị thiếu dòng tiêu đề cột `Mã, Giá, P/E`, hàm `is_stock_metrics_table` sẽ phân loại nhầm thành bảng vĩ mô và đẩy cả 40 cổ phiếu sang RAG thay vì ML.',
          en: 'A continuation table on Page 5 lacking repeated column headers fails `is_stock_metrics_table()` and gets misrouted.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'page.get_text("dict")',
          params: 'blocks -> lines -> spans',
          inputType: 'fitz.Page',
          outputType: 'nested dict',
          description: {
            vi: 'Truy cập `span["size"]`, `span["font"]`, `span["flags"]` (bit 4 tức `flags & 16` nghĩa là chữ Bold).',
            en: 'Exposes `span["size"]`, `span["font"]`, and `span["flags"]` (`flags & 16` indicates bold text).',
          },
        },
        {
          symbol: 'merge_continuation_tables(prev_headers, next_grid)',
          params: 'prev_headers, next_grid',
          inputType: 'list[str], list[list[str]]',
          outputType: 'list[list[str]]',
          description: {
            vi: 'Nếu bảng mới có cùng số cột với bảng cổ phiếu trang trước nhưng không có header, tự động gắn lại `prev_headers` lên đầu.',
            en: 'When a new table matches column count without headers, prepends `prev_headers` automatically.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Lọc các tiêu đề in đậm bằng get_text("dict")', en: 'Stage 1: Extract Bold Headings via get_text("dict")' },
          summary: {
            vi: 'Kiểm tra bitmask `flags & 16` và kích thước font `>= 11.5`.',
            en: 'Test bold bitmask `flags & 16` and font size `>= 11.5`.',
          },
          code: `for block in page.get_text("dict")["blocks"]:
    for line in block.get("lines", []):
        for span in line.get("spans", []):
            is_bold = bool(span["flags"] & 16)
            if is_bold and span["size"] >= 11.5:
                print("Heading:", span["text"].strip())`,
          expectedNote: {
            vi: 'Rất hữu ích để cắt chunk RAG đúng ranh giới từng tin doanh nghiệp.',
            en: 'Ideal for splitting RAG chunks cleanly at section boundaries.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Xoay chỉnh ảnh scan bị nghiêng trước khi đưa vào PaddleOCR', en: 'Stage 2: Deskewing Tilted Scans Before PaddleOCR' },
          summary: {
            vi: 'Khi người dùng chụp ảnh màn hình hơi nghiêng (>2 độ), thuật toán gom dòng `y_tolerance=5px` sẽ bị trượt hàng; dùng `use_angle_cls=True` hoặc xoay nhẹ OpenCV.',
            en: 'Enable `use_angle_cls=True` or OpenCV deskewing when smartphone photos are tilted.',
          },
          code: `import cv2, numpy as np

def correct_skew(gray_img: np.ndarray) -> np.ndarray:
    coords = np.column_stack(np.where(gray_img < 200))
    angle = cv2.minAreaRect(coords)[-1]
    angle = -(90 + angle) if angle < -45 else -angle
    if abs(angle) < 0.5:
        return gray_img
    h, w = gray_img.shape[:2]
    M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    return cv2.warpAffine(gray_img, M, (w, h), flags=cv2.INTER_CUBIC)`,
          expectedNote: {
            vi: 'Giữ hàng chữ nằm ngang phẳng giúp `y_tolerance=5px` chính xác trở lại.',
            en: 'Restores horizontal rows so `y_tolerance=5px` clusters accurately.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Nối bảng cổ phiếu vắt qua nhiều trang PDF', en: 'Stage 3: Merge Multi-Page Stock Tables' },
          summary: {
            vi: 'Nhớ `last_stock_headers` khi duyệt tuần tự từ Trang 4 -> Trang 5 -> Trang 6.',
            en: 'Carry `last_stock_headers` forward across Pages 4 -> 5 -> 6.',
          },
          code: `def attach_missing_header(grid: list[list[str]], last_headers: list[str] | None):
    if not last_headers or not grid:
        return grid
    first_row = " ".join(grid[0]).upper()
    if "MÃ" not in first_row and len(grid[0]) == len(last_headers):
        return [last_headers] + grid
    return grid`,
          expectedNote: {
            vi: 'Không bị rơi rớt các mã cổ phiếu nằm ở trang tiếp theo.',
            en: 'Prevents dropping continuation pages of the Top 100 table.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mở rộng Table Parser: Nối bảng nhiều trang & Đọc Bold Headings',
        en: 'Table Parser Extension: Multi-Page Merge & Bold Headings',
      },
      builderExplanation: {
        vi: 'Bổ sung hàm `attach_missing_header` và `extract_bold_headings` để làm chủ hoàn toàn PyMuPDF và OpenCV tiền xử lý tài liệu.',
        en: 'Adds `attach_missing_header` and `extract_bold_headings` to master PyMuPDF metadata and scan deskewing.',
      },
      builderCode: `def extract_bold_headings(page) -> list[str]:
    headings = []
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                if (span["flags"] & 16) and span["size"] >= 11.5:
                    txt = span["text"].strip()
                    if len(txt) > 3:
                        headings.append(txt)
    return headings


def attach_missing_header(grid: list[list[str]], last_headers: list[str] | None):
    if not last_headers or not grid:
        return grid
    first_row = " ".join(grid[0]).upper()
    if "MÃ" not in first_row and len(grid[0]) == len(last_headers):
        return [last_headers] + grid
    return grid`,
      highlightLines: [13, 19],
      lineWalkthrough: [
        {
          lines: 'L6',
          snippet: 'if (span["flags"] & 16) and span["size"] >= 11.5:',
          explanation: {
            vi: 'Bit 4 (`16`) trong PyMuPDF đại diện cho font in đậm (Bold).',
            en: 'Bit 4 (`16`) in PyMuPDF span flags denotes bold font weight.',
          },
        },
        {
          lines: 'L17-L18',
          snippet: 'if "MÃ" not in first_row and len(grid[0]) == len(last_headers):\n    return [last_headers] + grid',
          explanation: {
            vi: 'Kiểm tra khớp số lượng cột với bảng cổ phiếu liền trước trước khi chèn lại dòng header.',
            en: 'Verifies matching column count with the previous stock table before prepending headers.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện kiểm tra cờ Bold trong `get_text("dict")` và chèn lại header cho bảng nối trang:',
          en: 'Complete the bold flag check and header attachment for continuation tables:',
        },
        codeTemplate: `if (span["___0___"] & 16) and span["size"] >= 11.5:
    headings.append(span["text"].strip())
...
if "MÃ" not in first_row and len(grid[0]) == len(last_headers):
    return [___1___] + grid`,
        answers: ['flags', 'last_headers'],
        hints: [
          { vi: 'Khóa trong dictionary của span chứa bitmask kiểu chữ', en: 'Span dict key holding font style bitmasks' },
          { vi: 'Danh sách tên cột lưu từ bảng trang trước', en: 'Header row saved from the preceding page' },
        ],
        explanation: {
          vi: '`span["flags"] & 16` phát hiện chữ đậm, và `[last_headers] + grid` phục hồi header cho trang nối tiếp.',
          en: '`span["flags"] & 16` detects bold fonts and `[last_headers] + grid` restores continuation headers.',
        },
      },
      quiz: {
        question: {
          vi: 'Khi một ảnh chụp bảng chứng khoán bị nghiêng góc 5 độ, bước nào trong pipeline hiện tại dễ sai lệch nhất nếu không xoay phẳng ảnh lại?',
          en: 'When a photographed stock table is tilted by 5 degrees, which step breaks first without deskewing?',
        },
        options: [
          {
            vi: 'Thuật toán gom dòng theo `y_tolerance=5.0px` sẽ trộn chữ ở đầu dòng trên với cuối dòng dưới.',
            en: '`y_tolerance=5.0px` row clustering merges the start of one row with the end of the adjacent row.',
          },
          {
            vi: 'Hàm `json.dump()` bị lỗi UTF-8.',
            en: '`json.dump()` fails UTF-8 encoding.',
          },
          {
            vi: '`joblib.load()` không đọc được file `.pkl`.',
            en: '`joblib.load()` fails to load `.pkl`.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Gom dòng dựa trên giả định chữ nằm ngang; ảnh nghiêng làm tọa độ `y` trôi dần từ trái sang phải.',
          en: 'Correct! Horizontal `y` clustering assumes level text lines; tilt shifts `y` linearly across columns.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'extract_bold_headings(p1) + attach_missing_header(p5)',
        terminalLines: [
          '[PyMuPDF dict] Bold headings found: ["NHẬN ĐỊNH THỊ TRƯỜNG", "TIN DOANH NGHIỆP"]',
          '[Page 5 Table] Missing header row detected; cols=8 matches last_headers (cols=8)',
          '[Merged] Prepended ["Mã", "Giá", "P/E", "P/B", "ROE", "KLTB 20N", "GTGD", "% 1D"]',
          '[OK] 35 continuation rows routed cleanly to ML DataFrame',
        ],
      },
      checkpointItems: [
        {
          vi: 'Biết cách đọc thông tin font chữ và kích thước từ `page.get_text("dict")`.',
          en: 'Extract font size and bold flags via `page.get_text("dict")`.',
        },
        {
          vi: 'Hiểu giải pháp xử lý ảnh nghiêng (OpenCV) và bảng kéo dài nhiều trang.',
          en: 'Handle tilted scans (OpenCV) and multi-page continuation tables.',
        },
      ],
      studyApis: ['page.get_text("dict")', 'cv2.minAreaRect', 'attach_missing_header'],
    },
  ],
};
