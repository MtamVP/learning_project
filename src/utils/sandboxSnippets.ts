const SANDBOX_BY_STEP: Record<string, string> = {
  '1.1': `from pathlib import Path

base_dir = Path("/masvn-intelligence")
output_dir = base_dir / "data" / "raw_pdfs"
output_dir.mkdir(parents=True, exist_ok=True)
print("Output dir:", output_dir)
print("Exists:", output_dir.exists())`,

  '1.2': `url = "https://www.masvn.com/cate/bao-cao-thuong-nhat-22"
config = {
    "headless": True,
    "wait_until": "domcontentloaded",
    "timeout_ms": 60000,
    "settle_ms": 3000,
}
print("Playwright goto config ->", config)
print("Target:", url)`,

  '1.3': `page_1 = ["https://masvn.com/a.pdf", "https://masvn.com/b.pdf"]
page_2 = ["https://masvn.com/a.pdf", "https://masvn.com/b.pdf", "https://masvn.com/c.pdf"]

report_dict = {}
for link in page_1 + page_2:
    if link in report_dict:
        continue
    report_dict[link] = "20261113"

print("Total unique links:", len(report_dict))
print(list(report_dict.keys()))`,

  '1.4': `import re
from datetime import datetime

urls = [
    "https://www.masvn.com/files/MiraeAsset_Daily_VN_20261113.pdf",
    "https://www.masvn.com/files/1731456000000-DailyReport_Mobile_VN.pdf",
    "https://www.masvn.com/about-us",
]

for link in urls:
    m1 = re.search(r"MiraeAsset_Daily_VN_(\\d{8})\\.pdf", link, re.IGNORECASE)
    if m1:
        print("Format 1:", m1.group(1))
        continue
    m2 = re.search(r"/(\\d{13})-DailyReport_Mobile_VN\\.pdf", link, re.IGNORECASE)
    if m2:
        ts = int(m2.group(1)) / 1000
        print("Format 2:", datetime.fromtimestamp(ts).strftime("%Y%m%d"))`,

  '1.5': `report_dict = {
    "https://masvn.com/old.pdf": "20260902",
    "https://masvn.com/mid.pdf": "20261015",
    "https://masvn.com/new.pdf": "20261113",
}
report_links = [(d, url) for url, d in report_dict.items()]
report_links.sort(key=lambda x: x[0], reverse=True)
for item in report_links[:2]:
    print(item)`,

  '1.6': `from pathlib import Path

def mock_download(url: str, out_path: Path, content_type: str):
    if out_path.exists():
        return f"Skipped (exists): {out_path.name}"
    if "application/pdf" not in content_type:
        return f"Rejected MIME: {content_type}"
    out_path.write_bytes(b"%PDF-1.4 mock")
    return f"Saved: {out_path.name}"

p = Path("/tmp/report_20261113.pdf")
print(mock_download("https://masvn.com/a.pdf", p, "text/html"))
print(mock_download("https://masvn.com/a.pdf", p, "application/pdf"))
print(mock_download("https://masvn.com/a.pdf", p, "application/pdf"))`,

  '1.7': `reports = [("20261113", "https://masvn.com/1.pdf"), ("20261112", "https://masvn.com/2.pdf")]
for idx, (date_str, url) in enumerate(reports, start=1):
    filename = f"report_{date_str}.pdf"
    print(f"[{idx}/{len(reports)}] {filename} <- {url}")`,

  '1.8': `def build_cron(hour: int = 17, minute: int = 30) -> str:
    return f"{minute} {hour} * * 1-5 python scripts/scrape_masvn.py --days 30"

print("Daily schedule:", build_cron())`,

  '2.1': `pdfs = [f"report_202610{d:02d}.pdf" for d in range(1, 21)]
train_pdfs = pdfs[:16]
test_pdfs = pdfs[16:20]
overlap = set(train_pdfs) & set(test_pdfs)
print("Train:", len(train_pdfs), "Test:", len(test_pdfs), "Overlap:", len(overlap))`,

  '2.2': `def to_yolo_txt(cls_id, x0, y0, x1, y1, img_w, img_h):
    xc = ((x0 + x1) / 2.0) / img_w
    yc = ((y0 + y1) / 2.0) / img_h
    w = (x1 - x0) / img_w
    h = (y1 - y0) / img_h
    return f"{cls_id} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}"

print(to_yolo_txt(0, 62, 520, 1180, 1480, 1240, 1754))`,

  '2.3': `vram_budget = {"YOLOv11n": 0.30, "Qwen2.5:7b (Q4_K_M)": 4.90}
total = sum(vram_budget.values())
print(f"Peak VRAM: {total:.2f} GB / 8.00 GB (Headroom: {8.0 - total:.2f} GB)")`,

  '2.4': `detections = [
    {"label": "Text", "bbox": [60.0, 1645.0, 840.0, 1702.0], "conf": 0.89},
    {"label": "Table", "bbox": [58.0, 148.0, 1184.0, 1620.0], "conf": 0.97},
    {"label": "Text", "bbox": [64.0, 48.0, 1172.0, 132.0], "conf": 0.95},
]
detections.sort(key=lambda d: d["bbox"][1])
for d in detections:
    print(d["label"], "y0=", d["bbox"][1], "conf=", d["conf"])`,

  '2.5': `def compute_iou(a, b):
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (area_a + area_b - inter + 1e-9)

iou = compute_iou([50, 100, 500, 400], [60, 110, 490, 390])
print("IoU:", round(iou, 4), "| Suppress duplicate?", iou > 0.45)`,

  '3.1': `bbox = (58.0, 148.0, 1184.0, 1620.0)
words = [
    (70, 160, 110, 175, "FPT"),
    (200, 160, 260, 175, "138.5"),
    (120, 40, 220, 60, "HEADER_OUTSIDE"),
]
bx0, by0, bx1, by1 = bbox
inside = [w[4] for w in words if bx0 <= (w[0]+w[2])/2 <= bx1 and by0 <= (w[1]+w[3])/2 <= by1]
print("Words inside Table bbox:", inside)`,

  '3.2': `bx0, by0 = 100, 300
local_box = (12, 18, 84, 34)
global_box = (local_box[0] + bx0, local_box[1] + by0, local_box[2] + bx0, local_box[3] + by0)
print("Local:", local_box, "-> Global page:", global_box)`,

  '3.3': `import math, re

def clean_numeric_value(raw_val):
    if raw_val is None:
        return math.nan
    text = str(raw_val).strip()
    if not text or text.upper() in {"#N/A", "N/A", "-", "--"}:
        return math.nan
    text = re.sub(r"\\s+", "", text.replace(",", "").replace("%", ""))
    if text.startswith("(") and text.endswith(")"):
        text = "-" + text[1:-1]
    m = re.search(r"-?\\d+(?:\\.\\d+)?", text)
    return float(m.group(0)) if m else math.nan

for s in ["25,723", "+1.5%", "- 2.34", "#N/A", "(4.10)"]:
    print(f"{s:>8} -> {clean_numeric_value(s)}")`,

  '3.4': `grid = [
    ["Chỉ số", "Điểm/Giá", "1D%", "YTD%"],
    ["VN-Index", "1,268.4", "+0.5%", "+12.1%"],
    ["USD/VND", "25,723", "+0.2%", "+1.5%"],
]
headers = grid[0]
for row in grid[1:]:
    pairs = ", ".join(f"{headers[i]}: {row[i]}" for i in range(1, len(headers)))
    print(f"[Ngày 20261113 - Trang 1] {row[0]} ghi nhận {pairs}.")`,

  '3.5': `import json
docs = [
    {"date": "20261113", "page": 1, "text": "VN-Index tăng 0.5%"},
    {"date": "20261113", "page": 2, "text": "Trang 2"},
]
clean_docs = [d for d in docs if len(d["text"]) > 10]
print(json.dumps(clean_docs, ensure_ascii=False, indent=2))`,

  '3.6': `last_headers = ["Mã", "Giá", "P/E", "P/B", "ROE"]
page5_grid = [
    ["DCL", "28.9", "#N/A", "1.9", "9.4"],
    ["FPT", "138.5", "21.4", "4.8", "26.2"],
]
if "MÃ" not in " ".join(page5_grid[0]).upper() and len(page5_grid[0]) == len(last_headers):
    merged = [last_headers] + page5_grid
    print("Merged rows:", len(merged), "Header:", merged[0])`,

  '4.1': `def assign_rating_label(roe, pe, pb, chg_1d):
    if roe is not None and roe >= 18 and pe is not None and 0 < pe <= 16 and pb is not None and pb <= 3.0:
        return 2  # Khả quan
    if (pe is not None and (pe < 0 or pe > 35)) or (roe is not None and roe < 6) or chg_1d < -3.5:
        return 0  # Rủi ro
    return 1      # Trung tính

print("MBB:", assign_rating_label(22.8, 6.1, 1.2, 0.8))
print("NVL:", assign_rating_label(-4.1, -12.4, 0.5, -2.0))`,

  '4.2': `import statistics

x_train_pe = [6.1, 14.2, 15.8, 21.4, 300.0]
median_pe = statistics.median(x_train_pe)
mean_pe = statistics.mean(x_train_pe)
print(f"Median (robust): {median_pe} vs Mean (skewed by 300.0): {mean_pe:.2f}")`,

  '4.3': `support = {0: 68, 1: 244, 2: 116}
total = sum(support.values())
n_classes = len(support)
weights = {k: round(total / (n_classes * v), 3) for k, v in support.items()}
print("Balanced class weights:", weights)`,

  '4.4': `LABEL_MAP = {0: "Rủi ro / Tiêu cực", 1: "Trung tính / Theo dõi", 2: "Khả quan"}
probs = [0.02, 0.04, 0.94]
pred = probs.index(max(probs))
print(f"Prediction: {LABEL_MAP[pred]} ({max(probs)*100:.1f}%)")`,

  '4.5': `dates = ["20260902", "20260915", "20261001", "20261020", "20261113"]
for split in range(2, len(dates)):
    print("Train up to:", dates[:split], "-> Test on:", dates[split])`,

  '5.1': `import re
TICKER_RE = re.compile(r"\\b[A-Z]{3}\\b")
blacklist = {"VND", "USD", "YTD", "ROE", "PDF", "MAS", "HOSE"}
text = "Khối ngoại mua ròng FPT và MBB trên sàn HOSE, tỷ giá USD ổn định."
tickers = sorted({t for t in TICKER_RE.findall(text) if t not in blacklist})
print("Extracted tickers:", tickers)`,

  '5.2': `import math
def l2_norm(v):
    norm = math.sqrt(sum(x*x for x in v))
    return [x / norm for x in v]

a = l2_norm([3.0, 4.0])
b = l2_norm([4.0, 3.0])
cosine = sum(x * y for x, y in zip(a, b))
print("L2 norm:", round(math.sqrt(sum(x*x for x in a)), 4), "| Cosine(IP):", round(cosine, 4))`,

  '5.3': `dense = [0.88, 0.84, 0.45]
bm25 = [0.94, 0.62, 0.15]
alpha = 0.5
d_norm = [x / (max(dense) + 1e-9) for x in dense]
b_norm = [x / (max(bm25) + 1e-9) for x in bm25]
fused = [round(alpha * d + (1 - alpha) * b, 4) for d, b in zip(d_norm, b_norm)]
print("Hybrid scores:", fused)`,

  '5.4': `contexts = [
    {"date": "20261113", "page": 2, "text": "FPT tăng trưởng doanh thu 10T +19.5% YoY."}
]
ctx_str = "\\n".join(f"[Ngày {c['date']} - Trang {c['page']}] {c['text']}" for c in contexts)
print("Injected prompt context:\\n" + ctx_str)`,

  '5.5': `def rrf_fusion(dense_ids, bm25_ids, k=60):
    scores = {}
    for rank, doc_id in enumerate(dense_ids, start=1):
        scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    for rank, doc_id in enumerate(bm25_ids, start=1):
        scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)

print("RRF ranking:", rrf_fusion([10, 4, 2], [4, 7, 10]))`,

  '6.1': `def style_rating_cell(val: str) -> str:
    if val == "Khả quan":
        return "background-color: #163826; color: #5eead4;"
    if val == "Rủi ro / Tiêu cực":
        return "background-color: #421c1e; color: #fca5a5;"
    return "background-color: #3d3117; color: #fcd34d;"

for label in ["Khả quan", "Trung tính / Theo dõi", "Rủi ro / Tiêu cực"]:
    print(label, "->", style_rating_cell(label))`,

  '6.2': `session_state = {}
if "latest_scored_df" not in session_state:
    session_state["latest_scored_df"] = [{"Mã": "MBB", "Đánh giá": "Khả quan"}]
print("Session Tab 1 -> Tab 2:", session_state["latest_scored_df"])`,

  '6.3': `ram_24gb = {"PaddleOCR": 1.1, "bge-m3": 1.4, "Python+Pandas": 0.4}
vram_8gb = {"YOLOv11n": 0.3, "Qwen2.5:7b": 4.9}
print("RAM used:", sum(ram_24gb.values()), "/ 24.0 GB")
print("VRAM used:", sum(vram_8gb.values()), "/ 8.0 GB")`,

  '6.4': `def clean_test_sample(s):
    return float(s.replace(",", "").replace("%", ""))

assert clean_test_sample("25,723") == 25723.0
assert clean_test_sample("+1.5%") == 1.5
print("All assertions passed!")`,

  '7.1': `routes = ["image", "document", "xhr", "font", "script"]
for r in routes:
    action = "ABORT" if r in {"image", "media", "font"} else "CONTINUE"
    print(f"{r:<10} -> {action}")`,

  '7.2': `payload = {"Mã": "MBB", "Giá": 25.4, "P/E": 6.1, "ROE": 22.8}
assert payload["Giá"] > 0
print("Validated StockInput JSON:", payload)`,

  '7.3': `params_b = 7.0
print("FP16 size (GB):", round(params_b * 2.0, 2))
print("Q4_K_M size (GB):", round(params_b * 0.68, 2))`,

  '7.4': `prices = [24.0, 24.5, 25.1, 25.0, 25.6, 26.4]
t0 = prices[0]
t5 = prices[5]
ret_5d = (t5 / t0 - 1.0) * 100
print(f"Entry={t0}, T+5={t5} -> Return = {ret_5d:+.2f}%")`,
};

export function getSandboxCode(stepId: string): string {
  return (
    SANDBOX_BY_STEP[stepId] ||
    `print("MASVN Market Intelligence - Step ${stepId}")`
  );
}
