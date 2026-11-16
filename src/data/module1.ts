import { ModuleSpec } from '../types';

export const SCRAPE_MASVN_FINAL = `import os
import re
import time
import urllib3
import requests
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

# Tắt cảnh báo SSL khi dùng verify=False
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Trỏ đúng về thư mục masvn-intelligence/data/raw_pdfs/
BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "data" / "raw_pdfs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def get_report_links(limit=50):
    report_dict = {}  # Dùng dict với key là URL để tự động loại bỏ link trùng

    with sync_playwright() as p:
        print("Opening browser...")
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        url = "https://www.masvn.com/cate/bao-cao-thuong-nhat-22"
        print(f"Navigating to {url}...")
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)

        while True:
            # 1. Quét toàn bộ link hiện có trên trang
            links = page.evaluate(
                "() => Array.from(document.querySelectorAll('a')).map(a => a.href)"
            )

            for link in links:
                if link in report_dict:
                    continue

                match1 = re.search(
                    r"MiraeAsset_Daily_VN_(\\d{8})\\.pdf", link, re.IGNORECASE
                )
                if match1:
                    report_dict[link] = match1.group(1)
                    continue

                match2 = re.search(
                    r"/(\\d{13})-DailyReport_Mobile_VN\\.pdf", link, re.IGNORECASE
                )
                if match2:
                    ts = int(match2.group(1)) / 1000
                    date_str = datetime.fromtimestamp(ts).strftime("%Y%m%d")
                    report_dict[link] = date_str

            print(f"Collected {len(report_dict)} reports so far...")

            # 2. Đủ số lượng thì thoát vòng lặp
            if len(report_dict) >= limit:
                break

            # 3. Tìm và bấm nút "Tải thêm" (hỗ trợ cả tiếng Việt lẫn tiếng Anh)
            load_more_btn = page.locator("text=/Tải thêm|Load more/i")
            if load_more_btn.count() > 0 and load_more_btn.first.is_visible():
                print("Clicking 'Tải thêm'...")
                load_more_btn.first.scroll_into_view_if_needed()
                # force=True tránh bị bong bóng chat góc dưới phải che mất nút bấm
                load_more_btn.first.click(force=True)
                page.wait_for_timeout(2500)
            else:
                print("No more 'Tải thêm' button found. Reached the end of list.")
                break

        browser.close()

    # Chuyển về list [(date_str, link), ...] và sắp xếp mới nhất lên đầu
    report_links = [(date_str, link) for link, date_str in report_dict.items()]
    report_links.sort(key=lambda x: x[0], reverse=True)

    return report_links[:limit]


def download_pdf(url, output_path: Path):
    # Bỏ qua nếu file đã tải trước đó rồi
    if output_path.exists():
        print(f"Skipped (already exists): {output_path.name}")
        return

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        print(f"Downloading {output_path.name} from {url}...")
        response = requests.get(url, verify=False, headers=headers, timeout=30)
        response.raise_for_status()

        if "application/pdf" in response.headers.get("Content-Type", ""):
            output_path.write_bytes(response.content)
            print(" -> Saved successfully!")
        else:
            print(f" -> Failed: Content-Type is {response.headers.get('Content-Type')}")
    except requests.exceptions.RequestException as e:
        print(f" -> Download error: {e}")


if __name__ == "__main__":
    N = 50  # Số lượng file muốn lấy
    reports = get_report_links(limit=N)

    print(f"\\nStart downloading {len(reports)} reports into {OUTPUT_DIR}...\\n")
    for idx, (date_str, url) in enumerate(reports, start=1):
        filename = f"report_{date_str}.pdf"
        output_file = OUTPUT_DIR / filename

        print(f"[{idx}/{len(reports)}] ", end="")
        download_pdf(url, output_file)

        # Nghỉ 1 giây giữa các lần tải để tránh bị server chặn
        time.sleep(1)`;

