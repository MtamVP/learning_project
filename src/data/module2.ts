import { ModuleSpec } from '../types';

const NOTEBOOK_01_CODE = `import fitz  # PyMuPDF
from pathlib import Path

BASE_DIR = Path("..").resolve()
RAW_PDF_DIR = BASE_DIR / "data" / "raw_pdfs"
IMG_OUT_DIR = BASE_DIR / "data" / "yolo_raw_images"

# Nguyên tắc chống rò rỉ dữ liệu: Chia tách theo ĐƠN VỊ FILE PDF trước khi xuất ảnh
all_pdfs = sorted(RAW_PDF_DIR.glob("report_*.pdf"))[:20]
train_pdfs = all_pdfs[:16]   # 16 báo cáo -> ~145 ảnh train/val
test_pdfs = all_pdfs[16:20]  # 4 báo cáo hoàn toàn độc lập -> ~35 ảnh test


def export_pdf_pages(pdf_list, split_name: str, dpi: int = 150):
    out_dir = IMG_OUT_DIR / split_name
    out_dir.mkdir(parents=True, exist_ok=True)
    saved_count = 0

    for pdf_path in pdf_list:
        doc = fitz.open(pdf_path)
        stem = pdf_path.stem  # vd: report_20261113
        for page_num in range(len(doc)):
            page = doc[page_num]
            pix = page.get_pixmap(dpi=dpi)
            out_file = out_dir / f"{stem}_p{page_num + 1:02d}.jpg"
            pix.save(str(out_file))
            saved_count += 1
        doc.close()

    print(f"[{split_name}] Exported {saved_count} images from {len(pdf_list)} PDFs.")


if __name__ == "__main__":
    export_pdf_pages(train_pdfs, "train_pool", dpi=150)
    export_pdf_pages(test_pdfs, "holdout_test", dpi=150)`;

const NOTEBOOK_02_CODE = `# Chạy trên Google Colab (Runtime -> Change runtime type -> T4 GPU)
# !pip install -q ultralytics

from ultralytics import YOLO

# 1. Tải trọng số pre-trained nhẹ nhất dòng YOLO11 (phù hợp 8GB VRAM local)
model = YOLO("yolo11n.pt")

# 2. Huấn luyện nhận diện 3 lớp: Table, Text, Figure
results = model.train(
    data="/content/yolo_dataset/data.yaml",
    epochs=60,
    imgsz=640,
    batch=16,
    scale=0.5,
    translate=0.1,
    mosaic=1.0,
    project="masvn_layout",
    name="yolo11n_v1",
    patience=15,
)

# 3. Đánh giá trên tập test độc lập (4 file PDF chưa từng thấy)
metrics = model.val(split="test")
print(f"mAP50: {metrics.box.map50:.4f} | mAP50-95: {metrics.box.map:.4f}")

# 4. Tải file runs/detect/masvn_layout/yolo11n_v1/weights/best.pt
#    đổi tên thành models/yolo_masvn_layout.pt trên máy local`;

const YOLO_INFERENCE_SNIPPET = `from ultralytics import YOLO
import numpy as np

class LayoutDetector:
    """Wrapper YOLOv11n nhận diện vùng Table, Text, Figure trên trang báo cáo."""

    CLASS_NAMES = {0: "Table", 1: "Text", 2: "Figure"}

    def __init__(self, weights_path: str = "models/yolo_masvn_layout.pt", conf: float = 0.4):
        self.model = YOLO(weights_path)
        self.conf = conf

    def detect(self, image_or_array):
        results = self.model.predict(
            source=image_or_array,
            conf=self.conf,
            verbose=False,
        )
        detections = []
        boxes = results[0].boxes
        if boxes is None or len(boxes) == 0:
            return detections

        xyxy = boxes.xyxy.cpu().numpy()
        classes = boxes.cls.cpu().numpy().astype(int)
        confs = boxes.conf.cpu().numpy()

        for (x0, y0, x1, y1), cls_id, score in zip(xyxy, classes, confs):
            detections.append({
                "label": self.CLASS_NAMES.get(cls_id, "Unknown"),
                "bbox": [float(x0), float(y0), float(x1), float(y1)],
                "conf": round(float(score), 4),
            })

        # Sắp xếp từ trên xuống dưới theo tọa độ y0 để giữ đúng thứ tự đọc
        detections.sort(key=lambda d: d["bbox"][1])
        return detections`;

