import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import QRCode from "react-qr-code";
import topercLogo from "./assets/toperc-logo.png";
import "./i18n";
import {
  Antenna,
  ArrowRight,
  ChevronDown,
  Copy,
  Download,
  FolderOpen,
  FolderOutput,
  Plus,
  Play,
  RefreshCcw,
  Save,
  Search,
  Trash2,
  Youtube,
} from "lucide-react";
import type {
  AppMetadata,
  AppSettings,
  BridgeEvent,
  CsvSample,
  CsvSummary,
  FrameState,
  LayoutItem,
  OverlayApi,
  RadioLog,
  RadioSource,
  UpdateStatus,
} from "../shared/types";
import "./styles.css";

// ─── Resize types ─────────────────────────────────────────────────────────────

type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: "nw-resize", n:  "n-resize",  ne: "ne-resize",
  w:  "w-resize",                   e:  "e-resize",
  sw: "sw-resize", s:  "s-resize",  se: "se-resize",
};

type ResizePreview = { itemId: string; x: number; y: number; scaleX: number; scaleY: number };

type ResizingState = {
  itemId: string;
  handle: HandleId;
  /** Horizontal: fix this X boundary (frame px), or null to keep width unchanged */
  resizeX: { fixedEnd: number } | null;
  /** Vertical: fix this Y boundary (frame px), or null to keep height unchanged */
  resizeY: { fixedEnd: number } | null;
  origX: number; origY: number;
  origScaleX: number; origScaleY: number;
};

const defaultSettings: AppSettings = {
  csv_path: "",
  output_dir: "",
  video_output: "output/overlay.mov",
  ffmpeg_path: "",
  fps: 30,
  width: 1920,
  height: 1080,
  offset_ms: 0,
  duration_ms: "",
  render_video: false,
  layout: {},
  calibration: {},
};

const fallbackMetadata: AppMetadata = {
  sources: ["time", "ch1", "ch2", "ch3", "ch4"],
  channel_widget_types: ["wheel", "vertical_bar", "bar", "circle", "text"],
  time_widget_types: ["text"],
};

const fallbackItem: LayoutItem = {
  source: "ch1",
  name: "ch1 1",
  label: "CH1",
  widget: "wheel",
  x: 0.15,
  y: 0.78,
  scale_x: 1,
  scale_y: 1,
  accent_color: "#ffd25a",
  negative_color: "#ffaa54",
  positive_color: "#55beff",
  text_color: "#ffffff",
  bg_color: "#141a20",
  bg_visible: true,
  outline_color: "#ffffff",
  outline_visible: true,
  text_visible: true,
  shadow_visible: true,
};

const browserFallbackApi: OverlayApi = {
  metadata: async () => fallbackMetadata,
  defaultLayout: async () => ({ layout: { item_ch1_1: fallbackItem } }),
  loadSettings: async () => ({ ...defaultSettings, layout: { item_ch1_1: fallbackItem } }),
  saveSettings: async (settings) => settings,
  chooseCsv: async () => null,
  chooseDirectory: async () => null,
  chooseMovOutput: async () => null,
  chooseFfmpeg: async () => null,
  loadCsvSummary: async () => ({
    csv_path: "",
    sample_count: 0,
    duration_ms: 0,
    scale_mode: "preview",
    sources: fallbackMetadata.sources,
  }),
  previewState: async () => ({ time_ms: 0, state: {} }),
  renderOverlay: async () => ({ frame_count: 0, output_dir: "", video_output: "" }),
  discoverRadios: async () => ({ sources: [] }),
  listRadioLogs: async () => ({ logs: [] }),
  calibrate: async () => ({ calibration: defaultSettings.calibration, info: {} }),
  createWidget: async () => ({ item_id: `item_ch1_${Date.now()}`, item: fallbackItem }),
  discoverFfmpeg: async () => ({ path: null, source: "not found" }),
  downloadFfmpeg: async () => { throw new Error("Not available in browser"); },
  installScripts: async () => { throw new Error("Not available in browser"); }, // lang param unused in stub
  onBridgeEvent: () => () => undefined,
};

const api = window.overlayApi ?? browserFallbackApi;

// ─── Utilities ───────────────────────────────────────────────────────────────

function numeric(value: number | string | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, low: number, high: number) {
  if (!Number.isFinite(value)) return low;
  return Math.max(low, Math.min(high, value));
}

function widgetSize(widget: string) {
  const sizes: Record<string, [number, number]> = {
    text: [280, 52],
    bar: [220, 48],
    circle: [150, 150],
    wheel: [250, 250],
    vertical_bar: [130, 330],
  };
  return sizes[widget] || [180, 60];
}

function itemName(id: string, item: LayoutItem) {
  return item.name || item.label || id;
}

function widgetTypesForSource(metadata: AppMetadata, source: string) {
  return source === "time" ? metadata.time_widget_types : metadata.channel_widget_types;
}

function widgetTypeLabel(widget: string) {
  return widget.replace(/_/g, " ");
}

type ColorKey = "accent_color" | "negative_color" | "positive_color" | "text_color" | "bg_color" | "outline_color";

function colorControlLabel(item: LayoutItem, key: ColorKey): string | null {
  if (item.source === "time" || item.widget === "text") {
    const labels: Record<ColorKey, string | null> = {
      accent_color: "colors.value",
      negative_color: null,
      positive_color: null,
      text_color: "colors.labelText",
      bg_color: "colors.boxFill",
      outline_color: "colors.boxOutline",
    };
    return labels[key];
  }

  if (item.widget === "wheel") {
    const labels: Record<ColorKey, string | null> = {
      accent_color: "colors.spokeHub",
      negative_color: null,
      positive_color: null,
      text_color: "colors.valueText",
      bg_color: "colors.wheelFill",
      outline_color: "colors.wheelOutline",
    };
    return labels[key];
  }

  if (item.widget === "vertical_bar") {
    const labels: Record<ColorKey, string | null> = {
      accent_color: null,
      negative_color: "colors.negativeFill",
      positive_color: "colors.positiveFill",
      text_color: "colors.centerMark",
      bg_color: "colors.trackFill",
      outline_color: "colors.trackOutline",
    };
    return labels[key];
  }

  if (item.widget === "bar") {
    const labels: Record<ColorKey, string | null> = {
      accent_color: null,
      negative_color: "colors.negativeFill",
      positive_color: "colors.positiveFill",
      text_color: "colors.centerMark",
      bg_color: "colors.trackFill",
      outline_color: "colors.trackOutline",
    };
    return labels[key];
  }

  if (item.widget === "circle") {
    const labels: Record<ColorKey, string | null> = {
      accent_color: "colors.needleHub",
      negative_color: null,
      positive_color: null,
      text_color: "colors.valueText",
      bg_color: "colors.circleFill",
      outline_color: "colors.circleOutline",
    };
    return labels[key];
  }

  return key;
}

function valueForSource(state: FrameState, source: string) {
  const value = Number(state[source]);
  return Number.isFinite(value) ? value : 0;
}

