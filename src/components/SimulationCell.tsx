import React, { useEffect, useState } from 'react';
import { Play, Terminal } from 'lucide-react';
import { Lang, SimulationSpec, YoloBox } from '../types';
import { UI_TEXT, t } from '../i18n';

interface SimulationCellProps {
  spec: SimulationSpec;
  lang: Lang;
}

export const SimulationCell: React.FC<SimulationCellProps> = ({ spec, lang }) => {
  const [status, setStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [visibleLines, setVisibleLines] = useState<number>(0);
  const [selectedBox, setSelectedBox] = useState<YoloBox | null>(
    spec.yoloBoxes ? spec.yoloBoxes[0] : null
  );

  useEffect(() => {
    setStatus('idle');
    setVisibleLines(0);
    setSelectedBox(spec.yoloBoxes ? spec.yoloBoxes[0] : null);
  }, [spec]);

  const handleRun = () => {
    setStatus('running');
    setVisibleLines(0);

    if (spec.kind === 'terminal' && spec.terminalLines) {
      const total = spec.terminalLines.length;
      let count = 0;
      const timer = window.setInterval(() => {
        count += 1;
        setVisibleLines(count);
        if (count >= total) {
          window.clearInterval(timer);
          setStatus('done');
        }
      }, 95);
      return;
    }

    window.setTimeout(() => {
      setStatus('done');
    }, 320);
  };

  const getBadgeClass = (val: string | number) => {
    const s = String(val);
    if (s.includes('Khả quan')) return 'df-pill df-pill--pos';
    if (s.includes('Rủi ro')) return 'df-pill df-pill--neg';
    if (s.includes('Trung tính')) return 'df-pill df-pill--neu';
    return '';
  };

  const getYoloColor = (label: YoloBox['label']) => {
    if (label === 'Table') return 'yolo-box--table';
    if (label === 'Text') return 'yolo-box--text';
    return 'yolo-box--figure';
  };

  return (
    <div className="sim-cell">
      <div className="sim-cell__header">
        <div className="sim-cell__prompt">
          <span className="colab-bracket">
            {status === 'idle' ? '[ ]' : status === 'running' ? '[*]' : '[✓]'}
          </span>
          <Terminal size={14} />
          <code className="sim-cell__cmd">{spec.commandLabel}</code>
        </div>
        <button
          type="button"
          className="btn-primary-sm"
          onClick={handleRun}
          disabled={status === 'running'}
        >
          <Play size={13} />
          <span>
            {status === 'running'
              ? t(UI_TEXT.actions.running, lang)
              : t(UI_TEXT.actions.runSim, lang)}
          </span>
        </button>
      </div>

      {status !== 'idle' && (
        <div className="sim-cell__output">
          {spec.kind === 'terminal' && spec.terminalLines && (
            <pre className="sim-terminal">
              {spec.terminalLines.slice(0, visibleLines).map((line, i) => (
                <div key={i} className="sim-terminal__line">
                  {line || ' '}
                </div>
              ))}
            </pre>
          )}

          {spec.kind === 'dataframe' && spec.dataframeColumns && spec.dataframeRows && (
            <div className="df-wrap">
              <table className="df-table">
                <thead>
                  <tr>
                    <th className="df-idx">#</th>
                    {spec.dataframeColumns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {spec.dataframeRows.map((row, idx) => (
                    <tr key={idx}>
                      <td className="df-idx">{idx}</td>
                      {spec.dataframeColumns!.map((col) => {
                        const cellVal = row[col];
                        const isStatus = spec.statusColumn === col;
                        return (
                          <td key={col}>
                            {isStatus ? (
                              <span className={getBadgeClass(cellVal)}>{cellVal}</span>
                            ) : (
                              String(cellVal)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {spec.kind === 'yolo_canvas' && spec.yoloBoxes && (
            <div className="yolo-grid">
              <div className="yolo-page">
                <div className="yolo-page__title">
                  {spec.yoloPageTitle ? t(spec.yoloPageTitle, lang) : 'MASVN Page'}
                </div>
                <div className="yolo-page__canvas">
                  {spec.yoloBoxes.map((box, i) => (
                    <button
                      type="button"
                      key={i}
                      onClick={() => setSelectedBox(box)}
                      className={`yolo-box ${getYoloColor(box.label)} ${
                        selectedBox === box ? 'yolo-box--active' : ''
                      }`}
                      style={{
                        left: `${box.x}%`,
                        top: `${box.y}%`,
                        width: `${box.w}%`,
                        height: `${box.h}%`,
                      }}
                    >
                      <span className="yolo-box__tag">
                        {box.label} {(box.conf * 100).toFixed(0)}%
                      </span>
                      <span className="yolo-box__preview">{box.previewText}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="yolo-inspector">
                <div className="yolo-inspector__title">
                  {lang === 'vi' ? 'Thanh tra Bounding Box' : 'Bounding Box Inspector'}
                </div>
                <div className="yolo-legend">
                  <span className="legend-dot legend-dot--table">0: Table</span>
                  <span className="legend-dot legend-dot--text">1: Text</span>
                  <span className="legend-dot legend-dot--figure">2: Figure</span>
                </div>
                {selectedBox && (
                  <div className="yolo-inspector__card">
                    <div className="yolo-kv">
                      <span>Class</span>
                      <strong>{selectedBox.label}</strong>
                    </div>
                    <div className="yolo-kv">
                      <span>Confidence</span>
                      <strong>{selectedBox.conf.toFixed(2)}</strong>
                    </div>
                    <div className="yolo-kv">
                      <span>Normalized</span>
                      <code>
                        {((selectedBox.x + selectedBox.w / 2) / 100).toFixed(2)},{' '}
                        {((selectedBox.y + selectedBox.h / 2) / 100).toFixed(2)},{' '}
                        {(selectedBox.w / 100).toFixed(2)},{' '}
                        {(selectedBox.h / 100).toFixed(2)}
                      </code>
                    </div>
                    <div className="yolo-routing-note">
                      {selectedBox.label === 'Table' &&
                        (lang === 'vi'
                          ? 'Luồng đi: Cắt vùng -> PyMuPDF/OCR -> table_parser.py'
                          : 'Route: Crop -> PyMuPDF/OCR -> table_parser.py')}
                      {selectedBox.label === 'Text' &&
                        (lang === 'vi'
                          ? 'Luồng đi: Cắt vùng -> Gom chữ -> market_knowledge.json (RAG)'
                          : 'Route: Crop -> Extract words -> market_knowledge.json (RAG)')}
                      {selectedBox.label === 'Figure' &&
                        (lang === 'vi'
                          ? 'Luồng đi: BỎ QUA khi đọc chữ để tránh nhiễu số trục biểu đồ.'
                          : 'Route: DISCARD from text extraction to prevent chart axis noise.')}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {spec.kind === 'rag_trace' && spec.ragChunks && (
            <div className="rag-trace">
              {spec.ragQuery && (
                <div className="rag-trace__query">
                  <span>Query:</span> {t(spec.ragQuery, lang)}
                </div>
              )}
              <div className="rag-trace__chunks">
                {spec.ragChunks.map((chunk, i) => (
                  <div key={i} className="rag-chunk">
                    <div className="rag-chunk__head">
                      <span className="rag-chunk__src">{chunk.source}</span>
                      <div className="rag-chunk__scores">
                        <span>BM25: {chunk.bm25Score.toFixed(2)}</span>
                        <span>FAISS: {chunk.denseScore.toFixed(2)}</span>
                        <strong>Hybrid: {chunk.hybridScore.toFixed(3)}</strong>
                      </div>
                    </div>
                    <p className="rag-chunk__text">{chunk.text}</p>
                  </div>
                ))}
              </div>
              {spec.ragAnswer && (
                <div className="rag-trace__answer">
                  <div className="rag-trace__answer-label">
                    Ollama · qwen2.5:7b (Grounded Output)
                  </div>
                  <p>{t(spec.ragAnswer, lang)}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
