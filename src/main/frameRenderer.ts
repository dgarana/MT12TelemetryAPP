/**
 * frameRenderer.ts — canvas rendering that faithfully replicates the CSS preview.
 *
 * Each widget mirrors its CSS counterpart precisely:
 * - proportions (72% ring, 68% vertical bar track, etc.)
 * - colors ("currentColor" = text_color inside child elements)
 * - spoke/needle are pill-shaped rectangles, not lines
 * - value text rendered below the widget bounds (CSS: bottom: -24px)
 * - text widget: label left / value right (space-between)
 */

import { createCanvas, type Canvas } from "@napi-rs/canvas";

type Ctx = ReturnType<Canvas["getContext"]>;

type LayoutItem = {
  source: string;
  widget: string;
  x: number;
  y: number;
  scale_x: number;
  scale_y: number;
  label: string;
  accent_color: string;
  negative_color: string;
  positive_color: string;
  text_color: string;
  bg_color: string;
  bg_visible?: boolean;
  outline_color: string;
  outline_visible?: boolean;
  text_visible?: boolean;
  shadow_visible?: boolean;
};

type FrameState = Record<string, number>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
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

function formatValue(value: number): string {
  const pct = Math.round(value * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function widgetBaseSize(widget: string): [number, number] {
  const sizes: Record<string, [number, number]> = {
    text:     [280, 52],
    bar:      [220, 48],
    circle:   [150, 150],
    wheel:    [250, 250],
    vertical_bar: [130, 330],
  };
  return sizes[widget] ?? [180, 60];
}

function itemBounds(
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
function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
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
//
// CSS: border: 2px solid currentColor   ← inline borderColor overrides → outline_color
//      border-radius: 8px
//      background-color: ${bg_color}aa

function drawBackground(ctx: Ctx, w: number, h: number, item: LayoutItem, sc: number) {
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

  // Clear shadow before stroke so border doesn't cast a second shadow
  ctx.shadowColor = "transparent";
  if (item.outline_visible !== false) {
    ctx.strokeStyle = item.outline_color;
    ctx.lineWidth = borderW;
    ctx.stroke();
  }
}

// ─── Wheel ────────────────────────────────────────────────────────────────────
//
// .widget-wheel         → display:grid; place-items:center
// .wheel-ring           → width:72%; aspect-ratio:1; border:6px solid currentColor(=text_color); border-radius:50%
// .wheel-spoke          → width:8px; height:42% of ring; bottom:50%; transform-origin:bottom center;
//                          background:var(--accent); border-radius:99px; rotate(value*150deg)
// .wheel-hub            → width:16% of ring; aspect-ratio:1; border-radius:50%; background:var(--accent)
// strong (value text)   → position:absolute; bottom:-24px; font-size:12px; text-shadow

function drawWheel(ctx: Ctx, item: LayoutItem, value: number, w: number, h: number, sc: number) {
  // Ring
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
  // Spoke — pill shape, bottom anchored at center, rotated
  const spokeW = Math.max(3, 8 * sc);
  const spokeH = 0.42 * ringDiam;            // 42% of ring height
  const angle = value * 150 * (Math.PI / 180);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  // Spoke goes upward from (0,0): y from -spokeH to 0
  rrect(ctx, -spokeW / 2, -spokeH, spokeW, spokeH, spokeW / 2);
  ctx.fillStyle = item.accent_color;
  ctx.fill();
  ctx.restore();

  // Hub
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

  // Value text — bottom: -24px in CSS (outside widget)
  if (item.text_visible !== false) {
    const fs = Math.max(9, 12 * sc);
    ctx.font = `700 ${fs}px Arial,sans-serif`;
    ctx.fillStyle = item.text_color;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 2 * sc;
    ctx.fillText(formatValue(value), cx, h + 4 * sc);
    ctx.shadowBlur = 0;
  }
}

// ─── Vertical bar ─────────────────────────────────────────────────────────────
//
// .widget-vertical-bar  → display:grid; place-items:center
// .vertical-bar-track   → width:68%; height:90%; border-radius:12px; border:3px solid currentColor(=text_color)
// .vertical-bar-fill    → left:8px; right:8px; border-radius:10px; background:positive/negative_color
//                          positive: height=|v|*50%; bottom:50%
//                          negative: height=|v|*50%; top:50%

function drawVerticalBar(ctx: Ctx, item: LayoutItem, value: number, w: number, h: number, sc: number) {
  const trackW = 0.68 * w;
  const trackH = 0.90 * h;
  const trackX = (w - trackW) / 2;
  const trackY = (h - trackH) / 2;
  const bw = Math.max(1, 3 * sc);
  const innerInset = bw;
  const fillInset = 8 * sc;

  // Shadow on the pill track (mirrors CSS box-shadow on .vertical-bar-track)
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
  // Fill — clipped inside track
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

  // Mid line inside clip
  if (item.text_visible !== false) {
    ctx.fillStyle = item.text_color;
    ctx.fillRect(trackX + innerInset + fillInset, midY - sc, trackW - innerInset * 2 - fillInset * 2, Math.max(1, 2 * sc));
  }

  ctx.restore();

  if (item.outline_visible !== false) {
    rrect(ctx, trackX + bw / 2, trackY + bw / 2, trackW - bw, trackH - bw, trackW / 2);
    ctx.strokeStyle = item.outline_color;
    ctx.lineWidth = bw;
    ctx.stroke();
  }

}

// ─── Bar ──────────────────────────────────────────────────────────────────────
//
// .bar-mid   → left:50%; top:8px; bottom:8px; width:2px; background:currentColor; opacity:0.6
// .bar-fill  → top:10px; bottom:10px; border-radius:9px; background:positive/negative_color
//              positive: left:50%; width:|v|*50%
//              negative: left:(50-|v|*50)%; width:|v|*50%

function drawBar(ctx: Ctx, item: LayoutItem, value: number, w: number, h: number, sc: number) {
  const trackTop = 8 * sc;
  const trackH = h - trackTop * 2;
  const borderW = Math.max(1, 2 * sc);
  const midX = w / 2;
  const fillTop = 19 * sc;
  const fillH = h - fillTop * 2;
  const fillInsetX = 8 * sc;

  // Shadow on the pill track (mirrors CSS box-shadow on .bar-track)
  if (item.shadow_visible !== false) {
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 10 * sc;
    ctx.shadowBlur = 28 * sc;
  }

  rrect(ctx, borderW / 2, trackTop + borderW / 2, w - borderW, trackH - borderW, trackH / 2);
  if (item.bg_visible !== false) {
    ctx.fillStyle = rgba(item.bg_color, BG_ALPHA);
    ctx.fill();
  }
  ctx.shadowColor = "transparent";

  if (item.text_visible !== false) {
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = item.text_color;
    ctx.fillRect(midX - sc, fillTop, Math.max(1, 2 * sc), fillH);
    ctx.globalAlpha = 1;
  }

  if (Math.abs(value) > 0.005) {
    const fillW = Math.abs(value) * ((w - fillInsetX * 2) / 2);
    const fillX = value >= 0 ? midX : midX - fillW;
    rrect(ctx, fillX, fillTop, fillW, fillH, fillH / 2);
    ctx.fillStyle = value >= 0 ? item.positive_color : item.negative_color;
    ctx.fill();
  }

  if (item.outline_visible !== false) {
    rrect(ctx, borderW / 2, trackTop + borderW / 2, w - borderW, trackH - borderW, trackH / 2);
    ctx.strokeStyle = item.outline_color;
    ctx.lineWidth = borderW;
    ctx.stroke();
  }
}

// ─── Circle ───────────────────────────────────────────────────────────────────
//
// .widget-circle  → width:100%; height:100%; border:4px solid currentColor(=text_color);
//                    border-radius:50%; display:grid; place-items:center
// .circle-needle  → same as .wheel-spoke (pill, anchored bottom at center, rotated)
// strong          → position:absolute (centered, bottom:auto) → centered in circle

function drawCircle(ctx: Ctx, item: LayoutItem, value: number, w: number, h: number, sc: number) {
  const cx = w / 2;
  const cy = h / 2;
  const bw = Math.max(1.5, 4 * sc);
  const r = Math.min(w, h) / 2 - bw / 2;

  // Circular border (.widget-circle)
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (item.bg_visible !== false) {
    ctx.fillStyle = rgba(item.bg_color, BG_ALPHA);
    ctx.fill();
  }
  if (item.outline_visible !== false) {
    ctx.strokeStyle = item.outline_color;
    ctx.lineWidth = bw;
    ctx.stroke();
  }

  // Needle — identical to wheel spoke
  const spokeW = Math.max(3, 8 * sc);
  const spokeH = 0.42 * (r * 2);
  const angle = value * 150 * (Math.PI / 180);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  rrect(ctx, -spokeW / 2, -spokeH, spokeW, spokeH, spokeW / 2);
  ctx.fillStyle = item.accent_color;
  ctx.fill();
  ctx.restore();

  // Hub
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(3, 0.08 * r * 2), 0, Math.PI * 2);
  ctx.fillStyle = item.accent_color;
  ctx.fill();

  if (item.outline_visible !== false) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = item.outline_color;
    ctx.lineWidth = bw;
    ctx.stroke();
  }

  // Value centered inside circle (strong: bottom:auto → centered)
  if (item.text_visible !== false) {
    const fs = Math.max(9, 12 * sc);
    ctx.font = `700 ${fs}px Arial,sans-serif`;
    ctx.fillStyle = item.text_color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 2 * sc;
    ctx.fillText(formatValue(value), cx, cy);
    ctx.shadowBlur = 0;
  }
}

// ─── Text ─────────────────────────────────────────────────────────────────────
//
// .widget-text  → display:flex; align-items:center; justify-content:space-between;
//                  gap:8px; padding:0 10px; font-size:clamp(10px,1.4vw,18px)
// span (label)  → text_color
// strong        → accent_color

function drawTextWidget(ctx: Ctx, item: LayoutItem, value: number, w: number, h: number, sc: number) {
  const pad = 10 * sc;
  // font-size: clamp(10, 1.4vw, 18) — base on frame width represented by sc
  const fs = Math.max(10, Math.min(18 * sc, 0.014 * (1920 * sc)));
  ctx.font = `600 ${fs}px Arial,sans-serif`;
  ctx.textBaseline = "middle";
  const midY = h / 2;

  // Label — left side
  if (item.text_visible !== false) {
    ctx.textAlign = "left";
    ctx.fillStyle = item.text_color;
    ctx.fillText(item.label, pad, midY);
  }

  // Value — right side
  ctx.textAlign = "right";
  ctx.fillStyle = item.accent_color;
  ctx.font = `700 ${fs}px Arial,sans-serif`;
  ctx.fillText(formatValue(value), w - pad, midY);
}

// ─── Time ─────────────────────────────────────────────────────────────────────
// Same layout as text widget but source is time.

function drawTimeWidget(ctx: Ctx, item: LayoutItem, timeMs: number, w: number, h: number, sc: number) {
  const pad = 10 * sc;
  const fs = Math.max(10, Math.min(18 * sc, 0.014 * (1920 * sc)));
  ctx.font = `600 ${fs}px Arial,sans-serif`;
  ctx.textBaseline = "middle";
  const midY = h / 2;

  if (item.text_visible !== false) {
    ctx.textAlign = "left";
    ctx.fillStyle = item.text_color;
    ctx.fillText(item.label, pad, midY);
  }

  ctx.textAlign = "right";
  ctx.fillStyle = item.accent_color;
  ctx.font = `700 ${fs}px Arial,sans-serif`;
  ctx.fillText(`T ${(timeMs / 1000).toFixed(2)}s`, w - pad, midY);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

function drawWidget(
  ctx: Ctx,
  item: LayoutItem,
  state: FrameState,
  timeMs: number,
  fw: number,
  fh: number,
) {
  const [left, top, right, bottom] = itemBounds(item, fw, fh);
  const w = right - left;
  const h = bottom - top;
  const sc = clamp(Math.min(fw / 1920, fh / 1080), 0.1, 8);

  ctx.save();
  ctx.translate(left, top);
  drawBackground(ctx, w, h, item, sc);

  if (item.source === "time") {
    drawTimeWidget(ctx, item, timeMs, w, h, sc);
  } else {
    const v = valueForSource(state, item.source);
    switch (item.widget) {
      case "wheel":    drawWheel(ctx, item, v, w, h, sc);    break;
      case "vertical_bar": drawVerticalBar(ctx, item, v, w, h, sc); break;
      case "bar":      drawBar(ctx, item, v, w, h, sc);      break;
      case "circle":   drawCircle(ctx, item, v, w, h, sc);   break;
      default:         drawTextWidget(ctx, item, v, w, h, sc); break;
    }
  }

  ctx.restore();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function makeCanvas(width: number, height: number): Canvas {
  return createCanvas(width, height);
}

export async function encodeCanvasPng(canvas: Canvas): Promise<Buffer> {
  return canvas.encode("png");
}

export function renderFrameToCanvas(
  canvas: Canvas,
  layout: Record<string, unknown>,
  state: FrameState,
  timeMs: number,
  frameWidth: number,
  frameHeight: number,
) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, frameWidth, frameHeight);

  for (const item of Object.values(layout)) {
    if (!item || typeof item !== "object") continue;
    try {
      drawWidget(ctx, item as unknown as LayoutItem, state, timeMs, frameWidth, frameHeight);
    } catch {
      // skip failed widget without aborting the frame
    }
  }
}
