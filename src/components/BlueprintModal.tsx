import React, { useState } from 'react';
import { FileCode, Folder, ArrowRight, Download, Lock, X } from 'lucide-react';
import { BlueprintNode, Lang } from '../types';
import { PROJECT_BLUEPRINT } from '../data/blueprint';
import { isStepUnlocked } from '../data/curriculum';
import { UI_TEXT, t } from '../i18n';
import { RichText } from './RichText';
import { downloadFullProjectZip } from '../utils/download';

interface BlueprintModalProps {
  open: boolean;
  onClose: () => void;
  onJumpToStep: (stepId: string) => void;
  completedIds: string[];
  lang: Lang;
}

const PIPELINE_STAGES = [
  { id: '1.8', label: { vi: 'Thu thập · Playwright', en: 'Ingestion · Playwright' }, sub: 'scripts/ + src/scraper.py' },
  { id: '3.2', label: { vi: 'Trạm 1 · Extractor', en: 'Station 1 · Extractor' }, sub: 'src/extractor.py' },
  { id: '3.4', label: { vi: 'Trạm 2 · Table Parser', en: 'Station 2 · Table Parser' }, sub: 'src/table_parser.py' },
  { id: '4.4', label: { vi: 'Trạm 3 · LightGBM', en: 'Station 3 · LightGBM' }, sub: 'src/ml_scorer.py' },
  { id: '5.4', label: { vi: 'Trạm 4 · Hybrid RAG', en: 'Station 4 · Hybrid RAG' }, sub: 'src/rag_engine.py' },
  { id: '6.1', label: { vi: 'UI · Streamlit 2 Tab', en: 'UI · 2-Tab Streamlit' }, sub: 'app.py' },
];

export const BlueprintModal: React.FC<BlueprintModalProps> = ({
  open,
  onClose,
  onJumpToStep,
  completedIds,
  lang,
}) => {
  const [selected, setSelected] = useState<BlueprintNode>(
    PROJECT_BLUEPRINT.find((n) => n.linkedStepId === '1.7') || PROJECT_BLUEPRINT[0]
  );
  const [zipping, setZipping] = useState(false);

  if (!open) return null;

  const handleDownloadZip = async () => {
    setZipping(true);
    try {
      await downloadFullProjectZip();
    } finally {
      setZipping(false);
    }
  };

  const selectedUnlocked = selected.linkedStepId
    ? isStepUnlocked(selected.linkedStepId, completedIds)
    : false;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel modal-panel--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{t(UI_TEXT.blueprint.title, lang)}</h2>
            <p className="modal-sub">{t(UI_TEXT.blueprint.subtitle, lang)}</p>
          </div>
          <div className="code-cell__actions">
            <button
              type="button"
              className="btn-primary-sm"
              disabled={zipping}
              onClick={handleDownloadZip}
            >
              <Download size={14} />
              <span>
                {zipping
                  ? lang === 'vi'
                    ? 'Đang nén .zip...'
                    : 'Zipping...'
                  : lang === 'vi'
                  ? 'Tải Project (.zip)'
                  : 'Download Project (.zip)'}
              </span>
            </button>
            <button type="button" className="btn-ghost-sm" onClick={onClose}>
              <X size={15} />
              <span>{t(UI_TEXT.actions.close, lang)}</span>
            </button>
          </div>
        </div>

        <div className="pipeline-strip">
          <div className="pipeline-strip__label">{t(UI_TEXT.blueprint.pipelineFlowTitle, lang)}</div>
          <div className="pipeline-strip__nodes">
            {PIPELINE_STAGES.map((stage, i) => {
              const unlocked = isStepUnlocked(stage.id, completedIds);
              return (
                <React.Fragment key={stage.id}>
                  <button
                    type="button"
                    disabled={!unlocked}
                    className={`pipeline-node ${!unlocked ? 'pipeline-node--locked' : ''}`}
                    title={!unlocked ? t(UI_TEXT.actions.lockedStepHint, lang) : undefined}
                    onClick={() => {
                      if (!unlocked) return;
                      onJumpToStep(stage.id);
                      onClose();
                    }}
                  >
                    <span className="pipeline-node__title">
                      {!unlocked && <Lock size={11} />}
                      {t(stage.label, lang)}
                    </span>
                    <span className="pipeline-node__sub">{stage.sub}</span>
                  </button>
                  {i < PIPELINE_STAGES.length - 1 && (
                    <ArrowRight size={13} className="pipeline-arrow" />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div className="blueprint-grid">
          <div className="blueprint-tree">
            {PROJECT_BLUEPRINT.map((node) => {
              const isSelected = selected.path === node.path;
              const nodeUnlocked = node.linkedStepId
                ? isStepUnlocked(node.linkedStepId, completedIds)
                : true;
              return (
                <button
                  type="button"
                  key={node.path}
                  onClick={() => setSelected(node)}
                  className={`tree-row ${isSelected ? 'tree-row--active' : ''}`}
                  style={{ paddingLeft: `${12 + node.depth * 18}px` }}
                >
                  {node.type === 'dir' ? (
                    <Folder size={14} className="tree-icon tree-icon--dir" />
                  ) : (
                    <FileCode size={14} className="tree-icon tree-icon--file" />
                  )}
                  <span className="tree-name">{node.name}</span>
                  {node.linkedStepId && (
                    <span className={`tree-step-tag ${!nodeUnlocked ? 'tree-step-tag--locked' : ''}`}>
                      {!nodeUnlocked && <Lock size={10} />}
                      {node.linkedStepId}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="blueprint-detail">
            <div className="blueprint-detail__path">{selected.path}</div>
            <p className="blueprint-detail__role">
              <RichText text={t(selected.role, lang)} />
            </p>

            {selected.linkedStepId ? (
              selectedUnlocked ? (
                <button
                  type="button"
                  className="btn-primary-sm"
                  onClick={() => {
                    onJumpToStep(selected.linkedStepId!);
                    onClose();
                  }}
                >
                  <span>
                    {t(UI_TEXT.actions.jumpToLesson, lang)} ({selected.linkedStepId})
                  </span>
                  <ArrowRight size={14} />
                </button>
              ) : (
                <div className="blueprint-locked-note">
                  <Lock size={13} />
                  <span>
                    {lang === 'vi'
                      ? `Bài ${selected.linkedStepId} đang khóa — hoàn thành các bước trước đó để mở.`
                      : `Step ${selected.linkedStepId} is locked — complete prior steps first.`}
                  </span>
                </div>
              )
            ) : (
              <div className="blueprint-detail__note">
                {lang === 'vi'
                  ? 'Thư mục tổ chức lưu trữ dữ liệu cho các bước kế tiếp.'
                  : 'Organizational directory shared across pipeline stages.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
