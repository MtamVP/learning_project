import { ModuleSpec } from '../types';

export const RAG_ENGINE_PY_COMPLETE = `import json
import pickle
import re
from pathlib import Path
import faiss
import numpy as np
import requests
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer


class HybridRAGEngine:
    """Truy xuất lai (BM25 + FAISS trên CPU) + Local LLM Ollama (Qwen2.5:7b)."""

    TICKER_PATTERN = re.compile(r"\\b[A-Z]{3}\\b")

    def __init__(
        self,
        knowledge_path: str = "data/processed/market_knowledge.json",
        vector_dir: str = "data/vector_store",
        embed_model_name: str = "BAAI/bge-m3",
        ollama_model: str = "qwen2.5:7b",
        ollama_url: str = "http://localhost:11434/api/generate",
    ):
        self.knowledge_path = Path(knowledge_path)
        self.vector_dir = Path(vector_dir)
        self.vector_dir.mkdir(parents=True, exist_ok=True)
        self.ollama_model = ollama_model
        self.ollama_url = ollama_url

        # Ép Embedding Model chạy trên CPU (24GB RAM) để nhường trọn 8GB VRAM cho Qwen2.5:7b
        self.embedder = SentenceTransformer(embed_model_name, device="cpu")
        self.chunks = []
        self.faiss_index = None
        self.bm25 = None

    @classmethod
    def extract_tickers(cls, text: str) -> list[str]:
        blacklist = {"VND", "USD", "YTD", "ROE", "PDF", "MAS", "HOSE", "HNX"}
        found = cls.TICKER_PATTERN.findall(text)
        return sorted({t for t in found if t not in blacklist})

    @staticmethod
    def tokenize_for_bm25(text: str) -> list[str]:
        return re.findall(r"\\w+", text.lower())

    def prepare_chunks(self, raw_docs: list[dict], max_chars: int = 800) -> list[dict]:
        """Chunking theo cấu trúc bản tin + gắn Metadata (date, page, tickers, category)."""
        prepared = []
        for doc in raw_docs:
            text = doc["text"].strip()
            if not text:
                continue
            parts = [text[i : i + max_chars] for i in range(0, len(text), max_chars)]
            for idx, part in enumerate(parts):
                prepared.append({
                    "text": part,
                    "metadata": {
                        "date": doc.get("date", "unknown"),
                        "page": doc.get("page", 1),
                        "tickers": self.extract_tickers(part),
                        "category": doc.get("category", "macro_and_news"),
                        "part": idx,
                    },
                })
        return prepared

    def build_and_save_indices(self):
        raw_docs = json.loads(self.knowledge_path.read_text(encoding="utf-8"))
        self.chunks = self.prepare_chunks(raw_docs)
        texts = [c["text"] for c in self.chunks]

        # 1. Dense Embeddings (L2 normalized -> Inner Product tương đương Cosine Similarity)
        embeddings = self.embedder.encode(
            texts,
            batch_size=32,
            normalize_embeddings=True,
            show_progress_bar=False,
        ).astype("float32")

        dim = embeddings.shape[1]
        self.faiss_index = faiss.IndexFlatIP(dim)
        self.faiss_index.add(embeddings)

        # 2. Sparse BM25 Index cho từ khóa chính xác (mã cổ phiếu 3 chữ cái, số liệu)
        tokenized_corpus = [self.tokenize_for_bm25(t) for t in texts]
        self.bm25 = BM25Okapi(tokenized_corpus)

        # 3. Lưu cứng xuống ổ đĩa
        faiss.write_index(self.faiss_index, str(self.vector_dir / "faiss.index"))
        with open(self.vector_dir / "bm25.pkl", "wb") as f:
            pickle.dump({"bm25": self.bm25, "chunks": self.chunks}, f)

    def load_indices(self):
        self.faiss_index = faiss.read_index(str(self.vector_dir / "faiss.index"))
        with open(self.vector_dir / "bm25.pkl", "rb") as f:
            payload = pickle.load(f)
        self.bm25 = payload["bm25"]
        self.chunks = payload["chunks"]

    def hybrid_search(self, query: str, top_k: int = 4, alpha: float = 0.5) -> list[dict]:
        """Trộn điểm Dense FAISS + Sparse BM25 (Weighted Min-Max Fusion)."""
        if self.faiss_index is None or self.bm25 is None:
            self.load_indices()

        n_docs = len(self.chunks)
        if n_docs == 0:
            return []

        q_emb = self.embedder.encode(
            [query], normalize_embeddings=True, show_progress_bar=False
        ).astype("float32")
        dense_scores_raw, dense_ids = self.faiss_index.search(q_emb, n_docs)

        dense_scores = np.zeros(n_docs, dtype="float32")
        for idx, score in zip(dense_ids[0], dense_scores_raw[0]):
            if idx >= 0:
                dense_scores[idx] = max(0.0, float(score))

        bm25_scores = np.array(
            self.bm25.get_scores(self.tokenize_for_bm25(query)), dtype="float32"
        )

        # Chuẩn hóa Min-Max về đoạn [0, 1] trước khi trộn theo trọng số alpha
        d_norm = dense_scores / (dense_scores.max() + 1e-9)
        b_norm = bm25_scores / (bm25_scores.max() + 1e-9)
        hybrid_scores = alpha * d_norm + (1.0 - alpha) * b_norm

        top_indices = np.argsort(hybrid_scores)[::-1][:top_k]
        results = []
        for idx in top_indices:
            chunk = self.chunks[int(idx)]
            results.append({
                "text": chunk["text"],
                "metadata": chunk["metadata"],
                "score": round(float(hybrid_scores[int(idx)]), 4),
            })
        return results

    def ask(self, query: str, ml_summary: str = "", extra_chunks: list[dict] | None = None) -> dict:
        contexts = self.hybrid_search(query, top_k=4, alpha=0.5)
        if extra_chunks:
            contexts = (extra_chunks[:2] + contexts)[:4]

        context_block = "\\n\\n".join(
            f"[Ngày {c['metadata'].get('date')} - Trang {c['metadata'].get('page')}] {c['text']}"
            for c in contexts
        )

        system_prompt = (
            "Bạn là trợ lý phân tích chứng khoán MASVN. CHỈ được trả lời dựa trên "
            "4 đoạn ngữ cảnh từ bản tin và bảng điểm ML được cung cấp dưới đây. "
            "Bắt buộc trích dẫn rõ nguồn theo định dạng [Ngày YYYYMMDD - Trang X]. "
            "Nếu thông tin không có trong tài liệu, hãy trả lời thẳng là không tìm thấy "
            "trong bản tin và tuyệt đối không tự bịa số liệu."
        )

        prompt = (
            f"{system_prompt}\\n\\n"
            f"=== TÓM TẮT ĐIỂM ML TỪ BẢNG ===\\n{ml_summary or 'Chưa có bảng ML'}\\n\\n"
            f"=== NGỮ CẢNH BẢN TIN ===\\n{context_block}\\n\\n"
            f"=== CÂU HỎI ===\\n{query}\\n\\nTrả lời ngắn gọn, chính xác:"
        )

        response = requests.post(
            self.ollama_url,
            json={"model": self.ollama_model, "prompt": prompt, "stream": False},
            timeout=120,
        )
        response.raise_for_status()
        answer = response.json().get("response", "").strip()
        return {"answer": answer, "sources": contexts}`;