function formatValue(value: number) {
  return `${value * 100 >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
}

function detectScale(samples: CsvSample[]) {
  let maxAbs = 0;
  for (const sample of samples) {
    for (const value of Object.values(sample.values)) {
      maxAbs = Math.max(maxAbs, Math.abs(value));
    }
  }
  return maxAbs <= 120 ? "percent" : "legacy";
}

function normalizeChannel(value: number, scale: string) {
  if (scale === "percent") {
    return clamp(((value + 100) / 200) * 2 - 1, -1, 1);
  }
  return clamp(((value + 1024) / 2048) * 2 - 1, -1, 1);
}

function calibrationValue(calibration: Record<string, number>, key: string) {
  const value = Number(calibration[key]);
  return Number.isFinite(value) ? value : 0;
}

function frameStateFromValues(values: Record<string, number>, calibration: Record<string, number>, scale: string): FrameState {
  const state: FrameState = {};
  for (const [source, value] of Object.entries(values)) {
    state[source] = normalizeChannel(value - calibrationValue(calibration, `${source}_offset`), scale);
  }
  return state;
}

function interpolateLocalState(samples: CsvSample[], timeMs: number, calibration: Record<string, number>): FrameState {
  const scale = detectScale(samples);
  if (!samples.length) return {};
  if (timeMs <= samples[0].time_ms) {
    const sample = samples[0];
    return frameStateFromValues(sample.values, calibration, scale);
  }
  const last = samples[samples.length - 1];
  if (timeMs >= last.time_ms) {
    return frameStateFromValues(last.values, calibration, scale);
  }
  let index = 0;
  while (index < samples.length - 2 && samples[index + 1].time_ms < timeMs) index += 1;
  const left = samples[index];
  const right = samples[index + 1];
  const segment = right.time_ms - left.time_ms;
  const t = segment <= 0 ? 0 : (timeMs - left.time_ms) / segment;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const values: Record<string, number> = {};
  const sources = new Set([...Object.keys(left.values), ...Object.keys(right.values)]);
  for (const source of sources) {
    values[source] = lerp(left.values[source] ?? 0, right.values[source] ?? 0);
  }
  return frameStateFromValues(values, calibration, scale);
}

function itemBounds(item: LayoutItem, frameWidth: number, frameHeight: number): [number, number, number, number] {
  const [baseWidth, baseHeight] = widgetSize(item.widget);
  const scale = Math.max(0.2, Math.min(frameWidth / 1920, frameHeight / 1080));
  const width = Math.max(32, baseWidth * scale * Number(item.scale_x || 1));
  const height = Math.max(24, baseHeight * scale * Number(item.scale_y || 1));
  const centerX = item.x * frameWidth;
  const centerY = item.y * frameHeight;
  const left = clamp(centerX - width / 2, 0, Math.max(0, frameWidth - width));
  const top = clamp(centerY - height / 2, 0, Math.max(0, frameHeight - height));
  return [left, top, left + width, top + height];
}

// ─── Field component ─────────────────────────────────────────────────────────

function Field(props: {
  label: string;
  value: string | number | undefined;
  onChange: (value: string) => void;
  type?: string;
  wide?: boolean;
}) {
  const [draft, setDraft] = React.useState(String(props.value ?? ""));
  const focused = React.useRef(false);

  // Sync external value changes only while the field is not being edited
  React.useEffect(() => {
    if (!focused.current) setDraft(String(props.value ?? ""));
  }, [props.value]);

  function commit() {
    props.onChange(draft);
  }

  return (
    <label className={props.wide ? "field wide-field" : "field"}>
      <span>{props.label}</span>
      <input
        value={draft}
        type={props.type ?? "text"}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; commit(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") { setDraft(String(props.value ?? "")); (e.target as HTMLInputElement).blur(); }
        }}
      />
    </label>
  );
}

// ─── Widget preview ───────────────────────────────────────────────────────────

function WidgetPreview(props: {
  item: LayoutItem;
  state: FrameState;
  timeMs: number;
  selected: boolean;
  bounds: [number, number, number, number];
  frameWidth: number;
  frameHeight: number;
  name: string;
  showEditorChrome?: boolean;
}) {
  const { item, state, timeMs, selected, bounds, frameWidth, frameHeight, name, showEditorChrome = true } = props;
  const [left, top, right, bottom] = bounds;
  const width = right - left;
  const height = bottom - top;
  const value = valueForSource(state, item.source);
  const hasBoxChrome = item.source === "time" || item.widget === "text";
  const style = {
    left: `${(left / frameWidth) * 100}%`,
    top: `${(top / frameHeight) * 100}%`,
    width: `${(width / frameWidth) * 100}%`,
    height: `${(height / frameHeight) * 100}%`,
    color: item.text_color,
    borderColor: hasBoxChrome && item.outline_visible !== false ? item.outline_color : "transparent",
    backgroundColor: hasBoxChrome && item.bg_visible !== false ? `${item.bg_color}aa` : "transparent",
    "--accent": item.accent_color,
    "--widget-bg": item.bg_visible === false ? "transparent" : `${item.bg_color}aa`,
    "--widget-outline": item.outline_visible === false ? "transparent" : item.outline_color,
    "--negative-color": item.negative_color,
    "--positive-color": item.positive_color,
  } as React.CSSProperties;

  let body: React.ReactNode;
  if (item.source === "time") {
    body = (
      <div className="widget-text">
        <span className="widget-label">{item.label}</span>
        <strong className="widget-value" style={{ color: item.accent_color }}>T {(timeMs / 1000).toFixed(2)}s</strong>
      </div>
    );
  } else if (item.widget === "wheel") {
    body = (
      <div className="widget-wheel">
        <div className="wheel-ring">
          <div className="wheel-spoke" style={{ transform: `rotate(${value * 150}deg)` }} />
          <div className="wheel-hub" />
          <div className="wheel-outline" />
        </div>
        <strong>{formatValue(value)}</strong>
      </div>
    );
  } else if (item.widget === "vertical_bar") {
    body = (
      <div className="widget-vertical-bar">
        <div className="vertical-bar-track">
          <div className="vertical-bar-inner">
            <div
              className={value >= 0 ? "vertical-bar-fill positive" : "vertical-bar-fill negative"}
              style={{ height: `${Math.abs(value) * 50}%`, [value >= 0 ? "bottom" : "top"]: "50%" }}
            />
            <div className="vertical-bar-mid" />
          </div>
          <div className="vertical-bar-outline" />
        </div>
      </div>
    );
  } else if (item.widget === "bar") {
    body = (
      <div className="widget-bar">
        <div className="bar-track" />
        <div className="bar-mid" />
        <div
          className={value >= 0 ? "bar-fill positive" : "bar-fill negative"}
          style={{
            width: `calc((100% - 16px) * ${Math.abs(value) / 2})`,
            left: value >= 0 ? "50%" : `calc(50% - (100% - 16px) * ${Math.abs(value) / 2})`,
          }}
        />
      </div>
    );
  } else if (item.widget === "circle") {
    body = (
      <div className="widget-circle">
        <div className="circle-needle" style={{ transform: `rotate(${value * 150}deg)` }} />
        <div className="circle-outline" />
        <strong>{formatValue(value)}</strong>
      </div>
    );
  } else {
    body = (
      <div className="widget-text">
        <span className="widget-label">{item.label}</span>
        <strong className="widget-value" style={{ color: item.accent_color }}>{formatValue(value)}</strong>
      </div>
    );
  }

  return (
    <div className={[
      "overlay-widget",
      showEditorChrome && selected ? "selected" : "",
      item.text_visible === false ? "text-hidden" : "",
      item.shadow_visible === false ? "shadow-hidden" : "",
    ].filter(Boolean).join(" ")} style={style}>
      {showEditorChrome && <span className="widget-name">{name}</span>}
      {body}
      {showEditorChrome && selected && (["nw","n","ne","e","se","s","sw","w"] as HandleId[]).map((h) => (
        <div key={h} className={`rh rh-${h}`} />
      ))}
    </div>
  );
}

// ─── Language dropdown ────────────────────────────────────────────────────────

const LANGUAGES = [
  { value: "en", label: "EN", flag: "🇬🇧", name: "English" },
  { value: "es", label: "ES", flag: "🇪🇸", name: "Español" },
  { value: "de", label: "DE", flag: "🇩🇪", name: "Deutsch" },
  { value: "fr", label: "FR", flag: "🇫🇷", name: "Français" },
];

function LangDropdown({ value, onChange }: { value: string; onChange: (lang: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="lang-dropdown">
      <button className="lang-btn" onClick={() => setOpen((o) => !o)}>
        {LANGUAGES.find((l) => l.value === value)?.name} <ChevronDown size={11} />
      </button>
      {open && (
        <div className="lang-menu">
          {LANGUAGES.map((opt) => (
            <button
              key={opt.value}
              className={`lang-option${opt.value === value ? " active" : ""}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              {opt.flag} {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

type CapturePayload = {
  layout: Record<string, LayoutItem>;
  state: FrameState;
  timeMs: number;
  width: number;
  height: number;
};

function CaptureRenderer() {
  const [payload, setPayload] = useState<CapturePayload | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("capture-mode");
    window.mt12Capture = {
      render: async (nextPayload: CapturePayload) => {
        setPayload(nextPayload);
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
        });
      },
    };
    return () => {
      delete window.mt12Capture;
      document.documentElement.classList.remove("capture-mode");
    };
  }, []);

  if (!payload) return <div className="capture-root" />;

  return (
    <div className="capture-root" style={{ width: payload.width, height: payload.height }}>
      <div className="capture-stage">
        {Object.entries(payload.layout ?? {}).map(([id, item]) => (
          <WidgetPreview
            key={id}
            item={item}
            state={payload.state}
            timeMs={payload.timeMs}
            selected={false}
            bounds={itemBounds(item, payload.width, payload.height)}
            frameWidth={payload.width}
            frameHeight={payload.height}
            name={itemName(id, item)}
            showEditorChrome={false}
          />
        ))}
      </div>
    </div>
  );
}

