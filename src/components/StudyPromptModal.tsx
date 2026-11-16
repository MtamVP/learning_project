import React, { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { Lang, SubLesson } from '../types';
import { UI_TEXT, t } from '../i18n';

interface StudyPromptModalProps {
  open: boolean;
  onClose: () => void;
  step: SubLesson;
  lang: Lang;
}

export const StudyPromptModal: React.FC<StudyPromptModalProps> = ({
  open,
  onClose,
  step,
  lang,
}) => {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const apis = step.studyApis.join(', ');
  const promptText =
    lang === 'vi'
      ? `Tôi là sinh viên năm 2 ngành Khoa học Máy tính, đang làm project cuối kỳ MASVN Market Intelligence Engine trên máy cá nhân (RTX 5060 8GB VRAM, 24GB RAM). Hãy giải thích sâu hơn kèm ví dụ thực hành cho tôi về [${t(step.title, 'vi')} — Các API: ${apis}], tập trung đúng vào các hàm tôi đang dùng trong project chứ không học lan man lý thuyết hàn lâm.`
      : `I am a 2nd-year Computer Science student building the MASVN Market Intelligence Engine capstone project locally (RTX 5060 8GB VRAM, 24GB RAM). Please explain [${t(step.title, 'en')} — APIs: ${apis}] in depth with practical examples, focusing strictly on the functions used in this project rather than broad academic theory.`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{t(UI_TEXT.sections.studyBuddyTitle, lang)}</h2>
            <p className="modal-sub">{t(step.title, lang)}</p>
          </div>
          <button type="button" className="btn-ghost-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <textarea className="prompt-textarea" readOnly value={promptText} rows={6} />

        <div className="modal-footer">
          <button type="button" className="btn-primary-sm" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? t(UI_TEXT.actions.copied, lang) : t(UI_TEXT.actions.copyPrompt, lang)}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
