import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Download,
  FolderTree,
  Lock,
  Menu,
  MessageSquare,
  Moon,
  Search,
  Sun,
} from 'lucide-react';
import {
  ALL_STEPS,
  CURRICULUM,
  getAdjacentSteps,
  getFrontierIndex,
  getStepById,
  isStepUnlocked,
} from './data/curriculum';
import { getTroubleshootingForStep } from './data/troubleshooting';
import { LabStatus, Lang, Theme } from './types';
import { UI_TEXT, t } from './i18n';
import { CodeCell } from './components/CodeCell';
import { MicroLab } from './components/MicroLab';
import { BlueprintModal } from './components/BlueprintModal';
import { StudyPromptModal } from './components/StudyPromptModal';
import { CommandPalette } from './components/CommandPalette';
import { RichText } from './components/RichText';
import { downloadFullProjectZip } from './utils/download';

type WorkspaceTab = 'theory' | 'builder' | 'lab' | 'complete';

const STORAGE_KEYS = {
  lang: 'masvn_studio_lang',
  theme: 'masvn_studio_theme',
  step: 'masvn_studio_active_step',
  completed: 'masvn_studio_completed_steps',
  labStatus: 'masvn_studio_lab_status',
  strictMode: 'masvn_studio_strict_mode',
};

