export type Lang = 'vi' | 'en';
export type Theme = 'dark' | 'light';

export interface BiText {
  vi: string;
  en: string;
}

export interface ApiAnatomyRow {
  symbol: string;
  params: string;
  inputType: string;
  outputType: string;
  description: BiText;
}

export interface ProgressiveStage {
  tier: 1 | 2 | 3;
  title: BiText;
  summary: BiText;
  code: string;
  expectedNote: BiText;
}

export interface LineAnnotation {
  lines: string;
  snippet: string;
  explanation: BiText;
}

export interface FillBlankExercise {
  prompt: BiText;
  codeTemplate: string; // use ___0___, ___1___ placeholders
  answers: string[];
  hints: BiText[];
  explanation: BiText;
}

export interface QuizQuestion {
  question: BiText;
  options: BiText[];
  correctIndex: number;
  explanation: BiText;
}

export interface DataFrameRow {
  [key: string]: string | number;
}

export interface YoloBox {
  label: 'Table' | 'Text' | 'Figure';
  conf: number;
  x: number; // percentage 0..100
  y: number;
  w: number;
  h: number;
  previewText?: string;
}

export interface SimulationSpec {
  kind: 'terminal' | 'dataframe' | 'yolo_canvas' | 'rag_trace';
  commandLabel: string;
  terminalLines?: string[];
  dataframeColumns?: string[];
  dataframeRows?: DataFrameRow[];
  statusColumn?: string;
  yoloPageTitle?: BiText;
  yoloBoxes?: YoloBox[];
  ragQuery?: BiText;
  ragChunks?: Array<{
    source: string;
    bm25Score: number;
    denseScore: number;
    hybridScore: number;
    text: string;
  }>;
  ragAnswer?: BiText;
}

export interface DownloadableFile {
  path: string;
  language: 'python' | 'yaml' | 'text' | 'markdown';
  code: string;
  notebookCells?: Array<{ type: 'markdown' | 'code'; content: string }>;
}

export interface TroubleshootingCase {
  symptom: BiText;
  traceback: string;
  cause: BiText;
  fix: BiText;
}

export interface LabStatus {
  blankOk: boolean;
  quizOk: boolean;
}

export interface SubLesson {
  id: string; // e.g. "1.1"
  moduleId: string; // e.g. "mod-1"
  tier: 1 | 2 | 3;
  title: BiText;
  subtitle: BiText;
  targetFile: string;
  whyAndWhat: {
    why: BiText;
    ifMissing: BiText;
  };
  apiAnatomy: ApiAnatomyRow[];
  progressiveStages: ProgressiveStage[];
  builderTitle: BiText;
  builderExplanation: BiText;
  builderCode: string; // Cumulative code up to this step
  highlightLines?: [number, number]; // 1-based inclusive line range newly added in this step
  lineWalkthrough: LineAnnotation[];
  fillBlank: FillBlankExercise;
  quiz: QuizQuestion;
  simulation: SimulationSpec;
  checkpointItems: BiText[];
  studyApis: string[];
  completeFiles?: DownloadableFile[];
}

export interface ModuleSpec {
  id: string;
  number: number;
  title: BiText;
  summary: BiText;
  stack: string[];
  steps: SubLesson[];
}

export interface BlueprintNode {
  path: string;
  name: string;
  type: 'dir' | 'file';
  depth: number;
  role: BiText;
  linkedStepId?: string;
  linkedModuleId?: string;
}
