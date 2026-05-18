import React from "react";
import type { FrameState, LayoutItem } from "../../shared/types";
import { formatValue, valueForSource } from "../utils";
import type { HandleId } from "../utils";

export function WidgetPreview(props: {
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
  } else if (item.widget === "gauge") {
    body = (
      <div className="widget-gauge">
        <div className="gauge-ring">
          <div className="gauge-spoke" style={{ transform: `rotate(${value * 150}deg)` }} />
          <div className="gauge-hub" />
          <div className="gauge-outline" />
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
