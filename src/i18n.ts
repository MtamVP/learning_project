import { Lang } from './types';

export const UI_TEXT = {
  appTitle: {
    vi: 'MASVN Market Intelligence',
    en: 'MASVN Market Intelligence',
  },
  appSubtitle: {
    vi: 'Tài liệu thực hành xây dựng hệ thống A–Z',
    en: 'End-to-End Engineering Handbook',
  },
  blueprintBtn: {
    vi: 'Cây thư mục dự án',
    en: 'Project Blueprint',
  },
  curriculumHeader: {
    vi: 'Lộ trình 7 Học phần',
    en: '7-Module Curriculum',
  },
  overallProgress: {
    vi: 'Tiến độ',
    en: 'Progress',
  },
  stageLabels: {
    1: { vi: 'Tầng 1 · Cơ bản', en: 'Stage 1 · Foundations' },
    2: { vi: 'Tầng 2 · Xử lý thực tế', en: 'Stage 2 · Edge Cases' },
    3: { vi: 'Tầng 3 · Ghép Production', en: 'Stage 3 · Production' },
  },
  tabs: {
    theory: { vi: '1. Lý thuyết & API', en: '1. Theory & API' },
    builder: { vi: '2. Ghép code từng bước', en: '2. Step-by-Step Builder' },
    lab: { vi: '3. Thực hành & Chạy thử', en: '3. Lab & Run' },
    complete: { vi: '4. File hoàn chỉnh', en: '4. Complete File' },
  },
  sections: {
    whyTitle: { vi: '1. Mục tiêu', en: '1. Goal' },
    ifMissingTitle: { vi: 'Nếu thiếu bước này:', en: 'Without this step:' },
    apiTitle: { vi: '2. Chi tiết hàm & Tham số', en: '2. Functions & Parameters' },
    colSymbol: { vi: 'Hàm / Lớp', en: 'Symbol' },
    colParams: { vi: 'Tham số', en: 'Parameters' },
    colInput: { vi: 'Đầu vào', en: 'Input' },
    colOutput: { vi: 'Đầu ra', en: 'Output' },
    colDesc: { vi: 'Ghi chú thực tế', en: 'Notes' },
    stagesTitle: {
      vi: '3. Lộ trình 3 tầng: Từ ví dụ nhỏ đến code thực tế',
      en: '3. Three-Stage Progression: Toy Example to Production',
    },
    builderTitle: { vi: 'Ghép dần mã nguồn qua từng bước', en: 'Incremental Code Assembly' },
    walkthroughTitle: { vi: 'Giải thích từng khối lệnh', en: 'Line-by-Line Notes' },
    fillBlankTitle: { vi: 'Bài tập 1 · Điền khuyết mã nguồn', en: 'Exercise 1 · Fill in the Blanks' },
    quizTitle: { vi: 'Bài tập 2 · Kiểm tra hiểu bản chất', en: 'Exercise 2 · Concept Check' },
    simTitle: { vi: 'Chạy thử mô phỏng', en: 'Simulated Run' },
    checkpointTitle: { vi: 'Kiểm tra hoàn thành bước này', en: 'Step Checkpoint' },
    studyBuddyTitle: { vi: 'Tạo Prompt hỏi sâu thêm', en: 'Study Prompt Generator' },
  },
  actions: {
    prevStep: { vi: '← Bước trước', en: '← Previous Step' },
    nextStep: { vi: 'Bước tiếp theo →', en: 'Next Step →' },
    copyCode: { vi: 'Sao chép', en: 'Copy' },
    copied: { vi: 'Đã chép', en: 'Copied' },
    downloadPy: { vi: 'Tải file', en: 'Download' },
    downloadIpynb: { vi: 'Tải .ipynb', en: 'Download .ipynb' },
    runSim: { vi: 'Chạy thử', en: 'Run' },
    running: { vi: 'Đang chạy...', en: 'Running...' },
    checkAnswers: { vi: 'Kiểm tra đáp án', en: 'Check' },
    showHint: { vi: 'Gợi ý', en: 'Hint' },
    markDone: { vi: 'Đánh dấu hoàn thành', en: 'Mark as completed' },
    completeAndNext: { vi: 'Hoàn thành & Mở bước tiếp theo', en: 'Complete & Unlock Next' },
    completed: { vi: 'Đã hoàn thành', en: 'Completed' },
    lockedStepHint: {
      vi: 'Hoàn thành bước hiện tại để mở khóa',
      en: 'Complete the current step to unlock',
    },
    lockedBadge: { vi: 'Đang khóa', en: 'Locked' },
    generatePrompt: { vi: 'Tạo Prompt hỏi sâu thêm', en: 'Generate Study Prompt' },
    copyPrompt: { vi: 'Chép Prompt', en: 'Copy Prompt' },
    jumpToLesson: { vi: 'Mở bài học viết file này', en: 'Open lesson for this file' },
    close: { vi: 'Đóng', en: 'Close' },
    resetProgress: { vi: 'Đặt lại tiến độ', en: 'Reset Progress' },
  },
  blueprint: {
    title: {
      vi: 'Cây thư mục chuẩn (masvn-intelligence/)',
      en: 'Project Directory Tree (masvn-intelligence/)',
    },
    subtitle: {
      vi: 'Chọn bất kỳ file nào bên trái để xem vai trò, 4 trạm xử lý dữ liệu và nhảy tới bài học tương ứng.',
      en: 'Select any file on the left to inspect its role, the 4-station runtime pipeline, and jump to its lesson.',
    },
    pipelineFlowTitle: {
      vi: '4 Trạm Xử lý Dữ liệu (End-to-End Runtime Pipeline)',
      en: '4-Station End-to-End Runtime Pipeline',
    },
  },
};

export function t(obj: { vi: string; en: string }, lang: Lang): string {
  return obj[lang];
}
