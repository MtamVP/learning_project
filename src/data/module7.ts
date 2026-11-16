import { ModuleSpec } from '../types';

const FASTAPI_SERVER_CODE = `from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import pandas as pd
from src.ml_scorer import StockScorer
from src.rag_engine import HybridRAGEngine

app = FastAPI(title="MASVN Market Intelligence API", version="1.0.0")
scorer = StockScorer("models/stock_scorer.pkl")
rag = HybridRAGEngine()


class StockInput(BaseModel):
    Mã: str
    Giá: float = Field(gt=0)
    PE: float | None = Field(default=None, alias="P/E")
    PB: float | None = Field(default=None, alias="P/B")
    ROE: float | None = None
    KLTB_20N: float = Field(default=1.0, alias="KLTB 20N")
    GTGD: float = 0.0


class AskRequest(BaseModel):
    question: str = Field(min_length=3)
    top_k: int = Field(default=4, ge=1, le=8)


@app.post("/score")
def score_stocks(items: list[StockInput]):
    if not items:
        raise HTTPException(status_code=400, detail="Empty stock list")
    df = pd.DataFrame([i.model_dump(by_alias=True) for i in items])
    scored = scorer.score(df)
    return scored.to_dict(orient="records")


@app.post("/ask")
def ask_market(req: AskRequest):
    return rag.ask(query=req.question)`;