function App() {
  const { t, i18n } = useTranslation();

  if (new URLSearchParams(window.location.search).get("capture") === "1") {
    return <CaptureRenderer />;
  }

  const [metadata, setMetadata] = useState<AppMetadata>(fallbackMetadata);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [summary, setSummary] = useState<CsvSummary | null>(null);
  const [previewSamples, setPreviewSamples] = useState<CsvSample[]>([]);
  const [previewState, setPreviewState] = useState<FrameState>({});
  const [previewTime, setPreviewTime] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [sourceLogs, setSourceLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [radios, setRadios] = useState<RadioSource[]>([]);
  const [radioLogs, setRadioLogs] = useState<RadioLog[]>([]);
  const [selectedRadioRoot, setSelectedRadioRoot] = useState("");
  const [selectedRadioLog, setSelectedRadioLog] = useState("");
  const [scriptLang, setScriptLang] = useState(() =>
    ["en", "es", "de", "fr"].includes(i18n.language) ? i18n.language : "en"
  );
  useEffect(() => {
    if (["en", "es", "de", "fr"].includes(i18n.language)) setScriptLang(i18n.language);
  }, [i18n.language]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [inputMode, setInputMode] = useState<"manual" | "radio">("manual");
  const [currentView, setCurrentView] = useState<"source" | "layout" | "export">("source");
  const [dragPreview, setDragPreview] = useState<{ itemId: string; x: number; y: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null);
  const [previewCursor, setPreviewCursor] = useState("default");
  const [ffmpegDownloading, setFfmpegDownloading] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: "idle" });
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const draggingItemRef = useRef<{ itemId: string; dx: number; dy: number } | null>(null);
  const dragPreviewRef = useRef<{ itemId: string; x: number; y: number } | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const resizingRef = useRef<ResizingState | null>(null);
  const resizePreviewRef = useRef<ResizePreview | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const panStartRef = useRef<{ cx: number; cy: number; ox: number; oy: number } | null>(null);
  const previewRequestRef = useRef(0);
  const previewScheduleRef = useRef<number | null>(null);
  const pendingPreviewTimeRef = useRef(0);
  const latestSettingsRef = useRef<AppSettings>(defaultSettings);

  const layoutItems = useMemo(() => Object.entries(settings.layout ?? {}), [settings.layout]);
  const selectedItem = selectedItemId ? settings.layout[selectedItemId] : undefined;
  const durationMs = summary?.duration_ms ?? 0;
  const ffmpegReady = Boolean(String(settings.ffmpeg_path ?? "").trim());
  const outputWidth = Math.max(1, numeric(settings.width, 1920));
  const outputHeight = Math.max(1, numeric(settings.height, 1080));

  useEffect(() => {
    latestSettingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    return () => {
      if (dragRafRef.current !== null) window.cancelAnimationFrame(dragRafRef.current);
      if (previewScheduleRef.current !== null) window.cancelAnimationFrame(previewScheduleRef.current);
      if (resizeRafRef.current !== null) window.cancelAnimationFrame(resizeRafRef.current);
    };
  }, []);

  useEffect(() => {
    Promise.all([api.metadata(), api.loadSettings()]).then(([loadedMetadata, loadedSettings]) => {
      const merged = { ...defaultSettings, ...loadedSettings };
      setMetadata(loadedMetadata);
      setSettings(merged);
      const firstId = Object.keys(merged.layout ?? {})[0];
      setSelectedItemId(firstId ?? "");
      if (merged.csv_path) {
        void loadCsv(merged.csv_path, merged);
      }
      if (!merged.ffmpeg_path) {
        void api.discoverFfmpeg().then((result) => {
          if (result.path) {
            setSettings((current) => ({ ...current, ffmpeg_path: result.path! }));
            pushLog(t("logs.ffmpegFound", { path: result.path, source: result.source }));
          }
        }).catch(() => undefined);
      }
    });

    return api.onBridgeEvent((event: BridgeEvent) => {
      if (event.type === "log") pushLog(event.message);
      if (event.type === "progress") setProgress(event.total > 0 ? { done: event.done, total: event.total } : null);
    });
  }, []);

  useEffect(() => {
    if (!window.updaterApi) return;
    window.updaterApi.getStatus().then(setUpdateStatus).catch(() => undefined);
    return window.updaterApi.onStatus(setUpdateStatus);
  }, []);

  function pushLog(message: string) {
    setLogs((current) => [message, ...current].slice(0, 200));
  }

  function pushSourceLog(message: string) {
    setSourceLogs((current) => [message, ...current].slice(0, 50));
  }

  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function updateSelectedItem<K extends keyof LayoutItem>(key: K, value: LayoutItem[K]) {
    if (!selectedItemId) return;
    setSettings((current) => ({
      ...current,
      layout: {
        ...current.layout,
        [selectedItemId]: { ...current.layout[selectedItemId], [key]: value },
      },
    }));
  }

  function updateSelectedNumber(key: keyof LayoutItem, value: string, low: number, high: number) {
    updateSelectedItem(key, clamp(Number(value), low, high) as never);
  }

  async function chooseCsv() {
    const path = await api.chooseCsv();
    if (!path) return;
    const next = { ...settings, csv_path: path };
    setInputMode("manual");
    setSettings(next);
    await loadCsv(path, next);
  }

  async function loadCsv(path = settings.csv_path, sourceSettings = settings) {
    if (!path) return;
    setBusy(true);
    try {
      const loaded = await api.loadCsvSummary({
        csv_path: path,
        offset_ms: sourceSettings.offset_ms,
      });
      setSummary(loaded);
      setPreviewSamples(loaded.samples || []);
      setMetadata((current) => ({
        ...current,
        sources: loaded.sources.length ? loaded.sources : current.sources,
      }));
      const midPoint = loaded.duration_ms / 2;
      setPreviewTime(midPoint);
      updatePreviewFromSamples(loaded.samples || [], midPoint, sourceSettings.calibration);
      pushSourceLog(t("logs.loadedSamples", { count: loaded.sample_count, mode: loaded.scale_mode }));
    } catch (error) {
      pushSourceLog(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function refreshPreview(path = settings.csv_path, timeMs = previewTime, sourceSettings = settings) {
    if (!path) return;
    if (previewSamples.length) {
      setPreviewState(interpolateLocalState(previewSamples, timeMs, sourceSettings.calibration));
      return;
    }
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    try {
      const result = await api.previewState({
        csv_path: path,
        offset_ms: sourceSettings.offset_ms,
        time_ms: timeMs,
        calibration: sourceSettings.calibration,
      });
      if (requestId !== previewRequestRef.current) return;
      setPreviewState(result.state);
    } catch (error) {
      pushSourceLog(error instanceof Error ? error.message : String(error));
    }
  }

  function schedulePreviewAt(timeMs: number) {
    pendingPreviewTimeRef.current = timeMs;
    if (previewScheduleRef.current !== null) return;
    previewScheduleRef.current = window.requestAnimationFrame(() => {
      previewScheduleRef.current = null;
      updatePreviewFromSamples(previewSamples, pendingPreviewTimeRef.current, latestSettingsRef.current.calibration);
    });
  }

  function updatePreviewFromSamples(samples: CsvSample[], timeMs: number, calibration: Record<string, number>) {
    if (!samples.length) {
      void refreshPreview(settings.csv_path, timeMs, latestSettingsRef.current);
      return;
    }
    setPreviewState(interpolateLocalState(samples, timeMs, calibration));
  }

  async function autoDetectFfmpeg() {
    try {
      const result = await api.discoverFfmpeg();
      if (result.path) {
        updateSetting("ffmpeg_path", result.path);
        pushLog(t("logs.ffmpegFound", { path: result.path, source: result.source }));
      } else {
        pushLog(t("logs.ffmpegNotFound"));
      }
    } catch (error) {
      pushLog(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDownloadFfmpeg() {
    setFfmpegDownloading(true);
    try {
      const result = await api.downloadFfmpeg();
      updateSetting("ffmpeg_path", result.path);
      pushLog(t("logs.ffmpegDownloaded"));
    } catch (error) {
      pushLog(error instanceof Error ? error.message : String(error));
    } finally {
      setFfmpegDownloading(false);
      setProgress(null);
    }
  }

  async function renderOverlay() {
    if (!settings.csv_path) return;
    setBusy(true);
    setProgress(null);
    try {
      await api.saveSettings(settings);
      const result = await api.renderOverlay(settings as Record<string, unknown>);
      pushLog(t("logs.rendered", { count: result.frame_count }));
    } catch (error) {
      pushLog(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    try {
      const saved = await api.saveSettings(settings);
      setSettings(saved);
      pushLog(saved.settings_path ? t("logs.settingsSavedPath", { path: saved.settings_path }) : t("logs.settingsSaved"));
    } catch (error) {
      pushLog(error instanceof Error ? error.message : String(error));
    }
  }

  async function discoverRadios() {
    try {
      const result = await api.discoverRadios();
      setRadios(result.sources);
      pushSourceLog(result.sources.length ? t("logs.foundRadios", { count: result.sources.length }) : t("logs.noEdgeTx"));
      if (result.sources[0]) {
        await selectRadioSource(result.sources[0].root);
      }
    } catch (error) {
      pushSourceLog(error instanceof Error ? error.message : String(error));
    }
  }

  async function selectRadioSource(root: string) {
    setSelectedRadioRoot(root);
    setSelectedRadioLog("");
    const result = await api.listRadioLogs(root);
    setRadioLogs(result.logs);
    if (result.logs[0]) {
      setSelectedRadioLog(result.logs[0].path);
      await applyRadioLog(result.logs[0].path);
    }
  }

  async function installScriptsToRadio() {
    if (!selectedRadioRoot) return;
    setBusy(true);
    try {
      const result = await api.installScripts(selectedRadioRoot, scriptLang);
      pushSourceLog(t("logs.scriptsInstalled", { count: result.installed.length }));
      for (const f of result.installed) pushSourceLog(`  ${f}`);
    } catch (error) {
      pushSourceLog(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function applyRadioLog(path = selectedRadioLog) {
    if (!path) return;
    const next = { ...settings, csv_path: path };
    setInputMode("radio");
    setSettings(next);
    await loadCsv(path, next);
  }

  async function addWidget() {
    const source = selectedItem?.source ?? metadata.sources.find((item) => item !== "time") ?? "ch1";
    const result = await api.createWidget({ source, layout: settings.layout });
    setSettings((current) => ({
      ...current,
      layout: { ...current.layout, [result.item_id]: result.item },
    }));
    setSelectedItemId(result.item_id);
  }

  async function duplicateWidget() {
    if (!selectedItemId || !selectedItem) return;
    const result = await api.createWidget({ source: selectedItem.source, layout: settings.layout });
    const copy = {
      ...result.item,
      ...selectedItem,
      name: `${selectedItem.name || selectedItem.label || selectedItem.source} Copy`,
      x: clamp(selectedItem.x + 0.04, 0.05, 0.95),
      y: clamp(selectedItem.y + 0.04, 0.05, 0.95),
    };
    setSettings((current) => ({
      ...current,
      layout: { ...current.layout, [result.item_id]: copy },
    }));
    setSelectedItemId(result.item_id);
  }

  function deleteWidget() {
    if (!selectedItemId) return;
    setSettings((current) => {
      const nextLayout = { ...current.layout };
      delete nextLayout[selectedItemId];
      const nextId = Object.keys(nextLayout)[0] ?? "";
      setSelectedItemId(nextId);
      return { ...current, layout: nextLayout };
    });
  }

  function resetLayout() {
    void api.defaultLayout().then((loaded) => {
      const nextLayout = loaded.layout;
      setSettings((current) => ({ ...current, layout: nextLayout }));
      setSelectedItemId(Object.keys(nextLayout)[0] ?? "");
    });
  }

  function changeSelectedSource(source: string) {
    if (!selectedItem) return;
    const allowed = widgetTypesForSource(metadata, source);
    updateSelectedItem("source", source);
    if (!allowed.includes(selectedItem.widget)) updateSelectedItem("widget", allowed[0]);
  }

  function previewPointerToFrame(event: React.PointerEvent<HTMLElement>) {
    const stage = previewStageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = clamp(((event.clientX - rect.left) / rect.width) * outputWidth, 0, outputWidth);
    const y = clamp(((event.clientY - rect.top) / rect.height) * outputHeight, 0, outputHeight);
    return { x, y, frameWidth: outputWidth, frameHeight: outputHeight };
  }

  function locateItemAt(x: number, y: number) {
    for (const [id, item] of [...layoutItems].reverse()) {
      const [left, top, right, bottom] = itemBounds(item, outputWidth, outputHeight);
      if (left <= x && x <= right && top <= y && y <= bottom) {
        return { id, bounds: [left, top, right, bottom] as [number, number, number, number] };
      }
    }
    return null;
  }

  function moveWidget(itemId: string, x: number, y: number) {
    if (!itemId) return;
    setSettings((current) => {
      if (!current.layout[itemId]) return current;
      const next = {
        ...current,
        layout: {
          ...current.layout,
          [itemId]: { ...current.layout[itemId], x, y },
        },
      };
      latestSettingsRef.current = next;
      return next;
    });
  }

  function scheduleDragPreview(itemId: string, x: number, y: number) {
    dragPreviewRef.current = { itemId, x, y };
    if (dragRafRef.current !== null) return;
    dragRafRef.current = window.requestAnimationFrame(() => {
      dragRafRef.current = null;
      setDragPreview(dragPreviewRef.current);
    });
  }

  function boundsForPreviewItem(id: string, item: LayoutItem) {
    // Resize preview takes priority
    if (resizePreview?.itemId === id) {
      return itemBounds(
        { ...item, x: resizePreview.x, y: resizePreview.y, scale_x: resizePreview.scaleX, scale_y: resizePreview.scaleY },
        outputWidth, outputHeight,
      );
    }
    const bounds = itemBounds(item, outputWidth, outputHeight);
    if (!dragPreview || dragPreview.itemId !== id) return bounds;
    const [left, top, right, bottom] = bounds;
    const width = right - left;
    const height = bottom - top;
    const centerX = dragPreview.x * outputWidth;
    const centerY = dragPreview.y * outputHeight;
    const nextLeft = clamp(centerX - width / 2, 0, Math.max(0, outputWidth - width));
    const nextTop = clamp(centerY - height / 2, 0, Math.max(0, outputHeight - height));
    return [nextLeft, nextTop, nextLeft + width, nextTop + height] as [number, number, number, number];
  }

  // ── Resize helpers ────────────────────────────────────────────────────────

  function scheduleResizePreview(preview: ResizePreview) {
    resizePreviewRef.current = preview;
    if (resizeRafRef.current !== null) return;
    resizeRafRef.current = window.requestAnimationFrame(() => {
      resizeRafRef.current = null;
      setResizePreview(resizePreviewRef.current);
    });
  }

  /** Returns the handle under (frameX, frameY) for the currently selected widget, or null. */
  function locateResizeHandle(frameX: number, frameY: number): HandleId | null {
    if (!selectedItemId || !previewStageRef.current) return null;
    const item = settings.layout[selectedItemId];
    if (!item) return null;
    const [l, t, r, b] = boundsForPreviewItem(selectedItemId, item);
    const mx = (l + r) / 2;
    const my = (t + b) / 2;
    // Hit area: 10 visual px → frame px
    const stageRect = previewStageRef.current.getBoundingClientRect();
    const hit = 10 * (outputWidth / (stageRect.width / previewZoom));

    const pts: [HandleId, number, number][] = [
      ["nw", l, t], ["n", mx, t], ["ne", r, t],
      ["w",  l, my],               ["e",  r, my],
      ["sw", l, b], ["s", mx, b], ["se", r, b],
    ];
    for (const [id, hx, hy] of pts) {
      if (Math.abs(frameX - hx) <= hit && Math.abs(frameY - hy) <= hit) return id;
    }
    return null;
  }

  // ── Zoom helpers ──────────────────────────────────────────────────────────

  function handlePreviewWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newZoom = Math.max(0.15, Math.min(8, previewZoom * factor));
    const zRatio = newZoom / previewZoom;
    const rect = event.currentTarget.getBoundingClientRect();
    const mx = event.clientX - (rect.left + rect.width / 2);
    const my = event.clientY - (rect.top + rect.height / 2);
    setPreviewZoom(newZoom);
    setPreviewOffset((o) => ({ x: mx + (o.x - mx) * zRatio, y: my + (o.y - my) * zRatio }));
  }

  function resetPreviewView() {
    setPreviewZoom(1);
    setPreviewOffset({ x: 0, y: 0 });
  }

  function stepZoom(factor: number) {
    setPreviewZoom((z) => {
      const newZ = Math.max(0.15, Math.min(8, z * factor));
      const zRatio = newZ / z;
      setPreviewOffset((o) => ({ x: o.x * zRatio, y: o.y * zRatio }));
      return newZ;
    });
  }

  // ── Pointer handlers ──────────────────────────────────────────────────────

  function handlePreviewPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const point = previewPointerToFrame(event);

    // Priority 1: resize handle on the selected widget
    const handle = point ? locateResizeHandle(point.x, point.y) : null;
    if (handle && point && selectedItemId) {
      const item = settings.layout[selectedItemId];
      if (item) {
        const [l, t, r, b] = boundsForPreviewItem(selectedItemId, item);
        resizingRef.current = {
          itemId: selectedItemId,
          handle,
          resizeX: (handle === "n" || handle === "s") ? null : { fixedEnd: handle.includes("w") ? r : l },
          resizeY: (handle === "e" || handle === "w") ? null : { fixedEnd: handle.includes("n") ? b : t },
          origX: item.x, origY: item.y,
          origScaleX: item.scale_x, origScaleY: item.scale_y,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }

    // Priority 2: widget drag
    const found = summary && layoutItems.length && point ? locateItemAt(point.x, point.y) : null;
    if (found && point) {
      const [l, t, r, b] = found.bounds;
      const cx = (l + r) / 2;
      const cy = (t + b) / 2;
      draggingItemRef.current = { itemId: found.id, dx: point.x - cx, dy: point.y - cy };
      scheduleDragPreview(found.id, cx / point.frameWidth, cy / point.frameHeight);
      setSelectedItemId(found.id);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    // Priority 3: pan
    panStartRef.current = { cx: event.clientX, cy: event.clientY, ox: previewOffset.x, oy: previewOffset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePreviewPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    // ── Resize ──
    if (resizingRef.current) {
      const point = previewPointerToFrame(event);
      if (!point) return;
      const { itemId, handle, resizeX, resizeY, origX, origY, origScaleX, origScaleY } = resizingRef.current;
      const item = settings.layout[itemId];
      if (!item) return;
      const [baseW, baseH] = widgetSize(item.widget);
      const sc = Math.max(0.01, Math.min(outputWidth / 1920, outputHeight / 1080));
      const MIN_W = 32, MIN_H = 24;

      let newX = origX, newScaleX = origScaleX;
      let newY = origY, newScaleY = origScaleY;
      const isCornerResize = handle.length === 2 && resizeX && resizeY;

      if (isCornerResize) {
        const px = clamp(point.x, 0, outputWidth);
        const py = clamp(point.y, 0, outputHeight);
        const originalW = Math.max(MIN_W, baseW * sc * origScaleX);
        const originalH = Math.max(MIN_H, baseH * sc * origScaleY);
        const minFactor = Math.max(0.2 / origScaleX, 0.2 / origScaleY, MIN_W / originalW, MIN_H / originalH);
        const maxFactor = Math.min(12 / origScaleX, 12 / origScaleY);
        const factor = clamp(
          Math.max(Math.abs(px - resizeX.fixedEnd) / originalW, Math.abs(py - resizeY.fixedEnd) / originalH),
          minFactor,
          maxFactor,
        );
        const signX = handle.includes("w") ? -1 : 1;
        const signY = handle.includes("n") ? -1 : 1;
        const w = originalW * factor;
        const h = originalH * factor;
        const movingX = resizeX.fixedEnd + signX * w;
        const movingY = resizeY.fixedEnd + signY * h;
        newX = clamp(((resizeX.fixedEnd + movingX) / 2) / outputWidth, 0.01, 0.99);
        newY = clamp(((resizeY.fixedEnd + movingY) / 2) / outputHeight, 0.01, 0.99);
        newScaleX = clamp(origScaleX * factor, 0.2, 12);
        newScaleY = clamp(origScaleY * factor, 0.2, 12);
        scheduleResizePreview({ itemId, x: newX, y: newY, scaleX: newScaleX, scaleY: newScaleY });
        return;
      }

      if (resizeX) {
        const px = clamp(point.x, 0, outputWidth);
        const w = Math.max(MIN_W, Math.abs(px - resizeX.fixedEnd));
        newX = clamp(((px + resizeX.fixedEnd) / 2) / outputWidth, 0.01, 0.99);
        newScaleX = clamp(w / (baseW * sc), 0.2, 12);
      }

      if (resizeY) {
        const py = clamp(point.y, 0, outputHeight);
        const h = Math.max(MIN_H, Math.abs(py - resizeY.fixedEnd));
        newY = clamp(((py + resizeY.fixedEnd) / 2) / outputHeight, 0.01, 0.99);
        newScaleY = clamp(h / (baseH * sc), 0.2, 12);
      }

      scheduleResizePreview({ itemId, x: newX, y: newY, scaleX: newScaleX, scaleY: newScaleY });
      return;
    }

    // ── Pan ──
    if (panStartRef.current) {
      setPreviewOffset({
        x: panStartRef.current.ox + event.clientX - panStartRef.current.cx,
        y: panStartRef.current.oy + event.clientY - panStartRef.current.cy,
      });
      return;
    }

    // ── Widget drag ──
    if (draggingItemRef.current) {
      const point = previewPointerToFrame(event);
      if (!point) return;
      const cx = clamp(point.x - draggingItemRef.current.dx, 0, point.frameWidth);
      const cy = clamp(point.y - draggingItemRef.current.dy, 0, point.frameHeight);
      scheduleDragPreview(
        draggingItemRef.current.itemId,
        clamp(cx / point.frameWidth, 0.05, 0.95),
        clamp(cy / point.frameHeight, 0.05, 0.95),
      );
      return;
    }

    // ── Cursor feedback (idle hover) ──
    const point = previewPointerToFrame(event);
    if (point) {
      const handle = locateResizeHandle(point.x, point.y);
      if (handle) {
        setPreviewCursor(HANDLE_CURSORS[handle]);
        return;
      }
      const found = summary && layoutItems.length ? locateItemAt(point.x, point.y) : null;
      setPreviewCursor(found ? "grab" : "default");
    }
  }

  function handlePreviewPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const release = () => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    };

    // ── Commit resize ──
    if (resizingRef.current) {
      const r = resizePreviewRef.current;
      if (r) {
        setSettings((current) => ({
          ...current,
          layout: {
            ...current.layout,
            [r.itemId]: { ...current.layout[r.itemId], x: r.x, y: r.y, scale_x: r.scaleX, scale_y: r.scaleY },
          },
        }));
      }
      setResizePreview(null);
      resizingRef.current = null;
      resizePreviewRef.current = null;
      release();
      return;
    }

    // ── End pan ──
    if (panStartRef.current) {
      panStartRef.current = null;
      release();
      return;
    }

    // ── Commit drag ──
    if (draggingItemRef.current) {
      const committed = dragPreviewRef.current;
      if (committed) moveWidget(committed.itemId, committed.x, committed.y);
      draggingItemRef.current = null;
      dragPreviewRef.current = null;
      setDragPreview(null);
      release();
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="shell">

      {/* ── Global topbar ─────────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="topbar-brand">
          <h1>{t("appTitle")}</h1>
          {summary && (
            <p>{summary.sample_count.toLocaleString()} {t("topbar.samplesUnit")} · {(summary.duration_ms / 1000).toFixed(1)} s · {summary.scale_mode}</p>
          )}
        </div>

        <nav className="view-nav">
          <button
            className={`nav-step${currentView === "source" ? " active" : ""}`}
            onClick={() => setCurrentView("source")}
          >
            <span className="step-badge">1</span> {t("nav.source")}
          </button>
          <button
            className={`nav-step${currentView === "layout" ? " active" : ""}`}
            onClick={() => setCurrentView("layout")}
          >
            <span className="step-badge">2</span> {t("nav.layout")}
          </button>
          <button
            className={`nav-step${currentView === "export" ? " active" : ""}`}
            onClick={() => setCurrentView("export")}
          >
            <span className="step-badge">3</span> {t("nav.export")}
          </button>
        </nav>

        <div className="actions">
          {updateStatus.status === "available" && (
            <button className="update-chip update-chip-available" onClick={() => window.updaterApi?.download()}>
              <Download size={15} /> v{"version" in updateStatus ? updateStatus.version : ""} {t("topbar.available")}
            </button>
          )}
          {updateStatus.status === "downloading" && (
            <span className="update-chip update-chip-downloading">
              <Download size={15} /> {"percent" in updateStatus ? updateStatus.percent : 0}%
            </span>
          )}
          {updateStatus.status === "ready" && (
            <button className="update-chip update-chip-ready" onClick={() => window.updaterApi?.quitAndInstall()}>
              <RefreshCcw size={15} /> {t("topbar.restartToUpdate")}
            </button>
          )}
          <a
            className="yt-pill"
            href="https://www.youtube.com/@TopeRC-es"
            target="_blank"
            rel="noreferrer"
          >
            <Youtube size={15} />
            TopeRC
          </a>
          <LangDropdown
            value={i18n.language}
            onChange={(lang) => {
              i18n.changeLanguage(lang);
              localStorage.setItem("mt12-language", lang);
            }}
          />
          <button onClick={saveSettings}>
            <Save size={17} /> {t("topbar.save")}
          </button>
        </div>
      </header>

      {/* ── View 1: Source ────────────────────────────────────────────────── */}
      {currentView === "source" && (
        <div className="view-body source-view">
          <div className="source-cards">

            {/* Manual CSV card */}
            <div className={`source-card${inputMode === "manual" ? " source-card-active" : ""}`}>
              <div className="source-card-title">
                <FolderOpen size={16} /> {t("source.manualCsvTitle")}
              </div>
              <button
                className="wide"
                onClick={() => { setInputMode("manual"); void chooseCsv(); }}
                disabled={busy}
              >
                <FolderOpen size={17} /> {busy && inputMode === "manual" ? t("source.loading") : t("source.browseCsv")}
              </button>
              <input
                className="path"
                value={settings.csv_path ?? ""}
                placeholder={t("source.csvPathPlaceholder")}
                onChange={(e) => updateSetting("csv_path", e.target.value)}
                onBlur={() => {
                  if (settings.csv_path && settings.csv_path !== summary?.csv_path) {
                    setInputMode("manual");
                    void loadCsv(settings.csv_path, settings);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && settings.csv_path) {
                    setInputMode("manual");
                    void loadCsv(settings.csv_path, settings);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
            </div>

            {/* Auto / MT12 card */}
            <div className={`source-card${inputMode === "radio" ? " source-card-active" : ""}`}>
              <div className="source-card-title">
                <Antenna size={16} /> {t("source.mt12AutoTitle")}
              </div>
              <button
                className="wide"
                onClick={() => { setInputMode("radio"); void discoverRadios(); }}
                disabled={busy}
              >
                <RefreshCcw size={17} /> {t("source.scanForUnits")}
              </button>
              <label className="field">
                <span>{t("source.radioUnit")}</span>
                <select value={selectedRadioRoot} onChange={(e) => selectRadioSource(e.target.value)}>
                  <option value="">{t("source.noUnitFound")}</option>
                  {radios.map((r) => (
                    <option key={r.root} value={r.root}>{r.display_name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("source.logFile")}</span>
                <select
                  value={selectedRadioLog}
                  onChange={(e) => {
                    setSelectedRadioLog(e.target.value);
                    void applyRadioLog(e.target.value);
                  }}
                >
                  <option value="">{t("source.noLogSelected")}</option>
                  {radioLogs.map((l) => (
                    <option key={l.path} value={l.path}>{l.display_name}</option>
                  ))}
                </select>
              </label>
              {selectedRadioRoot && (
                <div className="install-scripts-row">
                  <select
                    className="script-lang-select"
                    value={scriptLang}
                    onChange={(e) => setScriptLang(e.target.value)}
                    title={t("source.scriptLangTitle")}
                  >
                    <option value="en">EN</option>
                    <option value="es">ES</option>
                    <option value="de">DE</option>
                    <option value="fr">FR</option>
                  </select>
                  <button
                    className="wide"
                    onClick={() => void installScriptsToRadio()}
                    disabled={busy}
                    title={t("source.installScriptsTitle", { root: selectedRadioRoot })}
                  >
                    <Download size={17} /> {t("source.installScripts")}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Loaded summary + calibration */}
          {summary && (
            <div className="source-loaded">
              <div className="summary-bar">
                <span className="summary-chip">{summary.sample_count.toLocaleString()} samples</span>
                <span className="summary-chip">{(summary.duration_ms / 1000).toFixed(2)} s</span>
                <span className="summary-chip">{summary.scale_mode}</span>
                <span className="summary-chip summary-chip-path">
                  {settings.csv_path?.split(/[\\/]/).pop()}
                </span>
              </div>

              <button className="primary source-continue" onClick={() => setCurrentView("layout")}>
                {t("source.editLayout")} <ArrowRight size={16} />
              </button>
            </div>
          )}



          {/* Support card */}
          <div className="support-card">
            <div className="support-section support-yt">
              <img src={topercLogo} alt="TopeRC" className="support-yt-logo" />
              <div className="support-yt-text">
                <span className="support-label">TopeRC</span>
                <span className="support-sub">{t("support.channelSub")}</span>
              </div>
              <a
                className="support-yt-btn"
                href="https://www.youtube.com/@TopeRC-es"
                target="_blank"
                rel="noreferrer"
              >
                {t("support.subscribe")}
              </a>
            </div>

            <div className="support-divider" />

            <div className="support-section support-donate">
              <div className="support-qr">
                <QRCode
                  value="https://paypal.me/dgarana"
                  size={96}
                  bgColor="transparent"
                  fgColor="#edf3f8"
                  level="M"
                />
              </div>
              <div className="support-donate-text">
                <span className="support-label">{t("support.donateTitle")}</span>
                <span className="support-sub">{t("support.donateSub")}</span>
                <a
                  className="support-donate-link"
                  href="https://paypal.me/dgarana"
                  target="_blank"
                  rel="noreferrer"
                >
                  paypal.me/dgarana
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── View 2: Layout ────────────────────────────────────────────────── */}
      {currentView === "layout" && (
        <div className="view-body layout-view">

          {/* Preview + timeline */}
          <div className="preview-workspace">
            <div
              className="preview draggable"
              style={{ cursor: previewCursor }}
              onPointerDown={handlePreviewPointerDown}
              onPointerMove={handlePreviewPointerMove}
              onPointerUp={handlePreviewPointerUp}
              onPointerCancel={handlePreviewPointerUp}
              onPointerLeave={() => setPreviewCursor("default")}
              onWheel={handlePreviewWheel}
            >
              {summary ? (
                <div
                  ref={previewStageRef}
                  className="preview-stage"
                  style={{
                    "--preview-aspect": `${outputWidth} / ${outputHeight}`,
                    transform: `translate(${previewOffset.x}px, ${previewOffset.y}px) scale(${previewZoom})`,
                    transformOrigin: "center center",
                  } as React.CSSProperties}
                >
                  <div className="electron-preview-layer">
                    {layoutItems.map(([id, item]) => (
                      <WidgetPreview
                        key={id}
                        item={item}
                        state={previewState}
                        timeMs={previewTime}
                        selected={id === selectedItemId}
                        bounds={boundsForPreviewItem(id, item)}
                        frameWidth={outputWidth}
                        frameHeight={outputHeight}
                        name={itemName(id, item)}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="empty">
                  {t("layout.noSource")} —{" "}
                  <button onClick={() => setCurrentView("source")}>{t("layout.selectSource")}</button>
                </div>
              )}
            </div>

            <div className="timeline">
              <input
                type="range"
                min={0}
                max={Math.max(1, durationMs)}
                value={Math.min(previewTime, Math.max(1, durationMs))}
                disabled={!summary}
                onChange={(e) => { const n = Number(e.target.value); setPreviewTime(n); schedulePreviewAt(n); }}
                onInput={(e) => { const n = Number(e.currentTarget.value); setPreviewTime(n); schedulePreviewAt(n); }}
                onMouseUp={(e) => refreshPreview(settings.csv_path, Number(e.currentTarget.value))}
                onKeyUp={(e) => refreshPreview(settings.csv_path, Number(e.currentTarget.value))}
              />
              <span className="timeline-time">{(previewTime / 1000).toFixed(2)}s</span>
              <div className="timeline-zoom">
                <button className="zoom-btn" title={t("layout.zoomOut")} onClick={() => stepZoom(1 / 1.25)}>−</button>
                <button className="zoom-btn zoom-pct" title={t("layout.resetZoom")} onClick={resetPreviewView}>
                  {Math.round(previewZoom * 100)}%
                </button>
                <button className="zoom-btn" title={t("layout.zoomIn")} onClick={() => stepZoom(1.25)}>+</button>
              </div>
              <button
                className="timeline-res"
                title={t("layout.swapDimensions")}
                onClick={() => {
                  updateSetting("width", outputHeight);
                  updateSetting("height", outputWidth);
                  resetPreviewView();
                }}
              >
                {outputWidth}×{outputHeight}
              </button>
            </div>
          </div>

          {/* Inspector sidebar */}
          <aside className="inspector-sidebar">
            <div className="widget-toolbar">
              <button onClick={addWidget}><Plus size={15} /> {t("layout.add")}</button>
              <button onClick={duplicateWidget} disabled={!selectedItem}><Copy size={15} /> {t("layout.duplicate")}</button>
              <button onClick={deleteWidget} disabled={!selectedItem}><Trash2 size={15} /> {t("layout.delete")}</button>
              <button onClick={resetLayout}>{t("layout.reset")}</button>
            </div>

            <label className="field">
              <span>{t("layout.selectedWidget")}</span>
              <select value={selectedItemId} onChange={(e) => setSelectedItemId(e.target.value)}>
                <option value="">{t("layout.noWidgetSelected")}</option>
                {layoutItems.map(([id, item]) => (
                  <option value={id} key={id}>{itemName(id, item)}</option>
                ))}
              </select>
            </label>

            {selectedItem ? (
              <div className="inspector">
                <Field label={t("layout.name")} value={selectedItem.name} onChange={(v) => updateSelectedItem("name", v)} />
                <Field label={t("layout.label")} value={selectedItem.label} onChange={(v) => updateSelectedItem("label", v)} />
                <label className="field">
                  <span>{t("layout.source")}</span>
                  <select value={selectedItem.source} onChange={(e) => changeSelectedSource(e.target.value)}>
                    {metadata.sources.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>{t("layout.widgetType")}</span>
                  <select value={selectedItem.widget} onChange={(e) => updateSelectedItem("widget", e.target.value)}>
                    {widgetTypesForSource(metadata, selectedItem.source).map((w) => (
                      <option key={w} value={w}>{widgetTypeLabel(w)}</option>
                    ))}
                  </select>
                </label>
                <Field label="X" value={selectedItem.x} onChange={(v) => updateSelectedNumber("x", v, 0.05, 0.95)} />
                <Field label="Y" value={selectedItem.y} onChange={(v) => updateSelectedNumber("y", v, 0.05, 0.95)} />
                {(() => {
                  const [baseW, baseH] = widgetSize(selectedItem.widget);
                  const sc = Math.max(0.2, Math.min(outputWidth / 1920, outputHeight / 1080));
                  const pxW = Math.round(Math.max(32, baseW * sc * selectedItem.scale_x));
                  const pxH = Math.round(Math.max(24, baseH * sc * selectedItem.scale_y));
                  return (
                    <>
                      <Field label={t("layout.widthPx")} value={pxW} onChange={(v) => {
                        const px = Math.max(1, Number(v));
                        if (Number.isFinite(px)) updateSelectedItem("scale_x", clamp(px / (baseW * sc), 0.2, 12));
                      }} />
                      <Field label={t("layout.heightPx")} value={pxH} onChange={(v) => {
                        const px = Math.max(1, Number(v));
                        if (Number.isFinite(px)) updateSelectedItem("scale_y", clamp(px / (baseH * sc), 0.2, 12));
                      }} />
                    </>
                  );
                })()}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selectedItem.shadow_visible !== false}
                    onChange={(e) => updateSelectedItem("shadow_visible", e.target.checked)}
                  />
                  {t("layout.shadow")}
                </label>
                {(
                  [
                    "accent_color",
                    "negative_color",
                    "positive_color",
                    "text_color",
                    "bg_color",
                    "outline_color",
                  ] as ColorKey[]
                ).map((key) => [key, colorControlLabel(selectedItem, key)] as const)
                .filter((entry): entry is readonly [ColorKey, string] => entry[1] !== null)
                .map(([key, labelKey]) => {
                  const isOff =
                    (key === "bg_color" && selectedItem.bg_visible === false) ||
                    (key === "outline_color" && selectedItem.outline_visible === false) ||
                    (key === "text_color" && selectedItem.text_visible === false);
                  const hasToggle = key === "bg_color" || key === "outline_color" || key === "text_color";
                  const toggleKey =
                    key === "bg_color" ? "bg_visible" :
                    key === "outline_color" ? "outline_visible" : "text_visible";
                  return (
                  <label
                    className="field color-field"
                    key={key}
                    style={isOff ? { opacity: 0.35 } : undefined}
                  >
                    <span>
                      {hasToggle ? (
                        <>
                          <input
                            type="checkbox"
                            checked={!isOff}
                            style={{ width: "auto", minHeight: "auto", marginRight: 5 }}
                            onChange={(e) => updateSelectedItem(toggleKey as keyof LayoutItem, e.target.checked as LayoutItem[keyof LayoutItem])}
                          />
                          {t(labelKey)}
                        </>
                      ) : t(labelKey)}
                    </span>
                    <input
                      type="color"
                      disabled={isOff}
                      value={String(selectedItem[key as keyof LayoutItem])}
                      onChange={(e) => updateSelectedItem(key as keyof LayoutItem, e.target.value as never)}
                    />
                  </label>
                  );
                })}
              </div>
            ) : (
              <div className="empty small">{t("layout.selectOrAdd")}</div>
            )}
          </aside>
        </div>
      )}

      {/* ── View 3: Export ────────────────────────────────────────────────── */}
      {currentView === "export" && (
        <div className="view-body export-view">

          {/* Left: settings + render button */}
          <div className="export-form">
            <section className="panel grid">
              <h2>{t("export.renderSettings")}</h2>
              <Field label={t("export.fps")} value={settings.fps} onChange={(v) => updateSetting("fps", v)} />
              <Field label={t("export.width")} value={settings.width} onChange={(v) => updateSetting("width", v)} />
              <Field label={t("export.height")} value={settings.height} onChange={(v) => updateSetting("height", v)} />
              <label className="check wide-field">
                <input
                  type="checkbox"
                  checked={Boolean(settings.render_video)}
                  onChange={(e) => updateSetting("render_video", e.target.checked)}
                />
                {t("export.exportMov")}
              </label>
            </section>

            <section className="panel grid">
              <h2>{t("export.outputPaths")}</h2>
              <Field label={t("export.movOutputPath")} value={settings.video_output} onChange={(v) => updateSetting("video_output", v)} wide />
              <button
                onClick={async () => { const p = await api.chooseMovOutput(); if (p) updateSetting("video_output", p); }}
              >
                <FolderOutput size={16} /> {t("export.browse")}
              </button>
            </section>

            <section className="panel grid">
              <h2>{t("export.ffmpegSection")}</h2>
              <div className={`hint wide-field${ffmpegReady ? " ok" : ""}`}>
                {ffmpegReady ? t("export.ffmpegReady") : t("export.ffmpegMissing")}
              </div>
              <input
                className="path wide-field"
                value={settings.ffmpeg_path ?? ""}
                placeholder={t("export.ffmpegPathPlaceholder")}
                onChange={(e) => updateSetting("ffmpeg_path", e.target.value)}
              />
              <div className="row ffmpeg-actions wide-field">
                <button onClick={autoDetectFfmpeg} disabled={ffmpegDownloading}>
                  <Search size={15} /> {t("export.autoDetect")}
                </button>
                <button
                  onClick={handleDownloadFfmpeg}
                  disabled={ffmpegDownloading}
                  className={ffmpegDownloading ? "primary" : ""}
                >
                  <Download size={15} /> {ffmpegDownloading ? t("export.downloading") : t("export.download")}
                </button>
                <button
                  onClick={async () => { const p = await api.chooseFfmpeg(); if (p) updateSetting("ffmpeg_path", p); }}
                  disabled={ffmpegDownloading}
                >
                  <FolderOpen size={15} /> {t("export.browse")}
                </button>
              </div>
            </section>

            <div className="render-footer">
              {progress && (
                <div className="render-progress">
                  <div
                    className="render-progress-bar"
                    style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                  />
                </div>
              )}
              <button
                className="primary render-btn"
                onClick={renderOverlay}
                disabled={!settings.csv_path || busy}
              >
                <Play size={18} /> {busy ? `${t("export.rendering")} ${progress ? `${progress.done}/${progress.total}` : ""}` : t("export.renderOverlay")}
              </button>
            </div>
          </div>

          {/* Right: log */}
          <div className="export-log-panel">
            <div className="log-head">
              <span>{t("export.log")}</span>
              {progress && <span>{progress.done} / {progress.total}</span>}
            </div>
            <div className="log-lines">
              {logs.map((line, i) => <div key={`${line}-${i}`}>{line}</div>)}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
