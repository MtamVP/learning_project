import { TroubleshootingCase } from '../types';

export const TROUBLESHOOTING_BY_STEP: Record<string, TroubleshootingCase[]> = {
  '1.2': [
    {
      symptom: {
        vi: 'Playwright báo thiếu file thực thi trình duyệt Chromium khi chạy lần đầu trên Windows',
        en: 'Playwright raises ExecutableDoesNotExist on first Windows run',
      },
      traceback: `playwright._impl._errors.Error: BrowserType.launch: Executable doesn't exist at C:\\Users\\Admin\\AppData\\Local\\ms-playwright\\chromium-1148\\chrome-win\\chrome.exe`,
      cause: {
        vi: 'Lệnh `pip install playwright` chỉ cài thư viện Python điều khiển, chưa tải bộ nhân trình duyệt Chromium về máy.',
        en: '`pip install playwright` installs only the Python driver package without browser binaries.',
      },
      fix: {
        vi: 'Chạy một lần duy nhất lệnh `playwright install chromium` trong môi trường ảo `venv` rồi chạy lại script.',
        en: 'Run `playwright install chromium` once inside your virtual environment, then retry.',
      },
    },
  ],
  '1.4': [
    {
      symptom: {
        vi: 'Lỗi OSError khi chuyển chuỗi số timestamp 13 chữ số sang ngày tháng trên Windows',
        en: 'OSError: [Errno 22] Invalid argument when calling datetime.fromtimestamp()',
      },
      traceback: `ValueError / OSError: [Errno 22] Invalid argument
  File "scripts/scrape_masvn.py", line 55, in get_report_links
    date_str = datetime.fromtimestamp(ts).strftime("%Y%m%d")`,
      cause: {
        vi: 'Quên chia `1000` cho chuỗi Unix timestamp mili-giây (`1731456000000`), khiến Python hiểu nhầm là năm ~56,834 vượt giới hạn C `time_t` trên Windows.',
        en: 'Passing a 13-digit millisecond integer without `/ 1000` overflows Windows `time_t` bounds.',
      },
      fix: {
        vi: 'Luôn chia cho `1000`: `ts = int(match2.group(1)) / 1000` trước khi truyền vào `datetime.fromtimestamp(ts)`.',
        en: 'Divide milliseconds to seconds first: `ts = int(match2.group(1)) / 1000`.',
      },
    },
  ],
  '1.5': [
    {
      symptom: {
        vi: 'Playwright treo 30 giây rồi crash khi bấm nút "Tải thêm" trên trang MASVN',
        en: 'TimeoutError: locator.click: Timeout 30000ms exceeded (intercepted pointer)',
      },
      traceback: `playwright._impl._errors.TimeoutError: Locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator("text=/Tải thêm|Load more/i").first
  - element is visible, enabled and stable
  - <div class="chat-widget-bubble">...</div> intercepts pointer events`,
      cause: {
        vi: 'Bong bóng chat hỗ trợ góc dưới bên phải màn hình nằm đè lên đúng vị trí nút "Tải thêm", khiến cơ chế kiểm tra an toàn của Playwright từ chối click.',
        en: 'A floating support chat widget overlaps the bottom-right "Load more" button and intercepts pointer events.',
      },
      fix: {
        vi: 'Gọi `load_more_btn.first.scroll_into_view_if_needed()` rồi truyền `force=True` vào `.click(force=True)`.',
        en: 'Scroll into view first and pass `force=True` to `.click(force=True)`.',
      },
    },
  ],
  '1.6': [
    {
      symptom: {
        vi: 'PyMuPDF báo lỗi FileDataError khi mở một file vừa tải về từ web',
        en: 'fitz.FileDataError: cannot open broken document when opening a downloaded PDF',
      },
      traceback: `fitz.fitz.FileDataError: Failed to open file 'data/raw_pdfs/report_20261110.pdf': cannot open broken document`,
      cause: {
        vi: 'Link PDF bị lỗi tạm thời nhưng server vẫn trả mã HTTP 200 kèm nội dung trang HTML thông báo lỗi thay vì file PDF nhị phân.',
        en: 'Server returned HTTP 200 with an HTML error page instead of binary PDF bytes.',
      },
      fix: {
        vi: 'Xóa file `.pdf` hỏng đó và luôn giữ điều kiện `if "application/pdf" in response.headers.get("Content-Type", ""):` trước khi `write_bytes()`.',
        en: 'Delete the corrupt file and guard writes with `if "application/pdf" in response.headers.get("Content-Type", ""):`.',
      },
    },
  ],
  '2.3': [
    {
      symptom: {
        vi: 'Hết bộ nhớ GPU hoặc tốc độ train cực chậm khi quên bật T4 GPU trên Colab',
        en: 'Training runs on CPU at ~40s/epoch on Google Colab',
      },
      traceback: `Ultralytics 8.3.x  Python-3.11  torch-2.5.1+cpu  CPU (Intel Xeon)
WARNING: Training YOLO on CPU will take several hours.`,
      cause: {
        vi: 'Colab mặc định cấp Runtime CPU nếu không chuyển tay sang T4 GPU, hoặc đã hết hạn mức GPU miễn phí trong ngày.',
        en: 'Colab defaulted to CPU runtime instead of T4 GPU.',
      },
      fix: {
        vi: 'Trên Colab vào `Runtime -> Change runtime type -> T4 GPU`, chạy `!nvidia-smi` xác nhận có Tesla T4 rồi mới chạy `model.train(...)`.',
        en: 'Switch via `Runtime -> Change runtime type -> T4 GPU` and verify with `!nvidia-smi`.',
      },
    },
  ],
  '3.2': [
    {
      symptom: {
        vi: 'Xung đột CUDA / cuDNN hoặc tràn 8GB VRAM khi PaddleOCR và Ollama chạy cùng lúc',
        en: 'PaddleOCR GPU initialization consumes ~2GB VRAM and triggers CUDA OOM with Ollama',
      },
      traceback: `RuntimeError: CUDA error: out of memory (allocated 7.92 GiB / 8.00 GiB on RTX 5060)`,
      cause: {
        vi: 'Để mặc định `use_gpu=True` khiến PaddleOCR tranh giành GPU với `YOLOv11n` (~0.3GB) và `Qwen2.5:7b` (~4.9GB).',
        en: 'Leaving `use_gpu=True` lets PaddleOCR allocate ~2GB VRAM alongside YOLOv11n and Ollama.',
      },
      fix: {
        vi: 'Ép `use_gpu=False` khi khởi tạo `PaddleOCR` để đẩy sang 24GB RAM CPU, đồng thời gọi `release_gpu_memory()` sau bước YOLO.',
        en: 'Pin `PaddleOCR(..., use_gpu=False)` to 24GB CPU RAM and call `release_gpu_memory()` post-YOLO.',
      },
    },
  ],
  '3.5': [
    {
      symptom: {
        vi: 'Mở file stock_metrics.csv bằng Excel trên Windows bị lỗi font chữ tiếng Việt',
        en: 'Vietnamese characters appear garbled (mojibake) when opening stock_metrics.csv in Windows Excel',
      },
      traceback: `Cột hiển thị trong Excel: "MÃ£", "GiÃ¡", "Ä á»™ tin cáº­y"`,
      cause: {
        vi: 'Xuất CSV với `encoding="utf-8"` thiếu Byte Order Mark (BOM), nên Excel Windows mặc định đọc bằng bảng mã `cp1252`.',
        en: 'Standard `utf-8` omits BOM, causing Windows Excel to guess `cp1252`.',
      },
      fix: {
        vi: 'Luôn dùng `df.to_csv(path, index=False, encoding="utf-8-sig")` khi xuất CSV chứa tiếng Việt.',
        en: 'Export with `encoding="utf-8-sig"` so Excel auto-detects UTF-8.',
      },
    },
  ],
  '4.4': [
    {
      symptom: {
        vi: 'Lỗi số lượng hoặc sai tên cột khi gọi StockScorer.score() trên bảng mới bóc tách',
        en: 'ValueError: X has 8 features, but ColumnTransformer is expecting 9 features',
      },
      traceback: `ValueError: X has 8 features, but ColumnTransformer is expecting 9 features as input.
Columns missing: {'liquidity_ratio'}`,
      cause: {
        vi: 'Truyền thẳng DataFrame thô từ `table_parser.py` vào `pipeline.predict()` mà quên tính cột phái sinh `liquidity_ratio`.',
        en: 'Passing raw parsed columns directly to `pipeline.predict()` without recomputing `liquidity_ratio`.',
      },
      fix: {
        vi: 'Luôn gọi qua phương thức `self._prepare_features(df)` trong `StockScorer` để tạo `liquidity_ratio` và sắp đúng thứ tự `self.feature_names`.',
        en: 'Always route inputs through `StockScorer._prepare_features(df)` to align all 9 columns.',
      },
    },
  ],
  '5.4': [
    {
      symptom: {
        vi: 'Không kết nối được Ollama trên cổng 11434 khi chạy app.py',
        en: 'requests.exceptions.ConnectionError: HTTPConnectionPool(host="localhost", port=11434)',
      },
      traceback: `requests.exceptions.ConnectionError: HTTPConnectionPool(host='localhost', port=11434): Max retries exceeded with url: /api/generate`,
      cause: {
        vi: 'Dịch vụ Ollama chưa được bật chạy nền trên Windows, hoặc bạn chưa kéo model bằng `ollama pull qwen2.5:7b`.',
        en: 'The background Ollama service is stopped or `qwen2.5:7b` has not been pulled yet.',
      },
      fix: {
        vi: 'Mở ứng dụng Ollama (hoặc chạy `ollama serve`), chạy `ollama pull qwen2.5:7b`, sau đó kiểm tra bằng `ollama list`.',
        en: 'Launch Ollama (`ollama serve`), run `ollama pull qwen2.5:7b`, and verify with `ollama list`.',
      },
    },
  ],
  '6.1': [
    {
      symptom: {
        vi: 'Streamlit báo lỗi StreamlitAPIException ngay khi mở web',
        en: 'streamlit.errors.StreamlitAPIException: set_page_config() can only be called once and must be the first Streamlit command',
      },
      traceback: `streamlit.errors.StreamlitAPIException: set_page_config() can only be called once per app page, and must be called as the first Streamlit command in your script.`,
      cause: {
        vi: 'Có một lệnh `st.title()`, `st.sidebar` hoặc `st.write()` vô tình chạy trước dòng `st.set_page_config(layout="wide")`.',
        en: 'Another `st.*` UI command executed prior to `st.set_page_config(layout="wide")`.',
      },
      fix: {
        vi: 'Đặt `st.set_page_config(...)` ở ngay đầu file `app.py` (trước mọi hàm `st.*` khác kể cả trong `@st.cache_resource` nếu bên trong có `st.toast/st.write`).',
        en: 'Move `st.set_page_config(...)` to the top of `app.py` before any other `st.*` call.',
      },
    },
  ],
  '6.3': [
    {
      symptom: {
        vi: 'Qwen2.5:7b phản hồi chậm bất thường (~4 tok/s thay vì ~48 tok/s trên RTX 5060)',
        en: 'Ollama spills 50% layers to CPU RAM due to concurrent VRAM usage',
      },
      traceback: `$ ollama ps
NAME            SIZE    PROCESSOR
qwen2.5:7b      5.2 GB  45% CPU / 55% GPU`,
      cause: {
        vi: 'Trình duyệt Chrome/VS Code + bộ nhớ đệm PyTorch của YOLO vẫn đang giữ VRAM làm Ollama không nạp hết 100% lớp vào 8GB VRAM.',
        en: 'Unfreed PyTorch CUDA cache or heavy GPU apps leave insufficient contiguous VRAM for Ollama.',
      },
      fix: {
        vi: 'Gọi `release_gpu_memory()` (`gc.collect()` + `torch.cuda.empty_cache()`) ngay sau bước trích xuất YOLO và đặt `num_ctx 4096`.',
        en: 'Call `release_gpu_memory()` right after YOLO extraction and cap `num_ctx` at `4096`.',
      },
    },
  ],
  '7.2': [
    {
      symptom: {
        vi: 'FastAPI chạy trong Docker báo ConnectionRefused khi gọi Ollama trên máy host',
        en: 'Containerized FastAPI fails to reach host Ollama on localhost:11434',
      },
      traceback: `requests.exceptions.ConnectionError: Failed to establish a new connection: [Errno 111] Connection refused ('localhost', 11434)`,
      cause: {
        vi: 'Bên trong Docker container, `localhost` trỏ vào chính container đó chứ không phải máy Windows/Linux bên ngoài.',
        en: '`localhost` inside a Docker container refers to the container loopback interface, not the host.',
      },
      fix: {
        vi: 'Truyền biến môi trường `OLLAMA_URL=http://host.docker.internal:11434/api/generate` khi chạy `docker run`.',
        en: 'Point `ollama_url` to `http://host.docker.internal:11434/api/generate` inside Docker.',
      },
    },
  ],
};

export function getTroubleshootingForStep(stepId: string): TroubleshootingCase[] {
  return TROUBLESHOOTING_BY_STEP[stepId] || [];
}
