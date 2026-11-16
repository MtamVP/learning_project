export interface PyodideRunResult {
  stdout: string;
  stderr: string;
  error?: string;
  durationMs: number;
}

interface PyodideInstance {
  runPythonAsync: (code: string) => Promise<unknown>;
  globals: {
    get: (name: string) => unknown;
    set: (name: string, val: unknown) => void;
  };
}

declare global {
  interface Window {
    loadPyodide?: (opts?: { indexURL?: string }) => Promise<PyodideInstance>;
  }
}

const PYODIDE_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/';
const PYODIDE_SCRIPT_URL = `${PYODIDE_INDEX_URL}pyodide.js`;

let pyodidePromise: Promise<PyodideInstance> | null = null;

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (window.loadPyodide) resolve();
      else existing.addEventListener('load', () => resolve(), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function getPyodide(): Promise<PyodideInstance> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      await loadScriptOnce(PYODIDE_SCRIPT_URL);
      if (!window.loadPyodide) {
        throw new Error('Pyodide loader did not register on window.');
      }
      return await window.loadPyodide({ indexURL: PYODIDE_INDEX_URL });
    })().catch((err) => {
      pyodidePromise = null;
      throw err;
    });
  }
  return pyodidePromise;
}

export async function runPythonInBrowser(userCode: string): Promise<PyodideRunResult> {
  const start = performance.now();
  try {
    const py = await getPyodide();
    py.globals.set('__user_code__', userCode);

    await py.runPythonAsync(`
import io, sys, traceback
_buf_out = io.StringIO()
_buf_err = io.StringIO()
_old_out, _old_err = sys.stdout, sys.stderr
sys.stdout, sys.stderr = _buf_out, _buf_err
_run_err = ""
try:
    exec(compile(__user_code__, "<sandbox>", "exec"), {})
except Exception:
    _run_err = traceback.format_exc()
finally:
    sys.stdout, sys.stderr = _old_out, _old_err
__sandbox_stdout__ = _buf_out.getvalue()
__sandbox_stderr__ = _buf_err.getvalue()
__sandbox_err__ = _run_err
`);

    const stdout = String(py.globals.get('__sandbox_stdout__') || '');
    const stderr = String(py.globals.get('__sandbox_stderr__') || '');
    const err = String(py.globals.get('__sandbox_err__') || '');

    return {
      stdout,
      stderr: err ? `${stderr}${stderr ? '\n' : ''}${err}` : stderr,
      durationMs: Math.round(performance.now() - start),
    };
  } catch (e) {
    return {
      stdout: '',
      stderr: '',
      error: e instanceof Error ? e.message : String(e),
      durationMs: Math.round(performance.now() - start),
    };
  }
}
