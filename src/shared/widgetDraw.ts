/**
 * widgetDraw.ts — shared canvas 2D widget rendering.
 *
 * Works with both browser CanvasRenderingContext2D and @napi-rs/canvas context.
 * Callers should cast their context: `ctx as unknown as DrawCtx`
 */

import type { CsvSample, LayoutItem } from "./types";

export type FrameState = Record<string, number>;

export type SourceStats = { min: number; max: number; avg: number };
export type RunningStats = Record<string, SourceStats>;

export function buildRunningStatsArray(samples: CsvSample[]): RunningStats[] {
  const acc: Record<string, { min: number; max: number; sum: number; count: number }> = {};
  return samples.map((s) => {
    for (const [src, val] of Object.entries(s.values)) {
      if (!acc[src]) { acc[src] = { min: val, max: val, sum: val, count: 1 }; continue; }
      if (val < acc[src].min) acc[src].min = val;
      if (val > acc[src].max) acc[src].max = val;
      acc[src].sum += val;
      acc[src].count++;
    }
    const snap: RunningStats = {};
    for (const [src, a] of Object.entries(acc)) {
      snap[src] = { min: a.min, max: a.max, avg: a.sum / a.count };
    }
    return snap;
  });
}

export function getRunningStatsAt(statsArray: RunningStats[], samples: CsvSample[], timeMs: number): RunningStats {
  if (!statsArray.length || !samples.length) return {};
  if (timeMs <= samples[0].time_ms) return statsArray[0];
  const last = samples.length - 1;
  if (timeMs >= samples[last].time_ms) return statsArray[last];
  let lo = 0, hi = last;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (samples[mid].time_ms <= timeMs) lo = mid; else hi = mid; }
  return statsArray[lo];
}