export function App() {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.lang);
    return saved === 'en' ? 'en' : 'vi';
  });

  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.theme);
    return saved === 'light' ? 'light' : 'dark';
  });

  const [completedIds, setCompletedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.completed);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [labStatusByStep, setLabStatusByStep] = useState<Record<string, LabStatus>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.labStatus);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const [strictMode, setStrictMode] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.strictMode);
    return saved === 'false' ? false : true;
  });

  const [activeStepId, setActiveStepId] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.step) || '1.1';
    try {
      const rawDone = localStorage.getItem(STORAGE_KEYS.completed);
      const done: string[] = rawDone ? JSON.parse(rawDone) : [];
      return isStepUnlocked(saved, done) ? saved : ALL_STEPS[getFrontierIndex(done)].id;
    } catch {
      return '1.1';
    }
  });

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('theory');
  const [activeStageIdx, setActiveStageIdx] = useState<number>(0);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [blueprintOpen, setBlueprintOpen] = useState<boolean>(false);
  const [promptOpen, setPromptOpen] = useState<boolean>(false);
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);
  const [zipping, setZipping] = useState<boolean>(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.lang, lang);
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.theme, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.step, activeStepId);
    setActiveStageIdx(0);
  }, [activeStepId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.completed, JSON.stringify(completedIds));
    if (!isStepUnlocked(activeStepId, completedIds)) {
      setActiveStepId(ALL_STEPS[getFrontierIndex(completedIds)].id);
    }
  }, [completedIds, activeStepId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.labStatus, JSON.stringify(labStatusByStep));
  }, [labStatusByStep]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.strictMode, String(strictMode));
  }, [strictMode]);

  // Global Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const currentStep = useMemo(() => getStepById(activeStepId), [activeStepId]);
  const currentModule = useMemo(
    () => CURRICULUM.find((m) => m.id === currentStep.moduleId) || CURRICULUM[0],
    [currentStep.moduleId]
  );
  const { prev, next } = useMemo(() => getAdjacentSteps(activeStepId), [activeStepId]);
  const troubleshootingCases = useMemo(
    () => getTroubleshootingForStep(currentStep.id),
    [currentStep.id]
  );

  const moduleStepIndex = currentModule.steps.findIndex((s) => s.id === currentStep.id);

  const completeFilesForDisplay = useMemo(() => {
    if (currentStep.completeFiles && currentStep.completeFiles.length > 0) {
      return currentStep.completeFiles;
    }
    for (let i = currentModule.steps.length - 1; i >= 0; i--) {
      const candidate = currentModule.steps[i].completeFiles;
      if (candidate && candidate.length > 0) return candidate;
    }
    return [];
  }, [currentStep, currentModule]);

  const currentLabStatus: LabStatus = labStatusByStep[currentStep.id] || {
    blankOk: false,
    quizOk: false,
  };
  const labPassedCount =
    (currentLabStatus.blankOk ? 1 : 0) + (currentLabStatus.quizOk ? 1 : 0);
  const isLabPassed = currentLabStatus.blankOk && currentLabStatus.quizOk;
  const canMarkComplete = !strictMode || isLabPassed;

  const isStepCompleted = completedIds.includes(currentStep.id);
  const nextUnlocked = next ? isStepUnlocked(next.id, completedIds) : false;
  const completedCount = completedIds.length;
  const totalCount = ALL_STEPS.length;
  const progressPct = Math.round((completedCount / totalCount) * 100);

  const handleUpdateLabStatus = (stepId: string, patch: Partial<LabStatus>) => {
    setLabStatusByStep((prevMap) => {
      const existing = prevMap[stepId] || { blankOk: false, quizOk: false };
      return {
        ...prevMap,
        [stepId]: { ...existing, ...patch },
      };
    });
  };

  const toggleCompleted = (stepId: string) => {
    setCompletedIds((prevList) =>
      prevList.includes(stepId)
        ? prevList.filter((id) => id !== stepId)
        : [...prevList, stepId]
    );
  };

  const handleCompleteAndAdvance = () => {
    if (!canMarkComplete) return;
    if (!isStepCompleted) {
      setCompletedIds((prevList) =>
        prevList.includes(currentStep.id) ? prevList : [...prevList, currentStep.id]
      );
    }
    if (next) {
      setActiveStepId(next.id);
      setActiveTab('theory');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSelectStep = (stepId: string) => {
    if (!isStepUnlocked(stepId, completedIds)) return;
    setActiveStepId(stepId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleResetProgress = () => {
    setCompletedIds([]);
    setLabStatusByStep({});
    setActiveStepId('1.1');
    setActiveTab('theory');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDownloadZip = async () => {
    setZipping(true);
    try {
      await downloadFullProjectZip();
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="app-shell">
      {/* Compact Studio Toolbar */}
      <header className="topbar">
        <div className="topbar__left">
          <button
            type="button"
            className="btn-icon"
            onClick={() => setSidebarOpen((v) => !v)}
            title="Toggle sidebar"
          >
            <Menu size={16} />
          </button>
          <div className="brand">
            <span className="brand__name">{t(UI_TEXT.appTitle, lang)}</span>
            <span className="brand__sep">/</span>
            <span className="brand__sub">{t(UI_TEXT.appSubtitle, lang)}</span>
          </div>
        </div>

        <div className="topbar__right">
          <button
            type="button"
            className="btn-ghost-sm cmd-trigger"
            onClick={() => setPaletteOpen(true)}
            title="Ctrl+K"
          >
            <Search size={13} />
            <span>{lang === 'vi' ? 'Tìm kiếm' : 'Search'}</span>
            <kbd className="kbd-hint">Ctrl K</kbd>
          </button>

          <button
            type="button"
            className={`strict-toggle ${strictMode ? 'strict-toggle--on' : ''}`}
            onClick={() => setStrictMode((v) => !v)}
            title={
              lang === 'vi'
                ? 'Strict Mode: Bắt buộc làm đúng Bài tập 1 & 2 ở Tab 3 trước khi qua bước mới'
                : 'Strict Mode: Require passing Lab Exercises 1 & 2 before advancing'
            }
          >
            <span>Strict: {strictMode ? 'ON' : 'OFF'}</span>
          </button>

          <div className="progress-pill" title={t(UI_TEXT.overallProgress, lang)}>
            <div className="progress-pill__track">
              <div className="progress-pill__fill" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="progress-pill__text">
              {completedCount}/{totalCount}
            </span>
          </div>

          <button
            type="button"
            className="btn-ghost-sm"
            onClick={() => setBlueprintOpen(true)}
          >
            <FolderTree size={14} />
            <span>{t(UI_TEXT.blueprintBtn, lang)}</span>
          </button>

          <div className="seg-control" role="group" aria-label="Language switch">
            <button
              type="button"
              className={`seg-btn ${lang === 'vi' ? 'seg-btn--active' : ''}`}
              onClick={() => setLang('vi')}
            >
              VI
            </button>
            <button
              type="button"
              className={`seg-btn ${lang === 'en' ? 'seg-btn--active' : ''}`}
              onClick={() => setLang('en')}
            >
              EN
            </button>
          </div>

          <button
            type="button"
            className="btn-icon"
            onClick={() => setTheme((prevTheme) => (prevTheme === 'dark' ? 'light' : 'dark'))}
            title="Toggle Dark/Light mode"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      <div className="workspace-body">
        {/* Left Curriculum Sidebar */}
        {sidebarOpen && (
          <aside className="sidebar">
            <div className="sidebar__head">
              <span>{t(UI_TEXT.curriculumHeader, lang)}</span>
            </div>

            <nav className="sidebar__nav">
              {CURRICULUM.map((mod) => {
                const modDoneCount = mod.steps.filter((s) => completedIds.includes(s.id)).length;
                return (
                  <div key={mod.id} className="nav-module">
                    <div className="nav-module__title">
                      <span>{t(mod.title, lang)}</span>
                      <span className="nav-module__count">
                        {modDoneCount}/{mod.steps.length}
                      </span>
                    </div>
                    <div className="nav-steps">
                      {mod.steps.map((step) => {
                        const isActive = step.id === currentStep.id;
                        const isDone = completedIds.includes(step.id);
                        const unlocked = isStepUnlocked(step.id, completedIds);
                        return (
                          <button
                            type="button"
                            key={step.id}
                            disabled={!unlocked}
                            title={!unlocked ? t(UI_TEXT.actions.lockedStepHint, lang) : undefined}
                            onClick={() => handleSelectStep(step.id)}
                            className={`nav-step ${isActive ? 'nav-step--active' : ''} ${
                              !unlocked ? 'nav-step--locked' : ''
                            }`}
                          >
                            <span
                              className={`step-dot ${
                                isDone
                                  ? 'step-dot--done'
                                  : isActive
                                  ? 'step-dot--active'
                                  : !unlocked
                                  ? 'step-dot--locked'
                                  : ''
                              }`}
                            >
                              {isDone ? (
                                <Check size={10} strokeWidth={3} />
                              ) : !unlocked ? (
                                <Lock size={9} strokeWidth={2.4} />
                              ) : null}
                            </span>
                            <span className="nav-step__label">{t(step.title, lang)}</span>
                            <span className="tier-mono">S{step.tier}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </nav>

            <div className="sidebar__foot">
              <button
                type="button"
                className="btn-ghost-sm"
                onClick={handleResetProgress}
              >
                {t(UI_TEXT.actions.resetProgress, lang)}
              </button>
            </div>
          </aside>
        )}

        {/* Main Docs/Notebook Workspace */}
        <main className="main-pane">
          <div className="notebook-container">
            {/* De-carded Lesson Header directly on canvas */}
            <header className="lesson-header">
              <div className="lesson-meta-row">
                <span className="meta-mod">
                  {lang === 'vi' ? `Học phần ${currentModule.number}` : `Module ${currentModule.number}`}
                </span>
                <span className="meta-dot">·</span>
                <span className="meta-tier">
                  {t(UI_TEXT.stageLabels[currentStep.tier], lang)}
                </span>
                <span className="meta-dot">·</span>
                <code className="meta-file">{currentStep.targetFile}</code>
              </div>

              <h1 className="lesson-title">{t(currentStep.title, lang)}</h1>
              <p className="lesson-subtitle">
                <RichText text={t(currentStep.subtitle, lang)} />
              </p>
            </header>

            {/* 4 Workspace Mode Tabs */}
            <div className="mode-tabs" role="tablist">
              {(
                [
                  ['theory', UI_TEXT.tabs.theory],
                  ['builder', UI_TEXT.tabs.builder],
                  ['lab', UI_TEXT.tabs.lab],
                  ['complete', UI_TEXT.tabs.complete],
                ] as const
              ).map(([tabKey, tabLabel]) => (
                <button
                  type="button"
                  key={tabKey}
                  role="tab"
                  aria-selected={activeTab === tabKey}
                  className={`mode-tab ${activeTab === tabKey ? 'mode-tab--active' : ''}`}
                  onClick={() => setActiveTab(tabKey)}
                >
                  {t(tabLabel, lang)}
                  {tabKey === 'lab' && (
                    <span className={`tab-lab-badge ${isLabPassed ? 'tab-lab-badge--ok' : ''}`}>
                      {labPassedCount}/2
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* TAB 1: Theory, API & Troubleshooting */}
            {activeTab === 'theory' && (
              <div className="tab-flow">
                <section className="doc-section">
                  <h3 className="doc-h3">{t(UI_TEXT.sections.whyTitle, lang)}</h3>
                  <p className="prose-p">
                    <RichText text={t(currentStep.whyAndWhat.why, lang)} />
                  </p>
                  <div className="callout-warn">
                    <div className="callout-warn__label">
                      {t(UI_TEXT.sections.ifMissingTitle, lang)}
                    </div>
                    <p>
                      <RichText text={t(currentStep.whyAndWhat.ifMissing, lang)} />
                    </p>
                  </div>
                </section>

                <section className="doc-section">
                  <h3 className="doc-h3">{t(UI_TEXT.sections.apiTitle, lang)}</h3>
                  <div className="api-table-wrap">
                    <table className="api-table">
                      <thead>
                        <tr>
                          <th>{t(UI_TEXT.sections.colSymbol, lang)}</th>
                          <th>{t(UI_TEXT.sections.colParams, lang)}</th>
                          <th>{t(UI_TEXT.sections.colInput, lang)}</th>
                          <th>{t(UI_TEXT.sections.colOutput, lang)}</th>
                          <th>{t(UI_TEXT.sections.colDesc, lang)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentStep.apiAnatomy.map((row, idx) => (
                          <tr key={idx}>
                            <td>
                              <code className="api-sym">{row.symbol}</code>
                            </td>
                            <td>
                              <code className="api-mono">{row.params}</code>
                            </td>
                            <td className="api-mono-cell">{row.inputType}</td>
                            <td className="api-mono-cell">{row.outputType}</td>
                            <td>
                              <RichText text={t(row.description, lang)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="doc-section">
                  <h3 className="doc-h3">{t(UI_TEXT.sections.stagesTitle, lang)}</h3>

                  <div className="stage-switcher">
                    {currentStep.progressiveStages.map((st, idx) => (
                      <button
                        type="button"
                        key={st.tier}
                        className={`stage-btn ${activeStageIdx === idx ? 'stage-btn--active' : ''}`}
                        onClick={() => setActiveStageIdx(idx)}
                      >
                        <span className="tier-mono">S{st.tier}</span>
                        <span>{t(st.title, lang)}</span>
                      </button>
                    ))}
                  </div>

                  {currentStep.progressiveStages[activeStageIdx] && (
                    <div className="stage-body">
                      <p className="prose-p">
                        <RichText text={t(currentStep.progressiveStages[activeStageIdx].summary, lang)} />
                      </p>
                      <CodeCell
                        code={currentStep.progressiveStages[activeStageIdx].code}
                        lang={lang}
                        compact
                      />
                      <div className="stage-note">
                        <RichText text={t(currentStep.progressiveStages[activeStageIdx].expectedNote, lang)} />
                      </div>
                    </div>
                  )}
                </section>

                {troubleshootingCases.length > 0 && (
                  <section className="doc-section">
                    <h3 className="doc-h3">
                      {lang === 'vi'
                        ? '4. Sửa lỗi thực chiến (Windows & RTX 5060)'
                        : '4. Common Errors & Debugging'}
                    </h3>
                    <div className="debug-list">
                      {troubleshootingCases.map((item, idx) => (
                        <div key={idx} className="debug-item">
                          <div className="debug-item__symptom">
                            {t(item.symptom, lang)}
                          </div>
                          <pre className="debug-item__trace">{item.traceback}</pre>
                          <div className="debug-item__grid">
                            <div>
                              <span className="debug-label">
                                {lang === 'vi' ? 'Nguyên nhân' : 'Root cause'}
                              </span>
                              <p>
                                <RichText text={t(item.cause, lang)} />
                              </p>
                            </div>
                            <div>
                              <span className="debug-label debug-label--fix">
                                {lang === 'vi' ? 'Cách khắc phục' : 'Fix'}
                              </span>
                              <p>
                                <RichText text={t(item.fix, lang)} />
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* TAB 2: Step-by-Step Builder */}
            {activeTab === 'builder' && (
              <div className="tab-flow">
                <section className="doc-section">
                  <h3 className="doc-h3">
                    <span className="build-counter">
                      [{moduleStepIndex + 1}/{currentModule.steps.length}]
                    </span>{' '}
                    {t(currentStep.builderTitle, lang)}
                  </h3>
                  <p className="prose-p">
                    <RichText text={t(currentStep.builderExplanation, lang)} />
                  </p>

                  <div className="module-stepper">
                    <div className="module-stepper__track">
                      {currentModule.steps.map((s) => {
                        const unlocked = isStepUnlocked(s.id, completedIds);
                        return (
                          <button
                            type="button"
                            key={s.id}
                            disabled={!unlocked}
                            title={!unlocked ? t(UI_TEXT.actions.lockedStepHint, lang) : undefined}
                            onClick={() => handleSelectStep(s.id)}
                            className={`stepper-node ${
                              s.id === currentStep.id ? 'stepper-node--active' : ''
                            } ${completedIds.includes(s.id) ? 'stepper-node--done' : ''} ${
                              !unlocked ? 'stepper-node--locked' : ''
                            }`}
                          >
                            {!unlocked && <Lock size={10} />}
                            <span>{s.id}</span>
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={currentModule.steps.length - 1}
                      value={moduleStepIndex}
                      onChange={(e) => {
                        const chosen = currentModule.steps[Number(e.target.value)];
                        if (chosen && isStepUnlocked(chosen.id, completedIds)) {
                          handleSelectStep(chosen.id);
                        }
                      }}
                      className="stepper-slider"
                      aria-label="Step builder slider"
                    />
                  </div>

                  <CodeCell
                    code={currentStep.builderCode}
                    filename={currentStep.targetFile}
                    highlightLines={currentStep.highlightLines}
                    lang={lang}
                  />
                </section>

                <section className="doc-section">
                  <h3 className="doc-h3">{t(UI_TEXT.sections.walkthroughTitle, lang)}</h3>
                  <div className="walkthrough-list">
                    {currentStep.lineWalkthrough.map((item, idx) => (
                      <div key={idx} className="walkthrough-item">
                        <div className="walkthrough-item__code">
                          <span className="walkthrough-ln">{item.lines}</span>
                          <pre>{item.snippet}</pre>
                        </div>
                        <p className="walkthrough-item__exp">
                          <RichText text={t(item.explanation, lang)} />
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* TAB 3: Interactive Micro-Lab + Pyodide */}
            {activeTab === 'lab' && (
              <MicroLab
                stepId={currentStep.id}
                fillBlank={currentStep.fillBlank}
                quiz={currentStep.quiz}
                simulation={currentStep.simulation}
                labStatus={currentLabStatus}
                onUpdateLabStatus={handleUpdateLabStatus}
                lang={lang}
              />
            )}

            {/* TAB 4: Complete File(s) + Full Project Zip */}
            {activeTab === 'complete' && (
              <div className="tab-flow">
                <div className="zip-banner">
                  <div>
                    <div className="zip-banner__title">
                      {lang === 'vi'
                        ? 'Tải trọn bộ khung thư mục dự án (masvn-intelligence.zip)'
                        : 'Download Full Project Skeleton (masvn-intelligence.zip)'}
                    </div>
                    <div className="zip-banner__sub">
                      {lang === 'vi'
                        ? 'Gồm đầy đủ data/, models/, notebooks/ (.ipynb), scripts/, src/, tests/, api/, app.py, requirements.txt và README.md.'
                        : 'Includes data/, models/, notebooks/ (.ipynb), scripts/, src/, tests/, api/, app.py, requirements.txt, and README.md.'}
                    </div>
                  </div>
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
                        : 'Download .zip'}
                    </span>
                  </button>
                </div>

                {completeFilesForDisplay.map((file) => (
                  <section key={file.path} className="doc-section">
                    <h3 className="doc-h3">
                      <code className="inline-code">{file.path}</code>
                    </h3>
                    <CodeCell
                      code={file.code}
                      filename={file.path}
                      language={file.language}
                      downloadable={file}
                      lang={lang}
                    />
                  </section>
                ))}
              </div>
            )}

            {/* Lesson Footer */}
            <footer className="lesson-footer">
              <div className="checkpoint-block">
                <div className="checkpoint-block__left">
                  <h3 className="doc-h3-sm">{t(UI_TEXT.sections.checkpointTitle, lang)}</h3>
                  <ul className="checkpoint-list">
                    {currentStep.checkpointItems.map((item, i) => (
                      <li key={i}>
                        <RichText text={t(item, lang)} />
                      </li>
                    ))}
                  </ul>
                  {strictMode && !isStepCompleted && !isLabPassed && (
                    <div className="strict-hint-row">
                      <span>
                        {lang === 'vi'
                          ? `Strict Mode đang bật: Cần làm đúng Bài tập 1 & 2 ở Tab 3 (${labPassedCount}/2) để mở bước tiếp theo.`
                          : `Strict Mode is ON: Pass Lab Exercises 1 & 2 in Tab 3 (${labPassedCount}/2) to unlock next step.`}
                      </span>
                      {activeTab !== 'lab' && (
                        <button
                          type="button"
                          className="btn-link-inline"
                          onClick={() => {
                            setActiveTab('lab');
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                        >
                          {lang === 'vi' ? 'Đi tới Tab 3 →' : 'Go to Lab →'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="checkpoint-actions">
                  {!isStepCompleted && next ? (
                    <button
                      type="button"
                      disabled={!canMarkComplete}
                      className={canMarkComplete ? 'btn-primary-sm' : 'btn-ghost-sm'}
                      onClick={handleCompleteAndAdvance}
                    >
                      {canMarkComplete ? <Check size={14} /> : <Lock size={13} />}
                      <span>{t(UI_TEXT.actions.completeAndNext, lang)}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!isStepCompleted && !canMarkComplete}
                      className={
                        isStepCompleted
                          ? 'btn-done-active'
                          : canMarkComplete
                          ? 'btn-primary-sm'
                          : 'btn-ghost-sm'
                      }
                      onClick={() => toggleCompleted(currentStep.id)}
                    >
                      <Check size={14} />
                      <span>
                        {isStepCompleted
                          ? t(UI_TEXT.actions.completed, lang)
                          : t(UI_TEXT.actions.markDone, lang)}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn-ghost-sm"
                    onClick={() => setPromptOpen(true)}
                  >
                    <MessageSquare size={14} />
                    <span>{t(UI_TEXT.actions.generatePrompt, lang)}</span>
                  </button>
                </div>
              </div>

              <div className="docs-pager">
                {prev ? (
                  <button
                    type="button"
                    className="pager-btn pager-btn--prev"
                    onClick={() => handleSelectStep(prev.id)}
                  >
                    <span className="pager-btn__dir">{t(UI_TEXT.actions.prevStep, lang)}</span>
                    <span className="pager-btn__title">{t(prev.title, lang)}</span>
                  </button>
                ) : (
                  <div />
                )}

                {next ? (
                  <button
                    type="button"
                    disabled={!nextUnlocked}
                    className={`pager-btn pager-btn--next ${
                      !nextUnlocked ? 'pager-btn--locked' : ''
                    }`}
                    onClick={() => nextUnlocked && handleSelectStep(next.id)}
                  >
                    <span className="pager-btn__dir">
                      {!nextUnlocked && <Lock size={11} />}
                      <span>{t(UI_TEXT.actions.nextStep, lang)}</span>
                    </span>
                    <span className="pager-btn__title">
                      {nextUnlocked ? t(next.title, lang) : t(UI_TEXT.actions.lockedStepHint, lang)}
                    </span>
                  </button>
                ) : (
                  <div />
                )}
              </div>
            </footer>
          </div>
        </main>
      </div>

      <BlueprintModal
        open={blueprintOpen}
        onClose={() => setBlueprintOpen(false)}
        onJumpToStep={(stepId) => handleSelectStep(stepId)}
        completedIds={completedIds}
        lang={lang}
      />

      <StudyPromptModal
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        step={currentStep}
        lang={lang}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelectStep={(stepId) => handleSelectStep(stepId)}
        completedIds={completedIds}
        lang={lang}
      />
    </div>
  );
}

export default App;
