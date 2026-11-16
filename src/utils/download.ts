import JSZip from 'jszip';
import { DownloadableFile } from '../types';
import { ALL_STEPS } from '../data/curriculum';

function triggerBlobDownload(filename: string, blobOrContent: Blob | string, mimeType: string) {
  const blob =
    blobOrContent instanceof Blob
      ? blobOrContent
      : new Blob([blobOrContent], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function buildNotebookJson(file: DownloadableFile): string {
  const cells = (file.notebookCells && file.notebookCells.length > 0
    ? file.notebookCells
    : [{ type: 'code' as const, content: file.code }]
  ).map((cell) => {
    const lines = cell.content
      .split('\n')
      .map((line, i, arr) => (i < arr.length - 1 ? `${line}\n` : line));
    if (cell.type === 'markdown') {
      return {
        cell_type: 'markdown',
        metadata: {},
        source: lines,
      };
    }
    return {
      cell_type: 'code',
      execution_count: null,
      metadata: {},
      outputs: [],
      source: lines,
    };
  });

  const nbPayload = {
    cells,
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
        version: '3.11.0',
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };

  return JSON.stringify(nbPayload, null, 2);
}

export function downloadSourceFile(file: DownloadableFile) {
  const basename = file.path.split('/').pop() || 'script.py';
  if (basename.endsWith('.ipynb')) {
    const pyName = basename.replace('.ipynb', '.py');
    triggerBlobDownload(pyName, file.code, 'text/x-python;charset=utf-8');
    return;
  }
  triggerBlobDownload(basename, file.code, 'text/plain;charset=utf-8');
}

export function downloadNotebookFile(file: DownloadableFile) {
  const basename = file.path.split('/').pop() || 'notebook.ipynb';
  const ipynbName = basename.endsWith('.ipynb') ? basename : `${basename}.ipynb`;
  triggerBlobDownload(ipynbName, buildNotebookJson(file), 'application/x-ipynb+json;charset=utf-8');
}

export async function downloadFullProjectZip() {
  const zip = new JSZip();
  const root = zip.folder('masvn-intelligence');
  if (!root) return;

  // Empty data/models directory placeholders
  const placeholderDirs = [
    'data/raw_pdfs/.gitkeep',
    'data/yolo_dataset/train/images/.gitkeep',
    'data/yolo_dataset/train/labels/.gitkeep',
    'data/yolo_dataset/valid/images/.gitkeep',
    'data/yolo_dataset/valid/labels/.gitkeep',
    'data/yolo_dataset/test/images/.gitkeep',
    'data/yolo_dataset/test/labels/.gitkeep',
    'data/processed/.gitkeep',
    'data/vector_store/.gitkeep',
    'models/.gitkeep',
    'logs/.gitkeep',
  ];
  for (const dirFile of placeholderDirs) {
    root.file(dirFile, '');
  }

  root.file(
    '.gitignore',
    `__pycache__/
*.pyc
.venv/
venv/
.env
auth.json
data/raw_pdfs/*.pdf
data/yolo_raw_images/
data/yolo_dataset/*/images/
data/yolo_dataset/*/labels/
data/vector_store/*.index
data/vector_store/*.pkl
models/*.pt
models/*.pkl
logs/
`
  );

  // Deduplicate completeFiles across all steps, skipping preview-only snippets
  const addedPaths = new Set<string>();
  for (const step of ALL_STEPS) {
    if (!step.completeFiles) continue;
    for (const file of step.completeFiles) {
      if (file.path.includes('_preview')) continue;
      if (addedPaths.has(file.path)) continue;
      addedPaths.add(file.path);

      if (file.path.endsWith('.ipynb')) {
        root.file(file.path, buildNotebookJson(file));
      } else {
        root.file(file.path, file.code);
      }
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerBlobDownload('masvn-intelligence.zip', blob, 'application/zip');
}
