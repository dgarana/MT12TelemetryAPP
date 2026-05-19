export type BridgeEvent =
  | { type: "log"; message: string }
  | { type: "progress"; done: number; total: number };

export type UpdateStatus =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; version: string }
  | { status: "downloading"; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

export type UpdaterApi = {
  check: () => void;
  download: () => void;
  quitAndInstall: () => void;
  getStatus: () => Promise<UpdateStatus>;
  onStatus: (callback: (status: UpdateStatus) => void) => () => void;
};

export type CsvSummary = {
  csv_path: string;
  sample_count: number;
  duration_ms: number;
  samples?: CsvSample[];
  sources: string[];
};

export type CsvSample = {
  time_ms: number;
  values: Record<string, number>;
};

export type RadioSource = {
  drive: string;
  root: string;
  logs_dir: string;
  display_name: string;
};

export type RadioLog = {
  path: string;
  display_name: string;
  model_name: string | null;
  timestamp_text: string | null;
};

export type AppSettings = {
  csv_path?: string;
  output_dir?: string;
  video_output?: string;
  fps?: number | string;
  width?: number | string;
  height?: number | string;
  offset_ms?: number | string;
  duration_ms?: number | string;
  ffmpeg_path?: string;
  render_video?: boolean;
  layout: Record<string, LayoutItem>;
  settings_path?: string;
};

export type AppMetadata = {
  sources: string[];
  channel_widget_types: string[];
  time_widget_types: string[];
};

export type LayoutItem = {
  source: string;
  name: string;
  label: string;
  widget: string;
  x: number;
  y: number;
  scale_x: number;
  scale_y: number;
  accent_color: string;
  negative_color: string;
  positive_color: string;
  text_color: string;
  bg_color: string;
  bg_visible?: boolean;
  outline_color: string;
  outline_visible?: boolean;
  shadow_visible?: boolean;
  transforms?: string[];
  range_min?: number;
  range_center?: number;
  range_max?: number;
};

export type FrameState = Record<string, number>;

export type OverlayApi = {
  metadata: () => Promise<AppMetadata>;
  defaultLayout: () => Promise<{ layout: Record<string, LayoutItem> }>;
  loadSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
  chooseCsv: () => Promise<string | null>;
  chooseDirectory: () => Promise<string | null>;
  chooseMovOutput: () => Promise<string | null>;
  chooseFfmpeg: () => Promise<string | null>;
  loadCsvSummary: (payload: Record<string, unknown>) => Promise<CsvSummary>;
  previewState: (payload: Record<string, unknown>) => Promise<{ time_ms: number; state: FrameState }>;
  renderOverlay: (payload: Record<string, unknown>) => Promise<{ frame_count: number; output_dir: string; video_output: string }>;
  discoverRadios: () => Promise<{ sources: RadioSource[] }>;
  listRadioLogs: (root: string) => Promise<{ logs: RadioLog[] }>;
  createWidget: (payload: Record<string, unknown>) => Promise<{ item_id: string; item: LayoutItem }>;
  discoverFfmpeg: () => Promise<{ path: string | null; source: string }>;
  downloadFfmpeg: () => Promise<{ path: string }>;
  installScripts: (root: string) => Promise<{ installed: string[] }>;
  onBridgeEvent: (callback: (event: BridgeEvent) => void) => () => void;
};
