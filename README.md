# MASVN Market Intelligence — Learning Studio

Ứng dụng web học tập tương tác hướng dẫn xây dựng hệ thống **MASVN Market Intelligence Engine** từ đầu qua **7 học phần (36 bước)**, hỗ trợ song ngữ Việt / Anh, khóa tiến độ tuần tự, chạy thử Python trên trình duyệt (Pyodide) và xuất mã nguồn dự án.

---

## 1. Yêu cầu hệ thống

- **Node.js:** phiên bản `>= 18.0.0` (đã kiểm thử trên Node `v24.12.0` và npm `11.7.0`).
- **Trình duyệt:** Chrome, Edge, Firefox hoặc Safari bản hiện đại (có hỗ trợ WebAssembly nếu dùng tính năng chạy Python trực tiếp).
- **Kết nối Internet:** chỉ cần ở lần đầu chạy khối `Pyodide Runtime` (tải runtime từ `cdn.jsdelivr.net`) và tải font chữ Google Fonts (`Inter`, `JetBrains Mono`). Toàn bộ bài học, kiểm tra đáp án và xuất `.zip` chạy hoàn toàn trên máy.

---

## 2. Cài đặt và Khởi chạy

Mở terminal (PowerShell, Command Prompt hoặc Terminal trên macOS/Linux) tại thư mục gốc của dự án:

```bash
# 1. Cài đặt các gói phụ thuộc
npm install

# 2. Khởi chạy môi trường phát triển (mặc định tại http://localhost:5173)
npm run dev
```

Nếu muốn đóng gói bản production và xem trước cục bộ:

```bash
# Biên dịch TypeScript và đóng gói vào thư mục dist/
npm run build

# Chạy server xem trước bản build
npm run preview
```

---

## 3. Các lệnh có sẵn trong `package.json`

| Lệnh | Mục đích |
|---|---|
| `npm run dev` | Khởi chạy Vite dev server có hot-reload. |
| `npm run build` | Kiểm tra kiểu TypeScript (`tsc -b`) và đóng gói production (`vite build`) ra `dist/`. |
| `npm run preview` | Phục vụ thử thư mục `dist/` sau khi build. |

---

## 4. Cấu trúc mã nguồn

```text
.
├── index.html                        # Điểm vào HTML, thiết lập theme mặc định
├── package.json                      # Khai báo script và thư viện (React 19, Lucide, JSZip, Vite)
├── tsconfig.json                     # Cấu hình TypeScript
├── vite.config.ts                    # Cấu hình Vite bundler
└── src/
    ├── main.tsx                      # Mount ứng dụng React
    ├── App.tsx                       # Layout chính, điều hướng bước học, Strict Mode, tiến độ
    ├── styles.css                    # Hệ thống biến màu Warm Charcoal / Light và style toàn cục
    ├── types.ts                      # Định nghĩa kiểu TypeScript cho bài học, bài tập, blueprint
    ├── i18n.ts                       # Từ điển giao diện song ngữ VI / EN
    ├── components/
    │   ├── BlueprintModal.tsx        # Cây thư mục dự án đích & luồng dữ liệu 4 trạm
    │   ├── CodeCell.tsx              # Khối hiển thị code kèm đánh số dòng, copy, tải file
    │   ├── CommandPalette.tsx        # Tìm kiếm nhanh toàn giáo trình (Ctrl+K / Cmd+K)
    │   ├── MicroLab.tsx              # Bài tập điền khuyết, trắc nghiệm, mô phỏng & Pyodide
    │   ├── RichText.tsx              # Render inline `code` và **bold** trong văn bản
    │   ├── SimulationCell.tsx        # Mô phỏng terminal, DataFrame, YOLO canvas, RAG trace
    │   └── StudyPromptModal.tsx      # Tạo prompt hỏi sâu theo ngữ cảnh từng bài học
    ├── data/
    │   ├── blueprint.ts              # Dữ liệu cây thư mục masvn-intelligence/
    │   ├── curriculum.ts             # Tổng hợp 7 học phần và logic khóa/mở khóa tuần tự
    │   ├── module1.ts .. module7.ts  # Nội dung chi tiết 36 bài học (Học phần 1 đến 7)
    │   └── troubleshooting.ts        # Danh sách lỗi thực tế (Windows, RTX 5060, Docker, Ollama)
    └── utils/
        ├── download.ts               # Xuất file .py, .ipynb (nbformat 4) và đóng gói .zip
        ├── pyodideRunner.ts          # Nạp và thực thi Python qua Pyodide WebAssembly
        └── sandboxSnippets.ts        # Code mẫu chạy thử tương ứng từng bước 1.1–7.4
```

---

## 5. Hướng dẫn sử dụng nhanh

- **Học tuần tự từng bước:** Hệ thống mở sẵn bước `1.1`. Hoàn thành bước hiện tại để mở khóa bước tiếp theo; các bước đã xong luôn giữ mở để xem lại.
- **Chế độ `Strict: ON/OFF`:** Khi bật `Strict: ON` trên thanh công cụ, người học cần vượt qua cả `Bài tập 1 (Điền khuyết)` và `Bài tập 2 (Kiểm tra hiểu bản chất)` ở Tab 3 trước khi mở khóa bước kế tiếp. Có thể chuyển sang `Strict: OFF` để tự quản lý tiến độ.
- **Phím tắt tìm kiếm:** Nhấn `Ctrl + K` (hoặc `Cmd + K` trên macOS) để tìm nhanh theo tên bài, tên file hoặc tên hàm đã mở khóa.
- **Xuất mã nguồn dự án đích:** Trong Tab `4. File hoàn chỉnh` hoặc hộp thoại `Cây thư mục dự án`, có thể tải từng file `.py`, `.ipynb` riêng lẻ hoặc bấm `Tải Project (.zip)` để tải toàn bộ cấu trúc thư mục `masvn-intelligence/`.
- **Lưu trữ tiến độ:** Tiến độ hoàn thành, trạng thái bài tập, ngôn ngữ (`VI` / `EN`) và giao diện (`Dark` / `Light`) được lưu tự động trong `localStorage` của trình duyệt. Dùng nút `Đặt lại tiến độ` ở cuối thanh bên trái nếu muốn học lại từ đầu.

---

## 6. Khắc phục sự cố cài đặt

- **Lỗi không nhận lệnh `npm` hoặc phiên bản Node quá cũ:** Cài đặt Node.js LTS (`>= 18`) từ trang chủ Node.js, đóng và mở lại terminal rồi kiểm tra bằng `node -v` và `npm -v`.
- **Cổng `5173` đã bị ứng dụng khác chiếm:** Chạy chỉ định cổng khác bằng `npm run dev -- --port 3000`.
- **Không chạy được khối `Pyodide Runtime`:** Kiểm tra kết nối mạng (cần truy cập `cdn.jsdelivr.net` ở lần chạy đầu tiên trong phiên trình duyệt). Nếu trình chặn quảng cáo/tường lửa chặn CDN ngoài, các tab lý thuyết, ghép code, điền khuyết, trắc nghiệm, mô phỏng và tải file vẫn hoạt động bình thường.