export const module1: ModuleSpec = {
  id: 'mod-1',
  number: 1,
  title: {
    vi: 'Học phần 1: Thu thập Dữ liệu Tự động (Web Scraping)',
    en: 'Module 1: Automated Data Ingestion (Web Scraping)',
  },
  summary: {
    vi: 'Xây dựng crawler Playwright + Requests tải bản tin PDF chứng khoán MASVN theo ngày, xử lý phân trang động, bong bóng chat che nút và lỗi SSL.',
    en: 'Build a resilient Playwright + Requests scraper that fetches daily MASVN market PDFs, handles dynamic pagination, chat-widget overlays, and SSL quirks.',
  },
  stack: ['playwright', 'requests', 'urllib3', 're', 'pathlib', 'datetime'],
  steps: [
    {
      id: '1.1',
      moduleId: 'mod-1',
      tier: 1,
      title: {
        vi: 'Bước 1.1: Quản lý đường dẫn với pathlib & Tắt cảnh báo SSL',
        en: 'Step 1.1: Cross-Platform Paths with pathlib & SSL Warning Control',
      },
      subtitle: {
        vi: 'Thiết lập nền móng file scripts/scrape_masvn.py để chạy đúng từ mọi thư mục.',
        en: 'Set up the filesystem foundation of scripts/scrape_masvn.py so it works regardless of working directory.',
      },
      targetFile: 'scripts/scrape_masvn.py',
      whyAndWhat: {
        why: {
          vi: 'Nếu viết đường dẫn cứng kiểu "data/raw_pdfs", khi bạn đứng ở thư mục scripts/ rồi chạy `python scrape_masvn.py`, Python sẽ tạo nhầm thư mục `scripts/data/raw_pdfs`. Dùng `Path(__file__).resolve().parent.parent` giúp luôn xác định chính xác gốc dự án `masvn-intelligence/`. Ngoài ra, nhiều cổng tài chính Việt Nam dùng chuỗi chứng chỉ SSL thiếu intermediate CA trên Windows, gây spam cảnh báo `InsecureRequestWarning` khi truyền `verify=False`.',
          en: 'Hardcoding relative paths like "data/raw_pdfs" breaks when running the script from inside `scripts/`. Resolving `Path(__file__).resolve().parent.parent` anchors every output path to the project root `masvn-intelligence/`. Disabling `InsecureRequestWarning` keeps terminal logs readable when `verify=False` is required for local SSL quirks.',
        },
        ifMissing: {
          vi: 'Script sẽ lưu PDF sai chỗ (làm Module 2 & 3 không tìm thấy file), văng `FileNotFoundError` nếu thư mục chưa tồn tại, hoặc làm ngập terminal bằng hàng trăm dòng cảnh báo SSL.',
          en: 'PDFs get saved to the wrong directory, `FileNotFoundError` is raised if `raw_pdfs/` does not exist yet, and SSL warnings flood the console on every request.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'Path(__file__).resolve()',
          params: 'No args',
          inputType: 'str (__file__)',
          outputType: 'Path',
          description: {
            vi: 'Chuyển đường dẫn file hiện tại thành đường dẫn tuyệt đối, khử các ký tự `..` hoặc symlink.',
            en: 'Resolves the current script path into an absolute canonical Path object.',
          },
        },
        {
          symbol: '.parent.parent',
          params: 'Property chaining',
          inputType: 'Path',
          outputType: 'Path',
          description: {
            vi: '`.parent` thứ nhất ra `scripts/`, `.parent` thứ hai ra thư mục gốc `masvn-intelligence/`.',
            en: 'First `.parent` points to `scripts/`, second `.parent` reaches `masvn-intelligence/`.',
          },
        },
        {
          symbol: '.mkdir(parents=True, exist_ok=True)',
          params: 'parents: bool, exist_ok: bool',
          inputType: 'Path',
          outputType: 'None',
          description: {
            vi: 'Tạo cả thư mục cha `data/` nếu chưa có và không báo lỗi nếu thư mục đã tồn tại.',
            en: 'Creates missing parent directories automatically and stays silent if the folder already exists.',
          },
        },
        {
          symbol: 'urllib3.disable_warnings(...)',
          params: 'category=InsecureRequestWarning',
          inputType: 'Warning class',
          outputType: 'None',
          description: {
            vi: 'Tắt cảnh báo khi `requests.get(..., verify=False)` kết nối tới server có chứng chỉ SSL không chuẩn.',
            en: 'Suppresses `InsecureRequestWarning` when `requests.get(..., verify=False)` is used.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Ví dụ tối giản (Pathlib Hello World)', en: 'Stage 1: Minimal Toy Example' },
          summary: {
            vi: 'Làm quen toán tử `/` của `pathlib` thay cho `os.path.join` cồng kềnh.',
            en: 'Use the clean `/` operator on `Path` objects instead of nested `os.path.join` calls.',
          },
          code: `from pathlib import Path

root = Path(".")
pdf_folder = root / "data" / "raw_pdfs"
print("Target folder:", pdf_folder.resolve())`,
          expectedNote: {
            vi: 'Toán tử `/` tự động chọn `\\` trên Windows và `/` trên Linux/macOS.',
            en: 'The `/` operator automatically handles `\\` on Windows and `/` on POSIX.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Xử lý thực tế (Chạy từ bất kỳ thư mục nào)', en: 'Stage 2: Location-Independent Anchoring' },
          summary: {
            vi: 'Dùng `__file__` để không phụ thuộc vào thư mục hiện hành (CWD) trong terminal.',
            en: 'Anchor paths to `__file__` so the script behaves identically from any terminal CWD.',
          },
          code: `from pathlib import Path

# Dù chạy từ C:\\ hay từ scripts\\, BASE_DIR vẫn là masvn-intelligence/
BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "data" / "raw_pdfs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
print("Ready:", OUTPUT_DIR)`,
          expectedNote: {
            vi: 'Không bao giờ bị lỗi "No such file or directory" khi chạy lần đầu trên máy mới.',
            en: 'Prevents `FileNotFoundError` on fresh machines where `data/raw_pdfs/` does not exist yet.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Chuẩn bị khung Import & Cấu hình của Module 1', en: 'Stage 3: Production Header Assembly' },
          summary: {
            vi: 'Khai báo đầy đủ thư viện chuẩn bị cho Playwright + Requests và tắt cảnh báo SSL.',
            en: 'Assemble all imports, SSL warning suppression, and root output directory setup.',
          },
          code: `import os
import re
import time
import urllib3
import requests
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

# Tắt cảnh báo SSL khi dùng verify=False
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Trỏ đúng về thư mục masvn-intelligence/data/raw_pdfs/
BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "data" / "raw_pdfs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)`,
          expectedNote: {
            vi: 'Đây chính là 16 dòng đầu tiên của file `scripts/scrape_masvn.py`.',
            en: 'These form the exact opening 16 lines of `scripts/scrape_masvn.py`.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 1/7: Khởi tạo Imports, SSL & OUTPUT_DIR',
        en: 'Piece 1/7: Imports, SSL Config & OUTPUT_DIR',
      },
      builderExplanation: {
        vi: 'Ở bước khởi đầu này, ta khai báo toàn bộ thư viện sẽ dùng trong file `scripts/scrape_masvn.py` và đảm bảo thư mục `data/raw_pdfs/` luôn sẵn sàng ghi dữ liệu.',
        en: 'In this opening piece, we declare all imports for `scripts/scrape_masvn.py` and guarantee that `data/raw_pdfs/` exists before any download begins.',
      },
      builderCode: `import os
import re
import time
import urllib3
import requests
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

# Tắt cảnh báo SSL khi dùng verify=False
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Trỏ đúng về thư mục masvn-intelligence/data/raw_pdfs/
BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "data" / "raw_pdfs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)`,
      highlightLines: [1, 16],
      lineWalkthrough: [
        {
          lines: 'L10-L11',
          snippet: 'urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)',
          explanation: {
            vi: 'Ngăn `urllib3` in cảnh báo lặp lại mỗi lần ta gọi `requests.get(..., verify=False)`.',
            en: 'Stops `urllib3` from printing repeated SSL warnings on every `verify=False` call.',
          },
        },
        {
          lines: 'L14-L16',
          snippet: 'BASE_DIR = Path(__file__).resolve().parent.parent\nOUTPUT_DIR = BASE_DIR / "data" / "raw_pdfs"\nOUTPUT_DIR.mkdir(parents=True, exist_ok=True)',
          explanation: {
            vi: 'Từ `scripts/scrape_masvn.py`, leo lên 2 cấp để tới gốc dự án rồi tạo sẵn thư mục `data/raw_pdfs/`.',
            en: 'Walks up two directory levels from `scripts/scrape_masvn.py` and ensures `data/raw_pdfs/` exists.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện đoạn tạo thư mục `data/raw_pdfs/` an toàn từ file nằm trong `scripts/`:',
          en: 'Complete the code to safely create `data/raw_pdfs/` from a script located inside `scripts/`:',
        },
        codeTemplate: `BASE_DIR = Path(__file__).resolve().___0___.___0___
OUTPUT_DIR = BASE_DIR / "data" / "raw_pdfs"
OUTPUT_DIR.mkdir(___1___=True, exist_ok=True)`,
        answers: ['parent', 'parents'],
        hints: [
          { vi: 'Thuộc tính lấy thư mục cha của đối tượng Path', en: 'Property on Path that moves one folder up' },
          { vi: 'Tham số của mkdir() cho phép tạo cả thư mục cha còn thiếu', en: 'Argument of mkdir() that creates missing parent directories' },
        ],
        explanation: {
          vi: '`.parent.parent` lùi 2 cấp từ `scripts/scrape_masvn.py` về `masvn-intelligence/`, và `parents=True` giúp tạo luôn `data/` nếu chưa có.',
          en: '`.parent.parent` navigates up two levels to `masvn-intelligence/`, and `parents=True` creates `data/` automatically if missing.',
        },
      },
      quiz: {
        question: {
          vi: 'Tại sao không dùng đường dẫn tương đối `Path("data/raw_pdfs")` mà phải dùng `Path(__file__).resolve().parent.parent`?',
          en: 'Why prefer `Path(__file__).resolve().parent.parent` over `Path("data/raw_pdfs")`?',
        },
        options: [
          {
            vi: 'Vì `Path("data/raw_pdfs")` phụ thuộc vào thư mục hiện tại của terminal (CWD), dễ lưu nhầm chỗ khi chạy từ thư mục khác.',
            en: 'Because `Path("data/raw_pdfs")` depends on the terminal CWD and saves into the wrong folder if invoked from elsewhere.',
          },
          {
            vi: 'Vì `Path("data/raw_pdfs")` không hỗ trợ hệ điều hành Windows.',
            en: 'Because `Path("data/raw_pdfs")` does not work on Windows.',
          },
          {
            vi: 'Vì `mkdir()` chỉ hoạt động trên đường dẫn tuyệt đối.',
            en: 'Because `mkdir()` only works with absolute paths.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Khi bạn chạy `cd scripts && python scrape_masvn.py`, CWD là `scripts/`, khiến đường dẫn tương đối ghi nhầm vào `scripts/data/raw_pdfs`.',
          en: 'Correct! Running `cd scripts && python scrape_masvn.py` sets CWD to `scripts/`, which would write into `scripts/data/raw_pdfs` by mistake.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'python -c "from pathlib import Path; ..."' ,
        terminalLines: [
          '__file__   -> C:\\Users\\Admin\\masvn-intelligence\\scripts\\scrape_masvn.py',
          'BASE_DIR   -> C:\\Users\\Admin\\masvn-intelligence',
          'OUTPUT_DIR -> C:\\Users\\Admin\\masvn-intelligence\\data\\raw_pdfs',
          '[OK] Directory verified (parents=True, exist_ok=True)',
          '[OK] urllib3 InsecureRequestWarning suppressed',
        ],
      },
      checkpointItems: [
        {
          vi: 'Hiểu rõ sự khác biệt giữa CWD và vị trí vật lý của file `__file__`.',
          en: 'Understand the difference between terminal CWD and physical script location (`__file__`).',
        },
        {
          vi: 'Nắm được cách dùng `mkdir(parents=True, exist_ok=True)` để code chạy lại nhiều lần không lỗi.',
          en: 'Know how `mkdir(parents=True, exist_ok=True)` makes directory creation idempotent.',
        },
      ],
      studyApis: ['pathlib.Path', 'Path.resolve()', 'Path.mkdir()', 'urllib3.disable_warnings'],
    },
    {
      id: '1.2',
      moduleId: 'mod-1',
      tier: 1,
      title: {
        vi: 'Bước 1.2: Khởi tạo vòng đời trình duyệt với Playwright Sync API',
        en: 'Step 1.2: Browser Lifecycle with Playwright Sync API',
      },
      subtitle: {
        vi: 'Mở Chromium không giao diện (`headless=True`) và điều hướng tới trang báo cáo MASVN ổn định.',
        en: 'Launch headless Chromium and navigate reliably to the MASVN daily report page.',
      },
      targetFile: 'scripts/scrape_masvn.py',
      whyAndWhat: {
        why: {
          vi: 'Trang báo cáo của MASVN dựng bằng JavaScript (SPA/Dynamic DOM) nên dùng `requests.get()` thuần chỉ thấy khung HTML rỗng, không thấy danh sách PDF. Playwright khởi động một trình duyệt Chromium thật để thực thi JS, nhưng vẫn chạy ngầm (`headless=True`) để nhanh và tiết kiệm RAM.',
          en: 'The MASVN report portal renders its list dynamically via JavaScript, so plain `requests.get()` returns an empty shell without PDF links. Playwright drives a real Chromium instance in headless mode to render the DOM reliably.',
        },
        ifMissing: {
          vi: 'Crawler dùng `requests` + `BeautifulSoup` sẽ trả về 0 link PDF, hoặc nếu dùng `wait_until="networkidle"` thì trình duyệt có thể bị treo 60 giây rồi timeout vì các script thống kê/chat chạy nền không bao giờ dứt.',
          en: 'A plain HTTP scraper finds zero PDF links, while `wait_until="networkidle"` frequently hangs until timeout due to persistent analytics or chat sockets.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'sync_playwright()',
          params: 'Context manager (`with ... as p:`)',
          inputType: 'None',
          outputType: 'Playwright',
          description: {
            vi: 'Khởi động tiến trình driver Playwright và tự động dọn dẹp tài nguyên khi thoát khối `with`.',
            en: 'Starts the Playwright driver process and cleans up resources on context exit.',
          },
        },
        {
          symbol: 'p.chromium.launch()',
          params: 'headless=True',
          inputType: 'bool',
          outputType: 'Browser',
          description: {
            vi: 'Mở Chromium. Đặt `headless=False` khi cần nhìn tận mắt trình duyệt bấm nút để debug.',
            en: 'Launches Chromium. Switch `headless=False` during debugging to watch clicks live.',
          },
        },
        {
          symbol: 'page.goto()',
          params: 'url, wait_until="domcontentloaded", timeout=60000',
          inputType: 'str, str, int (ms)',
          outputType: 'Response | None',
          description: {
            vi: 'Mở URL, chỉ chờ cây HTML chính dựng xong (`domcontentloaded`) trong tối đa 60 giây thay vì chờ ảnh/quảng cáo.',
            en: 'Navigates to URL and returns once the initial DOM is parsed, avoiding hangs from third-party assets.',
          },
        },
        {
          symbol: 'page.wait_for_timeout()',
          params: 'timeout=3000',
          inputType: 'float (ms)',
          outputType: 'None',
          description: {
            vi: 'Chờ thêm 3 giây để các lời gọi API fetch danh sách báo cáo đầu tiên kịp render ra thẻ `<a>`.',
            en: 'Waits 3,000 ms for client-side API calls to populate the first batch of `<a>` tags.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Mở trình duyệt & in tiêu đề trang', en: 'Stage 1: Open Browser & Print Title' },
          summary: {
            vi: 'Chạy 6 dòng cơ bản kiểm tra Playwright đã cài Chromium thành công chưa.',
            en: 'Run 6 minimal lines to verify Playwright and Chromium binaries work locally.',
          },
          code: `from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("https://www.masvn.com/cate/bao-cao-thuong-nhat-22")
    print("Title:", page.title())
    browser.close()`,
          expectedNote: {
            vi: 'Nếu báo lỗi thiếu executable, chạy `playwright install chromium` một lần duy nhất.',
            en: 'If browser binaries are missing, run `playwright install chromium` once.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Tối ưu điều hướng chống treo Timeout', en: 'Stage 2: Timeout-Safe Navigation' },
          summary: {
            vi: 'Kết hợp `wait_until="domcontentloaded"` và `timeout=60000` cho mạng doanh nghiệp/VN.',
            en: 'Combine `wait_until="domcontentloaded"` with a 60s timeout and short settle delay.',
          },
          code: `with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    url = "https://www.masvn.com/cate/bao-cao-thuong-nhat-22"
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    browser.close()`,
          expectedNote: {
            vi: '`domcontentloaded` giúp không bị kẹt bởi chat widget hoặc Google Analytics.',
            en: '`domcontentloaded` prevents hanging on slow third-party chat or analytics widgets.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Mở đầu hàm get_report_links(limit=50)', en: 'Stage 3: Function Skeleton in scrape_masvn.py' },
          summary: {
            vi: 'Đóng gói vào hàm `get_report_links(limit=50)` kèm biến `report_dict = {}`.',
            en: 'Wrap browser initialization inside `get_report_links(limit=50)` with `report_dict = {}`.',
          },
          code: `def get_report_links(limit=50):
    report_dict = {}  # Dùng dict với key là URL để tự động loại bỏ link trùng

    with sync_playwright() as p:
        print("Opening browser...")
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        url = "https://www.masvn.com/cate/bao-cao-thuong-nhat-22"
        print(f"Navigating to {url}...")
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)

        browser.close()`,
          expectedNote: {
            vi: 'Ở các bước 1.3–1.5, ta sẽ chèn vòng lặp `while True:` vào ngay giữa `wait_for_timeout` và `browser.close()`.',
            en: 'In steps 1.3–1.5, we will insert the `while True:` scraping loop right before `browser.close()`.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 2/7: Mở đầu hàm get_report_links() & Khởi tạo Playwright',
        en: 'Piece 2/7: Defining get_report_links() & Launching Playwright',
      },
      builderExplanation: {
        vi: 'Ta nối tiếp vào file bằng hàm `get_report_links(limit=50)`. Trình duyệt được mở ở chế độ `headless=True` và điều hướng bằng `domcontentloaded`.',
        en: 'We append `get_report_links(limit=50)` to our file, opening Chromium in headless mode and navigating with `domcontentloaded`.',
      },
      builderCode: `import os
import re
import time
import urllib3
import requests
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

# Tắt cảnh báo SSL khi dùng verify=False
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Trỏ đúng về thư mục masvn-intelligence/data/raw_pdfs/
BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "data" / "raw_pdfs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def get_report_links(limit=50):
    report_dict = {}  # Dùng dict với key là URL để tự động loại bỏ link trùng

    with sync_playwright() as p:
        print("Opening browser...")
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        url = "https://www.masvn.com/cate/bao-cao-thuong-nhat-22"
        print(f"Navigating to {url}...")
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)

        browser.close()`,
      highlightLines: [19, 32],
      lineWalkthrough: [
        {
          lines: 'L20',
          snippet: 'report_dict = {}',
          explanation: {
            vi: 'Khởi tạo dictionary rỗng. Key sẽ là URL, Value sẽ là chuỗi ngày `YYYYMMDD`.',
            en: 'Initializes an empty dict where keys are PDF URLs and values are `YYYYMMDD` date strings.',
          },
        },
        {
          lines: 'L28-L30',
          snippet: 'page.goto(url, wait_until="domcontentloaded", timeout=60000)\npage.wait_for_timeout(3000)',
          explanation: {
            vi: 'Không đợi toàn bộ ảnh/tracker tải xong (`load`), chỉ đợi DOM dựng xong rồi nghỉ cố định 3 giây để API danh sách trả dữ liệu.',
            en: 'Avoids waiting for heavy assets by using `domcontentloaded`, then pauses 3 seconds for XHR data to render.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Điền tham số phù hợp để Playwright chỉ đợi HTML chính tải xong với timeout 60 giây:',
          en: 'Fill in the navigation parameters so Playwright waits only for the initial DOM with a 60s timeout:',
        },
        codeTemplate: `browser = p.chromium.launch(headless=___0___)
page = browser.new_page()
page.goto(url, wait_until="___1___", timeout=60000)`,
        answers: ['True', 'domcontentloaded'],
        hints: [
          { vi: 'Chạy ngầm không hiện cửa sổ trình duyệt', en: 'Boolean to run without a visible GUI window' },
          { vi: 'Sự kiện trình duyệt khi HTML đã parse xong', en: 'Browser event fired once HTML document is parsed' },
        ],
        explanation: {
          vi: '`headless=True` giúp chạy ngầm nhanh gọn; `wait_until="domcontentloaded"` tránh bị treo bởi các widget chat/analytics.',
          en: '`headless=True` runs without a GUI window, and `domcontentloaded` avoids blocking on slow third-party widgets.',
        },
      },
      quiz: {
        question: {
          vi: 'Vì sao không dùng `wait_until="networkidle"` khi vào trang web tài chính?',
          en: 'Why avoid `wait_until="networkidle"` on modern financial websites?',
        },
        options: [
          {
            vi: 'Các trang có chat box, websocket bảng giá hoặc tracker liên tục gửi request ngầm khiến trạng thái `networkidle` không bao giờ xảy ra và gây TimeoutError.',
            en: 'Persistent chat widgets, ticker sockets, or analytics keep sending background requests so networkidle is never reached, causing TimeoutError.',
          },
          {
            vi: '`networkidle` không hỗ trợ giao thức HTTPS.',
            en: '`networkidle` does not support HTTPS.',
          },
          {
            vi: '`networkidle` tự động đóng trình duyệt trước khi tải xong.',
            en: '`networkidle` closes the browser prematurely.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Chính xác! Kết hợp `domcontentloaded` với một khoảng `wait_for_timeout(3000)` ổn định hơn nhiều ngoài thực tế.',
          en: 'Exactly! Pairing `domcontentloaded` with a controlled `wait_for_timeout(3000)` is far more reliable in production.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'python scripts/scrape_masvn.py (browser init test)',
        terminalLines: [
          'Opening browser...',
          'Navigating to https://www.masvn.com/cate/bao-cao-thuong-nhat-22...',
          '[Playwright] DOMContentLoaded reached in 842 ms',
          '[Playwright] Waiting 3000 ms for report cards to hydrate...',
          '[OK] Page ready for link extraction',
        ],
      },
      checkpointItems: [
        {
          vi: 'Hiểu lý do phải dùng Playwright thay vì `requests` thuần cho trang tải động.',
          en: 'Understand why Playwright is needed instead of raw `requests` for JS-rendered pages.',
        },
        {
          vi: 'Biết cách bật `headless=False` để debug giao diện khi website thay đổi.',
          en: 'Know how to toggle `headless=False` to visually debug selector changes.',
        },
      ],
      studyApis: ['sync_playwright', 'p.chromium.launch', 'page.goto', 'page.wait_for_timeout'],
    },
    {
      id: '1.3',
      moduleId: 'mod-1',
      tier: 2,
      title: {
        vi: 'Bước 1.3: Quét link bằng page.evaluate() & Khử trùng lặp bằng dict',
        en: 'Step 1.3: Bulk Link Extraction via page.evaluate() & O(1) Dict Deduplication',
      },
      subtitle: {
        vi: 'Thực thi JavaScript trực tiếp trong trang để gom toàn bộ thẻ `<a>` trong 1 lần gọi IPC.',
        en: 'Execute JavaScript inside the browser context to fetch all `<a>` hrefs in a single IPC round-trip.',
      },
      targetFile: 'scripts/scrape_masvn.py',
      whyAndWhat: {
        why: {
          vi: 'Nếu dùng vòng lặp Python gọi `page.locator("a").nth(i).get_attribute("href")` cho 300 thẻ `<a>`, Playwright phải gửi 300 thông điệp qua lại giữa Python và Chromium (rất chậm). Thay vào đó, `page.evaluate()` chạy 1 dòng JavaScript gom hết `a.href` thành mảng và trả về trong 1 lần duy nhất. Khi bấm "Tải thêm", các link cũ vẫn nằm trên trang, nên ta dùng `report_dict = {}` với `if link in report_dict: continue` để bỏ qua ngay lập tức với tốc độ O(1).',
          en: 'Looping over `page.locator("a").nth(i)` in Python causes hundreds of slow IPC round-trips. Running `Array.from(document.querySelectorAll("a")).map(a => a.href)` inside `page.evaluate()` collects every URL in one call. Since clicking "Load more" keeps old links in the DOM, checking `if link in report_dict: continue` gives O(1) deduplication.',
        },
        ifMissing: {
          vi: 'Tốc độ quét chậm gấp 20 lần khi danh sách dài ra, và mỗi lần bấm "Tải thêm" sẽ xử lý lại toàn bộ các link đã thu ở trang trước, dẫn đến đếm sai số lượng `limit`.',
          en: 'Scraping becomes ~20x slower as the DOM grows, and previously collected links are recounted after every pagination click, breaking the `limit` counter.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'page.evaluate(js_fn)',
          params: 'expression: str',
          inputType: 'JS arrow function string',
          outputType: 'list[str]',
          description: {
            vi: 'Chạy đoạn JS ngay trong sandbox của tab đang mở và chuyển kết quả JSON về thành `list` của Python.',
            en: 'Executes a JS expression inside the active tab and deserializes the return value into a Python `list`.',
          },
        },
        {
          symbol: 'document.querySelectorAll("a")',
          params: 'CSS selector `"a"`',
          inputType: 'str',
          outputType: 'NodeList',
          description: {
            vi: 'Lấy tất cả phần tử `<a>` trong DOM; `Array.from(...).map(a => a.href)` chuyển sang mảng chuỗi URL đầy đủ (đã ghép domain).',
            en: 'Selects all anchor tags; `Array.from(...).map(a => a.href)` returns resolved absolute URL strings.',
          },
        },
        {
          symbol: 'if link in report_dict:',
          params: 'Hash lookup',
          inputType: 'str in dict',
          outputType: 'bool',
          description: {
            vi: 'Kiểm tra khóa đã tồn tại trong bảng băm `dict` với độ phức tạp trung bình O(1), nhanh hơn rất nhiều so với `list` O(N).',
            en: 'O(1) hash-table membership check, vastly faster than scanning a Python `list` O(N).',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Gọi page.evaluate() trên trang mẫu', en: 'Stage 1: Minimal page.evaluate() Call' },
          summary: {
            vi: 'Thử lấy 5 link đầu tiên từ trình duyệt để thấy `a.href` luôn trả về URL tuyệt đối.',
            en: 'Extract the first 5 anchor hrefs and inspect that `a.href` resolves relative paths automatically.',
          },
          code: `links = page.evaluate(
    "() => Array.from(document.querySelectorAll('a')).map(a => a.href)"
)
print("Total anchors found:", len(links))
print(links[:5])`,
          expectedNote: {
            vi: 'Khác với `getAttribute("href")` có thể trả về đường dẫn thiếu domain, `a.href` luôn trả về URL đầy đủ `https://...`.',
            en: 'Unlike `getAttribute("href")`, `a.href` automatically resolves relative paths into full `https://...` URLs.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Khử trùng lặp qua nhiều lần tải trang', en: 'Stage 2: O(1) Deduplication Across Pages' },
          summary: {
            vi: 'Mô phỏng trường hợp trang 2 vẫn chứa 15 link của trang 1 cộng thêm 15 link mới.',
            en: 'Simulate page 2 retaining page 1 links alongside newly appended links.',
          },
          code: `report_dict = {}
batch_1 = ["https://masvn.com/a.pdf", "https://masvn.com/b.pdf"]
batch_2 = ["https://masvn.com/a.pdf", "https://masvn.com/b.pdf", "https://masvn.com/c.pdf"]

for link in batch_1 + batch_2:
    if link in report_dict:
        continue
    report_dict[link] = "20261113"

print("Unique links:", len(report_dict))  # 3`,
          expectedNote: {
            vi: 'Dù `batch_2` lặp lại 2 link cũ, `report_dict` chỉ giữ đúng 3 phần tử duy nhất.',
            en: 'Even though `batch_2` repeats 2 existing links, `report_dict` retains exactly 3 unique entries.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Vòng lặp while True trong get_report_links()', en: 'Stage 3: Inside the While Loop' },
          summary: {
            vi: 'Đặt bước quét `links = page.evaluate(...)` ở đầu vòng lặp `while True:`.',
            en: 'Place `links = page.evaluate(...)` at the top of the `while True:` pagination loop.',
          },
          code: `        while True:
            # 1. Quét toàn bộ link hiện có trên trang
            links = page.evaluate(
                "() => Array.from(document.querySelectorAll('a')).map(a => a.href)"
            )

            for link in links:
                if link in report_dict:
                    continue
                # Bước 1.4 sẽ giải mã Regex tại đây`,
          expectedNote: {
            vi: 'Ở Bước 1.4 ngay sau đây, ta sẽ phân tích 2 biểu thức chính quy (Regex) để lọc chỉ lấy đúng link báo cáo ngày.',
            en: 'In Step 1.4 next, we add two Regex patterns to filter and extract dates from valid daily report links.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 3/7: Vòng lặp quét DOM bằng page.evaluate()',
        en: 'Piece 3/7: Scanning DOM Anchors via page.evaluate()',
      },
      builderExplanation: {
        vi: 'Thêm vòng lặp `while True:` vào trong `get_report_links`, gọi `page.evaluate()` lấy toàn bộ thẻ `<a>` và dùng `if link in report_dict: continue` để bỏ qua link đã xử lý.',
        en: 'Adds the `while True:` loop inside `get_report_links`, calling `page.evaluate()` for all anchors and skipping duplicates via `if link in report_dict: continue`.',
      },
      builderCode: `import os
import re
import time
import urllib3
import requests
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

# Tắt cảnh báo SSL khi dùng verify=False
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Trỏ đúng về thư mục masvn-intelligence/data/raw_pdfs/
BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "data" / "raw_pdfs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def get_report_links(limit=50):
    report_dict = {}  # Dùng dict với key là URL để tự động loại bỏ link trùng

    with sync_playwright() as p:
        print("Opening browser...")
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        url = "https://www.masvn.com/cate/bao-cao-thuong-nhat-22"
        print(f"Navigating to {url}...")
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)

        while True:
            # 1. Quét toàn bộ link hiện có trên trang
            links = page.evaluate(
                "() => Array.from(document.querySelectorAll('a')).map(a => a.href)"
            )

            for link in links:
                if link in report_dict:
                    continue

            break

        browser.close()`,
      highlightLines: [32, 42],
      lineWalkthrough: [
        {
          lines: 'L34-L36',
          snippet: 'links = page.evaluate(\n    "() => Array.from(document.querySelectorAll(\'a\')).map(a => a.href)"\n)',
          explanation: {
            vi: 'Chuyển `NodeList` của DOM thành `Array` JS rồi ánh xạ sang thuộc tính `.href` để Python nhận ngay một `list[str]`.',
            en: 'Converts the DOM `NodeList` into a JS `Array`, maps `.href`, and returns a Python `list[str]`.',
          },
        },
        {
          lines: 'L38-L40',
          snippet: 'for link in links:\n    if link in report_dict:\n        continue',
          explanation: {
            vi: 'Bỏ qua tức thì mọi link đã thu thập ở vòng lặp trước, tránh parse Regex thừa.',
            en: 'Skips any URL already present in `report_dict`, avoiding redundant regex checks.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện câu lệnh JS trong `page.evaluate` để trích xuất thuộc tính `href` của mọi thẻ `a`:',
          en: 'Complete the JS snippet inside `page.evaluate` to extract `href` from every `a` tag:',
        },
        codeTemplate: `links = page.___0___(
    "() => Array.from(document.querySelectorAll('a')).map(a => a.___1___)"
)`,
        answers: ['evaluate', 'href'],
        hints: [
          { vi: 'Phương thức của Playwright để chạy JavaScript trên trang', en: 'Playwright method that executes JS in the page context' },
          { vi: 'Thuộc tính chứa URL đích của thẻ <a>', en: 'DOM property holding the resolved URL of an <a> element' },
        ],
        explanation: {
          vi: '`page.evaluate(...)` chạy JS trong ngữ cảnh trình duyệt và `a.href` luôn trả về URL đầy đủ.',
          en: '`page.evaluate(...)` runs JS inside the page context and `a.href` returns the fully resolved URL.',
        },
      },
      quiz: {
        question: {
          vi: 'Vì sao dùng `report_dict = {}` thay vì `report_list = []` để khử trùng lặp URL?',
          en: 'Why use `report_dict = {}` instead of `report_list = []` for deduplicating URLs?',
        },
        options: [
          {
            vi: 'Kiểm tra `if link in report_dict` tốn thời gian O(1) và lưu luôn được cặp `(URL -> ngày YYYYMMDD)`.',
            en: 'Membership checks `if link in report_dict` run in O(1) time while also storing the `URL -> YYYYMMDD` mapping.',
          },
          {
            vi: 'Vì Python `list` không chứa được chuỗi dài hơn 100 ký tự.',
            en: 'Because Python lists cannot hold strings longer than 100 characters.',
          },
          {
            vi: 'Vì `page.evaluate` chỉ cho phép trả về dictionary.',
            en: 'Because `page.evaluate` can only return dictionaries.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Hash table (`dict`) vừa khử trùng O(1) vừa ánh xạ thẳng link sang ngày phát hành chuẩn hóa.',
          en: 'Correct! A dict provides O(1) lookup and maps each unique link directly to its normalized report date.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'page.evaluate("() => Array.from(document.querySelectorAll(\'a\')).map(a => a.href)")',
        terminalLines: [
          '[DOM] Found 142 <a> elements on current page',
          '  sample[0]: https://www.masvn.com/',
          '  sample[41]: https://www.masvn.com/public/attachment/MiraeAsset_Daily_VN_20261113.pdf',
          '  sample[44]: https://www.masvn.com/public/attachment/1731456000000-DailyReport_Mobile_VN.pdf',
          '[Dedupe] 0 previously seen links skipped; ready for Regex filter',
        ],
      },
      checkpointItems: [
        {
          vi: 'Biết cách dùng `page.evaluate()` thay cho hàng trăm lời gọi `locator.get_attribute()`.',
          en: 'Know why bulk `page.evaluate()` outperforms looping over `locator.get_attribute()`.',
        },
        {
          vi: 'Hiểu tại sao `dict` khử trùng lặp O(1) qua nhiều lần bấm "Tải thêm".',
          en: 'Understand O(1) dict deduplication across paginated DOM updates.',
        },
      ],
      studyApis: ['page.evaluate', 'document.querySelectorAll', 'dict lookup O(1)'],
    },
    {
      id: '1.4',
      moduleId: 'mod-1',
      tier: 2,
      title: {
        vi: 'Bước 1.4: Giải mã 2 định dạng URL MASVN bằng Regex & datetime',
        en: 'Step 1.4: Parsing 2 MASVN URL Formats with Regex & datetime',
      },
      subtitle: {
        vi: 'Chuẩn hóa cả link dạng `YYYYMMDD` lẫn link dạng Unix timestamp 13 chữ số về chung chuẩn `report_YYYYMMDD.pdf`.',
        en: 'Normalize both explicit `YYYYMMDD` URLs and 13-digit millisecond Unix timestamp URLs into `YYYYMMDD`.',
      },
      targetFile: 'scripts/scrape_masvn.py',
      whyAndWhat: {
        why: {
          vi: 'Trong 142 thẻ `<a>` trên trang, có link menu, link Facebook, link báo cáo tuần... và ngay cả bản tin hàng ngày của MASVN cũng đổi quy ước đặt tên file theo thời gian (dạng cũ/desktop ghi thẳng `MiraeAsset_Daily_VN_20261113.pdf`, dạng mobile ghi timestamp mili-giây `/1731456000000-DailyReport_Mobile_VN.pdf`). Ta cần Regex để lọc đúng bản tin ngày và quy đổi cả 2 dạng về chuỗi 8 số `YYYYMMDD`.',
          en: 'Out of 142 `<a>` links on the page, most are navigation or unrelated documents. Furthermore, MASVN uses two different filename conventions: explicit dates (`MiraeAsset_Daily_VN_20261113.pdf`) and 13-digit millisecond timestamps (`/1731456000000-DailyReport_Mobile_VN.pdf`). Regex filters valid daily PDFs and unifies both into `YYYYMMDD`.',
        },
        ifMissing: {
          vi: 'Nếu chỉ bắt 1 dạng Regex, crawler sẽ bỏ sót một nửa số bản tin lịch sử (ví dụ mất toàn bộ bản mobile) hoặc tải nhầm file rác không phải bản tin ngày.',
          en: 'Matching only one pattern drops half the historical archive (e.g., all mobile reports) or downloads unrelated site PDFs.',
        },
      },
      apiAnatomy: [
        {
          symbol: 're.search(pattern, string, re.IGNORECASE)',
          params: 'pattern, string, flags',
          inputType: 'raw str, str, int',
          outputType: 're.Match | None',
          description: {
            vi: 'Tìm mẫu Regex khớp ở bất kỳ vị trí nào trong URL, không phân biệt chữ hoa/thường nhờ `re.IGNORECASE`.',
            en: 'Searches anywhere in the URL for a pattern match, ignoring letter casing via `re.IGNORECASE`.',
          },
        },
        {
          symbol: 'match.group(1)',
          params: 'group index = 1',
          inputType: 're.Match',
          outputType: 'str',
          description: {
            vi: 'Trích xuất chuỗi nằm trong cặp ngoặc đơn đầu tiên `(\\d{8})` hoặc `(\\d{13})`.',
            en: 'Extracts the substring captured by the first parentheses group `(\\d{8})` or `(\\d{13})`.',
          },
        },
        {
          symbol: 'datetime.fromtimestamp(ts).strftime("%Y%m%d")',
          params: 'ts (seconds), format "%Y%m%d"',
          inputType: 'float',
          outputType: 'str',
          description: {
            vi: 'Đổi Unix timestamp tính bằng giây (sau khi chia 1000 từ mili-giây) sang chuỗi ngày dạng `20241113`.',
            en: 'Converts seconds-based Unix timestamp (after dividing ms by 1000) into `YYYYMMDD` string.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Bắt chuỗi 8 số ở URL chuẩn (match1)', en: 'Stage 1: Capture 8-Digit Date (match1)' },
          summary: {
            vi: 'Dùng `\\d{8}` để khớp đúng 8 chữ số liền nhau trước đuôi `\\.pdf`.',
            en: 'Use `\\d{8}` to capture exactly 8 digits right before `\\.pdf`.',
          },
          code: `import re

url1 = "https://www.masvn.com/files/MiraeAsset_Daily_VN_20261113.pdf"
m1 = re.search(r"MiraeAsset_Daily_VN_(\\d{8})\\.pdf", url1, re.IGNORECASE)
if m1:
    print("Format 1 date:", m1.group(1))  # 20261113`,
          expectedNote: {
            vi: 'Lưu ý dấu `\\.` để khớp đúng dấu chấm thật, vì dấu `.` trần trong Regex nghĩa là "ký tự bất kỳ".',
            en: 'Always escape `\\.` so it matches a literal dot rather than Regex wildcard "any character".',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Giải mã Timestamp 13 chữ số (match2)', en: 'Stage 2: Decode 13-Digit Millisecond Timestamp (match2)' },
          summary: {
            vi: 'Tại sao phải chia 1000? Vì JavaScript dùng mili-giây (13 số), còn `datetime.fromtimestamp` nhận giây (10 số).',
            en: 'JavaScript timestamps use milliseconds (13 digits), whereas Python `fromtimestamp()` expects seconds (10 digits).',
          },
          code: `import re
from datetime import datetime

url2 = "https://www.masvn.com/files/1731456000000-DailyReport_Mobile_VN.pdf"
m2 = re.search(r"/(\\d{13})-DailyReport_Mobile_VN\\.pdf", url2, re.IGNORECASE)
if m2:
    ts = int(m2.group(1)) / 1000
    date_str = datetime.fromtimestamp(ts).strftime("%Y%m%d")
    print("Format 2 date:", date_str)`,
          expectedNote: {
            vi: 'Nếu quên chia 1000, Python sẽ báo `OSError: [Errno 22] Invalid argument` vì năm bị tính thành năm 56,834!',
            en: 'Forgetting `/ 1000` passes milliseconds as seconds, calculating year ~56,834 and throwing `OSError`!',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Tích hợp cả 2 nhánh vào vòng lặp quét link', en: 'Stage 3: Both Regex Branches Integrated' },
          summary: {
            vi: 'Nhánh `match1` lưu xong thì `continue` sang link kế; không khớp mới kiểm tra `match2`.',
            en: 'Check `match1` first (`continue` on hit), then fall back to `match2`.',
          },
          code: `                match1 = re.search(
                    r"MiraeAsset_Daily_VN_(\\d{8})\\.pdf", link, re.IGNORECASE
                )
                if match1:
                    report_dict[link] = match1.group(1)
                    continue

                match2 = re.search(
                    r"/(\\d{13})-DailyReport_Mobile_VN\\.pdf", link, re.IGNORECASE
                )
                if match2:
                    ts = int(match2.group(1)) / 1000
                    date_str = datetime.fromtimestamp(ts).strftime("%Y%m%d")
                    report_dict[link] = date_str`,
          expectedNote: {
            vi: 'Cả 2 định dạng giờ đều quy về cùng khóa giá trị `YYYYMMDD` trong `report_dict`.',
            en: 'Both URL formats now resolve to uniform `YYYYMMDD` values inside `report_dict`.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 4/7: Lọc 2 định dạng link PDF bằng Regex & datetime',
        en: 'Piece 4/7: Dual-Format Regex & Timestamp Decoding',
      },
      builderExplanation: {
        vi: 'Chèn logic giải mã `match1` và `match2` ngay bên dưới bước kiểm tra trùng lặp, rồi in ra số lượng báo cáo đã thu thập được sau mỗi lượt quét.',
        en: 'Inserts both `match1` and `match2` regex extractors after deduplication, printing the running count of valid reports collected.',
      },
      builderCode: `import os
import re
import time
import urllib3
import requests
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

# Tắt cảnh báo SSL khi dùng verify=False
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Trỏ đúng về thư mục masvn-intelligence/data/raw_pdfs/
BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "data" / "raw_pdfs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def get_report_links(limit=50):
    report_dict = {}  # Dùng dict với key là URL để tự động loại bỏ link trùng

    with sync_playwright() as p:
        print("Opening browser...")
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        url = "https://www.masvn.com/cate/bao-cao-thuong-nhat-22"
        print(f"Navigating to {url}...")
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)

        while True:
            # 1. Quét toàn bộ link hiện có trên trang
            links = page.evaluate(
                "() => Array.from(document.querySelectorAll('a')).map(a => a.href)"
            )

            for link in links:
                if link in report_dict:
                    continue

                match1 = re.search(
                    r"MiraeAsset_Daily_VN_(\\d{8})\\.pdf", link, re.IGNORECASE
                )
                if match1:
                    report_dict[link] = match1.group(1)
                    continue

                match2 = re.search(
                    r"/(\\d{13})-DailyReport_Mobile_VN\\.pdf", link, re.IGNORECASE
                )
                if match2:
                    ts = int(match2.group(1)) / 1000
                    date_str = datetime.fromtimestamp(ts).strftime("%Y%m%d")
                    report_dict[link] = date_str

            print(f"Collected {len(report_dict)} reports so far...")
            break

        browser.close()`,
      highlightLines: [42, 59],
      lineWalkthrough: [
        {
          lines: 'L42-L47',
          snippet: 'match1 = re.search(\n    r"MiraeAsset_Daily_VN_(\\d{8})\\.pdf", link, re.IGNORECASE\n)',
          explanation: {
            vi: 'Tiền tố `r"..."` (raw string) giúp `\\d` không bị Python hiểu nhầm là ký tự escape trước khi truyền cho bộ máy Regex.',
            en: 'The `r"..."` raw string prefix ensures `\\d` reaches the regex engine intact without Python string escaping.',
          },
        },
        {
          lines: 'L49-L55',
          snippet: 'ts = int(match2.group(1)) / 1000\ndate_str = datetime.fromtimestamp(ts).strftime("%Y%m%d")',
          explanation: {
            vi: 'Chuyển timestamp 13 chữ số (ms) về giây rồi format về chuỗi 8 số `YYYYMMDD` để đồng bộ với `match1`.',
            en: 'Divides the 13-digit ms timestamp by 1000 to seconds and formats it to `YYYYMMDD` matching `match1`.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện đoạn chuyển đổi timestamp 13 chữ số sang chuỗi ngày `YYYYMMDD`:',
          en: 'Complete the conversion from a 13-digit millisecond timestamp to `YYYYMMDD`:',
        },
        codeTemplate: `match2 = re.search(r"/(\\d{13})-DailyReport_Mobile_VN\\.pdf", link, re.IGNORECASE)
if match2:
    ts = int(match2.___0___(1)) / ___1___
    date_str = datetime.fromtimestamp(ts).strftime("%Y%m%d")`,
        answers: ['group', '1000'],
        hints: [
          { vi: 'Phương thức lấy nhóm ngoặc đơn từ đối tượng Match', en: 'Method on re.Match to extract capture group 1' },
          { vi: 'Số mili-giây trong 1 giây', en: 'Milliseconds per second' },
        ],
        explanation: {
          vi: '`match2.group(1)` trả về chuỗi 13 số mili-giây; chia `1000` để đổi sang giây cho `datetime.fromtimestamp()`.',
          en: '`match2.group(1)` returns the 13-digit ms string; dividing by `1000` yields seconds for `datetime.fromtimestamp()`.',
        },
      },
      quiz: {
        question: {
          vi: 'Điều gì xảy ra nếu ta quên chia `1000` trước khi truyền giá trị `1731456000000` vào `datetime.fromtimestamp()`?',
          en: 'What happens if you pass `1731456000000` directly into `datetime.fromtimestamp()` without dividing by `1000`?',
        },
        options: [
          {
            vi: 'Python hiểu đó là 1.73 nghìn tỷ giây (tương ứng năm ~56,834) và ném lỗi `OSError` / `ValueError`.',
            en: 'Python treats it as 1.73 trillion seconds (year ~56,834) and raises `OSError` / `ValueError`.',
          },
          {
            vi: 'Python tự động phát hiện 13 chữ số và tự chia 1000.',
            en: 'Python automatically detects 13 digits and divides by 1000.',
          },
          {
            vi: 'Ngày trả về bị lùi lại 1 ngày.',
            en: 'The resulting date is simply off by 1 day.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Chính xác! API chuẩn của Python `fromtimestamp` luôn nhận đơn vị giây (10 chữ số cho thời điểm hiện tại).',
          en: 'Correct! Python `fromtimestamp` strictly expects seconds (10 digits for modern dates).',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'python regex_test.py',
        terminalLines: [
          '[match1] MiraeAsset_Daily_VN_20261113.pdf       -> date_str = "20261113"',
          '[match2] 1731456000000-DailyReport_Mobile_VN.pdf -> ts = 1731456000.0 -> date_str = "20241113"',
          '[skip]   https://www.masvn.com/about-us         -> ignored',
          'Collected 15 reports so far...',
        ],
      },
      checkpointItems: [
        {
          vi: 'Phân biệt được 2 quy ước đặt tên PDF trên website MASVN.',
          en: 'Recognize both MASVN PDF URL naming patterns.',
        },
        {
          vi: 'Hiểu quy đổi mili-giây sang giây khi làm việc với Unix timestamp.',
          en: 'Understand millisecond-to-second conversion when parsing JS timestamps.',
        },
      ],
      studyApis: ['re.search', 're.IGNORECASE', 'Match.group', 'datetime.fromtimestamp', 'strftime'],
    },
    {
      id: '1.5',
      moduleId: 'mod-1',
      tier: 2,
      title: {
        vi: 'Bước 1.5: Xử lý phân trang động & Bong bóng chat che nút (force=True)',
        en: 'Step 1.5: Dynamic Pagination & Bypassing Chat Overlays (force=True)',
      },
      subtitle: {
        vi: 'Bấm nút "Tải thêm" / "Load more" an toàn kể cả khi bị widget chat nổi che mất phần tử.',
        en: 'Locate and click "Tải thêm" / "Load more" reliably even when floating chat bubbles overlap the button.',
      },
      targetFile: 'scripts/scrape_masvn.py',
      whyAndWhat: {
        why: {
          vi: 'Trang MASVN chỉ hiển thị khoảng 10–15 báo cáo đầu tiên. Muốn lấy đủ 50 bản tin (~2.5 tháng dữ liệu để train ML), script phải bấm nút "Tải thêm" (hoặc "Load more" nếu server trả bản tiếng Anh). Tuy nhiên ngoài thực tế, trang MASVN có một bong bóng chat hỗ trợ nằm cố định ở góc dưới bên phải, thường che đúng lên nút "Tải thêm", khiến lệnh `.click()` mặc định của Playwright từ chối bấm vì kiểm tra actionability.',
          en: 'MASVN loads only 10–15 reports initially. Reaching 50 reports requires clicking "Tải thêm" (or "Load more"). In production, a floating support chat bubble sits at the bottom-right corner and overlaps the button, causing Playwright’s default `.click()` to fail its hit-target check.',
        },
        ifMissing: {
          vi: 'Script sẽ kẹt ở trang 1 (chỉ thu được ~15 file thay vì 50), hoặc treo 30 giây rồi crash với lỗi `TimeoutError: element is obscured by another element` ngay lần bấm nút đầu tiên.',
          en: 'The scraper stalls on page 1 (~15 files instead of 50) or crashes after 30s with `TimeoutError: element intercepts pointer events`.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'page.locator("text=/Tải thêm|Load more/i")',
          params: 'Regex text selector',
          inputType: 'str',
          outputType: 'Locator',
          description: {
            vi: 'Tìm phần tử chứa chữ "Tải thêm" hoặc "Load more" không phân biệt hoa thường.',
            en: 'Matches elements containing either "Tải thêm" or "Load more" case-insensitively.',
          },
        },
        {
          symbol: 'load_more_btn.count() & .is_visible()',
          params: 'No args',
          inputType: 'Locator',
          outputType: 'int, bool',
          description: {
            vi: 'Kiểm tra nút còn tồn tại trên DOM (`count > 0`) và đang hiện trên màn hình (`is_visible()`) trước khi thao tác.',
            en: 'Verifies the button exists in DOM and is visible before attempting interaction.',
          },
        },
        {
          symbol: '.scroll_into_view_if_needed()',
          params: 'No args',
          inputType: 'Locator',
          outputType: 'None',
          description: {
            vi: 'Cuộn trang xuống tới vị trí của nút đầu tiên (`.first`) để đảm bảo phần tử nằm trong viewport.',
            en: 'Scrolls the viewport down to `.first` match if it is currently off-screen.',
          },
        },
        {
          symbol: '.click(force=True)',
          params: 'force=True',
          inputType: 'bool',
          outputType: 'None',
          description: {
            vi: 'Bỏ qua kiểm tra che khuất (actionability check) khi bong bóng chat đè lên nút và gửi thẳng sự kiện click.',
            en: 'Bypasses pointer-interception checks caused by floating chat overlays and dispatches the click.',
          },
        },
        {
          symbol: 'report_links.sort(key=lambda x: x[0], reverse=True)',
          params: 'key, reverse=True',
          inputType: 'list[tuple]',
          outputType: 'None (in-place)',
          description: {
            vi: 'Sắp xếp danh sách `[(date_str, link)]` theo `x[0]` (`YYYYMMDD`) giảm dần để bản tin mới nhất đứng đầu, rồi cắt `[:limit]`.',
            en: 'Sorts `[(date_str, link)]` descending by `YYYYMMDD` so newest reports are downloaded first, then slices `[:limit]`.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Định vị nút đa ngôn ngữ bằng Regex Locator', en: 'Stage 1: Bilingual Regex Locator' },
          summary: {
            vi: 'Thay vì gán cứng chữ tiếng Việt, dùng `text=/Tải thêm|Load more/i` để an toàn nếu trang đổi ngôn ngữ.',
            en: 'Match both Vietnamese and English button labels with `text=/Tải thêm|Load more/i`.',
          },
          code: `load_more_btn = page.locator("text=/Tải thêm|Load more/i")
if load_more_btn.count() > 0 and load_more_btn.first.is_visible():
    print("Button found and visible!")`,
          expectedNote: {
            vi: 'Luôn kiểm tra `.count() > 0` trước khi gọi `.first.is_visible()` để tránh lỗi khi hết danh sách.',
            en: 'Check `.count() > 0` before `.first.is_visible()` so reaching the end of the list exits cleanly.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Vượt bong bóng chat nổi bằng scroll + force=True', en: 'Stage 2: Bypassing Chat Widget Overlay' },
          summary: {
            vi: 'Cuộn nút vào khung nhìn, bấm với `force=True` và chờ `2500ms` cho trang tải thêm bài.',
            en: 'Scroll into view, click with `force=True`, and wait 2.5s for new items to render.',
          },
          code: `load_more_btn.first.scroll_into_view_if_needed()
# force=True tránh bị bong bóng chat góc dưới phải che mất nút bấm
load_more_btn.first.click(force=True)
page.wait_for_timeout(2500)`,
          expectedNote: {
            vi: 'Đây là kinh nghiệm thực chiến điển hình: code chạy đúng lý thuyết nhưng vẫn gãy vì UI ngoài đời có popup/chat.',
            en: 'Real-world scraping lesson: floating widgets often intercept Playwright pointer checks unless `force=True` is used.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Thoát vòng lặp, sắp xếp mới nhất lên đầu & cắt [:limit]', en: 'Stage 3: Break, Sort Descending & Slice' },
          summary: {
            vi: 'Hoàn chỉnh 100% hàm `get_report_links(limit=50)`.',
            en: 'Complete `get_report_links(limit=50)` including descending sort and slicing.',
          },
          code: `    # Chuyển về list [(date_str, link), ...] và sắp xếp mới nhất lên đầu
    report_links = [(date_str, link) for link, date_str in report_dict.items()]
    report_links.sort(key=lambda x: x[0], reverse=True)

    return report_links[:limit]`,
          expectedNote: {
            vi: 'Nhờ chuẩn hóa chuỗi ngày dạng `YYYYMMDD` ở Bước 1.4, ta có thể sort theo thứ tự từ điển mà vẫn đúng 100% thứ tự thời gian!',
            en: 'Because dates are formatted as `YYYYMMDD`, lexicographical sorting equals exact chronological sorting!',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 5/7: Hoàn thiện toàn bộ hàm get_report_links(limit=50)',
        en: 'Piece 5/7: Completing get_report_links(limit=50)',
      },
      builderExplanation: {
        vi: 'Ta thêm điều kiện thoát khi `len(report_dict) >= limit`, logic cuộn & click nút "Tải thêm" với `force=True`, đóng trình duyệt và trả về danh sách đã sắp xếp mới nhất lên đầu.',
        en: 'Adds the `limit` exit condition, scroll + `force=True` pagination click, browser teardown, and descending date sort.',
      },
      builderCode: `import os
import re
import time
import urllib3
import requests
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

# Tắt cảnh báo SSL khi dùng verify=False
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Trỏ đúng về thư mục masvn-intelligence/data/raw_pdfs/
BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "data" / "raw_pdfs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def get_report_links(limit=50):
    report_dict = {}  # Dùng dict với key là URL để tự động loại bỏ link trùng

    with sync_playwright() as p:
        print("Opening browser...")
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        url = "https://www.masvn.com/cate/bao-cao-thuong-nhat-22"
        print(f"Navigating to {url}...")
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)

        while True:
            # 1. Quét toàn bộ link hiện có trên trang
            links = page.evaluate(
                "() => Array.from(document.querySelectorAll('a')).map(a => a.href)"
            )

            for link in links:
                if link in report_dict:
                    continue

                match1 = re.search(
                    r"MiraeAsset_Daily_VN_(\\d{8})\\.pdf", link, re.IGNORECASE
                )
                if match1:
                    report_dict[link] = match1.group(1)
                    continue

                match2 = re.search(
                    r"/(\\d{13})-DailyReport_Mobile_VN\\.pdf", link, re.IGNORECASE
                )
                if match2:
                    ts = int(match2.group(1)) / 1000
                    date_str = datetime.fromtimestamp(ts).strftime("%Y%m%d")
                    report_dict[link] = date_str

            print(f"Collected {len(report_dict)} reports so far...")

            # 2. Đủ số lượng thì thoát vòng lặp
            if len(report_dict) >= limit:
                break

            # 3. Tìm và bấm nút "Tải thêm" (hỗ trợ cả tiếng Việt lẫn tiếng Anh)
            load_more_btn = page.locator("text=/Tải thêm|Load more/i")
            if load_more_btn.count() > 0 and load_more_btn.first.is_visible():
                print("Clicking 'Tải thêm'...")
                load_more_btn.first.scroll_into_view_if_needed()
                # force=True tránh bị bong bóng chat góc dưới phải che mất nút bấm
                load_more_btn.first.click(force=True)
                page.wait_for_timeout(2500)
            else:
                print("No more 'Tải thêm' button found. Reached the end of list.")
                break

        browser.close()

    # Chuyển về list [(date_str, link), ...] và sắp xếp mới nhất lên đầu
    report_links = [(date_str, link) for link, date_str in report_dict.items()]
    report_links.sort(key=lambda x: x[0], reverse=True)

    return report_links[:limit]`,
      highlightLines: [60, 82],
      lineWalkthrough: [
        {
          lines: 'L60-L62',
          snippet: 'if len(report_dict) >= limit:\n    break',
          explanation: {
            vi: 'Dừng ngay khi thu đủ `limit` báo cáo để không bấm "Tải thêm" vô tận.',
            en: 'Breaks out of pagination as soon as `limit` unique reports are gathered.',
          },
        },
        {
          lines: 'L65-L71',
          snippet: 'load_more_btn = page.locator("text=/Tải thêm|Load more/i")\nif load_more_btn.count() > 0 and load_more_btn.first.is_visible():\n    load_more_btn.first.scroll_into_view_if_needed()\n    load_more_btn.first.click(force=True)',
          explanation: {
            vi: '`force=True` cho phép bấm xuyên qua lớp bong bóng chat ở góc phải màn hình.',
            en: '`force=True` bypasses the bottom-right floating chat overlay that intercepts standard clicks.',
          },
        },
        {
          lines: 'L79-L82',
          snippet: 'report_links = [(date_str, link) for link, date_str in report_dict.items()]\nreport_links.sort(key=lambda x: x[0], reverse=True)\nreturn report_links[:limit]',
          explanation: {
            vi: 'Đảo `(link, date_str)` thành `(date_str, link)` rồi sắp xếp giảm dần để bản tin mới nhất lên đầu.',
            en: 'Flips each pair to `(date_str, link)`, sorts descending by date, and returns at most `limit` items.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện đoạn bấm nút "Tải thêm" xuyên qua bong bóng chat và sắp xếp ngày mới nhất lên đầu:',
          en: 'Complete the pagination click (bypassing overlays) and descending sort:',
        },
        codeTemplate: `load_more_btn.first.scroll_into_view_if_needed()
load_more_btn.first.click(___0___=True)
page.wait_for_timeout(2500)
...
report_links.sort(key=lambda x: x[0], ___1___=True)`,
        answers: ['force', 'reverse'],
        hints: [
          { vi: 'Tham số của Playwright click() để bỏ qua kiểm tra bị che khuất', en: 'Playwright click() option to bypass hit-target occlusion checks' },
          { vi: 'Tham số của list.sort() để xếp giảm dần', en: 'list.sort() argument for descending order' },
        ],
        explanation: {
          vi: '`force=True` bỏ qua actionability check khi có chat widget đè lên nút; `reverse=True` xếp chuỗi `YYYYMMDD` từ mới nhất tới cũ nhất.',
          en: '`force=True` bypasses occlusion checks from floating widgets; `reverse=True` orders `YYYYMMDD` newest-first.',
        },
      },
      quiz: {
        question: {
          vi: 'Nếu website MASVN có bong bóng chat nổi ở góc dưới phải đè lên nút "Tải thêm", lệnh `.click()` mặc định của Playwright sẽ làm gì?',
          en: 'What happens when Playwright runs a default `.click()` on a button partially covered by a floating chat widget?',
        },
        options: [
          {
            vi: 'Nó chờ tới hết timeout (30s) rồi báo lỗi `element intercepts pointer events` vì không bấm trực tiếp được vào nút.',
            en: 'It retries until the 30s timeout expires and fails because another element intercepts pointer events.',
          },
          {
            vi: 'Nó tự động đóng bong bóng chat rồi mới bấm.',
            en: 'It automatically closes the chat widget first.',
          },
          {
            vi: 'Nó tự động chuyển sang `force=True` sau 1 giây.',
            en: 'It silently falls back to `force=True` after 1 second.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Playwright kiểm tra rất kỹ xem phần tử có thực sự nhận được click không; chỉ khi truyền `force=True` nó mới bỏ qua bước kiểm tra này.',
          en: 'Correct! Playwright enforces strict actionability checks unless `force=True` is explicitly provided.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'get_report_links(limit=50)',
        terminalLines: [
          'Opening browser...',
          'Navigating to https://www.masvn.com/cate/bao-cao-thuong-nhat-22...',
          'Collected 15 reports so far...',
          "Clicking 'Tải thêm'...",
          'Collected 30 reports so far...',
          "Clicking 'Tải thêm'...",
          'Collected 45 reports so far...',
          "Clicking 'Tải thêm'...",
          'Collected 60 reports so far...',
          '[Sorted] Returning top 50 reports (20261113 -> 20260902)',
        ],
      },
      checkpointItems: [
        {
          vi: 'Hiểu rõ cơ chế actionability check của Playwright và khi nào dùng `force=True`.',
          en: 'Understand Playwright actionability checks and when `force=True` is warranted.',
        },
        {
          vi: 'Biết cách viết `sort(key=lambda x: x[0], reverse=True)` cho danh sách tuple.',
          en: 'Know how to sort tuple lists descending with `key=lambda x: x[0], reverse=True`.',
        },
      ],
      studyApis: ['page.locator', 'Locator.scroll_into_view_if_needed', 'Locator.click(force=True)', 'list.sort'],
    },
    {
      id: '1.6',
      moduleId: 'mod-1',
      tier: 2,
      title: {
        vi: 'Bước 1.6: Tải PDF an toàn, Idempotency & Kiểm tra Content-Type',
        en: 'Step 1.6: Safe PDF Download, Idempotency & Content-Type Validation',
      },
      subtitle: {
        vi: 'Viết hàm `download_pdf(url, output_path)` tránh tải trùng, giả lập User-Agent và không lưu nhầm trang lỗi HTML thành `.pdf`.',
        en: 'Write `download_pdf(url, output_path)` with idempotency checks, browser User-Agent headers, and MIME validation.',
      },
      targetFile: 'scripts/scrape_masvn.py',
      whyAndWhat: {
        why: {
          vi: 'Mỗi ngày bạn chạy lại script để cập nhật bản tin mới, 49 file cũ đã nằm sẵn trên đĩa — nguyên tắc **Idempotency (Tính lũy đẳng)** giúp bỏ qua ngay nếu `output_path.exists()`. Đồng thời, nếu link PDF bị lỗi 404 hoặc server chặn bot, server thường trả về một trang HTML thông báo lỗi với status 200 OK; nếu không kiểm tra `"application/pdf" in response.headers.get("Content-Type", "")`, ta sẽ ghi nhầm mã HTML vào file `.pdf` làm `PyMuPDF` bị crash ở Học phần 2.',
          en: 'When re-running daily, 49 older files already exist locally—checking `output_path.exists()` makes the script idempotent. Additionally, some servers return an HTML error page with HTTP 200; checking `"application/pdf"` in `Content-Type` stops corrupt HTML from being saved as a `.pdf` and crashing PyMuPDF later.',
        },
        ifMissing: {
          vi: 'Mỗi lần chạy lại phải tải lại toàn bộ 50 file tốn băng thông và dễ bị khóa IP; hoặc lưu nhầm file HTML thành `report_20261113.pdf` gây lỗi `fitz.FileDataError` ở bước sau.',
          en: 'Re-runs waste bandwidth re-downloading all 50 files and risk IP throttling, or corrupt HTML payloads get saved as `.pdf` files and break Module 2.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'output_path.exists()',
          params: 'No args',
          inputType: 'Path',
          outputType: 'bool',
          description: {
            vi: 'Kiểm tra file đích đã có trên ổ đĩa chưa; có rồi thì `return` ngay (Idempotency).',
            en: 'Checks if target file already exists on disk and exits early if present.',
          },
        },
        {
          symbol: 'requests.get()',
          params: 'url, verify=False, headers=headers, timeout=30',
          inputType: 'str, bool, dict, int',
          outputType: 'requests.Response',
          description: {
            vi: 'Gửi HTTP GET kèm `User-Agent` giống Chrome thật và giới hạn chờ tối đa 30 giây.',
            en: 'Issues an HTTP GET with a Chrome-like `User-Agent` header and a 30s network timeout.',
          },
        },
        {
          symbol: 'response.raise_for_status()',
          params: 'No args',
          inputType: 'Response',
          outputType: 'None (raises HTTPError on 4xx/5xx)',
          description: {
            vi: 'Tự động ném ngoại lệ `HTTPError` nếu server trả mã 403, 404 hoặc 500.',
            en: 'Raises `requests.exceptions.HTTPError` if status code is 4xx or 5xx.',
          },
        },
        {
          symbol: 'output_path.write_bytes(response.content)',
          params: 'data: bytes',
          inputType: 'bytes',
          outputType: 'int (bytes written)',
          description: {
            vi: 'Ghi trực tiếp nội dung nhị phân của file PDF xuống đĩa gọn hơn `with open(..., "wb")`.',
            en: 'Writes raw binary PDF bytes to disk cleanly without manual `open(..., "wb")` boilerplate.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Tải file nhị phân đơn giản', en: 'Stage 1: Minimal Binary Download' },
          summary: {
            vi: 'Dùng `requests.get` + `Path.write_bytes` để lưu 1 file thử nghiệm.',
            en: 'Fetch raw bytes with `requests.get` and persist with `Path.write_bytes`.',
          },
          code: `import requests
from pathlib import Path

resp = requests.get(url, verify=False, timeout=30)
Path("test.pdf").write_bytes(resp.content)`,
          expectedNote: {
            vi: 'Ngắn gọn nhưng thiếu kiểm tra file tồn tại, thiếu `User-Agent` và chưa kiểm tra lỗi HTTP/MIME.',
            en: 'Concise, but lacks idempotency, User-Agent spoofing, status checks, and MIME verification.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Thêm Idempotency & Validate Content-Type', en: 'Stage 2: Add Idempotency & MIME Guard' },
          summary: {
            vi: 'Chặn tải lại file cũ và kiểm tra `"application/pdf"` trước khi ghi xuống ổ cứng.',
            en: 'Skip existing files and verify `"application/pdf"` header before writing.',
          },
          code: `if output_path.exists():
    print(f"Skipped (already exists): {output_path.name}")
    return

if "application/pdf" in response.headers.get("Content-Type", ""):
    output_path.write_bytes(response.content)`,
          expectedNote: {
            vi: 'Dùng `.get("Content-Type", "")` tránh lỗi `KeyError` nếu server không gửi header này.',
            en: 'Using `.get("Content-Type", "")` avoids `KeyError` if a server omits the header.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Hàm download_pdf() chuẩn Production', en: 'Stage 3: Production download_pdf() Function' },
          summary: {
            vi: 'Bọc khối `try ... except requests.exceptions.RequestException as e:` để 1 file lỗi mạng không làm dừng cả 49 file còn lại.',
            en: 'Wrap network I/O in `try/except RequestException` so one failed download never aborts the batch.',
          },
          code: `def download_pdf(url, output_path: Path):
    # Bỏ qua nếu file đã tải trước đó rồi
    if output_path.exists():
        print(f"Skipped (already exists): {output_path.name}")
        return

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        print(f"Downloading {output_path.name} from {url}...")
        response = requests.get(url, verify=False, headers=headers, timeout=30)
        response.raise_for_status()

        if "application/pdf" in response.headers.get("Content-Type", ""):
            output_path.write_bytes(response.content)
            print(" -> Saved successfully!")
        else:
            print(f" -> Failed: Content-Type is {response.headers.get('Content-Type')}")
    except requests.exceptions.RequestException as e:
        print(f" -> Download error: {e}")`,
          expectedNote: {
            vi: 'An toàn, lũy đẳng và ghi log rõ trạng thái từng file.',
            en: 'Safe, idempotent, and logs clear status per file.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 6/7: Thêm hàm download_pdf(url, output_path)',
        en: 'Piece 6/7: Adding download_pdf(url, output_path)',
      },
      builderExplanation: {
        vi: 'Bổ sung hàm `download_pdf` vào sau `get_report_links`, tích hợp đầy đủ kiểm tra file tồn tại, giả lập `User-Agent`, `verify=False`, `raise_for_status()` và kiểm tra `Content-Type`.',
        en: 'Appends `download_pdf` after `get_report_links`, combining existence check, Chrome User-Agent, `verify=False`, `raise_for_status()`, and MIME validation.',
      },
      builderCode: `import os
import re
import time
import urllib3
import requests
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

# Tắt cảnh báo SSL khi dùng verify=False
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Trỏ đúng về thư mục masvn-intelligence/data/raw_pdfs/
BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "data" / "raw_pdfs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def get_report_links(limit=50):
    report_dict = {}  # Dùng dict với key là URL để tự động loại bỏ link trùng

    with sync_playwright() as p:
        print("Opening browser...")
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        url = "https://www.masvn.com/cate/bao-cao-thuong-nhat-22"
        print(f"Navigating to {url}...")
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)

        while True:
            # 1. Quét toàn bộ link hiện có trên trang
            links = page.evaluate(
                "() => Array.from(document.querySelectorAll('a')).map(a => a.href)"
            )

            for link in links:
                if link in report_dict:
                    continue

                match1 = re.search(
                    r"MiraeAsset_Daily_VN_(\\d{8})\\.pdf", link, re.IGNORECASE
                )
                if match1:
                    report_dict[link] = match1.group(1)
                    continue

                match2 = re.search(
                    r"/(\\d{13})-DailyReport_Mobile_VN\\.pdf", link, re.IGNORECASE
                )
                if match2:
                    ts = int(match2.group(1)) / 1000
                    date_str = datetime.fromtimestamp(ts).strftime("%Y%m%d")
                    report_dict[link] = date_str

            print(f"Collected {len(report_dict)} reports so far...")

            # 2. Đủ số lượng thì thoát vòng lặp
            if len(report_dict) >= limit:
                break

            # 3. Tìm và bấm nút "Tải thêm" (hỗ trợ cả tiếng Việt lẫn tiếng Anh)
            load_more_btn = page.locator("text=/Tải thêm|Load more/i")
            if load_more_btn.count() > 0 and load_more_btn.first.is_visible():
                print("Clicking 'Tải thêm'...")
                load_more_btn.first.scroll_into_view_if_needed()
                # force=True tránh bị bong bóng chat góc dưới phải che mất nút bấm
                load_more_btn.first.click(force=True)
                page.wait_for_timeout(2500)
            else:
                print("No more 'Tải thêm' button found. Reached the end of list.")
                break

        browser.close()

    # Chuyển về list [(date_str, link), ...] và sắp xếp mới nhất lên đầu
    report_links = [(date_str, link) for link, date_str in report_dict.items()]
    report_links.sort(key=lambda x: x[0], reverse=True)

    return report_links[:limit]


def download_pdf(url, output_path: Path):
    # Bỏ qua nếu file đã tải trước đó rồi
    if output_path.exists():
        print(f"Skipped (already exists): {output_path.name}")
        return

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        print(f"Downloading {output_path.name} from {url}...")
        response = requests.get(url, verify=False, headers=headers, timeout=30)
        response.raise_for_status()

        if "application/pdf" in response.headers.get("Content-Type", ""):
            output_path.write_bytes(response.content)
            print(" -> Saved successfully!")
        else:
            print(f" -> Failed: Content-Type is {response.headers.get('Content-Type')}")
    except requests.exceptions.RequestException as e:
        print(f" -> Download error: {e}")`,
      highlightLines: [85, 105],
      lineWalkthrough: [
        {
          lines: 'L87-L89',
          snippet: 'if output_path.exists():\n    print(f"Skipped (already exists): {output_path.name}")\n    return',
          explanation: {
            vi: 'Đảm bảo chạy lại script bao nhiêu lần cũng chỉ tải những ngày mới nhất chưa có trên máy.',
            en: 'Ensures subsequent runs only fetch new dates not already stored locally.',
          },
        },
        {
          lines: 'L98-L100',
          snippet: 'if "application/pdf" in response.headers.get("Content-Type", ""):\n    output_path.write_bytes(response.content)',
          explanation: {
            vi: 'Chặn đứng nguy cơ lưu nhầm trang HTML lỗi thành file `.pdf` hỏng.',
            en: 'Prevents saving an HTML error page under a `.pdf` extension.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện phần kiểm tra file tồn tại và kiểm tra Content-Type trước khi ghi file:',
          en: 'Complete the idempotency check and MIME Content-Type guard:',
        },
        codeTemplate: `if output_path.___0___():
    return
...
response.raise_for_status()
if "___1___" in response.headers.get("Content-Type", ""):
    output_path.write_bytes(response.content)`,
        answers: ['exists', 'application/pdf'],
        hints: [
          { vi: 'Phương thức của Path kiểm tra file có trên đĩa chưa', en: 'Path method checking whether the file exists on disk' },
          { vi: 'MIME type chuẩn của tài liệu PDF', en: 'Standard MIME type for PDF documents' },
        ],
        explanation: {
          vi: '`output_path.exists()` giúp bỏ qua file đã tải; `"application/pdf"` đảm bảo dữ liệu trả về thực sự là PDF.',
          en: '`output_path.exists()` skips already-downloaded files; `"application/pdf"` verifies the payload is a real PDF.',
        },
      },
      quiz: {
        question: {
          vi: 'Khái niệm "Idempotency" trong hàm `download_pdf` mang lại lợi ích gì?',
          en: 'What benefit does idempotency bring to `download_pdf`?',
        },
        options: [
          {
            vi: 'Chạy lại script nhiều lần không tải trùng file đã có, tiết kiệm băng thông và không làm hỏng dữ liệu cũ.',
            en: 'Re-running the script safely skips existing files, saving bandwidth and avoiding redundant requests.',
          },
          {
            vi: 'Tự động giải nén file PDF thành file CSV.',
            en: 'Automatically converts PDFs into CSV files.',
          },
          {
            vi: 'Tăng tốc độ GPU khi chạy Playwright.',
            en: 'Accelerates GPU execution in Playwright.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Data engineering pipeline tốt luôn phải chạy lại được an toàn mà không tạo bản sao rác.',
          en: 'Correct! Reliable ingestion pipelines are safe to re-run without duplicating data or wasting requests.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'download_pdf() batch test',
        terminalLines: [
          '[1/3] Skipped (already exists): report_20261113.pdf',
          '[2/3] Downloading report_20261112.pdf from https://www.masvn.com/.../MiraeAsset_Daily_VN_20261112.pdf...',
          ' -> Saved successfully!',
          '[3/3] Downloading report_20261111.pdf from https://www.masvn.com/.../broken_link.pdf...',
          ' -> Failed: Content-Type is text/html; charset=utf-8',
        ],
      },
      checkpointItems: [
        {
          vi: 'Biết dùng `Path.exists()` để thiết kế pipeline lũy đẳng.',
          en: 'Use `Path.exists()` to enforce idempotent downloads.',
        },
        {
          vi: 'Biết cách kiểm tra `Content-Type` để lọc bỏ trang HTML giả dạng PDF.',
          en: 'Validate `Content-Type` before calling `write_bytes()`.',
        },
      ],
      studyApis: ['Path.exists', 'requests.get', 'Response.raise_for_status', 'Path.write_bytes'],
    },
    {
      id: '1.7',
      moduleId: 'mod-1',
      tier: 3,
      title: {
        vi: 'Bước 1.7: Ghép nối hoàn chỉnh `scripts/scrape_masvn.py` & Rate Limiting',
        en: 'Step 1.7: Complete Assembly of `scripts/scrape_masvn.py` & Rate Limiting',
      },
      subtitle: {
        vi: 'Thêm khối `if __name__ == "__main__":`, vòng lặp chuẩn hóa tên file `report_{date_str}.pdf` và `time.sleep(1)`.',
        en: 'Add the `if __name__ == "__main__":` entry point, standardized naming `report_{date_str}.pdf`, and `time.sleep(1)` throttling.',
      },
      targetFile: 'scripts/scrape_masvn.py',
      whyAndWhat: {
        why: {
          vi: 'Khi có đủ `get_report_links()` và `download_pdf()`, ta cần điểm khởi chạy `if __name__ == "__main__":` để vừa có thể chạy trực tiếp bằng lệnh `python scripts/scrape_masvn.py`, vừa có thể `import` hai hàm trên vào `src/scraper.py` (cho nút cập nhật trên Streamlit ở Học phần 6) mà không bị tự động chạy khi import. Đồng thời, `time.sleep(1)` là phép lịch sự kỹ thuật (Rate Limiting) giúp server MASVN không chặn IP.',
          en: 'Putting the batch loop inside `if __name__ == "__main__":` keeps `get_report_links` and `download_pdf` cleanly importable (e.g., for Streamlit’s sidebar button in Module 6) without executing on import. Adding `time.sleep(1)` prevents rate-limiting or IP bans from rapid consecutive downloads.',
        },
        ifMissing: {
          vi: 'Nếu không có `if __name__ == "__main__":`, khi import module này từ `app.py`, Streamlit sẽ bị đứng để tải 50 file ngay lúc khởi động. Nếu bỏ `time.sleep(1)`, 50 request liên tiếp trong 2 giây rất dễ bị tường lửa chặn 429/403.',
          en: 'Without the `__main__` guard, importing the file in `app.py` immediately triggers a 50-file download on startup. Without `time.sleep(1)`, firing 50 rapid requests risks HTTP 429/403 blocks.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'if __name__ == "__main__":',
          params: 'Module execution guard',
          inputType: 'str (__name__)',
          outputType: 'bool',
          description: {
            vi: 'Chỉ chạy khối lệnh bên trong khi file được chạy trực tiếp; bỏ qua khi file bị module khác `import`.',
            en: 'Executes only when run as the main script, not when imported by another module.',
          },
        },
        {
          symbol: 'enumerate(reports, start=1)',
          params: 'iterable, start=1',
          inputType: 'list[tuple]',
          outputType: 'iterator of (idx, item)',
          description: {
            vi: 'Đếm số thứ tự từ `1` tới `50` thay vì `0..49` để in tiến độ `[1/50]` dễ đọc.',
            en: 'Provides 1-based indexing so console progress logs print `[1/50]` cleanly.',
          },
        },
        {
          symbol: 'time.sleep(1)',
          params: 'seconds=1',
          inputType: 'float',
          outputType: 'None',
          description: {
            vi: 'Tạm nghỉ 1 giây giữa các lượt gọi HTTP tải file để tránh làm quá tải server đích.',
            en: 'Pauses 1 second between downloads to respect server rate limits.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Định dạng tên file đồng nhất', en: 'Stage 1: Standardized Filename Formatting' },
          summary: {
            vi: 'Dù link gốc tên dài hay timestamp 13 số, mọi file tải về đều mang tên `report_YYYYMMDD.pdf`.',
            en: 'Regardless of original URL structure, every saved file follows `report_YYYYMMDD.pdf`.',
          },
          code: `for idx, (date_str, url) in enumerate(reports, start=1):
    filename = f"report_{date_str}.pdf"
    output_file = OUTPUT_DIR / filename`,
          expectedNote: {
            vi: 'Tên file đồng nhất giúp Học phần 3 và Học phần 5 dễ dàng trích xuất ngày báo cáo chỉ từ tên file.',
            en: 'Uniform filenames let Modules 3 and 5 parse report dates directly from filenames.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Thêm Rate Limiting & Log tiến độ', en: 'Stage 2: Add Rate Limiting & Progress Logging' },
          summary: {
            vi: 'Dùng `end=""` trong `print(f"[{idx}/{len(reports)}] ", end="")` để log nằm gọn trên cùng dòng với `download_pdf`.',
            en: 'Use `end=""` so the `[idx/total]` prefix aligns with `download_pdf` output.',
          },
          code: `    for idx, (date_str, url) in enumerate(reports, start=1):
        filename = f"report_{date_str}.pdf"
        output_file = OUTPUT_DIR / filename

        print(f"[{idx}/{len(reports)}] ", end="")
        download_pdf(url, output_file)

        # Nghỉ 1 giây giữa các lần tải để tránh bị server chặn
        time.sleep(1)`,
          expectedNote: {
            vi: 'Thân thiện với server đối tác và dễ theo dõi tiến độ từng file trên terminal.',
            en: 'Polite toward upstream servers and cleanly formatted in terminal logs.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Toàn bộ file scripts/scrape_masvn.py hoàn chỉnh', en: 'Stage 3: Complete Production File' },
          summary: {
            vi: 'Toàn bộ 121 dòng code ghép từ Bước 1.1 đến Bước 1.7 sẵn sàng chạy thật.',
            en: 'All pieces from Steps 1.1 to 1.7 assembled into the runnable `scripts/scrape_masvn.py`.',
          },
          code: `if __name__ == "__main__":
    N = 50  # Số lượng file muốn lấy
    reports = get_report_links(limit=N)

    print(f"\\nStart downloading {len(reports)} reports into {OUTPUT_DIR}...\\n")
    for idx, (date_str, url) in enumerate(reports, start=1):
        filename = f"report_{date_str}.pdf"
        output_file = OUTPUT_DIR / filename

        print(f"[{idx}/{len(reports)}] ", end="")
        download_pdf(url, output_file)

        # Nghỉ 1 giây giữa các lần tải để tránh bị server chặn
        time.sleep(1)`,
          expectedNote: {
            vi: 'Chuyển sang tab "4. File hoàn chỉnh" hoặc copy ngay bên dưới để đưa vào VS Code.',
            en: 'Inspect or download the complete file from Tab 4 ("Complete File") into VS Code.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 7/7: Khối __main__ hoàn thiện 100% file scrape_masvn.py',
        en: 'Piece 7/7: __main__ Entry Point Completing scrape_masvn.py',
      },
      builderExplanation: {
        vi: 'Chúc mừng! Đây là mảnh ghép cuối cùng của Học phần 1. Toàn bộ đoạn code dưới đây khớp 100% từng dòng với file chuẩn `scripts/scrape_masvn.py` của dự án.',
        en: 'Final piece of Module 1. The assembled code below is the exact, complete `scripts/scrape_masvn.py` ready to run locally.',
      },
      builderCode: SCRAPE_MASVN_FINAL,
      highlightLines: [108, 121],
      lineWalkthrough: [
        {
          lines: 'L108-L110',
          snippet: 'if __name__ == "__main__":\n    N = 50  # Số lượng file muốn lấy\n    reports = get_report_links(limit=N)',
          explanation: {
            vi: 'Đặt số lượng mục tiêu `N = 50` bản tin gần nhất (~2.5 tháng giao dịch).',
            en: 'Requests the 50 most recent daily reports (~2.5 trading months).',
          },
        },
        {
          lines: 'L113-L121',
          snippet: 'for idx, (date_str, url) in enumerate(reports, start=1):\n    filename = f"report_{date_str}.pdf"\n    output_file = OUTPUT_DIR / filename\n    ...\n    time.sleep(1)',
          explanation: {
            vi: 'Tạo tên file chuẩn hóa, tải từng file và nghỉ 1 giây sau mỗi lượt.',
            en: 'Builds the standardized path, downloads each file, and sleeps 1s between requests.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện vòng lặp tải file trong khối `if __name__ == "__main__":`:',
          en: 'Complete the main download loop inside `if __name__ == "__main__":`:',
        },
        codeTemplate: `if __name__ == "___0___":
    reports = get_report_links(limit=50)
    for idx, (date_str, url) in enumerate(reports, start=1):
        output_file = OUTPUT_DIR / f"report_{date_str}.pdf"
        download_pdf(url, output_file)
        time.___1___(1)`,
        answers: ['__main__', 'sleep'],
        hints: [
          { vi: 'Giá trị của __name__ khi chạy file trực tiếp', en: 'Value of __name__ when executed directly as a script' },
          { vi: 'Hàm tạm dừng thực thi trong module time', en: 'Function in the time module that pauses execution' },
        ],
        explanation: {
          vi: '`if __name__ == "__main__":` bảo vệ code không tự chạy khi import, và `time.sleep(1)` giúp tránh quá tải server.',
          en: '`if __name__ == "__main__":` prevents auto-execution on import, and `time.sleep(1)` throttles requests.',
        },
      },
      quiz: {
        question: {
          vi: 'Vì sao đặt vòng lặp tải 50 file vào trong `if __name__ == "__main__":` lại quan trọng cho kiến trúc ở Học phần 6?',
          en: 'Why does wrapping the 50-file loop in `if __name__ == "__main__":` matter for Module 6?',
        },
        options: [
          {
            vi: 'Để `app.py` (Streamlit) có thể `import` riêng hàm `get_report_links` và `download_pdf` mà không làm web tự chạy tải 50 file mỗi lần khởi động.',
            en: 'So `app.py` (Streamlit) can import `get_report_links` and `download_pdf` without triggering a 50-file download on startup.',
          },
          {
            vi: 'Vì Playwright bắt buộc phải có `if __name__ == "__main__":` mới mở được Chromium.',
            en: 'Because Playwright requires `__main__` to launch Chromium.',
          },
          {
            vi: 'Để tăng tốc độ ghi file PDF gấp đôi.',
            en: 'To double disk write throughput.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Chính xác! Tách phần thư viện hàm khỏi khối khởi chạy CLI là chuẩn mực thiết kế module Python.',
          en: 'Exactly! Separating reusable functions from the CLI entry point keeps modules cleanly reusable.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'python scripts/scrape_masvn.py',
        terminalLines: [
          'Opening browser...',
          'Navigating to https://www.masvn.com/cate/bao-cao-thuong-nhat-22...',
          'Collected 15 reports so far...',
          "Clicking 'Tải thêm'...",
          'Collected 30 reports so far...',
          "Clicking 'Tải thêm'...",
          'Collected 45 reports so far...',
          "Clicking 'Tải thêm'...",
          'Collected 60 reports so far...',
          '',
          'Start downloading 50 reports into C:\\Users\\Admin\\masvn-intelligence\\data\\raw_pdfs...',
          '',
          '[1/50] Downloading report_20261113.pdf from https://www.masvn.com/.../MiraeAsset_Daily_VN_20261113.pdf...',
          ' -> Saved successfully!',
          '[2/50] Downloading report_20261112.pdf from https://www.masvn.com/.../MiraeAsset_Daily_VN_20261112.pdf...',
          ' -> Saved successfully!',
          '[3/50] Skipped (already exists): report_20261111.pdf',
          '...',
          '[50/50] Downloading report_20260902.pdf from https://www.masvn.com/.../1725235200000-DailyReport_Mobile_VN.pdf...',
          ' -> Saved successfully!',
        ],
      },
      checkpointItems: [
        {
          vi: 'Hiểu toàn bộ 121 dòng code của `scripts/scrape_masvn.py` từ import tới `__main__`.',
          en: 'Understand every single line of `scripts/scrape_masvn.py` from imports to `__main__`.',
        },
        {
          vi: 'Đã sẵn sàng chạy lệnh `python scripts/scrape_masvn.py` để thu thập 50 bản tin đầu tiên.',
          en: 'Ready to run `python scripts/scrape_masvn.py` locally to populate `data/raw_pdfs/`.',
        },
      ],
      studyApis: ['if __name__ == "__main__"', 'enumerate', 'time.sleep', 'playwright.sync_api'],
      completeFiles: [
        {
          path: 'scripts/scrape_masvn.py',
          language: 'python',
          code: SCRAPE_MASVN_FINAL,
        },
      ],
    },
    {
      id: '1.8',
      moduleId: 'mod-1',
      tier: 3,
      title: {
        vi: 'Bước 1.8: Tách Phương án 1 (scripts/) vs Phương án 2 (src/scraper.py) & Lịch chạy 17h30',
        en: 'Step 1.8: Dual Ingestion Design (scripts/ vs src/scraper.py) & 17:30 Scheduling',
      },
      subtitle: {
        vi: 'Viết module src/scraper.py cho nút bấm trên Streamlit, thêm cờ --days bằng argparse và cài Task Scheduler / Cronjob.',
        en: 'Create `src/scraper.py` for the Streamlit UI button, add `--days` via `argparse`, and schedule daily runs at 17:30.',
      },
      targetFile: 'src/scraper.py',
      whyAndWhat: {
        why: {
          vi: 'Theo bản thiết kế chuẩn của dự án, việc thu thập dữ liệu có 2 cách vận hành song song: **Phương án 1 (`scripts/scrape_masvn.py`)** tách riêng Playwright khỏi thư mục lõi `src/` để chạy nền mỗi ngày lúc **17h30** (sau giờ đóng cửa sàn HOSE/HNX) qua Windows Task Scheduler hoặc Linux Cronjob (`python scripts/scrape_masvn.py --days 30`). **Phương án 2 (`src/scraper.py`)** cung cấp hàm `download_latest_report()` gọn nhẹ để nút *"Cập nhật bản tin mới nhất từ MASVN"* trên giao diện Streamlit gọi thẳng về `data/raw_pdfs/`.',
          en: 'Our project blueprint separates ingestion into two clean entry points: **Option 1 (`scripts/scrape_masvn.py`)** runs headless outside `src/` via a daily **17:30** Task Scheduler / Cronjob (`python scripts/scrape_masvn.py --days 30`); **Option 2 (`src/scraper.py`)** exposes `download_latest_report()` so the Streamlit sidebar button can fetch the latest report on demand.',
        },
        ifMissing: {
          vi: 'Nếu trộn code CLI vòng lặp 50 ngày vào trực tiếp `src/`, mỗi lần giao diện Streamlit import sẽ rất khó kiểm soát tham số; ngược lại nếu không cài lịch 17h30, người dùng phải tự mở terminal gõ lệnh tải tay mỗi chiều.',
          en: 'Without separating `src/scraper.py` from batch CLI flags, UI triggers become messy; without scheduling at 17:30, daily PDF ingestion stays manual.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'argparse.ArgumentParser()',
          params: '--days (int, default=50)',
          inputType: 'CLI args',
          outputType: 'Namespace(days=...)',
          description: {
            vi: 'Nhận tham số dòng lệnh `--days 30` khi chạy từ Task Scheduler hoặc Cronjob.',
            en: 'Parses `--days 30` from CLI flags for scheduled batch runs.',
          },
        },
        {
          symbol: 'download_latest_report(limit=3)',
          params: 'limit: int = 3',
          inputType: 'int',
          outputType: 'list[Path]',
          description: {
            vi: 'Hàm gọn trong `src/scraper.py` tải tối đa 3 bản tin mới nhất và trả về danh sách `Path` để Streamlit đẩy thẳng sang Trạm 1 (`extractor.py`).',
            en: 'Helper in `src/scraper.py` fetching up to 3 latest reports and returning saved `Path` objects for `extractor.py`.',
          },
        },
        {
          symbol: 'Cron: 30 17 * * 1-5',
          params: 'Mon–Fri at 17:30',
          inputType: 'Crontab / Task Scheduler',
          outputType: 'Daily auto-run',
          description: {
            vi: 'Chạy tự động lúc 17h30 từ thứ Hai đến thứ Sáu (trùng lịch giao dịch chứng khoán Việt Nam).',
            en: 'Triggers Monday–Friday at 17:30 after Vietnamese stock market close.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Thêm cờ --days với argparse cho script CLI', en: 'Stage 1: Add --days Flag with argparse' },
          summary: {
            vi: 'Thay con số `N = 50` cứng bằng tham số dòng lệnh linh hoạt.',
            en: 'Replace hardcoded `N = 50` with a flexible CLI flag.',
          },
          code: `import argparse

parser = argparse.ArgumentParser(description="MASVN Daily PDF Scraper")
parser.add_argument("--days", type=int, default=50, help="Số lượng bản tin mới nhất cần tải")
args = parser.parse_args()
print("Fetching limit:", args.days)`,
          expectedNote: {
            vi: 'Chạy thử: `python scripts/scrape_masvn.py --days 5`.',
            en: 'Test with `python scripts/scrape_masvn.py --days 5`.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Viết wrapper src/scraper.py cho Streamlit Sidebar', en: 'Stage 2: UI Wrapper src/scraper.py' },
          summary: {
            vi: 'Trả về danh sách đường dẫn file PDF vừa tải để `app.py` phân tích ngay không cần upload tay.',
            en: 'Return downloaded `Path` objects so `app.py` can process them immediately.',
          },
          code: `from pathlib import Path
from scripts.scrape_masvn import OUTPUT_DIR, download_pdf, get_report_links


def download_latest_report(limit: int = 3) -> list[Path]:
    """Tải nhanh các bản tin mới nhất từ MASVN cho nút bấm trên Streamlit."""
    reports = get_report_links(limit=limit)
    saved_paths: list[Path] = []
    for date_str, url in reports:
        target = OUTPUT_DIR / f"report_{date_str}.pdf"
        download_pdf(url, target)
        if target.exists():
            saved_paths.append(target)
    return saved_paths`,
          expectedNote: {
            vi: 'Trả về `saved_paths[0]` chính là bản tin ngày giao dịch gần nhất.',
            en: '`saved_paths[0]` points directly to the most recent trading day report.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Lệnh cài lịch tự động 17h30 (Windows & Linux/Mac)', en: 'Stage 3: 17:30 Automation Schedule (Windows & Cron)' },
          summary: {
            vi: 'Cấu hình chạy tự động sau giờ đóng cửa thị trường mỗi ngày làm việc.',
            en: 'Configure automated runs Monday–Friday at 17:30.',
          },
          code: `# Linux / macOS Crontab (chạy 'crontab -e'):
30 17 * * 1-5 cd /path/to/masvn-intelligence && .venv/bin/python scripts/scrape_masvn.py --days 30 >> logs/scrape.log 2>&1

# Windows PowerShell (đăng ký Task Scheduler chạy 17:30 hàng ngày):
# schtasks /create /tn "MASVN_Daily_Scrape" /tr "cmd /c cd /d C:\\masvn-intelligence && python scripts\\scrape_masvn.py" /sc weekly /d MON,TUE,WED,THU,FRI /st 17:30`,
          expectedNote: {
            vi: 'Ghi log ra `logs/scrape.log` giúp kiểm tra lại nếu mạng hôm đó bị gián đoạn.',
            en: 'Redirecting output to `logs/scrape.log` lets you audit daily runs.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 8/8: Hoàn chỉnh module giao diện src/scraper.py',
        en: 'Piece 8/8: Complete UI Module src/scraper.py',
      },
      builderExplanation: {
        vi: 'File `src/scraper.py` tái sử dụng hàm đã kiểm chứng từ `scripts/scrape_masvn.py` và trả về danh sách `Path` sẵn sàng nạp vào Trạm 1 (`HybridDocumentExtractor`).',
        en: '`src/scraper.py` reuses tested functions from `scripts/scrape_masvn.py` and returns `Path` objects ready for Station 1 (`HybridDocumentExtractor`).',
      },
      builderCode: `from pathlib import Path
from scripts.scrape_masvn import OUTPUT_DIR, download_pdf, get_report_links


def download_latest_report(limit: int = 3) -> list[Path]:
    """Gọi từ nút 'Cập nhật bản tin mới nhất từ MASVN' trên Sidebar Streamlit."""
    reports = get_report_links(limit=limit)
    saved_paths: list[Path] = []
    for date_str, url in reports:
        target = OUTPUT_DIR / f"report_{date_str}.pdf"
        download_pdf(url, target)
        if target.exists():
            saved_paths.append(target)
    return saved_paths`,
      highlightLines: [1, 14],
      lineWalkthrough: [
        {
          lines: 'L5-L14',
          snippet: 'def download_latest_report(limit: int = 3) -> list[Path]:',
          explanation: {
            vi: 'Chỉ lấy `limit=3` bản tin gần nhất để thao tác bấm nút trên Web hoàn thành trong ~4–5 giây.',
            en: 'Fetches only `limit=3` recent reports so the UI button completes in ~4–5 seconds.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện hàm `download_latest_report` và biểu thức Cronjob chạy 17h30 các ngày Thứ 2–Thứ 6:',
          en: 'Complete `download_latest_report` and the Mon–Fri 17:30 cron expression:',
        },
        codeTemplate: `def download_latest_report(limit: int = 3) -> list[Path]:
    reports = get_report_links(limit=___0___)
    ...
# Crontab 17h30 Mon-Fri:
# ___1___ 17 * * 1-5 python scripts/scrape_masvn.py`,
        answers: ['limit', '30'],
        hints: [
          { vi: 'Truyền tiếp tham số giới hạn vào get_report_links', en: 'Forward the limit argument into get_report_links' },
          { vi: 'Số phút (30) tương ứng với 17:30', en: 'Minute field for 17:30' },
        ],
        explanation: {
          vi: 'Truyền `limit=limit` giúp linh hoạt số lượng lấy; `30 17 * * 1-5` đặt lịch chạy đúng 17h30 từ thứ Hai đến thứ Sáu.',
          en: 'Forwarding `limit=limit` keeps the helper configurable, and `30 17 * * 1-5` schedules 17:30 weekday runs.',
        },
      },
      quiz: {
        question: {
          vi: 'Vì sao kiến trúc chuẩn đặt file cào chính tại `scripts/scrape_masvn.py` thay vì để chung trong `src/` ngay từ đầu?',
          en: 'Why place the batch scraper at `scripts/scrape_masvn.py` instead of mixing it directly into core `src/`?',
        },
        options: [
          {
            vi: 'Để tách biệt tác vụ chạy nền/lịch định kỳ (Batch Ingestion) khỏi lõi suy luận AI (`src/`), giúp `src/` không phụ thuộc cứng vào trình duyệt Playwright.',
            en: 'To decouple scheduled batch ingestion from core AI inference in `src/`, keeping `src/` independent of Playwright browser binaries.',
          },
          {
            vi: 'Vì Python không cho phép đặt quá 5 file trong `src/`.',
            en: 'Because Python limits `src/` to 5 files.',
          },
          {
            vi: 'Vì Playwright chỉ chạy được trong thư mục tên là `scripts/`.',
            en: 'Because Playwright only runs inside a `scripts/` folder.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Phân tách trách nhiệm (Separation of Concerns) giúp triển khai lõi suy luận lên server/Docker nhẹ nhàng hơn nhiều.',
          en: 'Correct! Separation of concerns keeps inference deployments lightweight without mandatory browser binaries.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'from src.scraper import download_latest_report; download_latest_report(limit=3)',
        terminalLines: [
          'Opening browser...',
          'Collected 15 reports so far...',
          '[1/3] Skipped (already exists): report_20261113.pdf',
          '[2/3] Skipped (already exists): report_20261112.pdf',
          '[3/3] Skipped (already exists): report_20261111.pdf',
          'Returned [Path("data/raw_pdfs/report_20261113.pdf"), ...] -> Ready for Station 1',
        ],
      },
      checkpointItems: [
        {
          vi: 'Hiểu rõ sự khác nhau giữa Phương án 1 (`scripts/scrape_masvn.py`) và Phương án 2 (`src/scraper.py`).',
          en: 'Understand Option 1 (`scripts/scrape_masvn.py`) vs Option 2 (`src/scraper.py`).',
        },
        {
          vi: 'Biết cách cấu hình Task Scheduler / Cronjob 17h30 cho các ngày giao dịch.',
          en: 'Know how to schedule 17:30 weekday runs with Task Scheduler or Cron.',
        },
      ],
      studyApis: ['argparse.ArgumentParser', 'src/scraper.py', 'Task Scheduler / Crontab'],
      completeFiles: [
        {
          path: 'src/scraper.py',
          language: 'python',
          code: `from pathlib import Path\nfrom scripts.scrape_masvn import OUTPUT_DIR, download_pdf, get_report_links\n\n\ndef download_latest_report(limit: int = 3) -> list[Path]:\n    """Gọi từ nút 'Cập nhật bản tin mới nhất từ MASVN' trên Sidebar Streamlit."""\n    reports = get_report_links(limit=limit)\n    saved_paths: list[Path] = []\n    for date_str, url in reports:\n        target = OUTPUT_DIR / f"report_{date_str}.pdf"\n        download_pdf(url, target)\n        if target.exists():\n            saved_paths.append(target)\n    return saved_paths`,
        },
      ],
    },
  ],
};
