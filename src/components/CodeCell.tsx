import React, { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { DownloadableFile, Lang } from '../types';
import { UI_TEXT, t } from '../i18n';
import { downloadNotebookFile, downloadSourceFile } from '../utils/download';

interface CodeCellProps {
  code: string;
  filename?: string;
  language?: string;
  highlightLines?: [number, number];
  downloadable?: DownloadableFile;
  lang: Lang;
  compact?: boolean;
}

const PY_KEYWORDS = new Set([
  'import', 'from', 'as', 'def', 'class', 'return', 'if', 'elif', 'else',
  'for', 'in', 'while', 'break', 'continue', 'with', 'try', 'except',
  'raise', 'True', 'False', 'None', 'and', 'or', 'not', 'is', 'lambda', 'pass',
]);

function renderHighlightedLine(line: string): React.ReactNode {
  const commentIdx = findCommentStart(line);
  const codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  const commentPart = commentIdx >= 0 ? line.slice(commentIdx) : '';

  const tokens: React.ReactNode[] = [];
  const regex = /(r?f?"(?:\\.|[^"\\])*"|r?f?'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  while ((match = regex.exec(codePart)) !== null) {
    if (match.index > lastIdx) {
      tokens.push(codePart.slice(lastIdx, match.index));
    }
    const word = match[0];
    if (word.startsWith('"') || word.startsWith("'") || word.startsWith('r"') || word.startsWith('f"') || word.startsWith("r'") || word.startsWith("f'")) {
      tokens.push(<span key={keyCounter++} className="tok-str">{word}</span>);
    } else if (/^\d/.test(word)) {
      tokens.push(<span key={keyCounter++} className="tok-num">{word}</span>);
    } else if (PY_KEYWORDS.has(word)) {
      tokens.push(<span key={keyCounter++} className="tok-kw">{word}</span>);
    } else {
      tokens.push(word);
    }
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < codePart.length) {
    tokens.push(codePart.slice(lastIdx));
  }
  if (commentPart) {
    tokens.push(<span key={keyCounter++} className="tok-cmt">{commentPart}</span>);
  }
  return tokens.length > 0 ? tokens : ' ';
}

function findCommentStart(line: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) return i;
  }
  return -1;
}

export const CodeCell: React.FC<CodeCellProps> = ({
  code,
  filename,
  language = 'python',
  highlightLines,
  downloadable,
  lang,
  compact = false,
}) => {
  const [copied, setCopied] = useState(false);
  const lines = code.split('\n');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={`code-cell ${compact ? 'code-cell--compact' : ''}`}>
      <div className="code-cell__bar">
        <div className="code-cell__meta">
          <span className="code-cell__lang">{language}</span>
          {filename && <span className="code-cell__file">{filename}</span>}
          {highlightLines && (
            <span className="code-cell__badge">
              L{highlightLines[0]}–L{highlightLines[1]}
            </span>
          )}
        </div>
        <div className="code-cell__actions">
          {downloadable && (
            <>
              <button
                type="button"
                className="btn-ghost-sm"
                onClick={() => downloadSourceFile(downloadable)}
              >
                <Download size={13} />
                <span>
                  {t(UI_TEXT.actions.downloadPy, lang)}{' '}
                  {downloadable.path.endsWith('.ipynb') ? '.py' : ''}
                </span>
              </button>
              {downloadable.notebookCells && (
                <button
                  type="button"
                  className="btn-ghost-sm"
                  onClick={() => downloadNotebookFile(downloadable)}
                >
                  <Download size={13} />
                  <span>{t(UI_TEXT.actions.downloadIpynb, lang)}</span>
                </button>
              )}
            </>
          )}
          <button type="button" className="btn-ghost-sm" onClick={handleCopy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? t(UI_TEXT.actions.copied, lang) : t(UI_TEXT.actions.copyCode, lang)}</span>
          </button>
        </div>
      </div>

      <div className="code-cell__scroll">
        <table className="code-table">
          <tbody>
            {lines.map((line, idx) => {
              const lineNum = idx + 1;
              const isNew =
                highlightLines &&
                lineNum >= highlightLines[0] &&
                lineNum <= highlightLines[1];
              return (
                <tr key={lineNum} className={isNew ? 'code-row--new' : ''}>
                  <td className="code-ln">{lineNum}</td>
                  <td className="code-src">{renderHighlightedLine(line)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
