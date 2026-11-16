import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Search, X } from 'lucide-react';
import { ALL_STEPS, isStepUnlocked } from '../data/curriculum';
import { Lang } from '../types';
import { UI_TEXT, t } from '../i18n';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelectStep: (stepId: string) => void;
  completedIds: string[];
  lang: Lang;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  onSelectStep,
  completedIds,
  lang,
}) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_STEPS;
    return ALL_STEPS.filter((step) => {
      const hay = [
        step.id,
        step.title.vi,
        step.title.en,
        step.subtitle.vi,
        step.subtitle.en,
        step.targetFile,
        ...step.studyApis,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (results.length > 0 ? (c + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) =>
        results.length > 0 ? (c - 1 + results.length) % results.length : 0
      );
    } else if (e.key === 'Enter' && results[cursor]) {
      const chosen = results[cursor];
      if (isStepUnlocked(chosen.id, completedIds)) {
        onSelectStep(chosen.id);
        onClose();
      }
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel cmd-panel"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="cmd-input-row">
          <Search size={15} className="cmd-search-icon" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              lang === 'vi'
                ? 'Tìm bước học, file (src/table_parser.py), hoặc hàm (force=True, SimpleImputer)...'
                : 'Search steps, files (src/table_parser.py), or APIs (force=True, SimpleImputer)...'
            }
            className="cmd-input"
          />
          <button type="button" className="btn-ghost-sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="cmd-list">
          {results.length === 0 ? (
            <div className="cmd-empty">
              {lang === 'vi' ? 'Không tìm thấy bài học phù hợp.' : 'No matching steps found.'}
            </div>
          ) : (
            results.map((step, idx) => {
              const unlocked = isStepUnlocked(step.id, completedIds);
              const isDone = completedIds.includes(step.id);
              const isSelected = idx === cursor;
              return (
                <button
                  type="button"
                  key={step.id}
                  disabled={!unlocked}
                  onMouseEnter={() => setCursor(idx)}
                  onClick={() => {
                    if (!unlocked) return;
                    onSelectStep(step.id);
                    onClose();
                  }}
                  className={`cmd-item ${isSelected ? 'cmd-item--active' : ''} ${
                    !unlocked ? 'cmd-item--locked' : ''
                  }`}
                >
                  <div className="cmd-item__main">
                    <span className="cmd-item__title">{t(step.title, lang)}</span>
                    <span className="cmd-item__meta">
                      <code>{step.targetFile}</code>
                      <span>·</span>
                      <span>{step.studyApis.slice(0, 3).join(', ')}</span>
                    </span>
                  </div>
                  <div className="cmd-item__right">
                    {!unlocked ? (
                      <span className="cmd-tag cmd-tag--locked">
                        <Lock size={10} />
                        {t(UI_TEXT.actions.lockedBadge, lang)}
                      </span>
                    ) : isDone ? (
                      <span className="cmd-tag cmd-tag--done">
                        {t(UI_TEXT.actions.completed, lang)}
                      </span>
                    ) : (
                      <span className="cmd-tag cmd-tag--open">
                        {lang === 'vi' ? 'Đang mở' : 'Unlocked'}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