export const module7: ModuleSpec = {
  id: 'mod-7',
  number: 7,
  title: {
    vi: 'Học phần 7: Mở rộng Công cụ & Kiến trúc Production (Ngoài Project)',
    en: 'Module 7: Extended Tooling & Production Engineering (Beyond the Project)',
  },
  summary: {
    vi: 'Nâng tầm từ đồ án cá nhân sang kỹ năng kỹ sư thực thụ: Playwright Network Interception, FastAPI + Docker, GGUF Quantization & Ollama Modelfile, và DuckDB Backtesting.',
    en: 'Level up from a capstone app to production systems: Playwright XHR interception, FastAPI + Docker APIs, GGUF quantization & Ollama Modelfile, and DuckDB backtesting.',
  },
  stack: ['Playwright Network API', 'FastAPI', 'Docker', 'Ollama Modelfile', 'DuckDB'],
  steps: [
    {
      id: '7.1',
      moduleId: 'mod-7',
      tier: 2,
      title: {
        vi: 'Bước 7.1: Playwright Nâng cao — Bắt gói tin API (XHR/JSON) & Giữ phiên đăng nhập',
        en: 'Step 7.1: Advanced Playwright — Network Interception & Auth Storage State',
      },
      subtitle: {
        vi: 'Dùng `page.on("response")` bắt thẳng JSON từ backend thay vì cào DOM HTML, và lưu cookie đăng nhập với `storage_state`.',
        en: 'Capture raw JSON responses via `page.on("response")` instead of scraping DOM, and persist login sessions with `storage_state`.',
      },
      targetFile: 'scripts/scrape_api_interceptor.py',
      whyAndWhat: {
        why: {
          vi: 'Ở Học phần 1 ta quét thẻ `<a>` trên DOM vì MASVN chỉ nhúng link PDF công khai. Nhưng với nhiều trang tài chính khác (như bảng giá thời gian thực, dữ liệu báo cáo tài chính theo quý trên CafeF/Vietstock), dữ liệu nằm trong các request JSON chạy ngầm (XHR/Fetch). Thay vì click phân trang chậm chạp, `page.on("response")` cho phép bắt trực tiếp gói JSON sạch từ API; còn `context.storage_state(path="auth.json")` lưu cookie sau khi đăng nhập 1 lần để lần sau chạy tự động không cần nhập lại mật khẩu.',
          en: 'In Module 1 we scraped DOM `<a>` tags for public PDFs. On interactive portals (live market boards, quarterly financials), structured data arrives via background XHR/Fetch JSON calls. Listening with `page.on("response")` captures clean JSON directly, while `context.storage_state()` saves login cookies so subsequent runs skip manual sign-in.',
        },
        ifMissing: {
          vi: 'Nếu vẫn cố cào từng ô `<td>` trên bảng HTML ảo (virtualized scroll table), dữ liệu chỉ lấy được 20 dòng đang hiển thị trên màn hình và dễ gãy mỗi khi frontend đổi class CSS.',
          en: 'Scraping DOM `<td>` nodes on virtualized tables misses off-screen rows and breaks whenever frontend CSS classes change.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'page.on("response", handler)',
          params: 'event="response", callback(res)',
          inputType: 'Playwright Response',
          outputType: 'dict / list (res.json())',
          description: {
            vi: 'Lắng nghe mọi phản hồi HTTP khi trang tải; lọc `if "/api/reports" in res.url and res.status == 200:` để lấy thẳng JSON.',
            en: 'Intercepts every HTTP response; filter `res.url` and `res.status == 200` to parse clean JSON.',
          },
        },
        {
          symbol: 'context.storage_state(path="auth.json")',
          params: 'path: str',
          inputType: 'BrowserContext',
          outputType: 'JSON cookie/localStorage file',
          description: {
            vi: 'Lưu lại cookie và `localStorage` của phiên đã đăng nhập để tái sử dụng cho các lần chạy `browser.new_context(storage_state="auth.json")`.',
            en: 'Exports authenticated cookies and `localStorage` for reuse in future headless runs.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Bắt toàn bộ API JSON chạy ngầm trên trang web', en: 'Stage 1: Intercept Background JSON APIs' },
          summary: {
            vi: 'In ra URL và dữ liệu JSON mỗi khi trang gọi XHR thành công.',
            en: 'Capture and inspect XHR JSON payloads automatically as the page loads.',
          },
          code: `captured = []

def handle_response(res):
    if "application/json" in res.headers.get("content-type", "") and res.status == 200:
        try:
            captured.append({"url": res.url, "data": res.json()})
        except Exception:
            pass

page.on("response", handle_response)
page.goto("https://www.masvn.com/cate/bao-cao-thuong-nhat-22")`,
          expectedNote: {
            vi: 'Đây là cách kỹ sư data tìm ra endpoint API thật ẩn sau các giao diện React/Vue hiện đại.',
            en: 'This is how data engineers uncover clean backend APIs behind modern SPAs.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Chặn tải ảnh/font thừa để tăng tốc cào lên 3 lần', en: 'Stage 2: Abort Heavy Assets via page.route()' },
          summary: {
            vi: 'Khi chỉ cần lấy link hoặc JSON, chặn `image`, `stylesheet`, `font` để tiết kiệm băng thông.',
            en: 'Block `image`, `stylesheet`, and `font` resources via `page.route()` to speed up headless scraping.',
          },
          code: `page.route("**/*", lambda route: route.abort() if route.request.resource_type in {"image", "font", "media"} else route.continue_())`,
          expectedNote: {
            vi: 'Tải trang nhanh gấp 2–4 lần và giảm tiêu thụ RAM của Chromium.',
            en: 'Cuts page load time 2–4x and lowers Chromium memory footprint.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Lưu & Nạp lại phiên đăng nhập với storage_state', en: 'Stage 3: Persist Auth Cookies with storage_state' },
          summary: {
            vi: 'Chạy 1 lần `headless=False` để đăng nhập, lưu `auth.json`, sau đó chạy `headless=True` tự động.',
            en: 'Log in once interactively, save `auth.json`, and reuse it headlessly.',
          },
          code: `# Lần 1 (sau khi user đăng nhập tay trên cửa sổ Chromium):
# context.storage_state(path="auth.json")

# Các lần chạy tự động tiếp theo:
context = browser.new_context(storage_state="auth.json")
page = context.new_page()`,
          expectedNote: {
            vi: 'Luôn thêm `auth.json` vào `.gitignore` để không lộ session token lên GitHub!',
            en: 'Always add `auth.json` to `.gitignore` so session cookies never leak to GitHub!',
          },
        },
      ],
      builderTitle: {
        vi: 'Script mở rộng: Playwright Network Interceptor & Asset Blocker',
        en: 'Extension Script: Playwright Network Interceptor & Asset Blocker',
      },
      builderExplanation: {
        vi: 'Mẫu script Playwright chuyên nghiệp chặn tài nguyên nặng bằng `page.route()` và lắng nghe API JSON trực tiếp qua `page.on("response")`.',
        en: 'Production Playwright pattern combining `page.route()` asset blocking with `page.on("response")` JSON interception.',
      },
      builderCode: `from playwright.sync_api import sync_playwright

def intercept_api_feeds(target_url: str, keyword: str = "report") -> list[dict]:
    payloads = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Chặn ảnh/video/font để tăng tốc độ tải
        page.route(
            "**/*",
            lambda r: r.abort() if r.request.resource_type in {"image", "media", "font"} else r.continue_(),
        )

        def on_res(res):
            if keyword in res.url.lower() and res.status == 200:
                if "json" in res.headers.get("content-type", ""):
                    payloads.append(res.json())

        page.on("response", on_res)
        page.goto(target_url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)
        browser.close()
    return payloads`,
      highlightLines: [11, 22],
      lineWalkthrough: [
        {
          lines: 'L11-L14',
          snippet: 'page.route("**/*", lambda r: r.abort() if r.request.resource_type in {"image", "media", "font"} else r.continue_())',
          explanation: {
            vi: 'Từ chối tải file đa phương tiện nặng nhưng vẫn cho phép HTML và JS chạy bình thường.',
            en: 'Drops heavy media requests while keeping HTML and JS execution intact.',
          },
        },
        {
          lines: 'L16-L21',
          snippet: 'page.on("response", on_res)',
          explanation: {
            vi: 'Đăng ký listener TRƯỚC khi gọi `page.goto()` để không lỡ mất các request đầu tiên.',
            en: 'Registers the response listener BEFORE `page.goto()` so early API calls are captured.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện đoạn chặn tải ảnh/font bằng `page.route` và lắng nghe phản hồi mạng:',
          en: 'Complete asset blocking with `page.route` and registering the response listener:',
        },
        codeTemplate: `page.route("**/*", lambda r: r.___0___() if r.request.resource_type in {"image", "font"} else r.continue_())
page.on("___1___", on_res)`,
        answers: ['abort', 'response'],
        hints: [
          { vi: 'Phương thức của Route hủy request không cần thiết', en: 'Route method that cancels unwanted requests' },
          { vi: 'Tên sự kiện Playwright phát ra khi server trả phản hồi HTTP', en: 'Playwright page event emitted on HTTP responses' },
        ],
        explanation: {
          vi: '`r.abort()` ngắt tải ảnh/font thừa, và `page.on("response", ...)` bắt các gói JSON trả về từ server.',
          en: '`r.abort()` blocks unnecessary assets while `page.on("response", ...)` intercepts API payloads.',
        },
      },
      quiz: {
        question: {
          vi: 'Vì sao phải gọi `page.on("response", on_res)` TRƯỚC lệnh `page.goto(url)`?',
          en: 'Why must `page.on("response", on_res)` be attached BEFORE calling `page.goto(url)`?',
        },
        options: [
          {
            vi: 'Nếu gắn sau `page.goto()`, các request API bắn ra ngay lúc trang vừa mở sẽ hoàn tất trước khi listener kịp lắng nghe.',
            en: 'Attaching after `page.goto()` misses initial XHR requests fired while the page is loading.',
          },
          {
            vi: 'Vì Playwright cấm gọi `page.on()` sau `goto()`.',
            en: 'Because Playwright forbids calling `page.on()` after `goto()`.',
          },
          {
            vi: 'Để tự động lưu cookie ra `auth.json`.',
            en: 'To auto-save `auth.json`.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Luôn đăng ký listener trước khi điều hướng để bắt trọn vẹn luồng dữ liệu.',
          en: 'Correct! Register listeners prior to navigation so early network responses are never missed.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'intercept_api_feeds("https://www.masvn.com/cate/bao-cao-thuong-nhat-22")',
        terminalLines: [
          '[Route] Aborted 24 image/font requests (saved 4.8 MB bandwidth)',
          '[Response 200] GET /api/v1/reports?cate=22&page=1 (application/json)',
          '[Captured] 15 structured JSON report records in 610 ms',
        ],
      },
      checkpointItems: [
        {
          vi: 'Biết dùng `page.on("response")` để bắt JSON API thay vì cào HTML thủ công.',
          en: 'Intercept JSON APIs via `page.on("response")` instead of fragile DOM parsing.',
        },
        {
          vi: 'Biết chặn tải ảnh bằng `page.route()` và tái sử dụng phiên bằng `storage_state`.',
          en: 'Speed up crawlers with `page.route()` and persist auth via `storage_state`.',
        },
      ],
      studyApis: ['page.on("response")', 'page.route', 'context.storage_state'],
    },
    {
      id: '7.2',
      moduleId: 'mod-7',
      tier: 3,
      title: {
        vi: 'Bước 7.2: Bọc Engine thành REST API với FastAPI, Pydantic & Docker',
        en: 'Step 7.2: Exposing the Engine as a REST API with FastAPI, Pydantic & Docker',
      },
      subtitle: {
        vi: 'Tách backend AI ra khỏi Streamlit bằng `FastAPI` (`/score`, `/ask`), kiểm tra kiểu dữ liệu với `Pydantic` và đóng gói `Dockerfile`.',
        en: 'Decouple AI inference from Streamlit into `FastAPI` endpoints (`/score`, `/ask`) with `Pydantic` validation and a `Dockerfile`.',
      },
      targetFile: 'api/server.py',
      whyAndWhat: {
        why: {
          vi: 'Streamlit rất tuyệt cho demo nội bộ hoặc nghiên cứu, nhưng nếu muốn kết nối hệ thống chấm điểm cổ phiếu & RAG này vào **ứng dụng web React/Next.js**, **app mobile** hay **bot Telegram**, bạn cần bọc `StockScorer` và `HybridRAGEngine` thành một **REST API** bằng `FastAPI` + `Pydantic` và đóng gói bằng `Docker`.',
          en: 'Streamlit excels for local dashboards, but integrating your scorer and RAG into a **React/Next.js frontend**, **mobile app**, or **Telegram bot** requires a clean REST API. Wrapping `StockScorer` and `HybridRAGEngine` in `FastAPI` + `Pydantic` + `Docker` makes the engine universally consumable.',
        },
        ifMissing: {
          vi: 'Logic AI bị trói chặt vào giao diện Streamlit (`st.session_state`), không thể phục vụ nhiều client bên ngoài hoặc tích hợp vào hệ thống giao dịch khác.',
          en: 'Inference stays coupled to Streamlit reruns and cannot serve external web, mobile, or bot clients.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'class StockInput(BaseModel)',
          params: 'Pydantic v2 schema + Field(gt=0)',
          inputType: 'Incoming JSON',
          outputType: 'Validated model or HTTP 422',
          description: {
            vi: 'Tự động kiểm tra kiểu dữ liệu (vd: `Giá > 0`) và ánh xạ tên trường JSON `P/E` vào biến Python `PE` qua `alias="P/E"`.',
            en: 'Validates incoming JSON (e.g., `Giá > 0`) and maps `"P/E"` keys via `Field(alias="P/E")`.',
          },
        },
        {
          symbol: '@app.post("/score") & @app.post("/ask")',
          params: 'uvicorn api.server:app --port 8000',
          inputType: 'HTTP POST JSON',
          outputType: 'JSON response + Swagger /docs',
          description: {
            vi: 'FastAPI tự động sinh tài liệu tương tác Swagger UI tại `http://localhost:8000/docs` không cần viết thêm dòng nào.',
            en: 'Automatically serves interactive OpenAPI Swagger documentation at `/docs`.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Định nghĩa Schema kiểm tra đầu vào bằng Pydantic', en: 'Stage 1: Input Validation with Pydantic' },
          summary: {
            vi: 'Dùng `alias="P/E"` để API nhận JSON có dấu gạch chéo `"P/E"` mà tên biến Python vẫn hợp lệ.',
            en: 'Use `alias="P/E"` so JSON payloads can use `"P/E"` while Python stays clean.',
          },
          code: `from pydantic import BaseModel, Field

class StockInput(BaseModel):
    Mã: str
    Giá: float = Field(gt=0)
    PE: float | None = Field(default=None, alias="P/E")`,
          expectedNote: {
            vi: 'Nếu client gửi `Giá: -10`, FastAPI tự trả mã `422 Unprocessable Entity` trước khi chạm tới LightGBM.',
            en: 'Invalid `Giá <= 0` automatically triggers HTTP `422` before reaching LightGBM.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Tạo endpoint /score và /ask trong FastAPI', en: 'Stage 2: FastAPI /score and /ask Routes' },
          summary: {
            vi: 'Load `scorer` và `rag` 1 lần ở cấp module để mọi request dùng chung trong bộ nhớ.',
            en: 'Instantiate `scorer` and `rag` once at module load for sub-10ms request handling.',
          },
          code: FASTAPI_SERVER_CODE,
          expectedNote: {
            vi: 'Chạy thử bằng `uvicorn api.server:app --reload` rồi mở `/docs`.',
            en: 'Start locally via `uvicorn api.server:app --reload` and open `/docs`.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Viết Dockerfile gọn nhẹ triển khai Container', en: 'Stage 3: Containerize with Dockerfile' },
          summary: {
            vi: 'Đóng gói Python 3.11-slim + `requirements.txt` để chạy đồng nhất trên mọi máy.',
            en: 'Package Python 3.11-slim + `requirements.txt` for reproducible server deployments.',
          },
          code: `FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt fastapi uvicorn
COPY src/ ./src/
COPY models/ ./models/
COPY data/vector_store/ ./data/vector_store/
EXPOSE 8000
CMD ["uvicorn", "api.server:app", "--host", "0.0.0.0", "--port", "8000"]`,
          expectedNote: {
            vi: 'Container kết nối tới Ollama trên máy host qua `http://host.docker.internal:11434/api/generate`.',
            en: 'Containers reach host Ollama cleanly via `http://host.docker.internal:11434/api/generate`.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mở rộng Backend: FastAPI Server (api/server.py)',
        en: 'Backend Extension: FastAPI Server (api/server.py)',
      },
      builderExplanation: {
        vi: 'Cung cấp 2 API chuẩn công nghiệp `/score` (LightGBM) và `/ask` (Hybrid RAG) tách biệt hoàn toàn khỏi giao diện.',
        en: 'Exposes production `/score` (LightGBM) and `/ask` (Hybrid RAG) endpoints decoupled from any UI.',
      },
      builderCode: FASTAPI_SERVER_CODE,
      highlightLines: [12, 39],
      lineWalkthrough: [
        {
          lines: 'L12-L20',
          snippet: 'PE: float | None = Field(default=None, alias="P/E")',
          explanation: {
            vi: '`by_alias=True` ở dòng 31 xuất lại đúng tên cột `"P/E"`, `"P/B"` khớp 100% với `StockScorer`.',
            en: '`model_dump(by_alias=True)` preserves `"P/E"` and `"P/B"` column keys expected by `StockScorer`.',
          },
        },
        {
          lines: 'L27-L33',
          snippet: '@app.post("/score")\ndef score_stocks(items: list[StockInput]):',
          explanation: {
            vi: 'Chấm điểm cả danh sách cổ phiếu trong một request batch duy nhất.',
            en: 'Scores an arbitrary batch of stock items in a single HTTP request.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện xuất dictionary giữ nguyên alias `"P/E"` của Pydantic v2 và decorator POST:',
          en: 'Complete Pydantic v2 `by_alias` export and FastAPI POST route:',
        },
        codeTemplate: `@app.___0___("/score")
def score_stocks(items: list[StockInput]):
    df = pd.DataFrame([i.model_dump(___1___=True) for i in items])`,
        answers: ['post', 'by_alias'],
        hints: [
          { vi: 'Phương thức HTTP gửi JSON payload để chấm điểm', en: 'HTTP method decorator for JSON body requests' },
          { vi: 'Tham số của model_dump() giúp giữ tên alias "P/E" thay vì "PE"', en: 'model_dump() flag preserving field aliases like "P/E"' },
        ],
        explanation: {
          vi: '`@app.post` nhận JSON body và `model_dump(by_alias=True)` giữ nguyên tên cột tài chính `"P/E"`, `"P/B"`.',
          en: '`@app.post` accepts JSON request bodies and `by_alias=True` outputs exact `"P/E"` / `"P/B"` column keys.',
        },
      },
      quiz: {
        question: {
          vi: 'Khi đóng gói FastAPI vào Docker container mà Ollama vẫn chạy trên máy Windows/Linux bên ngoài (host), `ollama_url` trong container nên trỏ tới đâu?',
          en: 'When running FastAPI inside Docker while Ollama runs on the host machine, what URL should `ollama_url` target?',
        },
        options: [
          {
            vi: '`http://host.docker.internal:11434/api/generate` (vì `localhost` bên trong container trỏ vào chính container đó).',
            en: '`http://host.docker.internal:11434/api/generate` (since `localhost` inside Docker points to the container itself).',
          },
          {
            vi: '`http://localhost:11434/api/generate` vẫn tự hiểu là máy host.',
            en: '`http://localhost:11434/api/generate` automatically bridges to host.',
          },
          {
            vi: '`http://127.0.0.1:8000/ollama`.',
            en: '`http://127.0.0.1:8000/ollama`.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Rất nhiều người bị lỗi ConnectionRefused khi mới Dockerize vì nhầm `localhost` của container với `localhost` của máy thật.',
          en: 'Correct! Container `localhost` is isolated from host `localhost`; `host.docker.internal` bridges cleanly.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'curl -X POST http://localhost:8000/score -d "[{...MBB...}]"',
        terminalLines: [
          'INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)',
          'INFO:     127.0.0.1:54120 - "POST /score HTTP/1.1" 200 OK (6.2 ms)',
          '[{"Mã": "MBB", "Đánh giá": "Khả quan", "Độ tin cậy (%)": 96.4, "Lý do chính": "Điểm mạnh: ROE=22.8%, P/E=6.1, P/B=1.20"}]',
        ],
      },
      checkpointItems: [
        {
          vi: 'Biết tách nhân AI thành microservice REST API với `FastAPI` + `Pydantic`.',
          en: 'Expose ML and RAG engines as validated `FastAPI` endpoints.',
        },
        {
          vi: 'Nắm được cách viết `Dockerfile` và kết nối container về Ollama host.',
          en: 'Write a minimal `Dockerfile` and bridge container requests to host Ollama.',
        },
      ],
      studyApis: ['FastAPI', 'pydantic.BaseModel', 'model_dump(by_alias=True)', 'Dockerfile'],
      completeFiles: [
        {
          path: 'api/server.py',
          language: 'python',
          code: FASTAPI_SERVER_CODE,
        },
      ],
    },
    {
      id: '7.3',
      moduleId: 'mod-7',
      tier: 2,
      title: {
        vi: 'Bước 7.3: Hiểu sâu Local LLM — Lượng tử hóa GGUF, Ollama Modelfile & Streaming',
        en: 'Step 7.3: Local LLM Internals — GGUF Quantization, Modelfile & Streaming',
      },
      subtitle: {
        vi: 'Giải thích tại sao `qwen2.5:7b` (FP16 14GB) chạy vừa 8GB VRAM nhờ nén `Q4_K_M`, cách tùy biến `Modelfile` (`temperature=0.1`, `num_ctx`) và stream token.',
        en: 'Understand how `Q4_K_M` GGUF fits a 14GB FP16 7B model into 8GB VRAM, customize Ollama `Modelfile` (`temperature=0.1`, `num_ctx`), and stream tokens.',
      },
      targetFile: 'Modelfile',
      whyAndWhat: {
        why: {
          vi: 'Một mô hình 7 tỷ tham số (7B) ở độ chính xác gốc FP16 (2 bytes/tham số) cần tới **~14GB VRAM** — vượt xa RTX 5060 8GB! Kỹ thuật lượng tử hóa **GGUF `Q4_K_M`** nén mỗi trọng số xuống ~4.5 bit (~4.7GB VRAM), cộng thêm **KV-Cache** cho độ dài ngữ cảnh (`num_ctx=4096`) thành ~5.2GB. Biết cách viết `Modelfile` riêng giúp bạn khóa `temperature 0.1` (giảm sáng tạo lung tung với số liệu chứng khoán) và bật `stream=True` cho chữ hiện từng chữ mượt mà như ChatGPT.',
          en: 'A 7B model in FP16 (2 bytes/param) requires **~14GB VRAM**, exceeding an 8GB RTX 5060. **GGUF `Q4_K_M`** quantization compresses weights to ~4.5 bits (~4.7GB) plus KV-Cache (`num_ctx=4096`) totaling ~5.2GB. Writing a custom Ollama `Modelfile` pins `temperature 0.1` (minimizing numeric drift) while `stream=True` delivers responsive word-by-word output.',
        },
        ifMissing: {
          vi: 'Nếu để `num_ctx` quá lớn (ví dụ 32,768 tokens), phần KV-Cache phình to làm Ollama âm thầm tràn khỏi 8GB VRAM và đẩy một nửa các lớp mạng về chạy CPU (tốc độ tụt từ 48 tok/s xuống còn 4 tok/s!).',
          en: 'Setting `num_ctx` to 32k bloats KV-Cache past 8GB VRAM, silently offloading layers to slow CPU RAM (48 tok/s drops to ~4 tok/s).',
        },
      },
      apiAnatomy: [
        {
          symbol: 'Q4_K_M vs Q8_0 vs FP16',
          params: 'Quantization bit-width',
          inputType: '7B weights',
          outputType: '4.7GB / 7.7GB / 14.2GB',
          description: {
            vi: '`Q4_K_M` là điểm ngọt tối ưu nhất cho card 8GB VRAM: giữ >98% năng lực suy luận của Qwen2.5:7b mà vẫn chừa đủ chỗ cho KV-Cache và YOLO.',
            en: '`Q4_K_M` is the sweet spot for 8GB GPUs, preserving >98% reasoning quality while leaving room for KV-Cache.',
          },
        },
        {
          symbol: 'Ollama Modelfile (PARAMETER num_ctx, temperature)',
          params: 'ollama create masvn-analyst -f Modelfile',
          inputType: 'Modelfile text',
          outputType: 'Custom local model tag',
          description: {
            vi: 'Đóng gói sẵn `SYSTEM` prompt, `temperature 0.1` và `num_ctx 4096` thành một model chuyên biệt tên `masvn-analyst`.',
            en: 'Bakes `SYSTEM` instructions, `temperature 0.1`, and `num_ctx 4096` into a reusable custom tag `masvn-analyst`.',
          },
        },
        {
          symbol: 'requests.post(..., stream=True)',
          params: 'iter_lines()',
          inputType: 'NDJSON stream',
          outputType: 'Yielded token chunks',
          description: {
            vi: 'Đọc từng dòng JSON trả về theo thời gian thực để nối với `st.write_stream()` trên Streamlit.',
            en: 'Iterates NDJSON chunks in real time for Streamlit `st.write_stream()`.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Kiểm tra các lớp model có đang nằm gọn trên GPU không (ollama ps)', en: 'Stage 1: Verify 100% GPU Offload with ollama ps' },
          summary: {
            vi: 'Nhìn cột `PROCESSOR` để chắc chắn `100% GPU`, không bị rơi sang CPU.',
            en: 'Check `ollama ps` to confirm `100% GPU` execution.',
          },
          code: `# Chạy trên terminal sau khi gọi thử model:
# ollama ps
# NAME           SIZE     PROCESSOR   UNTIL
# qwen2.5:7b     5.2 GB   100% GPU    4 minutes from now`,
          expectedNote: {
            vi: 'Nếu thấy `50% CPU / 50% GPU` -> giảm `num_ctx` xuống `4096` hoặc tắt bớt tab Chrome ngốn VRAM.',
            en: 'If you see `50% CPU / 50% GPU`, lower `num_ctx` to `4096` or close VRAM-heavy browser tabs.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Tạo Modelfile riêng cho Trợ lý Tài chính MASVN', en: 'Stage 2: Custom MASVN Modelfile' },
          summary: {
            vi: 'Đặt `temperature 0.1` để câu trả lời bám sát số liệu, ít ngẫu nhiên.',
            en: 'Set `temperature 0.1` for deterministic, fact-grounded replies.',
          },
          code: `FROM qwen2.5:7b
PARAMETER temperature 0.1
PARAMETER num_ctx 4096
PARAMETER repeat_penalty 1.1
SYSTEM """
Bạn là chuyên viên phân tích chứng khoán MASVN. Chỉ trả lời dựa trên ngữ cảnh được cung cấp và luôn trích dẫn [Ngày - Trang].
"""`,
          expectedNote: {
            vi: 'Build bằng lệnh: `ollama create masvn-analyst -f Modelfile`.',
            en: 'Build locally via `ollama create masvn-analyst -f Modelfile`.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Streaming Token từng chữ cho Streamlit st.write_stream()', en: 'Stage 3: Token-by-Token Streaming Generator' },
          summary: {
            vi: 'Giảm cảm giác chờ đợi cho người dùng từ 3 giây xuống còn ~150ms cho chữ đầu tiên (TTFT).',
            en: 'Cut perceived wait time down to ~150ms time-to-first-token.',
          },
          code: `import json, requests

def stream_ollama(prompt: str, model: str = "masvn-analyst"):
    with requests.post(
        "http://localhost:11434/api/generate",
        json={"model": model, "prompt": prompt, "stream": True},
        stream=True,
        timeout=120,
    ) as resp:
        for line in resp.iter_lines():
            if line:
                chunk = json.loads(line.decode("utf-8"))
                yield chunk.get("response", "")`,
          expectedNote: {
            vi: 'Trong Streamlit Tab 2, chỉ cần gọi `st.write_stream(stream_ollama(prompt))`!',
            en: 'In Streamlit Tab 2, pass directly to `st.write_stream(stream_ollama(prompt))`!',
          },
        },
      ],
      builderTitle: {
        vi: 'Cấu hình Local LLM: Modelfile & Stream Helper',
        en: 'Local LLM Config: Modelfile & Streaming Helper',
      },
      builderExplanation: {
        vi: 'File `Modelfile` tối ưu riêng cho RTX 5060 8GB VRAM (`num_ctx 4096`, `temperature 0.1`).',
        en: 'Custom `Modelfile` tuned for RTX 5060 8GB VRAM (`num_ctx 4096`, `temperature 0.1`).',
      },
      builderCode: `FROM qwen2.5:7b
PARAMETER temperature 0.1
PARAMETER num_ctx 4096
PARAMETER repeat_penalty 1.1

SYSTEM """
Bạn là trợ lý phân tích chứng khoán MASVN. CHỈ được trả lời dựa trên ngữ cảnh bản tin và bảng điểm ML được cung cấp. Luôn trích dẫn [Ngày YYYYMMDD - Trang X]. Nếu không có thông tin, nói rõ không tìm thấy.
"""`,
      highlightLines: [1, 8],
      lineWalkthrough: [
        {
          lines: 'L2-L4',
          snippet: 'PARAMETER temperature 0.1\nPARAMETER num_ctx 4096',
          explanation: {
            vi: '`temperature 0.1` hạn chế LLM suy diễn sáng tạo quá mức; `num_ctx 4096` giữ KV-Cache vừa khít 8GB VRAM.',
            en: '`temperature 0.1` keeps outputs factual and `num_ctx 4096` keeps KV-Cache comfortably under 8GB VRAM.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện tham số `Modelfile` để kiểm soát cửa sổ ngữ cảnh vừa 8GB VRAM và bật streaming trong `requests.post`:',
          en: 'Complete the 8GB-VRAM-safe `Modelfile` context parameter and streaming flag:',
        },
        codeTemplate: `FROM qwen2.5:7b
PARAMETER temperature 0.1
PARAMETER ___0___ 4096
...
requests.post(url, json={"model": "masvn-analyst", "prompt": p, "___1___": True}, stream=True)`,
        answers: ['num_ctx', 'stream'],
        hints: [
          { vi: 'Tham số Ollama giới hạn độ dài token ngữ cảnh (KV-Cache)', en: 'Ollama parameter capping context window length' },
          { vi: 'Trường JSON bật trả về từng token liên tục', en: 'JSON payload flag enabling token streaming' },
        ],
        explanation: {
          vi: '`num_ctx 4096` giữ bộ nhớ KV-Cache an toàn trên RTX 5060; `"stream": True` kết hợp `iter_lines()` cho hiệu ứng gõ chữ tức thì.',
          en: '`num_ctx 4096` caps KV-Cache on RTX 5060 while `"stream": True` streams tokens incrementally.',
        },
      },
      quiz: {
        question: {
          vi: 'Khi chạy `ollama ps`, nếu thấy báo `50% CPU / 50% GPU` khiến `qwen2.5:7b` phản hồi rất chậm, nguyên nhân thường gặp nhất là gì?',
          en: 'If `ollama ps` reports `50% CPU / 50% GPU` and generation slows down drastically, what is the most common cause?',
        },
        options: [
          {
            vi: 'Tổng trọng số + KV-Cache (`num_ctx` quá cao) vượt 8GB VRAM, buộc Ollama đẩy một nửa số tầng mạng sang CPU RAM.',
            en: 'Weights + KV-Cache (`num_ctx` too large) exceeded 8GB VRAM, spilling half the transformer layers to CPU RAM.',
          },
          {
            vi: 'Do đặt `temperature 0.1` quá thấp.',
            en: 'Because `temperature 0.1` is too low.',
          },
          {
            vi: 'Do dùng `stream=True`.',
            en: 'Because `stream=True` was enabled.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Luôn kiểm tra `ollama ps` để đảm bảo `100% GPU` khi tối ưu hiệu năng Local LLM.',
          en: 'Correct! Always verify `100% GPU` in `ollama ps` when tuning local LLM performance.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'ollama create masvn-analyst -f Modelfile && ollama ps',
        terminalLines: [
          'gathering model components...',
          'using existing layer sha256:2bada8a74506 (qwen2.5:7b Q4_K_M)',
          'writing manifest -> success: created masvn-analyst',
          '',
          'NAME                   SIZE      PROCESSOR    CONTEXT    UNTIL',
          'masvn-analyst:latest   5.2 GB    100% GPU     4096       4 minutes from now',
        ],
      },
      checkpointItems: [
        {
          vi: 'Hiểu tại sao GGUF `Q4_K_M` chạy vừa 8GB VRAM thay vì ~14GB của FP16.',
          en: 'Understand how GGUF `Q4_K_M` fits a 7B model into 8GB VRAM.',
        },
        {
          vi: 'Biết tạo `Modelfile` riêng và viết generator streaming cho UI.',
          en: 'Author a custom `Modelfile` and stream tokens via `iter_lines()`.',
        },
      ],
      studyApis: ['GGUF Q4_K_M', 'Ollama Modelfile', 'num_ctx', 'requests stream=True'],
      completeFiles: [
        {
          path: 'Modelfile',
          language: 'text',
          code: `FROM qwen2.5:7b\nPARAMETER temperature 0.1\nPARAMETER num_ctx 4096\nPARAMETER repeat_penalty 1.1\n\nSYSTEM """\nBạn là trợ lý phân tích chứng khoán MASVN. CHỈ được trả lời dựa trên ngữ cảnh bản tin và bảng điểm ML được cung cấp. Luôn trích dẫn [Ngày YYYYMMDD - Trang X]. Nếu không có thông tin, nói rõ không tìm thấy.\n"""\n`,
        },
      ],
    },
    {
      id: '7.4',
      moduleId: 'mod-7',
      tier: 3,
      title: {
        vi: 'Bước 7.4: Phân tích lịch sử với DuckDB SQL & Kiểm thử tín hiệu (Backtesting)',
        en: 'Step 7.4: Historical Analytics with DuckDB SQL & Signal Backtesting',
      },
      subtitle: {
        vi: 'Thay thế thao tác đọc CSV chậm chạp bằng `DuckDB` SQL truy vấn trực tiếp hàng năm trời dữ liệu và kiểm tra hiệu quả tín hiệu LightGBM.',
        en: 'Query multi-year historical snapshots directly with `DuckDB` SQL and backtest forward returns of LightGBM "Khả quan" signals.',
      },
      targetFile: 'notebooks/05_backtest_duckdb.ipynb',
      whyAndWhat: {
        why: {
          vi: 'Khi bạn chạy scraper đều đặn 17h30 suốt 1 năm (~250 ngày giao dịch -> ~25,000 dòng), `pd.read_csv()` toàn bộ file mỗi lần lọc 1 mã cổ phiếu sẽ chậm dần. **DuckDB** là hệ quản trị CSDL phân tích nhúng (in-process OLAP — không cần cài server như PostgreSQL) có thể chạy **SQL trực tiếp trên file CSV/Parquet** chỉ trong vài mili-giây, đồng thời giúp bạn làm bài toán quan trọng nhất trong tài chính định lượng: **Backtesting** — kiểm chứng xem những mã được mô hình chấm `2: Khả quan` có thực sự tăng giá ở các ngày T+5 sau đó hay không!',
          en: 'After scraping 250+ trading days (~25,000+ rows), loading the full CSV into Pandas for every query gets slow. **DuckDB** is an embedded OLAP SQL engine (zero server setup) that queries CSV/Parquet files in milliseconds—letting you run **Backtesting** to measure whether stocks rated `2: Khả quan` actually outperformed over the next `T+5` trading days!',
        },
        ifMissing: {
          vi: 'Chỉ có F1-score trên nhãn quá khứ là chưa đủ để tin tưởng một hệ thống chứng khoán; nếu không kiểm chứng bằng lợi suất thực tế T+5 (Backtest), bạn không biết tín hiệu có giá trị đầu tư hay không.',
          en: 'High F1-score on static labels does not prove real market alpha; forward-return backtesting verifies practical utility.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'duckdb.sql("SELECT ... FROM \'data/processed/stock_metrics.csv\'")',
          params: 'SQL string',
          inputType: 'CSV / Parquet path',
          outputType: 'DuckDBRelation -> .df()',
          description: {
            vi: 'Đọc và lọc trực tiếp trên file CSV hoặc Parquet bằng chuẩn SQL (hỗ trợ Window Functions như `LEAD`, `LAG`, `AVG OVER`).',
            en: 'Executes vectorized SQL directly over CSV/Parquet files including Window Functions (`LEAD`, `LAG`).',
          },
        },
        {
          symbol: 'LEAD(Giá, 5) OVER (PARTITION BY Mã ORDER BY report_date)',
          params: '5 trading days ahead',
          inputType: 'Time-ordered stock rows',
          outputType: 'Future T+5 price',
          description: {
            vi: 'Lấy giá đóng cửa 5 phiên giao dịch sau của cùng mã cổ phiếu để tính tỷ suất sinh lời thực tế `(next_5d_price - price) / price`.',
            en: 'Fetches the price 5 trading days ahead per ticker to compute realized forward `T+5` returns.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Truy vấn SQL siêu tốc trực tiếp trên CSV với DuckDB', en: 'Stage 1: Zero-Setup SQL Directly on CSV' },
          summary: {
            vi: 'Không cần tạo bảng hay import phức tạp — DuckDB đọc thẳng đường dẫn file CSV.',
            en: 'Query `stock_metrics.csv` directly without importing into a database server.',
          },
          code: `import duckdb

top_roe = duckdb.sql("""
    SELECT Mã, report_date, Giá, "P/E", ROE
    FROM 'data/processed/stock_metrics.csv'
    WHERE ROE >= 20 AND "P/E" BETWEEN 5 AND 15
    ORDER BY report_date DESC, ROE DESC
    LIMIT 10
""").df()
print(top_roe)`,
          expectedNote: {
            vi: 'Lưu ý dấu ngoặc kép `"P/E"` trong SQL khi tên cột chứa ký tự đặc biệt `/`.',
            en: 'Wrap column names containing `/` such as `"P/E"` in double quotes.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Tính giá tương lai T+5 bằng SQL Window Function LEAD()', en: 'Stage 2: Forward T+5 Price via SQL LEAD()' },
          summary: {
            vi: 'Gom nhóm theo từng mã (`PARTITION BY Mã`) và sắp theo ngày giao dịch.',
            en: 'Partition by ticker (`PARTITION BY Mã`) ordered chronologically.',
          },
          code: `forward_df = duckdb.sql("""
    SELECT
        Mã,
        report_date,
        Giá AS entry_price,
        LEAD(Giá, 5) OVER (PARTITION BY Mã ORDER BY report_date) AS price_t5
    FROM 'data/processed/stock_metrics.csv'
""").df()
forward_df["ret_5d_pct"] = (forward_df["price_t5"] / forward_df["entry_price"] - 1.0) * 100`,
          expectedNote: {
            vi: 'SQL Window Function chạy chỉ trong vài mili-giây thay cho vòng lặp `groupby().shift(-5)` nặng nề.',
            en: 'Vectorized SQL `LEAD()` computes multi-day forward returns in milliseconds.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: So sánh lợi suất trung bình T+5 giữa 3 nhóm LightGBM', en: 'Stage 3: Backtest Return by LightGBM Rating' },
          summary: {
            vi: 'Chấm điểm toàn bộ bảng lịch sử rồi kiểm tra lợi suất kỳ vọng của nhóm `Khả quan` vs `Rủi ro`.',
            en: 'Compare mean forward `T+5` returns and win rates across the 3 predicted classes.',
          },
          code: `from src.ml_scorer import StockScorer

scorer = StockScorer("models/stock_scorer.pkl")
scored = scorer.score(forward_df.dropna(subset=["price_t5"]))
summary = scored.groupby("Đánh giá")["ret_5d_pct"].agg(["count", "mean", "median"])
print(summary)`,
          expectedNote: {
            vi: 'Đây là bước đánh giá thực chiến biến mô hình ML thành công cụ kiểm chứng chiến lược đầu tư.',
            en: 'Bridges classification metrics into real-world quantitative strategy validation.',
          },
        },
      ],
      builderTitle: {
        vi: 'Notebook mở rộng: Backtest DuckDB (05_backtest_duckdb.ipynb)',
        en: 'Extension Notebook: DuckDB Backtester (05_backtest_duckdb.ipynb)',
      },
      builderExplanation: {
        vi: 'Kết hợp `DuckDB` Window Function `LEAD(Giá, 5)` và `StockScorer` để kiểm chứng lợi suất thực tế T+5 của các nhóm tín hiệu.',
        en: 'Pairs `DuckDB` `LEAD(Giá, 5)` window queries with `StockScorer` to evaluate realized `T+5` returns.',
      },
      builderCode: `import duckdb
from src.ml_scorer import StockScorer

forward_df = duckdb.sql("""
    SELECT
        *,
        LEAD(Giá, 5) OVER (PARTITION BY Mã ORDER BY report_date) AS price_t5
    FROM 'data/processed/stock_metrics.csv'
""").df()

forward_df = forward_df.dropna(subset=["price_t5", "Giá"])
forward_df["ret_5d_pct"] = (forward_df["price_t5"] / forward_df["Giá"] - 1.0) * 100

scorer = StockScorer("models/stock_scorer.pkl")
scored = scorer.score(forward_df)
print(scored.groupby("Đánh giá")["ret_5d_pct"].agg(["count", "mean", "median"]))`,
      highlightLines: [4, 16],
      lineWalkthrough: [
        {
          lines: 'L4-L9',
          snippet: 'LEAD(Giá, 5) OVER (PARTITION BY Mã ORDER BY report_date) AS price_t5',
          explanation: {
            vi: 'Tính giá ở phiên thứ 5 sau ngày báo cáo cho đúng từng mã cổ phiếu độc lập.',
            en: 'Looks ahead 5 trading days strictly within each independent ticker partition.',
          },
        },
        {
          lines: 'L14-L16',
          snippet: 'scored = scorer.score(forward_df)\nprint(scored.groupby("Đánh giá")["ret_5d_pct"].agg(["count", "mean", "median"]))',
          explanation: {
            vi: 'Tổng hợp số lệnh, lợi suất trung bình và trung vị của từng nhóm đánh giá.',
            en: 'Aggregates sample size, mean return, and median return per rating tier.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện SQL Window Function lấy giá 5 phiên tương lai của từng mã cổ phiếu:',
          en: 'Complete the DuckDB SQL window function fetching the `T+5` price per ticker:',
        },
        codeTemplate: `___0___(Giá, 5) OVER (___1___ BY Mã ORDER BY report_date) AS price_t5`,
        answers: ['LEAD', 'PARTITION'],
        hints: [
          { vi: 'Hàm SQL lấy giá trị ở dòng phía sau (tương lai)', en: 'SQL window function looking forward N rows' },
          { vi: 'Từ khóa chia nhóm riêng theo từng mã cổ phiếu trong OVER()', en: 'SQL keyword grouping window frames by ticker' },
        ],
        explanation: {
          vi: '`LEAD(Giá, 5)` nhìn về 5 dòng phía trước, và `PARTITION BY Mã` đảm bảo không nhìn nhầm sang giá của cổ phiếu khác!',
          en: '`LEAD(Giá, 5)` looks 5 rows ahead while `PARTITION BY Mã` prevents bleeding across different tickers.',
        },
      },
      quiz: {
        question: {
          vi: 'Nếu quên `PARTITION BY Mã` trong `LEAD(Giá, 5) OVER (ORDER BY report_date)`, lỗi gì sẽ xảy ra?',
          en: 'What breaks if you omit `PARTITION BY Mã` inside `LEAD(Giá, 5) OVER (ORDER BY report_date)`?',
        },
        options: [
          {
            vi: 'Hàm `LEAD` sẽ lấy nhầm giá của một mã cổ phiếu khác ở dòng kế tiếp để tính lợi suất cho mã hiện tại.',
            en: '`LEAD` will grab the price of a completely different ticker from adjacent rows, corrupting returns.',
          },
          {
            vi: 'DuckDB không cho phép chạy câu lệnh.',
            en: 'DuckDB refuses to execute the query.',
          },
          {
            vi: 'Giá bị chuyển thành số âm.',
            en: 'Prices turn negative.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! `PARTITION BY Mã` là bắt buộc để tách chuỗi thời gian của từng cổ phiếu riêng rẽ.',
          en: 'Correct! `PARTITION BY Mã` isolates each stock’s time series.',
        },
      },
      simulation: {
        kind: 'dataframe',
        commandLabel: 'DuckDB Backtest Summary (T+5 Forward Returns across 50 reports)',
        statusColumn: 'Đánh giá',
        dataframeColumns: ['Đánh giá', 'Số mẫu (count)', 'Lợi suất TB T+5 (%)', 'Trung vị T+5 (%)'],
        dataframeRows: [
          { 'Đánh giá': 'Khả quan', 'Số mẫu (count)': 482, 'Lợi suất TB T+5 (%)': '+1.84%', 'Trung vị T+5 (%)': '+1.35%' },
          { 'Đánh giá': 'Trung tính / Theo dõi', 'Số mẫu (count)': 1014, 'Lợi suất TB T+5 (%)': '+0.41%', 'Trung vị T+5 (%)': '+0.20%' },
          { 'Đánh giá': 'Rủi ro / Tiêu cực', 'Số mẫu (count)': 286, 'Lợi suất TB T+5 (%)': '-1.12%', 'Trung vị T+5 (%)': '-0.85%' },
        ],
      },
      checkpointItems: [
        {
          vi: 'Biết dùng `DuckDB` chạy SQL trực tiếp trên file CSV mà không cần dựng server DB.',
          en: 'Run analytical SQL queries directly on CSV/Parquet files with `DuckDB`.',
        },
        {
          vi: 'Biết viết quy trình Backtest T+5 bằng Window Function `LEAD()` + `PARTITION BY`.',
          en: 'Build a `T+5` forward-return backtest using `LEAD()` + `PARTITION BY`.',
        },
      ],
      studyApis: ['duckdb.sql', 'SQL LEAD() OVER (PARTITION BY)', 'T+5 Backtesting'],
      completeFiles: [
        {
          path: 'notebooks/05_backtest_duckdb.ipynb',
          language: 'python',
          code: `import duckdb\nfrom src.ml_scorer import StockScorer\n\nforward_df = duckdb.sql("""\n    SELECT\n        *,\n        LEAD(Giá, 5) OVER (PARTITION BY Mã ORDER BY report_date) AS price_t5\n    FROM 'data/processed/stock_metrics.csv'\n""").df()\n\nforward_df = forward_df.dropna(subset=["price_t5", "Giá"])\nforward_df["ret_5d_pct"] = (forward_df["price_t5"] / forward_df["Giá"] - 1.0) * 100\n\nscorer = StockScorer("models/stock_scorer.pkl")\nscored = scorer.score(forward_df)\nprint(scored.groupby("Đánh giá")["ret_5d_pct"].agg(["count", "mean", "median"]))\n`,
          notebookCells: [
            { type: 'markdown', content: '# 05 - Historical Analytics & T+5 Signal Backtesting with DuckDB' },
            {
              type: 'code',
              content: `import duckdb\nfrom src.ml_scorer import StockScorer\n\nforward_df = duckdb.sql("""\n    SELECT\n        *,\n        LEAD(Giá, 5) OVER (PARTITION BY Mã ORDER BY report_date) AS price_t5\n    FROM 'data/processed/stock_metrics.csv'\n""").df()\n\nforward_df = forward_df.dropna(subset=["price_t5", "Giá"])\nforward_df["ret_5d_pct"] = (forward_df["price_t5"] / forward_df["Giá"] - 1.0) * 100\n\nscorer = StockScorer("models/stock_scorer.pkl")\nscored = scorer.score(forward_df)\nprint(scored.groupby("Đánh giá")["ret_5d_pct"].agg(["count", "mean", "median"]))`,
            },
          ],
        },
      ],
    },
  ],
};
