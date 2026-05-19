import type {
  AppMetadata,
  AppSettings,
  CsvSample,
  FrameState,
  LayoutItem,
  OverlayApi,
} from "../shared/types";

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: "nw-resize", n:  "n-resize",  ne: "ne-resize",
  w:  "w-resize",                   e:  "e-resize",
  sw: "sw-resize", s:  "s-resize",  se: "se-resize",
};

export type ResizePreview = { itemId: string; x: number; y: number; scaleX: number; scaleY: number };

export type ResizingState = {
  itemId: string;
  handle: HandleId;
  resizeX: { fixedEnd: number } | null;
  resizeY: { fixedEnd: number } | null;
  origX: number; origY: number;
  origScaleX: number; origScaleY: number;
};

export const defaultSettings: AppSettings = {
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
};

export const fallbackMetadata: AppMetadata = {
  sources: ["time", "ch1", "ch2", "ch3", "ch4"],
  channel_widget_types: ["gauge", "vertical_bar", "bar", "text"],
  time_widget_types: ["text"],
};

export const fallbackItem: LayoutItem = {
  source: "ch1",
  name: "ch1 1",
  label: "CH1",
  widget: "gauge",
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
  shadow_visible: true,
};

export const browserFallbackApi: OverlayApi = {
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
  createWidget: async () => ({ item_id: `item_ch1_${Date.now()}`, item: fallbackItem }),
  discoverFfmpeg: async () => ({ path: null, source: "not found" }),
  downloadFfmpeg: async () => { throw new Error("Not available in browser"); },
  installScripts: async () => { throw new Error("Not available in browser"); },
  onBridgeEvent: () => () => undefined,
};

export const api = window.overlayApi ?? browserFallbackApi;

export function numeric(value: number | string | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value: number, low: number, high: number) {
  if (!Number.isFinite(value)) return low;
  return Math.max(low, Math.min(high, value));
}

export function widgetSize(widget: string) {
  const sizes: Record<string, [number, number]> = {
    text: [280, 52],
    bar: [220, 48],
    gauge: [250, 250],
    vertical_bar: [130, 330],
  };
  return sizes[widget] || [180, 60];
}

export function itemName(id: string, item: LayoutItem) {
  return item.name || item.label || id;
}

export function widgetTypesForSource(metadata: AppMetadata, source: string) {
  return source === "time" ? metadata.time_widget_types : metadata.channel_widget_types;
}

export function widgetTypeLabel(widget: string) {
  return widget.replace(/_/g, " ");
}

export type ColorKey = "accent_color" | "negative_color" | "positive_color" | "text_color" | "bg_color" | "outline_color";

export function colorControlLabel(item: LayoutItem, key: ColorKey): string | null {
  if (item.source === "time" || item.widget === "text") {
    const labels: Record<ColorKey, string | null> = {
      accent_color: null,
      negative_color: null,
      positive_color: null,
      text_color: null,
      bg_color: "colors.boxFill",
      outline_color: "colors.boxOutline",
    };
    return labels[key];
  }

  if (item.widget === "gauge") {
    const labels: Record<ColorKey, string | null> = {
      accent_color: "colors.spokeHub",
      negative_color: null,
      positive_color: null,
      text_color: null,
      bg_color: "colors.gaugeFill",
      outline_color: "colors.gaugeOutline",
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

  return key;
}

export function interpolateLocalState(samples: CsvSample[], timeMs: number): FrameState {
  if (!samples.length) return {};
  if (timeMs <= samples[0].time_ms) return { ...samples[0].values };
  const last = samples[samples.length - 1];
  if (timeMs >= last.time_ms) return { ...last.values };
  let index = 0;
  while (index < samples.length - 2 && samples[index + 1].time_ms < timeMs) index += 1;
  const left = samples[index];
  const right = samples[index + 1];
  const segment = right.time_ms - left.time_ms;
  const t = segment <= 0 ? 0 : (timeMs - left.time_ms) / segment;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const state: FrameState = {};
  const sources = new Set([...Object.keys(left.values), ...Object.keys(right.values)]);
  for (const source of sources) {
    state[source] = lerp(left.values[source] ?? 0, right.values[source] ?? 0);
  }
  return state;
}

export function itemBounds(item: LayoutItem, frameWidth: number, frameHeight: number): [number, number, number, number] {
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