// Minimal Canvas 2D interface — avoids DOM-specific union types so this file
// compiles under both the renderer (lib: DOM) and main (types: node) tsconfigs.
export interface DrawCtx {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, anticlockwise?: boolean): void;
  clip(): void;
  fill(): void;
  stroke(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowBlur: number;
  font: string;
  textAlign: string;
  textBaseline: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function applyTransforms(value: number, transforms: string[] | undefined, stats: SourceStats | undefined, item: LayoutItem): number {
  if (!transforms?.length) return value;
  let v = value;
  for (const t of transforms) {
    switch (t) {
      case "min": v = stats?.min ?? v; break;
      case "max": v = stats?.max ?? v; break;
      case "avg": v = stats?.avg ?? v; break;
      case "%": {
        const rMin = item.range_min ?? -1024;
        const rCenter = item.range_center ?? 0;
        const rMax = item.range_max ?? 1024;
        const half = v >= rCenter ? (rMax - rCenter) : (rCenter - rMin);
        v = half === 0 ? 0 : clamp(((v - rCenter) / half) * 100, -100, 100);
        break;
      }
    }
  }
  return v;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Parse '#rrggbb' or '#rgb' → 'rgba(r,g,b,a)' */
function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** CSS: background-color: ${bg_color}aa  → 0xAA/0xFF ≈ 0.6667 */
const BG_ALPHA = 170 / 255;

export function formatValue(value: number): string {
  const v = Math.round(value);
  return `${v >= 0 ? "+" : ""}${v}`;
}

function widgetBaseSize(widget: string): [number, number] {
  const sizes: Record<string, [number, number]> = {
    text:         [280, 52],
    bar:          [220, 48],
    gauge:        [250, 250],
    vertical_bar: [130, 330],
  };
  return sizes[widget] ?? [180, 60];
}

export function itemBoundsFromLayout(
  item: LayoutItem,
  fw: number,
  fh: number,
): [number, number, number, number] {
  const [bw, bh] = widgetBaseSize(item.widget);
  const s = clamp(Math.min(fw / 1920, fh / 1080), 0.1, 8);
  const w = Math.max(32, bw * s * (item.scale_x || 1));
  const h = Math.max(24, bh * s * (item.scale_y || 1));
  const cx = item.x * fw;
  const cy = item.y * fh;
  const left = clamp(cx - w / 2, 0, Math.max(0, fw - w));
  const top  = clamp(cy - h / 2, 0, Math.max(0, fh - h));
  return [left, top, left + w, top + h];
}

function valueForSource(state: FrameState, source: string): number {
  const value = Number(state[source]);
  return Number.isFinite(value) ? value : 0;
}

/** Draw a rounded rectangle path (does not fill/stroke). */
function rrect(ctx: DrawCtx, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

// ─── Widget background (.overlay-widget) ─────────────────────────────────────

function drawBackground(ctx: DrawCtx, w: number, h: number, item: LayoutItem, sc: number) {
  if (item.source !== "time" && item.widget !== "text") return;

  const borderW = Math.max(1, 2 * sc);

  if (item.shadow_visible !== false) {
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 10 * sc;
    ctx.shadowBlur = 28 * sc;
  }

  rrect(ctx, borderW / 2, borderW / 2, w - borderW, h - borderW, 8 * sc);
  if (item.bg_visible !== false) {
    ctx.fillStyle = rgba(item.bg_color, BG_ALPHA);
    ctx.fill();
  }

  ctx.shadowColor = "transparent";
  if (item.outline_visible !== false) {
    ctx.strokeStyle = item.outline_color;
    ctx.lineWidth = borderW;
    ctx.stroke();
  }
}

// ─── Gauge ────────────────────────────────────────────────────────────────────

function drawGauge(ctx: DrawCtx, item: LayoutItem, value: number, w: number, h: number, sc: number) {
  const ringDiam = 0.72 * w;
  const ringR = ringDiam / 2;
  const cx = w / 2;
  const cy = h / 2;

  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  if (item.bg_visible !== false) {
    ctx.fillStyle = rgba(item.bg_color, BG_ALPHA);
    ctx.fill();
  }

  const spokeW = Math.max(3, 8 * sc);
  const spokeH = 0.42 * ringDiam;
  const angle = value * 150 * (Math.PI / 180);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  rrect(ctx, -spokeW / 2, -spokeH, spokeW, spokeH, spokeW / 2);
  ctx.fillStyle = item.accent_color;
  ctx.fill();
  ctx.restore();

  const hubR = 0.16 * ringDiam / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(3, hubR), 0, Math.PI * 2);
  ctx.fillStyle = item.accent_color;
  ctx.fill();

  if (item.outline_visible !== false) {
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = item.outline_color;
    ctx.lineWidth = Math.max(2, 6 * sc);
    ctx.stroke();
  }

}

// ─── Vertical bar ─────────────────────────────────────────────────────────────

function drawVerticalBar(ctx: DrawCtx, item: LayoutItem, value: number, w: number, h: number, sc: number) {
  const trackW = 0.68 * w;
  const trackH = 0.90 * h;
  const trackX = (w - trackW) / 2;
  const trackY = (h - trackH) / 2;
  const bw = Math.max(1, 3 * sc);
  const innerInset = bw;
  const fillInset = 8 * sc;

  if (item.shadow_visible !== false) {
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 10 * sc;
    ctx.shadowBlur = 28 * sc;
  }

  rrect(ctx, trackX + bw / 2, trackY + bw / 2, trackW - bw, trackH - bw, trackW / 2);
  if (item.bg_visible !== false) {
    ctx.fillStyle = rgba(item.bg_color, BG_ALPHA);
    ctx.fill();
  }
  ctx.shadowColor = "transparent";

  ctx.save();
  rrect(ctx, trackX + innerInset, trackY + innerInset, trackW - innerInset * 2, trackH - innerInset * 2, (trackW - innerInset * 2) / 2);
  ctx.clip();

  const innerH = trackH - innerInset * 2;
  const midY = trackY + innerInset + innerH / 2;
  const fillH = Math.abs(value) * (innerH / 2);
  const fillColor = value >= 0 ? item.positive_color : item.negative_color;
  if (fillH > 0.5) {
    rrect(
      ctx,
      trackX + innerInset + fillInset,
      value >= 0 ? midY - fillH : midY,
      trackW - innerInset * 2 - fillInset * 2,
      fillH,
      (trackW - innerInset * 2 - fillInset * 2) / 2,
    );
    ctx.fillStyle = fillColor;
    ctx.fill();
  }

  // Center tick line (geometric guide, always visible)
  ctx.fillStyle = item.text_color;
  ctx.fillRect(trackX + innerInset + fillInset, midY - sc, trackW - innerInset * 2 - fillInset * 2, Math.max(1, 2 * sc));

  ctx.restore();

  if (item.outline_visible !== false) {
    rrect(ctx, trackX + bw / 2, trackY + bw / 2, trackW - bw, trackH - bw, trackW / 2);
    ctx.strokeStyle = item.outline_color;
    ctx.lineWidth = bw;
    ctx.stroke();
  }
}

// ─── Bar (horizontal mirror of vertical_bar) ─────────────────────────────────

function drawBar(ctx: DrawCtx, item: LayoutItem, value: number, w: number, h: number, sc: number) {
  const trackW = 0.90 * w;
  const trackH = 0.68 * h;
  const trackX = (w - trackW) / 2;
  const trackY = (h - trackH) / 2;
  const bw = Math.max(1, 3 * sc);
  const innerInset = bw;
  const fillInset = 8 * sc;

  if (item.shadow_visible !== false) {
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 10 * sc;
    ctx.shadowBlur = 28 * sc;
  }

  rrect(ctx, trackX + bw / 2, trackY + bw / 2, trackW - bw, trackH - bw, trackH / 2);
  if (item.bg_visible !== false) {
    ctx.fillStyle = rgba(item.bg_color, BG_ALPHA);
    ctx.fill();
  }
  ctx.shadowColor = "transparent";

  // Clip fill to the inner track area
  ctx.save();
  rrect(ctx, trackX + innerInset, trackY + innerInset, trackW - innerInset * 2, trackH - innerInset * 2, (trackH - innerInset * 2) / 2);
  ctx.clip();

  const innerW = trackW - innerInset * 2;
  const midX = trackX + innerInset + innerW / 2;
  const fillW = Math.abs(value) * (innerW / 2);
  const fillColor = value >= 0 ? item.positive_color : item.negative_color;
  if (fillW > 0.5) {
    rrect(
      ctx,
      value >= 0 ? midX : midX - fillW,
      trackY + innerInset + fillInset,
      fillW,
      trackH - innerInset * 2 - fillInset * 2,
      (trackH - innerInset * 2 - fillInset * 2) / 2,
    );
    ctx.fillStyle = fillColor;
    ctx.fill();
  }

  // Center tick line (geometric guide, always visible)
  ctx.fillStyle = item.text_color;
  ctx.fillRect(midX - sc, trackY + innerInset + fillInset, Math.max(1, 2 * sc), trackH - innerInset * 2 - fillInset * 2);

  ctx.restore();

  if (item.outline_visible !== false) {
    rrect(ctx, trackX + bw / 2, trackY + bw / 2, trackW - bw, trackH - bw, trackH / 2);
    ctx.strokeStyle = item.outline_color;
    ctx.lineWidth = bw;
    ctx.stroke();
  }
}

// ─── Text / Time ──────────────────────────────────────────────────────────────

function drawTextWidget(ctx: DrawCtx, item: LayoutItem, value: number, w: number, h: number, _sc: number) {
  ctx.font = `bold ${Math.max(10, Math.round(h * 0.50))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = item.accent_color;
  ctx.fillText(formatValue(value), w / 2, h / 2);
}

function drawTimeWidget(ctx: DrawCtx, item: LayoutItem, timeMs: number, w: number, h: number, _sc: number) {
  ctx.font = `bold ${Math.max(10, Math.round(h * 0.50))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = item.accent_color;
  ctx.fillText(`T ${(timeMs / 1000).toFixed(2)}s`, w / 2, h / 2);
}

// ─── Single widget dispatch ───────────────────────────────────────────────────

function drawWidget(
  ctx: DrawCtx,
  item: LayoutItem,
  state: FrameState,
  runningStats: RunningStats,
  timeMs: number,
  fw: number,
  fh: number,
) {
  const [left, top, right, bottom] = itemBoundsFromLayout(item, fw, fh);
  const w = right - left;
  const h = bottom - top;
  const sc = clamp(Math.min(fw / 1920, fh / 1080), 0.1, 8);

  ctx.save();
  ctx.translate(left, top);
  drawBackground(ctx, w, h, item, sc);

  if (item.source === "time") {
    drawTimeWidget(ctx, item, timeMs, w, h, sc);
  } else {
    const raw = valueForSource(state, item.source);
    const stats = runningStats[item.source];
    const v = Math.round(applyTransforms(raw, item.transforms, stats, item));
    const normDiv = item.transforms?.includes("%") ? 100 : 1024;
    const norm = clamp(v / normDiv, -1, 1);
    switch (item.widget) {
      case "gauge":        drawGauge(ctx, item, norm, w, h, sc);       break;
      case "vertical_bar": drawVerticalBar(ctx, item, norm, w, h, sc); break;
      case "bar":          drawBar(ctx, item, norm, w, h, sc);         break;
      default:             drawTextWidget(ctx, item, v, w, h, sc);     break;
    }
  }

  ctx.restore();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function renderFrame(
  ctx: DrawCtx,
  layout: Record<string, unknown>,
  state: FrameState,
  runningStats: RunningStats,
  timeMs: number,
  frameWidth: number,
  frameHeight: number,
) {
  ctx.clearRect(0, 0, frameWidth, frameHeight);

  for (const item of Object.values(layout)) {
    if (!item || typeof item !== "object") continue;
    try {
      drawWidget(ctx, item as unknown as LayoutItem, state, runningStats, timeMs, frameWidth, frameHeight);
    } catch {
      // skip failed widget without aborting the frame
    }
  }
}