export const module5: ModuleSpec = {
  id: 'mod-5',
  number: 5,
  title: {
    vi: 'Học phần 5: Truy xuất Lai & Local LLM (Hybrid RAG + Ollama)',
    en: 'Module 5: Hybrid Retrieval & Local LLM (FAISS + BM25 + Ollama)',
  },
  summary: {
    vi: 'Chunking gắn metadata chuẩn, xây dựng chỉ mục FAISS trên CPU + BM25Okapi cho mã cổ phiếu 3 chữ cái, trộn điểm Hybrid Search và gọi Qwen2.5:7b chống bịa đặt.',
    en: 'Implement metadata-rich chunking, CPU FAISS + BM25Okapi indices for exact 3-letter tickers, hybrid fusion, and grounded Qwen2.5:7b prompting.',
  },
  stack: ['Ollama (qwen2.5:7b)', 'sentence-transformers', 'faiss-cpu', 'rank_bm25', 'requests'],
  steps: [
    {
      id: '5.1',
      moduleId: 'mod-5',
      tier: 1,
      title: {
        vi: 'Bước 5.1: Chunking theo cấu trúc bản tin & Gắn Metadata',
        en: 'Step 5.1: Structure-Aware Chunking & Metadata Tagging',
      },
      subtitle: {
        vi: 'Đọc `market_knowledge.json`, chia đoạn hợp lý và gắn `date`, `page`, `tickers`, `category`.',
        en: 'Load `market_knowledge.json`, split long blocks cleanly, and attach `date`, `page`, `tickers`, and `category` metadata.',
      },
      targetFile: 'src/rag_engine.py',
      whyAndWhat: {
        why: {
          vi: 'Khác với cách cắt bừa bãi mỗi 500 ký tự dễ chặt đứt giữa câu số liệu, bản tin MASVN đã được YOLO tách thành từng khối `Text` và từng dòng `macro_table` trong `market_knowledge.json`. Ta chỉ cắt tiếp những khối quá dài (>800 ký tự) và dùng Regex `\\b[A-Z]{3}\\b` tự động rút trích danh sách mã cổ phiếu (`["FPT", "MBB"]`) gắn vào `metadata` để hỗ trợ trích dẫn `[Ngày YYYYMMDD - Trang X]`.',
          en: 'Instead of blindly slicing raw PDF text every 500 characters mid-sentence, YOLO already segmented coherent `Text` blocks and serialized `macro_table` lines in `market_knowledge.json`. We only subdivide blocks exceeding 800 chars and auto-tag 3-letter stock tickers (`["FPT", "MBB"]`) + `date`/`page` metadata for exact citations.',
        },
        ifMissing: {
          vi: 'Nếu thiếu metadata `date` và `page`, Chatbot ở Học phần 6 không thể trích dẫn nguồn `[Ngày 20261113 - Trang 2]`, làm người dùng không kiểm chứng được độ tin cậy của AI.',
          en: 'Without `date` and `page` metadata, the chatbot cannot output verifiable `[Date - Page]` citations.',
        },
      },
      apiAnatomy: [
        {
          symbol: 're.compile(r"\\b[A-Z]{3}\\b")',
          params: 'Word boundary + 3 uppercase letters',
          inputType: 'str',
          outputType: 'list[str]',
          description: {
            vi: 'Tìm mã cổ phiếu Việt Nam chuẩn 3 chữ cái in hoa (FPT, MBB, DCL...) đồng thời loại bỏ từ viết tắt nhiễu (`VND`, `USD`, `ROE`).',
            en: 'Extracts 3-letter uppercase Vietnamese tickers while filtering common abbreviations (`VND`, `USD`, `ROE`).',
          },
        },
        {
          symbol: 'prepare_chunks(raw_docs, max_chars=800)',
          params: 'raw_docs, max_chars',
          inputType: 'list[dict]',
          outputType: 'list[dict(text, metadata)]',
          description: {
            vi: 'Chuẩn hóa mọi mục thành `{ "text": ..., "metadata": {"date", "page", "tickers", "category"} }`.',
            en: 'Normalizes every chunk into `{ "text": ..., "metadata": {"date", "page", "tickers", "category"} }`.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Tự động bắt mã cổ phiếu trong đoạn tin', en: 'Stage 1: Regex Ticker Extraction' },
          summary: {
            vi: 'Lọc các từ 3 chữ cái in hoa không nằm trong danh sách loại trừ.',
            en: 'Match 3-letter uppercase tickers excluding financial acronyms.',
          },
          code: `import re

TICKER_RE = re.compile(r"\\b[A-Z]{3}\\b")
blacklist = {"VND", "USD", "YTD", "ROE", "PDF", "MAS", "HOSE", "HNX"}
sample = "MBB và FPT dẫn dắt dòng tiền HOSE trong khi USD tăng nhẹ."
tickers = sorted({t for t in TICKER_RE.findall(sample) if t not in blacklist})
print("Tickers:", tickers)  # ['FPT', 'MBB']`,
          expectedNote: {
            vi: 'Loại bỏ `HOSE`, `USD` để giữ đúng mã cổ phiếu `FPT`, `MBB`.',
            en: 'Filters `HOSE` and `USD`, keeping exact tickers `FPT` and `MBB`.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Đóng gói cấu trúc Chunk + Metadata chuẩn', en: 'Stage 2: Chunk + Metadata Schema' },
          summary: {
            vi: 'Mỗi đoạn văn mang đủ thẻ căn cước về ngày báo cáo và số trang.',
            en: 'Attach provenance tags (`date`, `page`, `tickers`, `category`) to every chunk.',
          },
          code: `chunk = {
    "text": part,
    "metadata": {
        "date": doc.get("date", "unknown"),
        "page": doc.get("page", 1),
        "tickers": extract_tickers(part),
        "category": doc.get("category", "macro_and_news"),
    },
}`,
          expectedNote: {
            vi: 'Khớp hoàn toàn với định dạng yêu cầu của prompt hệ thống ở Bước 5.4.',
            en: 'Matches the exact metadata contract required by the grounded prompt in Step 5.4.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Khung đầu của class HybridRAGEngine', en: 'Stage 3: HybridRAGEngine Class Header' },
          summary: {
            vi: 'Khởi tạo `SentenceTransformer` trên `device="cpu"` ngay trong `__init__`.',
            en: 'Initialize `SentenceTransformer` on `device="cpu"` inside `__init__`.',
          },
          code: RAG_ENGINE_PY_COMPLETE.split('    def build_and_save_indices')[0],
          expectedNote: {
            vi: 'Giữ sạch 8GB VRAM cho bước gọi Qwen2.5:7b.',
            en: 'Keeps the 8GB VRAM budget untouched for Qwen2.5:7b.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 1/4: Chunking & Metadata trong src/rag_engine.py',
        en: 'Piece 1/4: Chunking & Metadata in src/rag_engine.py',
      },
      builderExplanation: {
        vi: 'Thiết lập lớp `HybridRAGEngine` với Embedding chạy CPU, hàm tách mã cổ phiếu `extract_tickers` và hàm `prepare_chunks`.',
        en: 'Starts `HybridRAGEngine` with CPU embeddings, `extract_tickers`, and `prepare_chunks`.',
      },
      builderCode: RAG_ENGINE_PY_COMPLETE.split('    def build_and_save_indices')[0],
      highlightLines: [29, 64],
      lineWalkthrough: [
        {
          lines: 'L31-L32',
          snippet: 'self.embedder = SentenceTransformer(embed_model_name, device="cpu")',
          explanation: {
            vi: 'Bắt buộc đặt `device="cpu"` để model embedding (~1.2–2GB nếu dùng bge-m3) nằm trên 24GB RAM hệ thống.',
            en: 'Explicitly sets `device="cpu"` so embedding weights stay in 24GB system RAM.',
          },
        },
        {
          lines: 'L46-L64',
          snippet: 'def prepare_chunks(self, raw_docs: list[dict], max_chars: int = 800) -> list[dict]:',
          explanation: {
            vi: 'Gắn đầy đủ `date`, `page`, `tickers`, `category` vào mỗi đoạn để dùng cho trích dẫn.',
            en: 'Tags every chunk with `date`, `page`, `tickers`, and `category` for citations.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện việc ép Embedding chạy trên CPU và dùng Regex bắt mã cổ phiếu 3 chữ cái in hoa:',
          en: 'Complete forcing CPU execution for embeddings and matching 3-letter uppercase tickers:',
        },
        codeTemplate: `self.embedder = SentenceTransformer(embed_model_name, device="___0___")
TICKER_PATTERN = re.compile(r"\\b[A-Z]{___1___}\\b")`,
        answers: ['cpu', '3'],
        hints: [
          { vi: 'Thiết bị xử lý dùng 24GB System RAM thay vì VRAM GPU', en: 'Compute device using system RAM instead of GPU VRAM' },
          { vi: 'Độ dài ký tự chuẩn của mã chứng khoán Việt Nam (FPT, MBB...)', en: 'Character length of Vietnamese stock tickers' },
        ],
        explanation: {
          vi: '`device="cpu"` bảo vệ VRAM RTX 5060 cho Ollama; `\\b[A-Z]{3}\\b` bắt đúng mã 3 ký tự như FPT, MBB, DCL.',
          en: '`device="cpu"` preserves RTX 5060 VRAM for Ollama, and `\\b[A-Z]{3}\\b` captures 3-letter tickers.',
        },
      },
      quiz: {
        question: {
          vi: 'Vì sao ta đặt `SentenceTransformer(..., device="cpu")` thay vì để mặc định chạy GPU?',
          en: 'Why configure `SentenceTransformer(..., device="cpu")` instead of running it on the GPU?',
        },
        options: [
          {
            vi: 'Vì mô hình `qwen2.5:7b` Q4_K_M đã chiếm ~5GB trong tổng 8GB VRAM RTX 5060; đẩy Embedding sang 24GB RAM CPU giúp không bị tràn VRAM.',
            en: '`qwen2.5:7b` takes ~5GB of our 8GB RTX 5060 VRAM; offloading embeddings to 24GB CPU RAM prevents CUDA OOM.',
          },
          {
            vi: 'Vì `SentenceTransformer` không chạy được trên GPU NVIDIA.',
            en: 'Because `SentenceTransformer` does not support NVIDIA GPUs.',
          },
          {
            vi: 'Vì FAISS CPU chỉ đọc được vector tạo từ CPU.',
            en: 'Because FAISS requires CPU-generated vectors.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Mã hóa 1 câu truy vấn người dùng trên CPU chỉ mất ~25ms — quá nhanh và cực kỳ an toàn cho ngân sách 8GB VRAM.',
          en: 'Correct! Encoding a single user query on CPU takes ~25ms and saves ~1.5GB of precious VRAM.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'prepare_chunks(market_knowledge.json)',
        terminalLines: [
          'Loaded 712 raw documents from data/processed/market_knowledge.json',
          'Chunked into 748 chunks (max_chars=800)',
          'Sample chunk[12]:',
          '  metadata: {"date": "20261113", "page": 2, "tickers": ["FPT", "MBB"], "category": "narrative_text"}',
          '  text: "Dòng tiền ngoại quay lại mua ròng mạnh FPT (+142 tỷ) và MBB (+89 tỷ)..."',
        ],
      },
      checkpointItems: [
        {
          vi: 'Biết cách cấu trúc Metadata gồm `date`, `page`, `tickers`, `category`.',
          en: 'Know the chunk metadata schema (`date`, `page`, `tickers`, `category`).',
        },
        {
          vi: 'Hiểu lý do ép Embedding chạy trên CPU khi máy chỉ có 8GB VRAM.',
          en: 'Understand CPU offloading of embeddings under an 8GB VRAM budget.',
        },
      ],
      studyApis: ['SentenceTransformer(device="cpu")', 'prepare_chunks', 'Metadata tagging'],
    },
    {
      id: '5.2',
      moduleId: 'mod-5',
      tier: 2,
      title: {
        vi: 'Bước 5.2: Tìm kiếm Ngữ nghĩa (Dense Retrieval) với FAISS CPU',
        en: 'Step 5.2: Dense Semantic Retrieval with FAISS CPU',
      },
      subtitle: {
        vi: 'Chuẩn hóa vector L2 (`normalize_embeddings=True`), dùng `faiss.IndexFlatIP(dim)` và lưu cứng xuống `faiss.index`.',
        en: 'L2-normalize embeddings (`normalize_embeddings=True`), index with `faiss.IndexFlatIP(dim)`, and persist to `faiss.index`.',
      },
      targetFile: 'src/rag_engine.py',
      whyAndWhat: {
        why: {
          vi: 'Khi người dùng hỏi *"Triển vọng ngành công nghệ và chuyển đổi số thế nào?"*, từ khóa cụ thể có thể không khớp 100%, nhưng **Vector Embedding** hiểu được sự tương đồng ngữ nghĩa giữa *"công nghệ"* và *"FPT / phần mềm / xuất khẩu IT"*. Dùng `normalize_embeddings=True` đưa mọi vector về độ dài = 1, nhờ đó phép nhân tích vô hướng `faiss.IndexFlatIP` (Inner Product) trở thành **Cosine Similarity** chính xác và siêu nhanh, rồi ghi cứng ra file `data/vector_store/faiss.index` để lần sau khởi động không phải encode lại 748 đoạn văn.',
          en: 'When users ask semantic questions like *"What is the outlook for tech & digital transformation?"*, exact keyword matches may fail, while dense embeddings capture semantic similarity to *"FPT / software exports"*. L2-normalizing vectors makes `faiss.IndexFlatIP` (Inner Product) equal exact **Cosine Similarity**, and `faiss.write_index` persists the index on disk.',
        },
        ifMissing: {
          vi: 'Không lưu `faiss.index` xuống ổ đĩa sẽ buộc ứng dụng phải tính lại embedding cho toàn bộ 748 đoạn mỗi lần mở Streamlit (tốn 20–40 giây chờ đợi vô ích).',
          en: 'Skipping disk persistence forces re-encoding all 748 chunks on every app launch.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'embedder.encode(..., normalize_embeddings=True)',
          params: 'batch_size=32, normalize_embeddings=True',
          inputType: 'list[str]',
          outputType: 'np.ndarray (N, dim) float32',
          description: {
            vi: 'Chuyển văn bản sang vector và chia mỗi vector cho chuẩn L2 của nó (`||v|| = 1`). Lưu ý FAISS bắt buộc kiểu `float32`.',
            en: 'Encodes text into unit-length L2-normalized `float32` vectors required by FAISS.',
          },
        },
        {
          symbol: 'faiss.IndexFlatIP(dim)',
          params: 'd: int (embedding dimension)',
          inputType: 'int (e.g. 1024 for bge-m3)',
          outputType: 'faiss.IndexFlatIP',
          description: {
            vi: 'Chỉ mục tìm kiếm tích vô hướng chính xác (Exact Inner Product); với vector đã chuẩn hóa L2 thì `IP == Cosine Similarity`.',
            en: 'Exact Inner Product index; equivalent to Cosine Similarity when vectors are L2-normalized.',
          },
        },
        {
          symbol: 'faiss.write_index / faiss.read_index',
          params: 'index, path_str',
          inputType: 'Index, str',
          outputType: 'None / Index',
          description: {
            vi: 'Lưu và đọc lại chỉ mục FAISS từ ổ cứng trong <5ms.',
            en: 'Persists and reloads the FAISS index file in <5ms.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Tại sao Normalized Inner Product = Cosine Similarity?', en: 'Stage 1: Normalized Inner Product == Cosine Similarity' },
          summary: {
            vi: 'Kiểm chứng bằng NumPy: khi độ dài 2 vector đều bằng 1, `dot(a, b)` chính là `cos(theta)`.',
            en: 'Verify with NumPy: unit vectors make `dot(a, b)` identical to Cosine Similarity.',
          },
          code: `import faiss, numpy as np

vecs = np.array([[0.6, 0.8], [0.8, 0.6]], dtype="float32")  # Đều có độ dài = 1.0
index = faiss.IndexFlatIP(2)
index.add(vecs)
scores, ids = index.search(np.array([[0.6, 0.8]], dtype="float32"), k=2)
print("Similarities:", scores, "IDs:", ids)`,
          expectedNote: {
            vi: 'Độ tương đồng với chính nó = `1.0`, với vector thứ 2 = `0.96`.',
            en: 'Self-similarity = `1.0`, second vector = `0.96`.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Tạo chỉ mục từ danh sách chunks và ghi xuống ổ đĩa', en: 'Stage 2: Build & Persist FAISS Index' },
          summary: {
            vi: 'Ép kiểu `.astype("float32")` trước khi gọi `index.add(embeddings)`.',
            en: 'Always cast `.astype("float32")` before `index.add(embeddings)`.',
          },
          code: `embeddings = self.embedder.encode(
    texts, batch_size=32, normalize_embeddings=True, show_progress_bar=False
).astype("float32")

dim = embeddings.shape[1]
self.faiss_index = faiss.IndexFlatIP(dim)
self.faiss_index.add(embeddings)
faiss.write_index(self.faiss_index, str(self.vector_dir / "faiss.index"))`,
          expectedNote: {
            vi: 'File `faiss.index` chỉ nặng ~3 MB cho 748 đoạn văn bản.',
            en: '`faiss.index` takes only ~3 MB on disk for 748 chunks.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Tích hợp cùng BM25 vào build_and_save_indices()', en: 'Stage 3: Integrated Index Builder' },
          summary: {
            vi: 'Xem phần xây dựng song song cả FAISS lẫn BM25 ở Bước 5.3 tiếp theo.',
            en: 'Paired directly with BM25 persistence in Step 5.3 next.',
          },
          code: RAG_ENGINE_PY_COMPLETE.split('    def hybrid_search')[0].split('    def build_and_save_indices')[1],
          expectedNote: {
            vi: 'Lưu song song `faiss.index` và `bm25.pkl` vào `data/vector_store/`.',
            en: 'Saves both `faiss.index` and `bm25.pkl` into `data/vector_store/`.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 2/4: Xây & Lưu chỉ mục FAISS + BM25',
        en: 'Piece 2/4: Building & Persisting FAISS + BM25 Indices',
      },
      builderExplanation: {
        vi: 'Thêm `build_and_save_indices()` và `load_indices()` vào `src/rag_engine.py`, lưu cứng chỉ mục FAISS và BM25 xuống `data/vector_store/`.',
        en: 'Adds `build_and_save_indices()` and `load_indices()` to persist both indices inside `data/vector_store/`.',
      },
      builderCode: RAG_ENGINE_PY_COMPLETE.split('    def hybrid_search')[0],
      highlightLines: [66, 94],
      lineWalkthrough: [
        {
          lines: 'L71-L78',
          snippet: 'embeddings = self.embedder.encode(..., normalize_embeddings=True).astype("float32")\ndim = embeddings.shape[1]\nself.faiss_index = faiss.IndexFlatIP(dim)\nself.faiss_index.add(embeddings)',
          explanation: {
            vi: 'Chuẩn hóa L2 + ép kiểu `float32` + khởi tạo `IndexFlatIP` theo đúng số chiều `dim` của mô hình.',
            en: 'L2-normalizes to `float32` and populates `IndexFlatIP` using the embedder output dimension `dim`.',
          },
        },
        {
          lines: 'L85-L88',
          snippet: 'faiss.write_index(self.faiss_index, str(self.vector_dir / "faiss.index"))',
          explanation: {
            vi: 'Lưu ý `faiss.write_index` nhận kiểu `str` chứ không nhận trực tiếp `Path`, nên ta bọc `str(...)`.',
            en: 'Note that FAISS C++ bindings require `str(...)` rather than a raw `Path` object.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện đoạn tạo chỉ mục tích vô hướng (Cosine) với FAISS và lưu xuống ổ cứng:',
          en: 'Complete building the Cosine-equivalent `IndexFlatIP` and writing it to disk:',
        },
        codeTemplate: `embeddings = self.embedder.encode(texts, ___0___=True).astype("float32")
self.faiss_index = faiss.___1___(embeddings.shape[1])
self.faiss_index.add(embeddings)
faiss.write_index(self.faiss_index, str(self.vector_dir / "faiss.index"))`,
        answers: ['normalize_embeddings', 'IndexFlatIP'],
        hints: [
          { vi: 'Tham số của encode() giúp chuẩn hóa L2 vector về độ dài 1', en: 'encode() flag that L2-normalizes output vectors' },
          { vi: 'Lớp chỉ mục FAISS dùng tích vô hướng (Inner Product)', en: 'FAISS index class computing exact Inner Product' },
        ],
        explanation: {
          vi: '`normalize_embeddings=True` + `faiss.IndexFlatIP` chính là công thức chuẩn cho Cosine Similarity trong FAISS.',
          en: '`normalize_embeddings=True` + `faiss.IndexFlatIP` computes exact Cosine Similarity.',
        },
      },
      quiz: {
        question: {
          vi: 'Tại sao ta phải ép kiểu `.astype("float32")` trước khi đưa mảng vector vào `faiss.IndexFlatIP`?',
          en: 'Why cast embeddings with `.astype("float32")` before calling `faiss.IndexFlatIP.add()`?',
        },
        options: [
          {
            vi: 'Vì lõi C++ của FAISS yêu cầu chính xác dữ liệu 32-bit float; nếu là float64 sẽ báo lỗi TypeError hoặc sai kích thước.',
            en: 'FAISS C++ kernels require 32-bit floats; passing float64 raises type/stride errors.',
          },
          {
            vi: 'Vì float32 có độ chính xác cao hơn float64.',
            en: 'Because float32 has higher precision than float64.',
          },
          {
            vi: 'Để tự động xóa bớt các chiều không cần thiết.',
            en: 'To drop redundant dimensions automatically.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! FAISS được viết bằng C++ tối ưu SIMD cho `float32`, đồng thời tốn một nửa RAM so với `float64`.',
          en: 'Correct! FAISS SIMD kernels operate on `float32`, which also halves RAM usage compared to `float64`.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'HybridRAGEngine().build_and_save_indices()',
        terminalLines: [
          '[Embedder] SentenceTransformer("BAAI/bge-m3", device="cpu") loaded in system RAM',
          '[Dense] Encoded 748 chunks -> shape (748, 1024), dtype=float32, L2-normalized',
          '[FAISS] Saved data/vector_store/faiss.index (3.06 MB)',
          '[BM25]  Saved data/vector_store/bm25.pkl (1.18 MB)',
        ],
      },
      checkpointItems: [
        {
          vi: 'Hiểu mối liên hệ toán học giữa vector chuẩn hóa L2 + `IndexFlatIP` và Cosine Similarity.',
          en: 'Understand why L2-normalized vectors + `IndexFlatIP` equals Cosine Similarity.',
        },
        {
          vi: 'Biết cách lưu và đọc `faiss.index` bằng `str(path)`.',
          en: 'Know how to persist and reload `faiss.index` using `str(path)`.',
        },
      ],
      studyApis: ['normalize_embeddings=True', 'faiss.IndexFlatIP', 'faiss.write_index', 'faiss.read_index'],
    },
    {
      id: '5.3',
      moduleId: 'mod-5',
      tier: 2,
      title: {
        vi: 'Bước 5.3: Tìm kiếm Từ khóa Chính xác (BM25) & Trộn điểm Hybrid Search',
        en: 'Step 5.3: Exact Sparse Search (BM25Okapi) & Hybrid Score Fusion',
      },
      subtitle: {
        vi: 'Giải quyết điểm mù của Vector Search với các mã 3 chữ cái (`MBB`, `FPT`, `AFX`, `DCL`) bằng công thức trộn điểm `alpha = 0.5`.',
        en: 'Solve vector search blind spots on exact 3-letter tickers (`MBB`, `FPT`, `AFX`, `DCL`) via `alpha = 0.5` score fusion.',
      },
      targetFile: 'src/rag_engine.py',
      whyAndWhat: {
        why: {
          vi: 'Nếu chỉ dùng FAISS (Vector Search), khi bạn hỏi *"Thông tin về mã AFX hoặc DCL hôm nay?"*, mô hình embedding thường xem `AFX` và `DCL` như các chuỗi chữ cái lạ ít ngữ nghĩa, dẫn đến trả về nhầm đoạn văn nói về *"một cổ phiếu khác"*. Ngược lại, **BM25Okapi** chấm điểm khớp từ khóa chính xác (TF-IDF nâng cao): đoạn nào chứa đúng chữ `afx` hoặc số `25,723` sẽ vọt lên hạng 1! Trộn cả hai điểm sau khi chuẩn hóa Min-Max về `[0, 1]` giúp kết hợp hoàn hảo khả năng hiểu ý (FAISS) và bắt trúng mã cổ phiếu (BM25).',
          en: 'Pure vector search struggles with out-of-vocabulary 3-letter tickers like `AFX` or `DCL` and exact numbers like `25,723`. **BM25Okapi** excels at exact lexical matching, ranking paragraphs containing `afx` at #1. Normalizing both Dense and Sparse scores to `[0, 1]` and fusing via `alpha * dense + (1 - alpha) * bm25` delivers both semantic understanding and exact ticker precision.',
        },
        ifMissing: {
          vi: 'Hệ thống sẽ trả lời sai hoặc nói "không tìm thấy" khi người dùng hỏi đích danh các mã vốn hóa vừa/nhỏ (`AFX`, `DCL`) hoặc một con số tỷ giá cụ thể.',
          en: 'Queries targeting mid/small-cap tickers (`AFX`, `DCL`) or exact FX numbers fail to retrieve the right chunks.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'BM25Okapi(tokenized_corpus)',
          params: 'corpus: list[list[str]]',
          inputType: 'tokenized sentences',
          outputType: 'BM25Okapi index',
          description: {
            vi: 'Xây dựng chỉ mục từ khóa dựa trên tần suất từ (TF), độ hiếm toàn kho (IDF) và chuẩn hóa độ dài đoạn văn.',
            en: 'Builds lexical index using term frequency, inverse document frequency, and document length normalization.',
          },
        },
        {
          symbol: 'bm25.get_scores(tokenized_query)',
          params: 'query tokens: list[str]',
          inputType: 'list[str]',
          outputType: 'np.ndarray (N,)',
          description: {
            vi: 'Trả về điểm BM25 cho toàn bộ `N` đoạn văn bản theo đúng thứ tự index `0..N-1`.',
            en: 'Returns raw BM25 relevance scores aligned across all `N` chunks.',
          },
        },
        {
          symbol: 'alpha * d_norm + (1 - alpha) * b_norm',
          params: 'alpha = 0.5',
          inputType: 'normalized vectors [0..1]',
          outputType: 'hybrid_scores (N,)',
          description: {
            vi: 'Chia cho `.max() + 1e-9` để đưa cả điểm FAISS và BM25 về cùng thang `[0, 1]` trước khi cộng trọng số `0.5 / 0.5`.',
            en: 'Scales both score arrays into `[0, 1]` before blending equally (`alpha = 0.5`).',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Tại sao Vector Search trượt mã AFX mà BM25 bắt trúng?', en: 'Stage 1: Why BM25 Catches Exact Tickers' },
          summary: {
            vi: 'Thử chạy `BM25Okapi` trên 3 câu ngắn để thấy sức mạnh của khớp từ khóa.',
            en: 'Run `BM25Okapi` on 3 sample sentences to see exact ticker scoring.',
          },
          code: `from rank_bm25 import BM25Okapi
import re

docs = [
    "VN-Index tăng điểm tích cực nhờ nhóm ngân hàng.",
    "Cổ phiếu AFX ghi nhận thanh khoản đột biến trong phiên chiều.",
    "Giá dầu Brent giảm nhẹ về 72 USD/thùng.",
]
tok = lambda s: re.findall(r"\\w+", s.lower())
bm25 = BM25Okapi([tok(d) for d in docs])
print("Scores for 'mã AFX':", bm25.get_scores(tok("mã AFX")))`,
          expectedNote: {
            vi: 'Câu số 2 có điểm cao nhất rõ rệt vì chứa đúng token `"afx"`.',
            en: 'Sentence #2 scores highest strictly because it contains token `"afx"`.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Chuẩn hóa thang đo trước khi trộn (Min-Max Scaling)', en: 'Stage 2: Score Normalization Before Fusion' },
          summary: {
            vi: 'FAISS trả điểm trong `[0, 1]`, còn BM25 có thể trả `0..18.5`; nếu cộng thẳng sẽ bị BM25 nuốt mất FAISS.',
            en: 'FAISS lives in `[0, 1]` while BM25 can reach `18+`; normalize both before blending.',
          },
          code: `d_norm = dense_scores / (dense_scores.max() + 1e-9)
b_norm = bm25_scores / (bm25_scores.max() + 1e-9)
hybrid_scores = alpha * d_norm + (1.0 - alpha) * b_norm
top_indices = np.argsort(hybrid_scores)[::-1][:4]`,
          expectedNote: {
            vi: '`+ 1e-9` bảo vệ phép chia khi một truy vấn không khớp từ khóa nào (`max == 0`).',
            en: '`+ 1e-9` prevents ZeroDivisionError when BM25 max score is 0.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Hàm hybrid_search(query, top_k=4, alpha=0.5)', en: 'Stage 3: Complete hybrid_search() Method' },
          summary: {
            vi: 'Lấy Top 4 đoạn văn bản giàu thông tin nhất gửi sang Ollama ở Bước 5.4.',
            en: 'Select the Top 4 fused chunks to feed Ollama in Step 5.4.',
          },
          code: RAG_ENGINE_PY_COMPLETE.split('    def ask(')[0].split('    def hybrid_search')[1],
          expectedNote: {
            vi: 'Lấy đúng `top_k=4` để vừa đủ ngữ cảnh trả lời sâu, vừa không làm chậm tốc độ sinh chữ của Qwen2.5:7b.',
            en: '`top_k=4` gives rich evidence while keeping Qwen2.5:7b prompt latency fast.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 3/4: Thêm hàm hybrid_search() vào src/rag_engine.py',
        en: 'Piece 3/4: Adding hybrid_search() to src/rag_engine.py',
      },
      builderExplanation: {
        vi: 'Ghép logic truy vấn song song FAISS + BM25, chuẩn hóa điểm về `[0, 1]`, trộn theo `alpha = 0.5` và trả về Top 4 đoạn văn bản.',
        en: 'Combines FAISS + BM25 querying, `[0, 1]` score normalization, `alpha = 0.5` fusion, and Top-4 selection.',
      },
      builderCode: RAG_ENGINE_PY_COMPLETE.split('    def ask(')[0],
      highlightLines: [95, 134],
      lineWalkthrough: [
        {
          lines: 'L107-L115',
          snippet: 'dense_scores_raw, dense_ids = self.faiss_index.search(q_emb, n_docs)\n...\nbm25_scores = np.array(self.bm25.get_scores(self.tokenize_for_bm25(query)), dtype="float32")',
          explanation: {
            vi: 'Chấm điểm đồng thời toàn bộ `n_docs` đoạn văn bản bằng cả FAISS lẫn BM25 để đảm bảo không bỏ sót đoạn nào khi trộn.',
            en: 'Scores all `n_docs` chunks across both FAISS and BM25 so candidate sets align cleanly.',
          },
        },
        {
          lines: 'L120-L125',
          snippet: 'd_norm = dense_scores / (dense_scores.max() + 1e-9)\nb_norm = bm25_scores / (bm25_scores.max() + 1e-9)\nhybrid_scores = alpha * d_norm + (1.0 - alpha) * b_norm\ntop_indices = np.argsort(hybrid_scores)[::-1][:top_k]',
          explanation: {
            vi: 'Chuẩn hóa, trộn điểm 50/50 và lấy `top_k` chỉ mục cao điểm nhất.',
            en: 'Normalizes, blends 50/50, and selects the Top-K highest-scoring indices.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện phép chuẩn hóa điểm và công thức trộn Hybrid Search:',
          en: 'Complete score normalization and the Hybrid Search fusion formula:',
        },
        codeTemplate: `d_norm = dense_scores / (dense_scores.max() + 1e-9)
b_norm = bm25_scores / (bm25_scores.___0___() + 1e-9)
hybrid_scores = alpha * d_norm + (1.0 - ___1___) * b_norm`,
        answers: ['max', 'alpha'],
        hints: [
          { vi: 'Phương thức lấy giá trị lớn nhất của mảng điểm BM25', en: 'Method returning the maximum BM25 score' },
          { vi: 'Hệ số trọng số cân bằng giữa Dense và Sparse (0.5)', en: 'Weighting factor balancing Dense vs Sparse (0.5)' },
        ],
        explanation: {
          vi: 'Chia cho `.max()` đưa điểm BM25 về `[0, 1]` cùng thang với FAISS trước khi nhân với `(1.0 - alpha)`.',
          en: 'Dividing by `.max()` aligns BM25 into `[0, 1]` before multiplying by `(1.0 - alpha)`.',
        },
      },
      quiz: {
        question: {
          vi: 'Nếu người dùng hỏi: *"Bản tin nói gì về mã cổ phiếu DCL và tỷ giá 25,723?"*, thành phần nào trong Hybrid Search đóng vai trò quyết định để tìm đúng đoạn?',
          en: 'When a user asks: *"What does the report say about ticker DCL and rate 25,723?"*, which component prevents missing exact matches?',
        },
        options: [
          {
            vi: 'BM25Okapi (Sparse Retrieval), vì nó bắt chính xác token chữ `dcl` và số `25,723` mà mô hình Embedding dễ bỏ qua.',
            en: 'BM25Okapi (Sparse Retrieval), because it matches exact tokens `dcl` and `25,723` that dense embeddings often dilute.',
          },
          {
            vi: 'Chỉ cần `StandardScaler` là đủ.',
            en: '`StandardScaler` alone handles this.',
          },
          {
            vi: 'Chỉ cần `gc.collect()`.',
            en: '`gc.collect()` handles this.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Kết hợp FAISS (hiểu ngữ nghĩa) + BM25 (bắt chính xác mã & số) là chìa khóa cho RAG tài chính.',
          en: 'Correct! Pairing FAISS semantics with BM25 exact token matching is essential in financial RAG.',
        },
      },
      simulation: {
        kind: 'rag_trace',
        commandLabel: 'hybrid_search("Triển vọng FPT và MBB trong bản tin mới nhất?", top_k=4)',
        ragQuery: {
          vi: 'Triển vọng FPT và MBB trong bản tin mới nhất?',
          en: 'What is the outlook for FPT and MBB in the latest report?',
        },
        ragChunks: [
          {
            source: '20261113 · Page 2',
            bm25Score: 0.94,
            denseScore: 0.88,
            hybridScore: 0.91,
            text: 'TIN DOANH NGHIỆP: FPT công bố doanh thu 10T tăng 19.5% YoY nhờ mảng AI & phần mềm nước ngoài; MBB duy trì CASA top đầu ngành.',
          },
          {
            source: '20261113 · Page 1',
            bm25Score: 0.62,
            denseScore: 0.84,
            hybridScore: 0.73,
            text: 'NHẬN ĐỊNH THỊ TRƯỜNG: Khối ngoại mua ròng trở lại FPT (+142 tỷ) và MBB (+89 tỷ), giúp VN-Index vượt 1,268 điểm.',
          },
          {
            source: '20261112 · Page 3',
            bm25Score: 0.51,
            denseScore: 0.76,
            hybridScore: 0.635,
            text: '[Ngày 20261112 - Trang 3] Chỉ số USD/VND ghi nhận 25,723 (+0.2% 1D, +1.5% YTD).',
          },
        ],
        ragAnswer: {
          vi: 'Theo bản tin [Ngày 20261113 - Trang 2], FPT ghi nhận doanh thu 10 tháng tăng 19.5% YoY nhờ mảng AI và phần mềm nước ngoài, trong khi MBB duy trì tỷ lệ CASA dẫn đầu ngành. Ngoài ra [Ngày 20261113 - Trang 1], khối ngoại mua ròng FPT (+142 tỷ) và MBB (+89 tỷ).',
          en: 'Per [20261113 - Page 2], FPT posted 19.5% YoY 10M revenue growth driven by AI and overseas software, while MBB kept industry-leading CASA. Foreign investors also net-bought FPT (+142B) and MBB (+89B) [20261113 - Page 1].',
        },
      },
      checkpointItems: [
        {
          vi: 'Giải thích được vì sao Dense Retrieval đơn thuần yếu với mã cổ phiếu 3 chữ cái.',
          en: 'Explain why standalone dense retrieval struggles with 3-letter ticker codes.',
        },
        {
          vi: 'Biết cách chuẩn hóa điểm FAISS + BM25 về `[0, 1]` trước khi trộn.',
          en: 'Know how to normalize FAISS and BM25 scores into `[0, 1]` prior to fusion.',
        },
      ],
      studyApis: ['BM25Okapi', 'bm25.get_scores', 'Min-Max score fusion', 'hybrid_search'],
    },
    {
      id: '5.4',
      moduleId: 'mod-5',
      tier: 3,
      title: {
        vi: 'Bước 5.4: Tích hợp Ollama (qwen2.5:7b) & System Prompt Chống Bịa Đặt',
        en: 'Step 5.4: Local Ollama (qwen2.5:7b) & Grounded Anti-Hallucination Prompting',
      },
      subtitle: {
        vi: 'Gọi API local `http://localhost:11434/api/generate`, kết hợp Top 4 đoạn RAG + bảng ML và ép trích dẫn `[Ngày - Trang]`.',
        en: 'Call `http://localhost:11434/api/generate`, inject Top-4 RAG chunks + ML summary, and enforce `[Date - Page]` citations.',
      },
      targetFile: 'src/rag_engine.py',
      whyAndWhat: {
        why: {
          vi: 'Chạy LLM trên máy cá nhân bằng **Ollama** (`ollama pull qwen2.5:7b`, bản lượng tử Q4_K_M chiếm ~4.7–5.2GB VRAM trong tổng 8GB RTX 5060) giúp bảo mật 100% dữ liệu tài chính và không tốn phí API. Để LLM không tự "bịa" con số từ trí nhớ pre-train cũ, ta thiết kế **System Prompt** nghiêm ngặt: chỉ trả lời từ 4 đoạn ngữ cảnh + tóm tắt điểm ML, bắt buộc ghi rõ `[Ngày YYYYMMDD - Trang X]`, và nói thẳng không có nếu thiếu thông tin.',
          en: 'Running **Ollama** locally (`ollama pull qwen2.5:7b`, Q4_K_M using ~4.7–5.2GB of our 8GB RTX 5060 VRAM) keeps financial queries private with zero API fees. A strict **System Prompt** constrains the LLM to the 4 retrieved chunks + ML summary, mandates `[Ngày YYYYMMDD - Trang X]` citations, and instructs it to refuse unsupported claims.',
        },
        ifMissing: {
          vi: 'Không có System Prompt chống bịa đặt, LLM dễ lấy số liệu cũ từ năm 2023 trong trọng số huấn luyện để bịa ra giá cổ phiếu hiện tại — lỗi nghiêm trọng nhất trong ứng dụng tài chính.',
          en: 'Without strict grounding instructions, LLMs hallucinate stale pretrained prices or fabricate analyst targets.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'http://localhost:11434/api/generate',
          params: 'model, prompt, stream=False',
          inputType: 'JSON payload',
          outputType: 'JSON {"response": str}',
          description: {
            vi: 'Endpoint REST local của dịch vụ Ollama đang chạy ngầm trên máy Windows/Linux.',
            en: 'Local REST endpoint exposed by the background Ollama runtime.',
          },
        },
        {
          symbol: 'extra_chunks (Session Context)',
          params: 'st.session_state["latest_doc_chunks"]',
          inputType: 'list[dict] | None',
          outputType: 'merged top-4 contexts',
          description: {
            vi: 'Ưu tiên trộn thêm các đoạn từ file PDF người dùng vừa upload ở Tab 1 để hỏi đáp ngay lập tức không cần rebuild toàn kho.',
            en: 'Prioritizes chunks from the PDF just uploaded in Tab 1 so users can chat immediately without rebuilding global indices.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Kiểm tra kết nối Ollama local bằng requests', en: 'Stage 1: Test Local Ollama API Call' },
          summary: {
            vi: 'Đảm bảo đã chạy `ollama pull qwen2.5:7b` trước khi gọi API.',
            en: 'Ensure `ollama pull qwen2.5:7b` has been run locally first.',
          },
          code: `import requests

resp = requests.post(
    "http://localhost:11434/api/generate",
    json={"model": "qwen2.5:7b", "prompt": "Xin chào, bạn chạy local phải không?", "stream": False},
    timeout=60,
)
print(resp.json()["response"])`,
          expectedNote: {
            vi: 'Trả về câu tiếng Việt tự nhiên hoàn toàn offline trên GPU RTX 5060.',
            en: 'Responds completely offline on your local RTX 5060 GPU.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Thiết kế System Prompt ép trích dẫn & từ chối bịa đặt', en: 'Stage 2: Strict Citation System Prompt' },
          summary: {
            vi: 'Ghép 3 khối rõ rệt trong prompt: `TÓM TẮT ĐIỂM ML` + `NGỮ CẢNH BẢN TIN` + `CÂU HỎI`.',
            en: 'Structure the prompt into 3 explicit blocks: `ML SUMMARY` + `REPORT CONTEXT` + `QUESTION`.',
          },
          code: `system_prompt = (
    "Bạn là trợ lý phân tích chứng khoán MASVN. CHỈ được trả lời dựa trên "
    "4 đoạn ngữ cảnh từ bản tin và bảng điểm ML được cung cấp dưới đây. "
    "Bắt buộc trích dẫn rõ nguồn theo định dạng [Ngày YYYYMMDD - Trang X]. "
    "Nếu thông tin không có trong tài liệu, hãy trả lời thẳng là không tìm thấy "
    "trong bản tin và tuyệt đối không tự bịa số liệu."
)`,
          expectedNote: {
            vi: 'Mỗi câu trả lời đều kèm chứng cứ để người dùng đối chiếu lại PDF gốc.',
            en: 'Every statement is backed by a verifiable report date and page number.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Hoàn chỉnh toàn bộ file src/rag_engine.py', en: 'Stage 3: Complete src/rag_engine.py' },
          summary: {
            vi: 'Ghép hoàn thiện cả class `HybridRAGEngine` gồm Chunking, FAISS, BM25, Hybrid Search và Ollama `ask()`.',
            en: 'Complete `HybridRAGEngine` combining chunking, FAISS, BM25, hybrid search, and Ollama `ask()`.',
          },
          code: RAG_ENGINE_PY_COMPLETE,
          expectedNote: {
            vi: 'Vào Tab "4. File hoàn chỉnh" để tải về `src/rag_engine.py`.',
            en: 'Download the complete `src/rag_engine.py` from Tab 4.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mảnh ghép 4/4: Hoàn thiện ask() & Toàn bộ src/rag_engine.py',
        en: 'Piece 4/4: Completing ask() & Full src/rag_engine.py',
      },
      builderExplanation: {
        vi: 'Bổ sung hàm `ask(query, ml_summary, extra_chunks)` nối Hybrid Search với Ollama `qwen2.5:7b` và System Prompt chống ảo giác.',
        en: 'Appends `ask(query, ml_summary, extra_chunks)` connecting Hybrid Search to local Ollama `qwen2.5:7b`.',
      },
      builderCode: RAG_ENGINE_PY_COMPLETE,
      highlightLines: [135, 172],
      lineWalkthrough: [
        {
          lines: 'L136-L143',
          snippet: 'contexts = self.hybrid_search(query, top_k=4, alpha=0.5)\nif extra_chunks:\n    contexts = (extra_chunks[:2] + contexts)[:4]',
          explanation: {
            vi: 'Cho phép chatbot đọc đồng thời kho lịch sử 50 ngày lẫn file PDF mới nhất vừa upload trong `st.session_state`.',
            en: 'Blends historical vector-store hits with freshly uploaded session PDF chunks.',
          },
        },
        {
          lines: 'L164-L169',
          snippet: 'response = requests.post(\n    self.ollama_url,\n    json={"model": self.ollama_model, "prompt": prompt, "stream": False},\n    timeout=120,\n)',
          explanation: {
            vi: 'Đặt `stream=False` để nhận trọn câu trả lời JSON gọn gàng cho `st.chat_message`.',
            en: 'Uses `stream=False` for a clean single-response JSON payload in Streamlit.',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện lời gọi API local tới Ollama `qwen2.5:7b`:',
          en: 'Complete the local HTTP POST call to Ollama `qwen2.5:7b`:',
        },
        codeTemplate: `response = requests.post(
    "http://localhost:___0___/api/generate",
    json={"model": "___1___", "prompt": prompt, "stream": False},
    timeout=120,
)`,
        answers: ['11434', 'qwen2.5:7b'],
        hints: [
          { vi: 'Cổng mặc định của dịch vụ Ollama trên localhost', en: 'Default TCP port of the local Ollama daemon' },
          { vi: 'Tên mô hình Qwen 2.5 7B trong Ollama', en: 'Model tag for Qwen 2.5 7B in Ollama' },
        ],
        explanation: {
          vi: 'Ollama mặc định lắng nghe ở cổng `11434` và gọi model `qwen2.5:7b` chạy Q4_K_M trên GPU RTX 5060.',
          en: 'Ollama listens on port `11434` and executes quantized `qwen2.5:7b` on the local GPU.',
        },
      },
      quiz: {
        question: {
          vi: 'Nếu người dùng hỏi *"Giá mục tiêu cổ phiếu XYZ năm 2030 là bao nhiêu?"* (không hề có trong bản tin), System Prompt của chúng ta buộc AI làm gì?',
          en: 'If a user asks *"What is the 2030 price target for XYZ?"* (not in the report), what does our System Prompt enforce?',
        },
        options: [
          {
            vi: 'Trả lời thẳng rằng không tìm thấy thông tin trong bản tin và tuyệt đối không tự bịa số liệu.',
            en: 'Explicitly state that the information was not found in the provided reports and refuse to fabricate numbers.',
          },
          {
            vi: 'Tự ước lượng tăng 15% mỗi năm.',
            en: 'Extrapolate a 15% annual gain.',
          },
          {
            vi: 'Tự động tắt máy tính.',
            en: 'Shut down the application.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! Chấp nhận trả lời "không tìm thấy" khi thiếu dữ liệu là đặc tính an toàn bắt buộc của mọi hệ thống RAG thực chiến.',
          en: 'Correct! Explicit abstention on missing evidence is mandatory for trustworthy financial RAG.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'POST http://localhost:11434/api/generate (model=qwen2.5:7b)',
        terminalLines: [
          '[VRAM Monitor] YOLOv11n idle (0.28 GB) + Qwen2.5:7b Q4_K_M active (4.92 GB) = 5.20 GB / 8.00 GB VRAM',
          '[Prompt] Injected 4 retrieved chunks + ML top-5 summary (1,180 tokens)',
          '[Ollama] Generated 112 tokens in 2.34 s (47.8 tok/s on RTX 5060)',
          '[Citation Check] Verified "[Ngày 20261113 - Trang 2]" present in answer.',
        ],
      },
      checkpointItems: [
        {
          vi: 'Cài đặt được Ollama và kéo model `qwen2.5:7b` chạy cục bộ.',
          en: 'Verify Ollama + `qwen2.5:7b` runs locally via `localhost:11434`.',
        },
        {
          vi: 'Nắm vững cấu trúc System Prompt chống bịa đặt và bắt buộc trích dẫn nguồn.',
          en: 'Master grounded System Prompting with mandatory `[Date - Page]` citations.',
        },
      ],
      studyApis: ['Ollama REST API', 'qwen2.5:7b', 'Grounded System Prompt', 'src/rag_engine.py'],
      completeFiles: [
        {
          path: 'src/rag_engine.py',
          language: 'python',
          code: RAG_ENGINE_PY_COMPLETE,
        },
      ],
    },
    {
      id: '5.5',
      moduleId: 'mod-5',
      tier: 3,
      title: {
        vi: 'Bước 5.5: Mở rộng RAG — Reciprocal Rank Fusion (RRF), Reranker & Đánh giá Recall@3',
        en: 'Step 5.5: Production RAG Extensions — RRF, Cross-Encoder Reranking & Recall@3 Eval',
      },
      subtitle: {
        vi: 'Cài đặt công thức RRF (`1 / (60 + rank)`), lọc lại bằng `CrossEncoder` trên CPU và viết script chấm điểm `Recall@3` trên 20 câu hỏi mẫu.',
        en: 'Implement Reciprocal Rank Fusion (`1 / (60 + rank)`), add CPU `CrossEncoder` reranking, and benchmark `Recall@3` on 20 golden queries.',
      },
      targetFile: 'src/rag_engine.py',
      whyAndWhat: {
        why: {
          vi: 'Trộn điểm Min-Max nhạy cảm khi một đoạn có điểm BM25 quá cao lệch thang đo. **RRF (Reciprocal Rank Fusion)** chỉ dựa vào *thứ hạng (rank)* của FAISS và BM25 nên cực kỳ ổn định không cần chuẩn hóa điểm. Sau đó, kéo Top 12 đoạn từ RRF rồi cho qua **Cross-Encoder Reranker** (`BAAI/bge-reranker-v2-m3`) để chọn lại Top 4 tinh khiết nhất — và dùng script tự động đo `Recall@3` + `MRR` trên bộ 20 câu hỏi kiểm thử (Tuần 6 trong kế hoạch).',
          en: 'Min-Max score blending can skew when BM25 produces outlier lexical spikes. **Reciprocal Rank Fusion (RRF)** merges FAISS and BM25 using *rank order* (`1 / (60 + rank)`), eliminating scale mismatches. Fetching Top-12 via RRF, reranking with a CPU `CrossEncoder` down to Top-4, and scoring `Recall@3` on 20 benchmark questions provides hard quantitative proof.',
        },
        ifMissing: {
          vi: 'Không có tập 20 câu hỏi đo `Recall@3`, bạn chỉ "cảm giác" RAG chạy tốt chứ không có con số cụ thể để chứng minh trong `README.md` hay biết mình chỉnh `alpha` có thực sự cải thiện kết quả không.',
          en: 'Without a 20-query `Recall@3` eval script, tuning `alpha` or chunk sizes becomes guesswork with no metrics for `README.md`.',
        },
      },
      apiAnatomy: [
        {
          symbol: 'rrf_score = 1 / (k + rank)',
          params: 'k = 60 (standard)',
          inputType: 'ranks from FAISS & BM25',
          outputType: 'float score',
          description: {
            vi: 'Hạng 1 được `1/61`, hạng 2 được `1/62`; đoạn nằm top ở cả 2 bộ tìm kiếm sẽ có tổng điểm cao vượt trội.',
            en: 'Rank 1 adds `1/61`, rank 2 adds `1/62`; chunks ranking high in both Dense and Sparse lists surge to the top.',
          },
        },
        {
          symbol: 'Recall@K & MRR',
          params: 'top_k = 3',
          inputType: '20 golden QA pairs',
          outputType: 'float [0..1]',
          description: {
            vi: '`Recall@3` kiểm tra đáp án đúng có nằm trong 3 đoạn đầu không; `MRR` thưởng cao hơn nếu đáp án nằm ngay vị trí số 1.',
            en: '`Recall@3` measures hit rate in Top-3 chunks; `MRR` rewards placing the right chunk at rank #1.',
          },
        },
      ],
      progressiveStages: [
        {
          tier: 1,
          title: { vi: 'Tầng 1: Viết hàm trộn thứ hạng Reciprocal Rank Fusion (RRF)', en: 'Stage 1: Reciprocal Rank Fusion (RRF)' },
          summary: {
            vi: 'Không cần chia `.max()`, chỉ cần danh sách thứ tự ID từ FAISS và BM25.',
            en: 'Fuse ranked ID lists directly without scale normalization.',
          },
          code: `def rrf_fusion(dense_ranked_ids: list[int], bm25_ranked_ids: list[int], k: int = 60) -> list[int]:
    scores = {}
    for rank, doc_id in enumerate(dense_ranked_ids, start=1):
        scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    for rank, doc_id in enumerate(bm25_ranked_ids, start=1):
        scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return [doc_id for doc_id, _ in sorted(scores.items(), key=lambda x: x[1], reverse=True)]`,
          expectedNote: {
            vi: 'Hằng số `k = 60` giúp giảm chênh lệch quá gắt giữa hạng 1 và hạng 2.',
            en: 'Constant `k = 60` dampens extreme top-rank dominance.',
          },
        },
        {
          tier: 2,
          title: { vi: 'Tầng 2: Rerank Top-12 -> Top-4 bằng CrossEncoder', en: 'Stage 2: Rerank Top-12 to Top-4' },
          summary: {
            vi: 'Bi-encoder (FAISS) đọc câu hỏi và đoạn văn độc lập, còn Cross-Encoder đọc cả cặp `[query, chunk]` cùng lúc nên chính xác hơn nhiều.',
            en: 'Cross-Encoders jointly attend across `[query, chunk]` pairs for sharper Top-4 precision.',
          },
          code: `from sentence_transformers import CrossEncoder

reranker = CrossEncoder("BAAI/bge-reranker-v2-m3", device="cpu")
pairs = [[query, c["text"]] for c in candidate_12]
rerank_scores = reranker.predict(pairs)
top4 = [c for c, _ in sorted(zip(candidate_12, rerank_scores), key=lambda x: x[1], reverse=True)[:4]]`,
          expectedNote: {
            vi: 'Chỉ chạy CrossEncoder trên 12 ứng viên nên chỉ tốn ~120ms trên CPU.',
            en: 'Scoring only 12 candidates keeps CPU latency around ~120ms.',
          },
        },
        {
          tier: 3,
          title: { vi: 'Tầng 3: Script chấm điểm Recall@3 & MRR trên 20 câu hỏi mẫu', en: 'Stage 3: 20-Query Recall@3 & MRR Benchmark' },
          summary: {
            vi: 'Tạo số liệu thật điền thẳng vào bảng Benchmark của `README.md`.',
            en: 'Generate objective metrics directly for the `README.md` benchmark table.',
          },
          code: `def evaluate_recall_at_k(rag, eval_set: list[dict], k: int = 3):
    hits, rr_sum = 0, 0.0
    for item in eval_set:
        results = rag.hybrid_search(item["query"], top_k=k)
        found_rank = None
        for rank, res in enumerate(results, start=1):
            if item["expected_keyword"].lower() in res["text"].lower():
                found_rank = rank
                break
        if found_rank is not None:
            hits += 1
            rr_sum += 1.0 / found_rank
    n = len(eval_set)
    print(f"Recall@{k}: {hits / n:.2f} ({hits}/{n}) | MRR: {rr_sum / n:.3f}")`,
          expectedNote: {
            vi: 'Bạn có thể so sánh ngay FAISS thuần vs BM25 thuần vs Hybrid RRF trên cùng 20 câu hỏi này.',
            en: 'Lets you compare Dense-only vs BM25-only vs Hybrid RRF on identical queries.',
          },
        },
      ],
      builderTitle: {
        vi: 'Mở rộng RAG: RRF Fusion & Đánh giá Recall@3',
        en: 'RAG Extension: RRF Fusion & Recall@3 Evaluator',
      },
      builderExplanation: {
        vi: 'Thêm thuật toán `rrf_fusion` và hàm `evaluate_recall_at_k` đo lường khách quan chất lượng truy xuất.',
        en: 'Adds `rrf_fusion` and `evaluate_recall_at_k` for objective retrieval benchmarking.',
      },
      builderCode: `def rrf_fusion(dense_ranked_ids: list[int], bm25_ranked_ids: list[int], k: int = 60) -> list[int]:
    scores: dict[int, float] = {}
    for rank, doc_id in enumerate(dense_ranked_ids, start=1):
        scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    for rank, doc_id in enumerate(bm25_ranked_ids, start=1):
        scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return [doc_id for doc_id, _ in sorted(scores.items(), key=lambda x: x[1], reverse=True)]


def evaluate_recall_at_k(rag, eval_set: list[dict], k: int = 3) -> tuple[float, float]:
    hits, rr_sum = 0, 0.0
    for item in eval_set:
        results = rag.hybrid_search(item["query"], top_k=k)
        found_rank = None
        for rank, res in enumerate(results, start=1):
            if item["expected_keyword"].lower() in res["text"].lower():
                found_rank = rank
                break
        if found_rank is not None:
            hits += 1
            rr_sum += 1.0 / found_rank
    n = max(1, len(eval_set))
    return hits / n, rr_sum / n`,
      highlightLines: [1, 23],
      lineWalkthrough: [
        {
          lines: 'L3-L6',
          snippet: 'scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)',
          explanation: {
            vi: 'Cộng dồn nghịch đảo thứ hạng từ cả 2 danh sách xếp hạng mà không bị phụ thuộc thang điểm gốc.',
            en: 'Accumulates reciprocal ranks across both retrievers independent of raw score distributions.',
          },
        },
        {
          lines: 'L19-L21',
          snippet: 'if found_rank is not None:\n    hits += 1\n    rr_sum += 1.0 / found_rank',
          explanation: {
            vi: 'Tính đồng thời cả `Recall@K` (`hits/n`) và Mean Reciprocal Rank (`rr_sum/n`).',
            en: 'Computes both `Recall@K` (`hits/n`) and Mean Reciprocal Rank (`rr_sum/n`).',
          },
        },
      ],
      fillBlank: {
        prompt: {
          vi: 'Hoàn thiện công thức Reciprocal Rank Fusion (`k = 60`) và cập nhật Reciprocal Rank:',
          en: 'Complete the Reciprocal Rank Fusion formula (`k = 60`) and MRR accumulation:',
        },
        codeTemplate: `scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (___0___ + rank)
...
if found_rank is not None:
    hits += 1
    rr_sum += 1.0 / ___1___`,
        answers: ['60', 'found_rank'],
        hints: [
          { vi: 'Hằng số làm mượt chuẩn trong công thức RRF', en: 'Standard smoothing constant in RRF' },
          { vi: 'Thứ hạng tìm thấy đoạn văn chứa từ khóa đúng (1, 2, hoặc 3)', en: '1-based rank where the expected chunk appeared' },
        ],
        explanation: {
          vi: 'RRF dùng `1 / (60 + rank)` để trộn xếp hạng, còn MRR cộng `1 / found_rank` để thưởng hạng 1 cao hơn hạng 3.',
          en: 'RRF uses `1 / (60 + rank)` for fusion, while MRR sums `1 / found_rank` to reward higher positions.',
        },
      },
      quiz: {
        question: {
          vi: 'Ưu điểm lớn nhất của Reciprocal Rank Fusion (RRF) so với phép cộng có trọng số Min-Max là gì?',
          en: 'What is the main advantage of Reciprocal Rank Fusion (RRF) over Min-Max weighted score blending?',
        },
        options: [
          {
            vi: 'RRF chỉ dùng thứ hạng (rank) nên hoàn toàn miễn nhiễm với việc BM25 và FAISS có phân phối thang điểm khác nhau.',
            en: 'RRF operates purely on ranks, making it invariant to mismatched score scales between BM25 and FAISS.',
          },
          {
            vi: 'RRF tự động sinh ra vector embedding mới không cần model.',
            en: 'RRF generates embeddings without a model.',
          },
          {
            vi: 'RRF giảm kích thước file `faiss.index` đi một nửa.',
            en: 'RRF halves `faiss.index` file size.',
          },
        ],
        correctIndex: 0,
        explanation: {
          vi: 'Đúng! RRF rất được ưa chuộng trong các hệ thống tìm kiếm thực tế (Elasticsearch, Vespa) vì không cần tinh chỉnh nhiều ngưỡng thang điểm.',
          en: 'Correct! RRF is widely used in production search engines precisely because rank fusion is scale-invariant.',
        },
      },
      simulation: {
        kind: 'terminal',
        commandLabel: 'evaluate_recall_at_k(rag, golden_20_queries, k=3)',
        terminalLines: [
          'Benchmarking 20 MASVN queries (foreign flow, FX USD/VND, tickers FPT/MBB/DCL/AFX):',
          '  FAISS Dense only : Recall@3 = 0.70 (14/20) | MRR = 0.592',
          '  BM25 Sparse only : Recall@3 = 0.75 (15/20) | MRR = 0.658',
          '  Hybrid RRF       : Recall@3 = 0.90 (18/20) | MRR = 0.817',
          '  Hybrid + Reranker: Recall@3 = 0.95 (19/20) | MRR = 0.883',
        ],
      },
      checkpointItems: [
        {
          vi: 'Viết được công thức trộn điểm RRF `1 / (60 + rank)` bằng Python.',
          en: 'Implement RRF `1 / (60 + rank)` fusion cleanly in Python.',
        },
        {
          vi: 'Hiểu cách đo lường `Recall@3` và `MRR` để so sánh các chiến lược RAG.',
          en: 'Measure `Recall@3` and `MRR` to benchmark retrieval strategies.',
        },
      ],
      studyApis: ['rrf_fusion', 'CrossEncoder', 'Recall@3', 'MRR'],
    },
  ],
};
