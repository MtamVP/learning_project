import React, { useEffect, useState } from 'react';
import { Check, Play, RotateCcw, Terminal } from 'lucide-react';
import { FillBlankExercise, LabStatus, Lang, QuizQuestion, SimulationSpec } from '../types';
import { UI_TEXT, t } from '../i18n';
import { SimulationCell } from './SimulationCell';
import { RichText } from './RichText';
import { getSandboxCode } from '../utils/sandboxSnippets';
import { PyodideRunResult, runPythonInBrowser } from '../utils/pyodideRunner';

interface MicroLabProps {
  stepId: string;
  fillBlank: FillBlankExercise;
  quiz: QuizQuestion;
  simulation: SimulationSpec;
  labStatus: LabStatus;
  onUpdateLabStatus: (stepId: string, patch: Partial<LabStatus>) => void;
  lang: Lang;
}

export const MicroLab: React.FC<MicroLabProps> = ({
  stepId,
  fillBlank,
  quiz,
  simulation,
  labStatus,
  onUpdateLabStatus,
  lang,
}) => {
  const [inputs, setInputs] = useState<string[]>([]);
  const [checkedBlank, setCheckedBlank] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [selectedQuiz, setSelectedQuiz] = useState<number | null>(null);

  // Pyodide Sandbox state
  const [sandboxCode, setSandboxCode] = useState<string>(() => getSandboxCode(stepId));
  const [pyRunning, setPyRunning] = useState(false);
  const [pyResult, setPyResult] = useState<PyodideRunResult | null>(null);

  useEffect(() => {
    setInputs(
      labStatus.blankOk ? [...fillBlank.answers] : fillBlank.answers.map(() => '')
    );
    setCheckedBlank(labStatus.blankOk);
    setShowHints(false);
    setSelectedQuiz(labStatus.quizOk ? quiz.correctIndex : null);
    setSandboxCode(getSandboxCode(stepId));
    setPyResult(null);
  }, [stepId, fillBlank, quiz.correctIndex, labStatus.blankOk, labStatus.quizOk]);

  const handleBlankChange = (idx: number, val: string) => {
    setInputs((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
    setCheckedBlank(false);
  };

  const allBlankCorrect =
    fillBlank.answers.length > 0 &&
    fillBlank.answers.every(
      (ans, idx) => (inputs[idx] || '').trim() === ans.trim()
    );

  const handleCheckBlanks = () => {
    setCheckedBlank(true);
    if (allBlankCorrect && !labStatus.blankOk) {
      onUpdateLabStatus(stepId, { blankOk: true });
    }
  };

  const handleSelectQuiz = (idx: number) => {
    setSelectedQuiz(idx);
    if (idx === quiz.correctIndex && !labStatus.quizOk) {
      onUpdateLabStatus(stepId, { quizOk: true });
    }
  };

  const handleRunPyodide = async () => {
    setPyRunning(true);
    const res = await runPythonInBrowser(sandboxCode);
    setPyResult(res);
    setPyRunning(false);
  };

  const renderTemplate = () => {
    const parts = fillBlank.codeTemplate.split(/(___\d+___)/g);
    return (
      <pre className="fill-code">
        {parts.map((part, i) => {
          const match = /^___(\d+)___$/.exec(part);
          if (!match) return <span key={i}>{part}</span>;
          const idx = Number(match[1]);
          const val = inputs[idx] || '';
          const expected = fillBlank.answers[idx] || '';
          const isOk = checkedBlank && val.trim() === expected.trim();
          const isErr = checkedBlank && val.trim() !== expected.trim();
          return (
            <input
              key={`${stepId}-blank-${i}`}
              type="text"
              value={val}
              onChange={(e) => handleBlankChange(idx, e.target.value)}
              placeholder={`#${idx + 1}`}
              size={Math.max(expected.length + 2, 8)}
              className={`blank-input ${
                isOk ? 'blank-input--ok' : isErr ? 'blank-input--err' : ''
              }`}
              aria-label={`Blank ${idx + 1}`}
            />
          );
        })}
      </pre>
    );
  };

  return (
    <div className="lab-stack">
      <section className="doc-section">
        <div className="lab-title-row">
          <h3 className="doc-h3">{t(UI_TEXT.sections.fillBlankTitle, lang)}</h3>
          {labStatus.blankOk && (
            <span className="lab-pass-tag">
              <Check size={12} />
              <span>{lang === 'vi' ? 'Đã đạt' : 'Passed'}</span>
            </span>
          )}
        </div>
        <p className="prose-p">
          <RichText text={t(fillBlank.prompt, lang)} />
        </p>

        {renderTemplate()}

        <div className="lab-actions">
          <button
            type="button"
            className="btn-primary-sm"
            onClick={handleCheckBlanks}
          >
            {t(UI_TEXT.actions.checkAnswers, lang)}
          </button>
          <button
            type="button"
            className="btn-ghost-sm"
            onClick={() => setShowHints((v) => !v)}
          >
            {t(UI_TEXT.actions.showHint, lang)}
          </button>
          {checkedBlank && (
            <span
              className={`status-msg ${
                allBlankCorrect ? 'status-msg--ok' : 'status-msg--err'
              }`}
            >
              {allBlankCorrect
                ? lang === 'vi'
                  ? 'Chính xác.'
                  : 'All blanks correct.'
                : lang === 'vi'
                ? 'Chưa khớp — kiểm tra lại chữ hoa/thường hoặc xem gợi ý.'
                : 'Not quite right — check casing or open hints.'}
            </span>
          )}
        </div>

        {showHints && (
          <ul className="hint-list">
            {fillBlank.hints.map((h, i) => (
              <li key={i}>
                <strong>#{i + 1}:</strong> <RichText text={t(h, lang)} />
              </li>
            ))}
          </ul>
        )}

        {checkedBlank && allBlankCorrect && (
          <div className="feedback-box feedback-box--ok">
            <RichText text={t(fillBlank.explanation, lang)} />
          </div>
        )}
      </section>

      <section className="doc-section">
        <div className="lab-title-row">
          <h3 className="doc-h3">{t(UI_TEXT.sections.quizTitle, lang)}</h3>
          {labStatus.quizOk && (
            <span className="lab-pass-tag">
              <Check size={12} />
              <span>{lang === 'vi' ? 'Đã đạt' : 'Passed'}</span>
            </span>
          )}
        </div>
        <p className="quiz-question">
          <RichText text={t(quiz.question, lang)} />
        </p>

        <div className="quiz-options">
          {quiz.options.map((opt, idx) => {
            const isSelected = selectedQuiz === idx;
            const isCorrect = idx === quiz.correctIndex;
            let cls = 'quiz-opt';
            if (selectedQuiz !== null) {
              if (isSelected && isCorrect) cls += ' quiz-opt--ok';
              else if (isSelected && !isCorrect) cls += ' quiz-opt--err';
              else if (isCorrect) cls += ' quiz-opt--reveal';
            }
            return (
              <button
                type="button"
                key={idx}
                className={cls}
                onClick={() => handleSelectQuiz(idx)}
              >
                <span className="quiz-opt__key">{String.fromCharCode(65 + idx)}</span>
                <span className="quiz-opt__text">
                  <RichText text={t(opt, lang)} />
                </span>
              </button>
            );
          })}
        </div>

        {selectedQuiz !== null && (
          <div
            className={`feedback-box ${
              selectedQuiz === quiz.correctIndex
                ? 'feedback-box--ok'
                : 'feedback-box--err'
            }`}
          >
            <RichText text={t(quiz.explanation, lang)} />
          </div>
        )}
      </section>

      <section className="doc-section">
        <h3 className="doc-h3">{t(UI_TEXT.sections.simTitle, lang)}</h3>
        <SimulationCell spec={simulation} lang={lang} />
      </section>

      {/* Real Browser Python Runner (Pyodide) */}
      <section className="doc-section">
        <h3 className="doc-h3">
          {lang === 'vi'
            ? 'Thực hành Python trực tiếp (Pyodide Runtime)'
            : 'Interactive Python Sandbox (Pyodide Runtime)'}
        </h3>
        <p className="prose-p">
          {lang === 'vi'
            ? 'Sửa code bên dưới và chạy Python thật trực tiếp trên trình duyệt (lần chạy đầu sẽ tải Pyodide WebAssembly trong vài giây).'
            : 'Edit the code below and execute real Python in your browser (first run initializes Pyodide WebAssembly).'}
        </p>

        <div className="sandbox-cell">
          <div className="sim-cell__header">
            <div className="sim-cell__prompt">
              <Terminal size={14} />
              <code className="sim-cell__cmd">python3 (Pyodide WebAssembly)</code>
            </div>
            <div className="code-cell__actions">
              <button
                type="button"
                className="btn-ghost-sm"
                onClick={() => {
                  setSandboxCode(getSandboxCode(stepId));
                  setPyResult(null);
                }}
              >
                <RotateCcw size={12} />
                <span>{lang === 'vi' ? 'Khôi phục mẫu' : 'Reset'}</span>
              </button>
              <button
                type="button"
                className="btn-primary-sm"
                disabled={pyRunning}
                onClick={handleRunPyodide}
              >
                <Play size={13} />
                <span>
                  {pyRunning
                    ? lang === 'vi'
                      ? 'Đang chạy Python...'
                      : 'Running Python...'
                    : lang === 'vi'
                    ? 'Chạy Python thật'
                    : 'Run Python'}
                </span>
              </button>
            </div>
          </div>

          <textarea
            className="sandbox-editor"
            value={sandboxCode}
            onChange={(e) => setSandboxCode(e.target.value)}
            rows={Math.min(Math.max(sandboxCode.split('\n').length + 1, 6), 16)}
            spellCheck={false}
          />

          {pyResult && (
            <div className="sandbox-output">
              <div className="sandbox-output__meta">
                <span>
                  {pyResult.error
                    ? lang === 'vi'
                      ? 'Không tải được Pyodide'
                      : 'Pyodide load error'
                    : `${lang === 'vi' ? 'Hoàn tất trong' : 'Executed in'} ${pyResult.durationMs} ms`}
                </span>
              </div>
              {pyResult.error && (
                <pre className="sandbox-err">
                  {pyResult.error}
                  {'\n'}
                  {lang === 'vi'
                    ? '(Cần kết nối Internet ở lần tải Pyodide đầu tiên.)'
                    : '(Internet access is required on first Pyodide load.)'}
                </pre>
              )}
              {pyResult.stdout && (
                <pre className="sim-terminal">{pyResult.stdout}</pre>
              )}
              {pyResult.stderr && (
                <pre className="sandbox-err">{pyResult.stderr}</pre>
              )}
              {!pyResult.error && !pyResult.stdout && !pyResult.stderr && (
                <pre className="sim-terminal">
                  {lang === 'vi' ? '(Không có output in ra stdout)' : '(No stdout produced)'}
                </pre>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