export const module2: ModuleSpec = {
  id: 'mod-2',
  number: 2,
  title: {
    vi: 'Học phần 2: Thị giác Máy tính & Định vị Bố cục (Layout Detection)',
    en: 'Module 2: Computer Vision & Layout Detection (YOLOv11n)',
  },
  summary: {
    vi: 'Xuất PDF thành ảnh không rò rỉ dữ liệu, gán nhãn 3 lớp (Table, Text, Figure) trên Roboflow, huấn luyện YOLOv11n trên Colab T4 và trích xuất tọa độ bounding box.',
    en: 'Render PDFs to images without data leakage, annotate Table/Text/Figure in Roboflow, fine-tune YOLOv11n on Colab T4, and extract bounding boxes.',
  },
  stack: ['PyMuPDF (fitz)', 'Roboflow', 'Google Colab T4', 'ultralytics (YOLOv11n)'],
  steps: [
    {
      id: '2.1',
      moduleId: 'mod-2',
      tier: 1,
      title: {
        vi: 'Bước 2.1: Xuất PDF thành ảnh với PyMuPDF & Chống Data Leakage',
        en: 'Step 2.1: PDF-to-Image Rendering with PyMuPDF & Anti-Leakage Split',
      },
      subtitle: {
        vi: 'Chuyển 20 file PDF thành ~180 ảnh .jpg ở 150 DPI trong `notebooks/01_pdf_to_images.ipynb`.',
        en: 'Convert 20 PDFs into ~180 .jpg pages at 150 DPI inside `notebooks/01_pdf_to_images.ipynb`.',
      },
      targetFile: 'notebooks/01_pdf_to_images.ipynb',
      whyAndWhat: {
        why: {
          vi: 'Các bản tin MASVN mỗi ngày có bố cục giống hệt nhau (trang 1 tin vĩ mô, trang 4–6 bảng Top 100 cổ phiếu). Nếu bạn gộp tất cả 180 ảnh trang rồi chia ngẫu nhiên 80/20 vào Train và Test, trang 4 ngày 12/11 ở tập Train sẽ gần như giống hệt trang 4 ngày 13/11 ở tập Test — gây **rò rỉ dữ liệu (Data Leakage)** và làm điểm mAP ảo. Ta bắt buộc phải tách **16 file PDF riêng cho Train** và **4 file PDF riêng cho Test** trước khi xuất ảnh.',
          en: 'Daily MASVN reports share identical templates across days. Mixing all 180 rendered pages and randomly splitting 80/20 puts near-identical layouts from consecutive days into both Train and Test, inflating mAP via **data leakage**. Splitting strictly by **document level** (16 PDFs Train, 4 PDFs Test) before rendering prevents leakage.',
        },
        ifMissing: {
          vi: 'Độ chính xác trên tập test bị ảo (99% giả tạo), nhưng khi đưa một mẫu bản tin tháng mới vào thực tế thì model dự đoán sai lệch nghiêm trọng. Ngoài ra, dùng `dpi=72` quá mờ khiến chữ nhỏ trong bảng bị nhòe, còn `dpi=300` lại quá nặng.',
          en: 'Test metrics appear artificially high (~99% mAP) yet fail on new layouts. Meanwhile, 72 DPI blurs small table text while 300 DPI bloats disk/upload size unnecessarily.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'fitz.open(pdf_path)',
          params: 'filename: Path | str',
          inputType: 'Path | str',
          outputType: 'fitz.Document',
          description: {
            vi: 'Mở file PDF để truy cập từng trang như một mảng (`len(doc)`, `doc[page_num]`).',
            en: 'Opens a PDF document supporting indexing (`doc[page_num]`) and length (`len(doc)`).',
          },
        },
        {
          symbol: 'page.get_pixmap(dpi=150)',
          params: 'dpi: int = 150',
          inputType: 'int',
          outputType: 'fitz.Pixmap',
          description: {
            vi: 'Kết xuất vector PDF thành ảnh bitmap sắc nét ở độ phân giải 150 DPI — điểm cân bằng tốt nhất cho chữ nhỏ chứng khoán và kích thước ảnh YOLO 640px.',
            en: 'Rasterizes a PDF page at 150 DPI—the sweet spot for crisp financial tables without huge file sizes.',
          },
        },
        {
          symbol: 'pix.save(path)',
          params: 'filename: str',
          inputType: 'str',
          outputType: 'None',
          description: {
            vi: 'Lưu đối tượng `Pixmap` ra ảnh `.jpg` hoặc `.png`. Nhớ gọi `doc.close()` sau khi xong mỗi file.',
            en: 'Writes the rasterized `Pixmap` to `.jpg` or `.png`. Always close `doc` afterward to free file handles.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Mở 1 file PDF và lưu trang đầu tiên', en: 'Stage 1: Render Page 1 of a Single PDF' },
          summary: {
            vi: 'Nắm 4 dòng cơ bản nhất của PyMuPDF (`fitz`).',
            en: 'Learn the 4 core PyMuPDF (`fitz`) lines to render one page.',
          },
          code: `import fitz

doc = fitz.open("../data/raw_pdfs/report_20261113.pdf")
pix = doc[0].get_pixmap(dpi=150)
pix.save("page_01.jpg")
doc.close()`,
          expectedNote: {
            vi: 'Mỗi trang A4 ở 150 DPI cho ảnh khoảng 1240×1754 px, đọc rõ mọi số liệu bảng.',
            en: 'An A4 page at 150 DPI produces roughly 1240×1754 px—sharp enough for dense tables.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Chia PDF trước khi xuất ảnh (Anti-Leakage)', en: 'Stage 2: Document-Level Split Before Rendering' },
          summary: {
            vi: 'Cắt danh sách file PDF thành 16 train / 4 test rồi mới chạy vòng lặp trang.',
            en: 'Slice the sorted PDF list into 16 train / 4 test documents before looping over pages.',
          },
          code: `all_pdfs = sorted(RAW_PDF_DIR.glob("report_*.pdf"))[:20]
train_pdfs = all_pdfs[:16]
test_pdfs = all_pdfs[16:20]
print(f"Train PDFs: {len(train_pdfs)}, Test PDFs: {len(test_pdfs)}")`,
          expectedNote: {
            vi: 'Tuyệt đối không trộn các trang cùng một ngày vào cả Train và Test.',
            en: 'Pages from the same report date never appear in both Train and Test.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Viết hàm export_pdf_pages() hoàn chỉnh', en: 'Stage 3: Complete export_pdf_pages() Notebook Script' },
          summary: {
            vi: 'Đặt tên ảnh chuẩn `{stem}_p{page_num+1:02d}.jpg` để dễ truy vết ngược lại file PDF gốc.',
            en: 'Name outputs `{stem}_p{page_num+1:02d}.jpg` so every image traces back to its exact PDF and page.',
          },
          code: NOTEBOOK_01_CODE,
          expectedNote: {
            vi: 'Sinh ra khoảng ~180 ảnh sạch sẵn sàng kéo thả vào Roboflow.',
            en: 'Generates ~180 clean JPGs ready to upload to Roboflow.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 1/4: Notebook notebooks/01_pdf_to_images.ipynb',
        en: 'Piece 1/4: Notebook notebooks/01_pdf_to_images.ipynb',
      },
      builderExplanation: {
        vi: 'Script đầy đủ để chuyển 20 file PDF đầu tiên thành 2 thư mục ảnh `train_pool` (16 PDF) và `holdout_test` (4 PDF) ở 150 DPI.',
        en: 'Complete script converting 20 PDFs into `train_pool` (16 PDFs) and `holdout_test` (4 PDFs) folders at 150 DPI.',
      },
      builderCode: NOTEBOOK_01_CODE,
      highlightLines: [8, 29],
      lineWalkthrough: [
        {
          lines: 'L9-L11',
          snippet: 'all_pdfs = sorted(RAW_PDF_DIR.glob("report_*.pdf"))[:20]\ntrain_pdfs = all_pdfs[:16]\ntest_pdfs = all_pdfs[16:20]',
          explanation: {
            vi: 'Chia theo đơn vị báo cáo (16 file cũ hơn train, 4 file mới hơn test) giúp đánh giá đúng khả năng tổng quát hóa theo thời gian.',
            en: 'Chronological document split (16 older for training, 4 newer for testing) evaluates real temporal generalization.',
          },
        },
        {
          lines: 'L22-L25',
          snippet: 'pix = page.get_pixmap(dpi=dpi)\nout_file = out_dir / f"{stem}_p{page_num + 1:02d}.jpg"\npix.save(str(out_file))',
          explanation: {
            vi: 'Format `:02d` giúp trang 1 là `_p01` thay vì `_p1`, giữ đúng thứ tự alphabet khi duyệt thư mục.',
            en: '`:02d` zero-padding formats page 1 as `_p01` so directory listings remain naturally ordered.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện đoạn chia chống rò rỉ dữ liệu và kết xuất trang PDF ở 150 DPI:',
          en: 'Complete the anti-leakage split and 150 DPI page rendering:',
        },
        codeTemplate: `train_pdfs = all_pdfs[:16]
test_pdfs = all_pdfs[___0___:20]
doc = fitz.open(pdf_path)
pix = doc[0].___1___(dpi=150)`,
        answers: ['16', 'get_pixmap'],
        hints: [
          { vi: 'Chỉ số bắt đầu của 4 file test sau 16 file train', en: 'Start slice index after the first 16 training PDFs' },
          { vi: 'Phương thức của đối tượng Page trong PyMuPDF để render ảnh', en: 'PyMuPDF Page method that renders a raster Pixmap' },
        ],
        explanation: {
          vi: 'Slice `[16:20]` lấy 4 file PDF hoàn toàn tách biệt; `get_pixmap(dpi=150)` render trang thành ảnh sắc nét.',
          en: '`[16:20]` isolates 4 unseen test PDFs, and `get_pixmap(dpi=150)` renders crisp page images.',
        },
      },
      quiz: {
        question: {
          vi: 'Vì sao phải chia Train/Test theo **file PDF** trước khi chuyển sang ảnh thay vì xuất hết 180 ảnh rồi chia ngẫu nhiên 80/20?',
          en: 'Why split Train/Test by **PDF document** before rendering pages rather than randomly splitting all 180 rendered page images?',
        },
        options: [
          {
            vi: 'Vì các bản tin nhiều ngày có bố cục giống nhau; chia ngẫu nhiên theo trang khiến trang của cùng một tuần xuất hiện ở cả Train và Test (Data Leakage).',
            en: 'Because daily templates repeat across days; random page splitting leaks near-identical layouts across Train and Test.',
          },
          {
            vi: 'Vì PyMuPDF không cho phép xuất ảnh nếu chưa chia list.',
            en: 'Because PyMuPDF refuses to render unsplit lists.',
          },
          {
            vi: 'Vì YOLO chỉ đọc được tên file có chứa chữ `train` hoặc `test`.',
            en: 'Because YOLO requires filenames to include `train` or `test`.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Chính xác! Chống rò rỉ dữ liệu theo nhóm (Group/Document Split) là quy tắc vàng trong Computer Vision cho tài liệu.',
          en: 'Correct! Document-grouped splitting is mandatory in document AI to avoid inflated validation metrics.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'python notebooks/01_pdf_to_images.py',
        terminalLines: [
          '[train_pool] Exported 144 images from 16 PDFs -> data/yolo_raw_images/train_pool/',
          '  sample: report_20260902_p01.jpg (1240x1754, 248 KB)',
          '  sample: report_20260902_p04.jpg (1240x1754, 312 KB)',
          '[holdout_test] Exported 36 images from 4 PDFs -> data/yolo_raw_images/holdout_test/',
          '[Done] Total 180 pages exported at 150 DPI with 0 document overlap.',
        ],
      },
      checkpointItems: [
        {
          vi: 'Hiểu quy tắc Group/Document Split chống rò rỉ dữ liệu khi làm bài toán tài liệu.',
          en: 'Understand document-level splitting to prevent layout data leakage.',
        },
        {
          vi: 'Nắm được 3 lệnh cốt lõi của PyMuPDF: `fitz.open`, `get_pixmap(dpi=150)`, `pix.save`.',
          en: 'Know the 3 core PyMuPDF calls: `fitz.open`, `get_pixmap(dpi=150)`, and `pix.save`.',
        },
      ],
      studyApis: ['fitz.open', 'Page.get_pixmap', 'Pixmap.save', 'Path.glob'],
      completeFiles: [
        {
          path: 'notebooks/01_pdf_to_images.ipynb',
          language: 'python',
          code: NOTEBOOK_01_CODE,
          notebookCells: [
            { type: 'markdown', content: '# 01 - Export MASVN PDFs to Images (150 DPI, Anti-Leakage Split)' },
            { type: 'code', content: NOTEBOOK_01_CODE },
          ],
        },
      ],
    },
    {
      id: '2.2',
      moduleId: 'mod-2',
      tier: 1,
      title: {
        vi: 'Bước 2.2: Gán nhãn Roboflow (Table, Text, Figure) & Chuẩn YOLO TXT',
        en: 'Step 2.2: Roboflow Annotation (Table, Text, Figure) & YOLO TXT Format',
      },
      subtitle: {
        vi: 'Hiểu cách vẽ Bounding Box cho 3 lớp bố cục và công thức chuẩn hóa tọa độ `[0, 1]` trong `data.yaml` + `.txt`.',
        en: 'Learn the 3 layout classes, normalized `[0, 1]` YOLO bounding box math, and `data.yaml` structure.',
      },
      targetFile: 'data/yolo_dataset/data.yaml',
      whyAndWhat: {
        why: {
          vi: 'Nếu đẩy thẳng cả trang PDF vào OCR hay `get_text()`, chữ chú thích bên trong **biểu đồ nến (`Figure`)** sẽ trộn lẫn vào đoạn **văn bản nhận định (`Text`)**, còn số trong **bảng cổ phiếu (`Table`)** sẽ bị đọc ngang qua cột bên cạnh. Gán nhãn 3 lớp giúp YOLOv11n tách rạch ròi từng vùng: `Table` đưa sang `table_parser.py`, `Text` đưa sang `rag_engine.py`, còn `Figure` bị loại bỏ để không gây nhiễu.',
          en: 'Parsing an entire page blindly mixes candlestick chart axis labels (`Figure`) with narrative commentary (`Text`) and scrambles multi-column numbers (`Table`). Labeling 3 distinct classes lets YOLOv11n route `Table` to the table parser, `Text` to RAG chunks, and discard `Figure` noise.',
        },
        ifMissing: {
          vi: 'Kéo khung cẩu thả (ví dụ gộp cả tiêu đề bảng lẫn biểu đồ vào `Table`) sẽ làm thuật toán gom dòng/cột ở Học phần 3 bị nhiễm rác, tạo ra cột `P/E` hoặc `ROE` sai định dạng.',
          en: 'Sloppy boxes (e.g., including chart legends inside a `Table` box) inject garbage tokens into Module 3 row/column clustering.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'Class 0: Table',
          params: 'Trang 4–6, 11 (cổ phiếu) & Trang 1–3 (vĩ mô)',
          inputType: 'Bounding Box',
          outputType: 'cls_id = 0',
          description: {
            vi: 'Kéo sát mép bảng gồm cả hàng tiêu đề cột (`Mã`, `Giá`, `P/E`, `ROE`...) nhưng KHÔNG bao gồm đoạn văn bản bên ngoài.',
            en: 'Tightly wraps the table including column headers, excluding surrounding paragraphs.',
          },
        },
        {
          symbol: 'Class 1: Text',
          params: 'Nhận định thị trường, tin doanh nghiệp, tiêu đề mục',
          inputType: 'Bounding Box',
          outputType: 'cls_id = 1',
          description: {
            vi: 'Khoanh từng khối văn bản mạch lạc để đưa vào kho tri thức RAG.',
            en: 'Wraps coherent prose blocks and section headings for RAG ingestion.',
          },
        },
        {
          symbol: 'Class 2: Figure',
          params: 'Biểu đồ VN-Index, đồ thị cột dòng tiền',
          inputType: 'Bounding Box',
          outputType: 'cls_id = 2',
          description: {
            vi: 'Đánh dấu để hệ thống nhận biết và BỎ QUA khi đọc chữ, tránh số trục tung/hoành lọt vào văn bản.',
            en: 'Explicitly detected so the extractor ignores chart axis labels and numbers.',
          },
        },
        {
          symbol: 'YOLO TXT Format',
          params: '<cls> <x_c> <y_c> <w> <h>',
          inputType: 'Pixel coords (x0, y0, x1, y1)',
          outputType: 'Normalized [0..1]',
          description: {
            vi: '`x_c = ((x0+x1)/2)/W`, `y_c = ((y0+y1)/2)/H`, `w = (x1-x0)/W`, `h = (y1-y0)/H`.',
            en: 'Center coordinates and box dimensions divided by image width `W` and height `H`.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Công thức chuyển đổi tọa độ Pixel -> YOLO [0, 1]', en: 'Stage 1: Pixel-to-YOLO Normalization Formula' },
          summary: {
            vi: 'Tại sao YOLO không lưu tọa độ pixel tuyệt đối? Để khi resize ảnh về `640x640`, tọa độ tỉ lệ vẫn giữ nguyên.',
            en: 'Normalizing by image width/height keeps labels valid even when YOLO resizes inputs to `640x640`.',
          },
          code: `def to_yolo_txt(cls_id, x0, y0, x1, y1, img_w, img_h):
    x_center = ((x0 + x1) / 2.0) / img_w
    y_center = ((y0 + y1) / 2.0) / img_h
    width = (x1 - x0) / img_w
    height = (y1 - y0) / img_h
    return f"{cls_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}"

print(to_yolo_txt(0, 62, 520, 1180, 1480, 1240, 1754))`,
          expectedNote: {
            vi: 'Kết quả: `0 0.500806 0.570125 0.901613 0.547320` — 5 số trên 1 dòng cho mỗi hộp.',
            en: 'Outputs `0 0.500806 0.570125 0.901613 0.547320`—one line per bounding box.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Cấu trúc thư mục & data.yaml xuất từ Roboflow', en: 'Stage 2: Roboflow Export & data.yaml' },
          summary: {
            vi: 'Kiểm tra đúng thứ tự `names` trong `data.yaml` khớp với chỉ số 0, 1, 2.',
            en: 'Verify `names` indices in `data.yaml` match classes 0, 1, and 2.',
          },
          code: `train: ../train/images
val: ../valid/images
test: ../test/images

nc: 3
names: ['Table', 'Text', 'Figure']`,
          expectedNote: {
            vi: 'Tuyệt đối tắt các phép augmentation lật ngang/xoay 90° trên Roboflow vì chữ và bảng bị ngược sẽ làm sai bố cục!',
            en: 'Disable horizontal flip and 90° rotation augmentations in Roboflow—upside-down tables hurt document layout models!',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Hàm đảo ngược YOLO TXT -> Pixel xyxy để kiểm tra nhãn', en: 'Stage 3: Verify Labels Back in Pixel Coordinates' },
          summary: {
            vi: 'Hàm tiện ích giúp vẽ kiểm tra lại file nhãn `.txt` xem có bị lệch không trước khi bấm Train.',
            en: 'Utility to convert normalized YOLO labels back to pixel `xyxy` for visual QA.',
          },
          code: `def yolo_to_xyxy(line: str, img_w: int, img_h: int):
    cls_id, xc, yc, w, h = map(float, line.strip().split())
    x0 = (xc - w / 2) * img_w
    y0 = (yc - h / 2) * img_h
    x1 = (xc + w / 2) * img_w
    y1 = (yc + h / 2) * img_h
    return int(cls_id), [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)]`,
          expectedNote: {
            vi: 'Hữu ích khi kiểm tra trực quan tập `yolo_dataset/` tải từ Roboflow về.',
            en: 'Handy for sanity-checking exported labels before uploading to Colab.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 2/4: Chuẩn hóa tệp cấu hình data/yolo_dataset/data.yaml',
        en: 'Piece 2/4: Dataset Config data/yolo_dataset/data.yaml',
      },
      builderExplanation: {
        vi: 'File `data.yaml` là cầu nối nói cho `YOLOv11n` biết vị trí 3 tập `train/valid/test` và tên 3 lớp `Table`, `Text`, `Figure`.',
        en: '`data.yaml` tells `YOLOv11n` where `train/valid/test` images live and defines the 3 class labels.',
      },
      builderCode: `path: /content/yolo_dataset
train: train/images
val: valid/images
test: test/images

nc: 3
names:
  0: Table
  1: Text
  2: Figure`,
      highlightLines: [1, 10],
      lineWalkthrough: [
        {
          lines: 'L1-L4',
          snippet: 'path: /content/yolo_dataset\ntrain: train/images\nval: valid/images\ntest: test/images',
          explanation: {
            vi: 'Đường dẫn gốc trên Google Colab; Ultralytics tự suy ra thư mục `labels/` tương ứng khi thay `images` bằng `labels`.',
            en: 'Root dataset path on Colab; Ultralytics automatically pairs `train/images` with `train/labels`.',
          },
        },
        {
          lines: 'L6-L10',
          snippet: 'nc: 3\nnames:\n  0: Table\n  1: Text\n  2: Figure',
          explanation: {
            vi: 'Số lớp `nc: 3` và thứ tự ID cố định để Module 3 lọc `cls == 0` (Table) và `cls == 1` (Text).',
            en: '`nc: 3` fixes class IDs so Module 3 can reliably filter `cls == 0` (Table) and `cls == 1` (Text).',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện công thức chuẩn hóa tọa độ tâm `x_center` và chiều rộng `width` sang định dạng YOLO `[0, 1]`:',
          en: 'Complete the YOLO `[0, 1]` normalization formula for `x_center` and `width`:',
        },
        codeTemplate: `x_center = ((x0 + x1) / 2.0) / ___0___
width = (x1 - x0) / ___0___
y_center = ((y0 + y1) / 2.0) / ___1___`,
        answers: ['img_w', 'img_h'],
        hints: [
          { vi: 'Chiều rộng của ảnh gốc theo pixel', en: 'Width of the source image in pixels' },
          { vi: 'Chiều cao của ảnh gốc theo pixel', en: 'Height of the source image in pixels' },
        ],
        explanation: {
          vi: 'Trục X chia cho `img_w`, trục Y chia cho `img_h` để mọi giá trị nằm gọn trong đoạn `[0, 1]`.',
          en: 'X coordinates divide by `img_w` and Y coordinates divide by `img_h` so all values lie in `[0, 1]`.',
        },
      },
      quiz: {
        question: {
          vi: 'Vì sao khi xuất dataset từ Roboflow cho bài toán bố cục báo cáo tài chính ta KHÔNG nên bật Augmentation "Flip Horizontal" (Lật ngang)?',
          en: 'Why should "Flip Horizontal" augmentation be disabled in Roboflow for financial report layout detection?',
        },
        options: [
          {
            vi: 'Vì bảng số liệu bị lật ngược chữ từ phải sang trái không bao giờ xuất hiện trong thực tế và làm nhiễu đặc trưng cột tiêu đề.',
            en: 'Because mirrored text and right-to-left reversed tables never occur in real PDFs and confuse header features.',
          },
          {
            vi: 'Vì YOLO không hỗ trợ ảnh đã lật.',
            en: 'Because YOLO crashes on flipped images.',
          },
          {
            vi: 'Vì Roboflow tính phí cho tính năng lật ảnh.',
            en: 'Because Roboflow charges extra for horizontal flip.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Tài liệu chữ Việt/Anh luôn có chiều đọc cố định từ trái sang phải, trên xuống dưới.',
          en: 'Correct! Document layouts have fixed reading orientation, so horizontal flips create unrealistic training examples.',
        },
      },
      simulation: {
        kind: 'yolo_canvas',
        commandLabel: 'Roboflow QA Preview — report_20261113_p01.jpg',
        yoloPageTitle: {
          vi: 'Bản tin MASVN Trang 1 (Mô phỏng khung nhãn 3 lớp)',
          en: 'MASVN Report Page 1 (Simulated 3-Class Layout Boxes)',
        },
        yoloBoxes: [
          {
            label: 'Text',
            conf: 0.96,
            x: 6,
            y: 7,
            w: 88,
            h: 24,
            previewText: 'NHẬN ĐỊNH THỊ TRƯỜNG: VN-Index đóng cửa tăng +6.4 điểm (+0.51%) đạt 1,268.4 điểm. Khối ngoại mua ròng nhẹ tại FPT, MBB...',
          },
          {
            label: 'Table',
            conf: 0.94,
            x: 6,
            y: 35,
            w: 44,
            h: 26,
            previewText: 'Chỉ số / Tỷ giá | Điểm | 1D% | YTD%\nVN-Index | 1,268.4 | +0.5% | +12.1%\nUSD/VND | 25,723 | +0.2% | +1.5%',
          },
          {
            label: 'Figure',
            conf: 0.91,
            x: 53,
            y: 35,
            w: 41,
            h: 26,
            previewText: '[Candlestick Chart: VN-Index 20D Volume & RSI]',
          },
          {
            label: 'Text',
            conf: 0.93,
            x: 6,
            y: 65,
            w: 88,
            h: 28,
            previewText: 'TIN DOANH NGHIỆP: FPT công bố doanh thu 10T tăng 19.5% YoY; MBB duy trì tỷ lệ CASA dẫn đầu ngành...',
          },
        ],
      },
      checkpointItems: [
        {
          vi: 'Phân biệt rõ vai trò của 3 lớp `0: Table`, `1: Text`, `2: Figure`.',
          en: 'Know the distinct routing purpose of `0: Table`, `1: Text`, and `2: Figure`.',
        },
        {
          vi: 'Biết quy đổi tọa độ pixel sang tọa độ chuẩn hóa YOLO `[0, 1]`.',
          en: 'Know how to convert pixel coordinates into normalized YOLO `[0, 1]` labels.',
        },
      ],
      studyApis: ['Roboflow Export', 'data.yaml', 'YOLO TXT format'],
      completeFiles: [
        {
          path: 'data/yolo_dataset/data.yaml',
          language: 'yaml',
          code: `path: /content/yolo_dataset\ntrain: train/images\nval: valid/images\ntest: test/images\n\nnc: 3\nnames:\n  0: Table\n  1: Text\n  2: Figure`,
        },
      ],
    },
    {
      id: '2.3',
      moduleId: 'mod-2',
      tier: 2,
      title: {
        vi: 'Bước 2.3: Huấn luyện YOLOv11n trên Google Colab T4 GPU',
        en: 'Step 2.3: Training YOLOv11n on Google Colab T4 GPU',
      },
      subtitle: {
        vi: 'Hiểu từng tham số `epochs=60, imgsz=640, batch=16, scale=0.5, translate=0.1, mosaic=1.0` và cách đọc chỉ số mAP50.',
        en: 'Configure `epochs=60, imgsz=640, batch=16, scale=0.5, translate=0.1, mosaic=1.0` and interpret mAP50 vs overfitting.',
      },
      targetFile: 'notebooks/02_train_yolo_colab.ipynb',
      whyAndWhat: {
        why: {
          vi: 'Ta chọn dòng `yolo11n.pt` (Nano — chỉ ~2.6M tham số) vì trên máy local có **8GB VRAM (RTX 5060)** cần chừa ~5GB VRAM cho LLM Qwen2.5:7b. `YOLOv11n` chỉ tiêu tốn ~0.3GB VRAM khi chạy suy luận mà vẫn đạt `mAP50 > 0.94` trên bố cục chuẩn hóa như bản tin MASVN. Việc huấn luyện thực hiện trên Google Colab T4 miễn phí trong ~8 phút rồi tải file `best.pt` về `models/yolo_masvn_layout.pt`.',
          en: 'We choose `yolo11n.pt` (Nano, ~2.6M params) because our local **8GB VRAM (RTX 5060)** must reserve ~5GB for Qwen2.5:7b. YOLOv11n consumes only ~0.3GB VRAM at inference while achieving >0.94 mAP50 on structured MASVN layouts. Training on Colab T4 takes ~8 minutes and yields `models/yolo_masvn_layout.pt`.',
        },
        ifMissing: {
          vi: 'Nếu dùng model quá nặng (như `yolo11x.pt` hoặc LayoutLMv3 lớn), máy 8GB VRAM sẽ bị tràn bộ nhớ CUDA Out-of-Memory khi chạy song song cùng Ollama.',
          en: 'Heavy models (e.g., `yolo11x` or large transformers) compete with Ollama for the 8GB VRAM budget and trigger CUDA OOM.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'YOLO("yolo11n.pt")',
          params: 'weights path',
          inputType: 'str',
          outputType: 'YOLO model',
          description: {
            vi: 'Nạp kiến trúc YOLOv11 Nano đã pre-train trên tập COCO để transfer learning nhanh với chỉ ~144 ảnh.',
            en: 'Loads COCO-pretrained YOLOv11 Nano weights for fast transfer learning on ~144 training pages.',
          },
        },
        {
          symbol: 'model.train(...)',
          params: 'epochs=60, imgsz=640, batch=16',
          inputType: 'hyperparameters',
          outputType: 'Training results + best.pt',
          description: {
            vi: 'Huấn luyện 60 vòng lặp với kích thước ảnh đầu vào 640px và mỗi batch 16 ảnh.',
            en: 'Trains for 60 epochs at 640px resolution with batch size 16.',
          },
        },
        {
          symbol: 'scale=0.5, translate=0.1, mosaic=1.0',
          params: 'Augmentation controls',
          inputType: 'float',
          outputType: 'On-the-fly transforms',
          description: {
            vi: 'Thu phóng 50%, dịch chuyển 10% và ghép 4 ảnh (`mosaic=1.0`) giúp model học nhận diện cả bảng nhỏ trang 1 lẫn bảng lớn trang 4.',
            en: 'Scales up to 50%, shifts 10%, and stitches 4-page mosaics so the detector generalizes across small macro tables and full-page stock tables.',
          },
        },
        {
          symbol: 'mAP50 & mAP50-95',
          params: 'Validation metrics',
          inputType: 'Predictions vs GT',
          outputType: 'float [0..1]',
          description: {
            vi: '`mAP50` đo độ chính xác ở ngưỡng chồng lấn IoU >= 0.5; `mAP50-95` đo trung bình IoU từ 0.5 đến 0.95 (khắt khe hơn).',
            en: '`mAP50` measures precision-recall area at IoU >= 0.5; `mAP50-95` averages across IoU 0.50–0.95.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Kiểm tra GPU & Thử nạp YOLO11n trên Colab', en: 'Stage 1: Verify Colab T4 GPU & Load YOLO11n' },
          summary: {
            vi: 'Đảm bảo Colab đã bật GPU T4 trước khi train (CPU train 60 epoch sẽ mất hàng giờ).',
            en: 'Confirm T4 GPU is active on Colab before starting the 60-epoch training run.',
          },
          code: `!nvidia-smi
!pip install -q ultralytics
from ultralytics import YOLO

model = YOLO("yolo11n.pt")
print("Loaded YOLOv11n parameters:", sum(p.numel() for p in model.model.parameters()))`,
          expectedNote: {
            vi: 'Khoảng ~2.6 triệu tham số, cực nhẹ và nhanh.',
            en: 'Roughly ~2.6M parameters—lightweight and fast.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Cấu hình tham số Train phù hợp bố cục tài liệu', en: 'Stage 2: Document-Tuned Training Config' },
          summary: {
            vi: 'Sử dụng `scale=0.5, translate=0.1, mosaic=1.0` và `patience=15` để tự dừng sớm nếu Val Loss không giảm.',
            en: 'Use `scale=0.5, translate=0.1, mosaic=1.0` plus `patience=15` early stopping.',
          },
          code: `results = model.train(
    data="/content/yolo_dataset/data.yaml",
    epochs=60,
    imgsz=640,
    batch=16,
    scale=0.5,
    translate=0.1,
    mosaic=1.0,
    patience=15,
)`,
          expectedNote: {
            vi: 'Nếu `val/box_loss` tăng trong khi `train/box_loss` giảm liên tục -> dấu hiệu Overfitting; `patience=15` sẽ giữ lại `best.pt` ở epoch tốt nhất.',
            en: 'If `val/box_loss` rises while `train/box_loss` drops, Ultralytics saves the best checkpoint via `best.pt`.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Notebook hoàn chỉnh kèm kiểm thử trên Holdout Test', en: 'Stage 3: Full Notebook + Holdout Test Validation' },
          summary: {
            vi: 'Đánh giá lại trên `split="test"` (4 file PDF chưa từng thấy) rồi tải `best.pt` về `models/yolo_masvn_layout.pt`.',
            en: 'Evaluate on `split="test"` (the 4 unseen PDFs) and download `best.pt` to `models/yolo_masvn_layout.pt`.',
          },
          code: NOTEBOOK_02_CODE,
          expectedNote: {
            vi: 'File `yolo_masvn_layout.pt` có dung lượng chỉ ~5.5 MB!',
            en: 'The resulting `yolo_masvn_layout.pt` weights file is only ~5.5 MB!',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 3/4: Notebook notebooks/02_train_yolo_colab.ipynb',
        en: 'Piece 3/4: Notebook notebooks/02_train_yolo_colab.ipynb',
      },
      builderExplanation: {
        vi: 'Code hoàn chỉnh chạy trên Google Colab GPU T4 để huấn luyện `yolo11n.pt`, đánh giá trên 4 PDF test độc lập và xuất trọng số `best.pt`.',
        en: 'Complete Google Colab T4 notebook training `yolo11n.pt`, running holdout test evaluation, and producing `best.pt`.',
      },
      builderCode: NOTEBOOK_02_CODE,
      highlightLines: [9, 25],
      lineWalkthrough: [
        {
          lines: 'L10-L20',
          snippet: 'results = model.train(\n    data="/content/yolo_dataset/data.yaml",\n    epochs=60,\n    imgsz=640,\n    batch=16,\n    scale=0.5,\n    translate=0.1,\n    mosaic=1.0,\n)',
          explanation: {
            vi: 'Khớp đúng bộ siêu tham số tối ưu cho bố cục tài liệu chứng khoán.',
            en: 'Exact hyperparameter set tuned for structured financial document layout detection.',
          },
        },
        {
          lines: 'L24-L25',
          snippet: 'metrics = model.val(split="test")\nprint(f"mAP50: {metrics.box.map50:.4f} | mAP50-95: {metrics.box.map:.4f}")',
          explanation: {
            vi: 'Đo lường khách quan trên 4 file PDF test đã tách từ Bước 2.1 để ghi vào bảng Benchmark của `README.md`.',
            en: 'Unbiased evaluation on the 4 holdout PDFs from Step 2.1 for the `README.md` benchmark table.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện lệnh huấn luyện YOLOv11n trên Colab với `epochs=60`, `imgsz=640`, `batch=16`:',
          en: 'Complete the YOLOv11n training call with `epochs=60`, `imgsz=640`, `batch=16`:',
        },
        codeTemplate: `model = YOLO("___0___")
results = model.train(
    data="/content/yolo_dataset/data.yaml",
    epochs=60, imgsz=640, batch=___1___,
    scale=0.5, translate=0.1, mosaic=1.0
)`,
        answers: ['yolo11n.pt', '16'],
        hints: [
          { vi: 'Tên file trọng số bản Nano của YOLOv11', en: 'Pretrained Nano weights filename for YOLOv11' },
          { vi: 'Kích thước lô ảnh mỗi bước cập nhật gradient', en: 'Mini-batch size specified in the configuration' },
        ],
        explanation: {
          vi: '`yolo11n.pt` là bản Nano nhẹ nhất (~0.3GB VRAM suy luận) và `batch=16` chạy mượt mà trên T4 GPU 15GB.',
          en: '`yolo11n.pt` keeps inference under ~0.3GB VRAM, and `batch=16` fits comfortably on Colab T4.',
        },
      },
      quiz: {
        question: {
          vi: 'Khi xem biểu đồ kết quả train, dấu hiệu nào cho thấy mô hình đang bị Overfitting (học vẹt)?',
          en: 'On the training curves, what indicates the model is overfitting?',
        },
        options: [
          {
            vi: '`train/box_loss` tiếp tục giảm sát 0, nhưng `val/box_loss` ngừng giảm hoặc bắt đầu tăng lên.',
            en: '`train/box_loss` keeps dropping toward 0 while `val/box_loss` plateaus or starts rising.',
          },
          {
            vi: 'Cả `train/box_loss` và `val/box_loss` cùng giảm đều.',
            en: 'Both `train/box_loss` and `val/box_loss` decrease steadily together.',
          },
          {
            vi: '`mAP50` cao hơn `mAP50-95`.',
            en: '`mAP50` is higher than `mAP50-95`.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! `mAP50` luôn >= `mAP50-95` là bình thường; chỉ khi loss trên tập validation đi ngược chiều tăng lên mới là Overfitting.',
          en: 'Correct! `mAP50` is naturally >= `mAP50-95`; diverging validation loss is the classic sign of overfitting.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'model.val(split="test") on Colab T4',
        terminalLines: [
          'Ultralytics 8.3.x  Python-3.11  torch-2.5.1+cu124  CUDA:0 (Tesla T4, 15102MiB)',
          'Epoch 60/60 completed in 7m 42s. Best checkpoint saved -> weights/best.pt',
          '                 Class     Images  Instances      Box(P      R      mAP50  mAP50-95)',
          '                   all         36        148       0.946  0.932   0.958     0.861',
          '                 Table         36         42       0.961  0.952   0.971     0.904',
          '                  Text         36         78       0.944  0.923   0.955     0.848',
          '                Figure         36         28       0.933  0.921   0.948     0.831',
          '[Export] Copy weights/best.pt -> masvn-intelligence/models/yolo_masvn_layout.pt',
        ],
      },
      checkpointItems: [
        {
          vi: 'Hiểu tại sao chọn `yolo11n.pt` thay vì các biến thể lớn để tiết kiệm 8GB VRAM local.',
          en: 'Understand why `yolo11n.pt` fits the 8GB local VRAM budget.',
        },
        {
          vi: 'Đọc hiểu các chỉ số `Precision`, `Recall`, `mAP50`, `mAP50-95`.',
          en: 'Interpret `Precision`, `Recall`, `mAP50`, and `mAP50-95` validation tables.',
        },
      ],
      studyApis: ['YOLO.train', 'YOLO.val', 'mAP50', 'mAP50-95'],
      completeFiles: [
        {
          path: 'notebooks/02_train_yolo_colab.ipynb',
          language: 'python',
          code: NOTEBOOK_02_CODE,
          notebookCells: [
            { type: 'markdown', content: '# 02 - Train YOLOv11n Layout Detector on Google Colab T4' },
            { type: 'code', content: NOTEBOOK_02_CODE },
          ],
        },
      ],
    },
    {
      id: '2.4',
      moduleId: 'mod-2',
      tier: 3,
      title: {
        vi: 'Bước 2.4: Suy luận Local & Bóc tách tọa độ Bounding Box (xyxy)',
        en: 'Step 2.4: Local Inference & Extracting Bounding Box Coordinates (xyxy)',
      },
      subtitle: {
        vi: 'Gọi `model.predict(source=img, conf=0.4, verbose=False)` và quy đổi Tensor GPU về NumPy `[x0, y0, x1, y1]`.',
        en: 'Run `model.predict(source=img, conf=0.4, verbose=False)` and unpack `.xyxy`, `.cls`, and `.conf` tensors into clean dicts.',
      },
      targetFile: 'src/extractor.py',
      whyAndWhat: {
        why: {
          vi: 'Kết quả trả về của `model.predict()` nằm trong đối tượng PyTorch Tensor trên GPU (`cuda:0`). Để Học phần 3 (PyMuPDF / Pillow / PaddleOCR) đọc được tọa độ giao nhau hình học và cắt ảnh, ta phải chuyển các tensor `.xyxy`, `.cls`, `.conf` từ GPU sang NumPy trên CPU (`.cpu().numpy()`), lọc ngưỡng tự tin `conf=0.4` và sắp xếp các hộp theo trục dọc `y0` từ trên xuống dưới.',
          en: '`model.predict()` returns GPU-resident PyTorch tensors. Downstream modules (PyMuPDF geometric checks and Pillow cropping) expect plain CPU coordinates, so we call `.cpu().numpy()` on `.xyxy`, `.cls`, and `.conf`, filter with `conf=0.4`, and sort detections top-to-bottom by `y0`.',
        },
        ifMissing: {
          vi: 'Gọi trực tiếp tọa độ từ Tensor CUDA vào `PIL.Image.crop()` hoặc `fitz.Rect()` sẽ báo lỗi `TypeError` hoặc giữ tham chiếu bộ nhớ GPU gây rò rỉ VRAM qua hàng chục trang PDF.',
          en: 'Passing CUDA tensors directly to `PIL` or `fitz` raises `TypeError`, and retaining tensor references leaks GPU VRAM across multi-page batches.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'model.predict(source, conf=0.4, verbose=False)',
          params: 'source, conf, verbose',
          inputType: 'np.ndarray | PIL.Image | str',
          outputType: 'list[Results]',
          description: {
            vi: 'Chạy suy luận 1 ảnh; `conf=0.4` loại bỏ các khung dự đoán mờ nhạt, `verbose=False` giữ terminal sạch sẽ.',
            en: 'Runs inference on an image; `conf=0.4` prunes weak false positives and `verbose=False` silences per-frame spam.',
          },
        },
        {
          symbol: 'boxes.xyxy.cpu().numpy()',
          params: 'No args',
          inputType: 'torch.Tensor (N, 4)',
          outputType: 'np.ndarray (N, 4)',
          description: {
            vi: 'Lấy tọa độ góc trên-trái `(x0, y0)` và dưới-phải `(x1, y1)` theo đơn vị pixel ảnh đầu vào.',
            en: 'Extracts top-left `(x0, y0)` and bottom-right `(x1, y1)` pixel coordinates as a NumPy array.',
          },
        },
        {
          symbol: 'boxes.cls.cpu().numpy() & boxes.conf.cpu().numpy()',
          params: 'No args',
          inputType: 'torch.Tensor (N,)',
          outputType: 'np.ndarray (N,)',
          description: {
            vi: 'Lấy chỉ số lớp (`0, 1, 2`) và xác suất tin cậy tương ứng với từng khung.',
            en: 'Extracts class IDs (`0, 1, 2`) and confidence scores aligned with `xyxy`.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Chạy predict thử trên 1 ảnh', en: 'Stage 1: Minimal Predict on One Image' },
          summary: {
            vi: 'In số lượng vùng phát hiện được từ `results[0].boxes`.',
            en: 'Print how many layout boxes were detected from `results[0].boxes`.',
          },
          code: `from ultralytics import YOLO

model = YOLO("models/yolo_masvn_layout.pt")
results = model.predict(source="page_04.jpg", conf=0.4, verbose=False)
print("Detected boxes:", len(results[0].boxes))`,
          expectedNote: {
            vi: '`results` luôn là một list (mỗi phần tử ứng với 1 ảnh đầu vào), nên với 1 ảnh ta lấy `results[0]`.',
            en: '`predict()` always returns a list (one `Results` per input image), so single-image inference indexes `results[0]`.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Giải nén .xyxy, .cls, .conf về NumPy & Sắp xếp theo y0', en: 'Stage 2: Unpack Tensors to NumPy & Sort by y0' },
          summary: {
            vi: 'Sắp xếp `y0` tăng dần giúp giữ đúng thứ tự đọc tự nhiên của văn bản trong bản tin.',
            en: 'Sorting ascending by `y0` preserves top-to-bottom reading order.',
          },
          code: `boxes = results[0].boxes
xyxy = boxes.xyxy.cpu().numpy()
classes = boxes.cls.cpu().numpy().astype(int)
confs = boxes.conf.cpu().numpy()

for (x0, y0, x1, y1), cls_id, score in zip(xyxy, classes, confs):
    print(f"cls={cls_id} conf={score:.2f} box=({x0:.0f}, {y0:.0f}, {x1:.0f}, {y1:.0f})")`,
          expectedNote: {
            vi: 'Nhờ gọi `.cpu().numpy()`, mảng tọa độ tách hoàn toàn khỏi đồ thị PyTorch CUDA.',
            en: '`.cpu().numpy()` detaches coordinate arrays from CUDA memory immediately.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Lớp LayoutDetector sẵn sàng nối vào Học phần 3', en: 'Stage 3: Reusable LayoutDetector Class' },
          summary: {
            vi: 'Đóng gói thành class `LayoutDetector` có `CLASS_NAMES` rõ ràng và kiểm tra rỗng an toàn.',
            en: 'Package into `LayoutDetector` with `CLASS_NAMES` mapping and empty-box guard.',
          },
          code: YOLO_INFERENCE_SNIPPET,
          expectedNote: {
            vi: 'Đầu ra `detections` chuẩn bị giao tiếp trực tiếp với PyMuPDF và PaddleOCR ở Học phần 3.',
            en: 'The returned `detections` list feeds directly into PyMuPDF and PaddleOCR in Module 3.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 4/4: Bộ định vị bố cục LayoutDetector',
        en: 'Piece 4/4: LayoutDetector Inference Wrapper',
      },
      builderExplanation: {
        vi: 'Class `LayoutDetector` nạp trọng số `models/yolo_masvn_layout.pt`, chạy suy luận với `conf=0.4` và trả về danh sách dictionary sạch đã sắp xếp từ trên xuống dưới.',
        en: '`LayoutDetector` loads `models/yolo_masvn_layout.pt`, runs `conf=0.4` inference, and returns top-to-bottom sorted detection dicts.',
      },
      builderCode: YOLO_INFERENCE_SNIPPET,
      highlightLines: [12, 37],
      lineWalkthrough: [
        {
          lines: 'L13-L17',
          snippet: 'results = self.model.predict(\n    source=image_or_array,\n    conf=self.conf,\n    verbose=False,\n)',
          explanation: {
            vi: '`source` nhận linh hoạt đường dẫn ảnh, `PIL.Image` hoặc mảng `numpy` của OpenCV.',
            en: '`source` accepts a file path, `PIL.Image`, or NumPy array seamlessly.',
          },
        },
        {
          lines: 'L24-L26',
          snippet: 'xyxy = boxes.xyxy.cpu().numpy()\nclasses = boxes.cls.cpu().numpy().astype(int)\nconfs = boxes.conf.cpu().numpy()',
          explanation: {
            vi: 'Chuyển cả 3 tensor từ GPU sang NumPy trên CPU trước khi lặp qua bằng `zip()`.',
            en: 'Moves all three tensors from GPU to CPU NumPy arrays before iterating with `zip()`.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện đoạn chuyển tọa độ bounding box từ Tensor GPU sang mảng NumPy CPU:',
          en: 'Complete moving bounding box tensors from GPU to CPU NumPy arrays:',
        },
        codeTemplate: `boxes = results[0].boxes
xyxy = boxes.___0___.cpu().numpy()
classes = boxes.___1___.cpu().numpy().astype(int)
confs = boxes.conf.cpu().numpy()`,
        answers: ['xyxy', 'cls'],
        hints: [
          { vi: 'Thuộc tính chứa tọa độ 4 góc [x0, y0, x1, y1]', en: 'Attribute holding [x0, y0, x1, y1] corner coordinates' },
          { vi: 'Thuộc tính chứa ID lớp dự đoán', en: 'Attribute holding predicted class IDs' },
        ],
        explanation: {
          vi: '`boxes.xyxy` trả về tọa độ 4 góc `[x0, y0, x1, y1]`, còn `boxes.cls` trả về ID lớp (`0, 1, 2`).',
          en: '`boxes.xyxy` holds corner coordinates `[x0, y0, x1, y1]` while `boxes.cls` holds class IDs (`0, 1, 2`).',
        },
      },
      quiz: {
        question: {
          vi: 'Tại sao ta sắp xếp danh sách `detections` theo `d["bbox"][1]` (tọa độ `y0`) tăng dần?',
          en: 'Why sort `detections` ascending by `d["bbox"][1]` (`y0`)?',
        },
        options: [
          {
            vi: 'Vì YOLO trả các hộp theo độ tự tin giảm dần, không theo thứ tự từ trên xuống dưới của trang báo cáo; sắp xếp theo `y0` giúp giữ đúng mạch văn bản.',
            en: 'YOLO outputs boxes sorted by confidence, not page position; sorting by `y0` restores natural top-to-bottom reading order.',
          },
          {
            vi: 'Vì PyMuPDF chỉ đọc được tọa độ đã sắp xếp tăng dần.',
            en: 'Because PyMuPDF crashes on unsorted boxes.',
          },
          {
            vi: 'Để giảm kích thước file `.pt`.',
            en: 'To shrink `.pt` file size.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Giữ đúng thứ tự đọc từ trên xuống dưới rất quan trọng khi ghép các khối `Text` làm ngữ cảnh cho RAG.',
          en: 'Correct! Preserving top-to-bottom reading order keeps narrative RAG chunks coherent.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'LayoutDetector("models/yolo_masvn_layout.pt").detect("report_20261113_p04.jpg")',
        terminalLines: [
          '[YOLOv11n] Inference on CUDA:0 (RTX 5060) finished in 11.4 ms | VRAM allocated: 0.28 GB',
          '  box[0]: label=Text   conf=0.95  bbox=[64.2, 48.0, 1172.5, 132.4]',
          '  box[1]: label=Table  conf=0.97  bbox=[58.0, 148.6, 1184.0, 1620.8]  # Top 100 Stocks',
          '  box[2]: label=Text   conf=0.89  bbox=[60.4, 1645.1, 840.2, 1702.0]',
        ],
      },
      checkpointItems: [
        {
          vi: 'Biết cách trích xuất `.xyxy`, `.cls`, `.conf` sang NumPy từ kết quả Ultralytics.',
          en: 'Know how to unpack `.xyxy`, `.cls`, and `.conf` into CPU NumPy arrays.',
        },
        {
          vi: 'Hiểu lý do cần lọc `conf=0.4` và sắp xếp lại các vùng theo trục dọc `y0`.',
          en: 'Understand `conf=0.4` filtering and vertical `y0` sorting.',
        },
      ],
      studyApis: ['YOLO.predict', 'boxes.xyxy', 'boxes.cls', 'boxes.conf', '.cpu().numpy()'],
      completeFiles: [
        {
          path: 'src/layout_detector_preview.py',
          language: 'python',
          code: YOLO_INFERENCE_SNIPPET,
        },
      ],
    },
    {
      id: '2.5',
      moduleId: 'mod-2',
      tier: 3,
      title: {
        vi: 'Bước 2.5: Mở rộng công cụ — Cơ chế IoU/NMS trong YOLOv11 & Xuất ONNX',
        en: 'Step 2.5: Tool Deep Dive — YOLOv11 IoU/NMS & Exporting to ONNX',
      },
      subtitle: {
        vi: 'Hiểu sâu cách NMS loại bỏ khung chồng lấn (`iou=0.45`), đọc 3 hàm mất mát `box/cls/dfl` và xuất model `.onnx` chạy không cần PyTorch.',
        en: 'Understand Non-Maximum Suppression (`iou=0.45`), `box/cls/dfl` losses, and exporting `.onnx` for PyTorch-free deployment.',
      },
      targetFile: 'models/yolo_masvn_layout.pt',
      whyAndWhat: {
        why: {
          vi: 'Khi dùng `YOLOv11n` ngoài dự án này (ví dụ trên server CPU không có GPU hay edge device), bạn cần hiểu cơ chế **NMS (Non-Maximum Suppression)** lọc các khung dự đoán trùng nhau quanh một bảng biểu, cũng như cách xuất trọng số `.pt` sang định dạng chuẩn **ONNX** (`model.export(format="onnx")`) để tăng tốc suy luận CPU lên gấp 2–3 lần mà không phải cài trọn gói `torch` 2GB.',
          en: 'Beyond this capstone, deploying detectors to CPU servers or edge devices requires mastering **NMS (Non-Maximum Suppression)** to prune overlapping boxes and exporting `.pt` weights to **ONNX** (`model.export(format="onnx")`) for 2–3x faster CPU inference without shipping a 2GB PyTorch runtime.',
        },
        ifMissing: {
          vi: 'Nếu đặt ngưỡng `iou` quá cao (0.9) thì một bảng cổ phiếu bị đẻ ra 2–3 khung chồng lên nhau làm lặp dữ liệu; nếu quá thấp (0.15) thì hai đoạn `Text` nằm sát nhau bị gộp mất một đoạn.',
          en: 'Too high an `iou` threshold duplicates table detections; too low merges adjacent `Text` paragraphs.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'model.predict(..., iou=0.45)',
          params: 'iou: float = 0.45',
          inputType: 'float [0..1]',
          outputType: 'Deduplicated boxes',
          description: {
            vi: 'Nếu hai khung cùng lớp có tỉ lệ giao/hợp (IoU) > 0.45, NMS giữ khung điểm cao nhất và xóa khung thừa.',
            en: 'When same-class boxes overlap above IoU 0.45, NMS keeps the highest-confidence box and suppresses duplicates.',
          },
        },
        {
          symbol: 'model.export(format="onnx", imgsz=640)',
          params: 'format="onnx", simplify=True',
          inputType: '.pt weights',
          outputType: '.onnx graph',
          description: {
            vi: 'Đóng băng đồ thị mạng nơ-ron sang file `.onnx` độc lập, chạy được với `onnxruntime` chỉ nặng ~15MB.',
            en: 'Exports a static `.onnx` graph runnable via lightweight `onnxruntime` (~15MB).',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Tự tính chỉ số IoU (Intersection over Union) bằng Python', en: 'Stage 1: Compute IoU From Scratch' },
          summary: {
            vi: 'Hiểu bản chất phép đo độ chồng lấn giữa 2 hình chữ nhật `boxA` và `boxB`.',
            en: 'Understand the geometry behind overlap ratios for two bounding boxes.',
          },
          code: `def compute_iou(a, b):
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (area_a + area_b - inter + 1e-9)

print("IoU:", round(compute_iou([50, 100, 500, 400], [60, 110, 490, 390]), 3))`,
          expectedNote: {
            vi: 'Hai khung này chồng nhau ~0.88 > 0.45 -> NMS sẽ tự động xóa khung có độ tự tin thấp hơn.',
            en: 'Overlap ~0.88 > 0.45 -> NMS suppresses the lower-confidence duplicate.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Tinh chỉnh iou=0.45 & agnostic_nms khi bảng sát nhau', en: 'Stage 2: Tune iou & agnostic_nms' },
          summary: {
            vi: 'Bật `agnostic_nms=True` khi một bảng vĩ mô bị mô hình nhận nhầm vừa là `Table` vừa là `Text`.',
            en: 'Enable `agnostic_nms=True` when the same region gets both a `Table` and `Text` box.',
          },
          code: `results = model.predict(
    source="page_01.jpg",
    conf=0.4,
    iou=0.45,
    agnostic_nms=True,
    verbose=False,
)`,
          expectedNote: {
            vi: '`agnostic_nms=True` xử lý chồng lấn kể cả khác lớp (`Table` đè `Text`).',
            en: '`agnostic_nms=True` suppresses overlapping detections even across different classes.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Xuất sang ONNX để deploy nhẹ ngoài Colab/PyTorch', en: 'Stage 3: Export to ONNX for Production Servers' },
          summary: {
            vi: 'Chuyển `yolo_masvn_layout.pt` -> `yolo_masvn_layout.onnx` chỉ với 1 lệnh.',
            en: 'Convert `yolo_masvn_layout.pt` -> `yolo_masvn_layout.onnx` in one call.',
          },
          code: `from ultralytics import YOLO

model = YOLO("models/yolo_masvn_layout.pt")
onnx_path = model.export(format="onnx", imgsz=640, simplify=True)
print("Exported ONNX:", onnx_path)

# Ultralytics đọc trực tiếp file .onnx qua onnxruntime:
onnx_model = YOLO(onnx_path)
res = onnx_model.predict("page_04.jpg", conf=0.4, verbose=False)`,
          expectedNote: {
            vi: 'Kiến thức này áp dụng trực tiếp khi bạn đóng gói microservice chỉ chạy CPU trên cloud.',
            en: 'Directly applicable when deploying lightweight CPU-only inference containers.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mở rộng YOLOv11: NMS & Xuất ONNX',
        en: 'YOLOv11 Extension: NMS & ONNX Export',
      },
      builderExplanation: {
        vi: 'Tích hợp `iou=0.45`, `agnostic_nms=True` và kịch bản xuất ONNX cho môi trường không có GPU.',
        en: 'Adds `iou=0.45`, `agnostic_nms=True`, and `.onnx` export workflow for CPU production servers.',
      },
      builderCode: `from ultralytics import YOLO

def export_and_verify_onnx(pt_path: str = "models/yolo_masvn_layout.pt"):
    model = YOLO(pt_path)
    onnx_path = model.export(format="onnx", imgsz=640, simplify=True)

    # Kiểm thử suy luận với backend ONNX Runtime
    ort_model = YOLO(onnx_path, task="detect")
    results = ort_model.predict(
        source="page_04.jpg",
        conf=0.4,
        iou=0.45,
        agnostic_nms=True,
        verbose=False,
    )
    print(f"ONNX inference boxes: {len(results[0].boxes)}")`,
      highlightLines: [5, 14],
      lineWalkthrough: [
        {
          lines: 'L5',
          snippet: 'onnx_path = model.export(format="onnx", imgsz=640, simplify=True)',
          explanation: {
            vi: '`simplify=True` gộp các node phép tính thừa trong đồ thị ONNX giúp chạy CPU nhanh hơn.',
            en: '`simplify=True` folds redundant graph ops for faster ONNX Runtime execution.',
          },
        },
        {
          lines: 'L10-L15',
          snippet: 'iou=0.45,\nagnostic_nms=True',
          explanation: {
            vi: 'Chống tình trạng 1 bảng bị nhận diện kép thành cả `Table` lẫn `Text`.',
            en: 'Prevents the same region from being double-counted as both `Table` and `Text`.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện lệnh xuất mô hình sang định dạng ONNX và bật `agnostic_nms`:',
          en: 'Complete exporting to ONNX and enabling class-agnostic NMS:',
        },
        codeTemplate: `onnx_path = model.export(format="___0___", imgsz=640, simplify=True)
results = ort_model.predict(source=img, conf=0.4, iou=0.45, ___1___=True)`,
        answers: ['onnx', 'agnostic_nms'],
        hints: [
          { vi: 'Định dạng trao đổi mô hình đa nền tảng phổ biến nhất', en: 'Cross-runtime model exchange format' },
          { vi: 'Cờ NMS lọc chồng lấn không phân biệt nhãn lớp', en: 'Predict flag enabling cross-class NMS suppression' },
        ],
        explanation: {
          vi: '`format="onnx"` tạo đồ thị nhẹ cho `onnxruntime`; `agnostic_nms=True` xóa khung trùng ngay cả khi khác class.',
          en: '`format="onnx"` builds a portable graph and `agnostic_nms=True` resolves cross-class overlaps.',
        },
      },
      quiz: {
        question: {
          vi: 'Nếu một bảng ở Trang 1 vừa được YOLO vẽ khung `Table` (0.91) vừa bị vẽ đè một khung `Text` (0.55) lên đúng vị trí đó, tham số nào xử lý triệt để nhất?',
          en: 'If a Page 1 table receives both a `Table` (0.91) box and an overlapping `Text` (0.55) box, which predict parameter resolves it?',
        },
        options: [
          {
            vi: '`agnostic_nms=True` kết hợp ngưỡng `iou=0.45` để xóa khung yếu hơn bất kể khác nhãn lớp.',
            en: '`agnostic_nms=True` paired with `iou=0.45` suppresses the lower-scoring box across classes.',
          },
          {
            vi: 'Tăng `imgsz` lên 2048.',
            en: 'Increase `imgsz` to 2048.',
          },
          {
            vi: 'Tắt `verbose=False`.',
            en: 'Disable `verbose=False`.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! NMS mặc định chỉ lọc các khung *cùng* class; bật `agnostic_nms=True` sẽ lọc cả khung chồng lấn *khác* class.',
          en: 'Correct! Standard NMS only checks same-class pairs; `agnostic_nms=True` handles cross-class overlaps.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'export_and_verify_onnx("models/yolo_masvn_layout.pt")',
        terminalLines: [
          'PyTorch: starting from models/yolo_masvn_layout.pt (5.5 MB)',
          'ONNX: starting export with onnx 1.17.0, opset=19, simplify=True...',
          'Exported ONNX: models/yolo_masvn_layout.onnx (10.1 MB)',
          '[Benchmark CPU] PyTorch CPU: 68.4 ms/page | ONNX Runtime CPU: 24.1 ms/page (2.8x faster)',
          'ONNX inference boxes: 3 (0 duplicate cross-class overlaps)',
        ],
      },
      checkpointItems: [
        {
          vi: 'Tự tính được công thức IoU và hiểu cách NMS lọc khung trùng.',
          en: 'Understand IoU geometry and how NMS prunes duplicate boxes.',
        },
        {
          vi: 'Biết xuất model `.pt` sang `.onnx` để triển khai trên server không cần GPU.',
          en: 'Know how to export `.pt` weights to `.onnx` for lightweight CPU deployment.',
        },
      ],
      studyApis: ['compute_iou', 'agnostic_nms', 'model.export(format="onnx")'],
    },
  ],
};
