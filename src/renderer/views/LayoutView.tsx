import React from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  Plus,
  Trash2,
} from "lucide-react";
import type { AppMetadata, AppSettings, CsvSummary, FrameState, LayoutItem } from "../../shared/types";
import { Field } from "../components/Field";
import { WidgetPreview } from "../components/WidgetPreview";
import {
  clamp,
  colorControlLabel,
  itemName,
  widgetSize,
  widgetTypesForSource,
  widgetTypeLabel,
} from "../utils";
import type { ColorKey } from "../utils";

export interface LayoutViewProps {
  settings: AppSettings;
  metadata: AppMetadata;
  summary: CsvSummary | null;
  previewState: FrameState;
  previewTime: number;
  selectedItemId: string;
  selectedItem: LayoutItem | undefined;
  layoutItems: [string, LayoutItem][];
  outputWidth: number;
  outputHeight: number;
  previewCursor: string;
  previewZoom: number;
  previewOffset: { x: number; y: number };
  previewStageRef: React.RefObject<HTMLDivElement | null>;
  boundsForPreviewItem: (id: string, item: LayoutItem) => [number, number, number, number];
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
  onWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  onSetSelectedItemId: (id: string) => void;
  onAddWidget: () => void;
  onDuplicateWidget: () => void;
  onDeleteWidget: () => void;
  onResetLayout: () => void;
  onChangeSelectedSource: (source: string) => void;
  onUpdateSelectedItem: <K extends keyof LayoutItem>(key: K, value: LayoutItem[K]) => void;
  onUpdateSelectedNumber: (key: keyof LayoutItem, value: string, low: number, high: number) => void;
  onUpdateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onTimelineChange: (timeMs: number) => void;
  onTimelineMouseUp: (timeMs: number) => void;
  onStepZoom: (factor: number) => void;
  onResetPreviewView: () => void;
  onGoToSource: () => void;
}

export function LayoutView(props: LayoutViewProps) {
  const { t } = useTranslation();
  const {
    settings,
    metadata,
    summary,
    previewState,
    previewTime,
    selectedItemId,
    selectedItem,
    layoutItems,
    outputWidth,
    outputHeight,
    previewCursor,
    previewZoom,
    previewOffset,
    previewStageRef,
    boundsForPreviewItem,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onWheel,
    onSetSelectedItemId,
    onAddWidget,
    onDuplicateWidget,
    onDeleteWidget,
    onResetLayout,
    onChangeSelectedSource,
    onUpdateSelectedItem,
    onUpdateSelectedNumber,
    onUpdateSetting,
    onTimelineChange,
    onTimelineMouseUp,
    onStepZoom,
    onResetPreviewView,
    onGoToSource,
  } = props;

  const durationMs = summary?.duration_ms ?? 0;

  return (
    <div className="view-body layout-view">

      <div className="preview-workspace">
        <div
          className="preview draggable"
          style={{ cursor: previewCursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          onWheel={onWheel}
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
              <button onClick={onGoToSource}>{t("layout.selectSource")}</button>
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
            onChange={(e) => { const n = Number(e.target.value); onTimelineChange(n); }}
            onInput={(e) => { const n = Number(e.currentTarget.value); onTimelineChange(n); }}
            onMouseUp={(e) => onTimelineMouseUp(Number(e.currentTarget.value))}
            onKeyUp={(e) => onTimelineMouseUp(Number(e.currentTarget.value))}
          />
          <span className="timeline-time">{(previewTime / 1000).toFixed(2)}s</span>
          <div className="timeline-zoom">
            <button className="zoom-btn" title={t("layout.zoomOut")} onClick={() => onStepZoom(1 / 1.25)}>−</button>
            <button className="zoom-btn zoom-pct" title={t("layout.resetZoom")} onClick={onResetPreviewView}>
              {Math.round(previewZoom * 100)}%
            </button>
            <button className="zoom-btn" title={t("layout.zoomIn")} onClick={() => onStepZoom(1.25)}>+</button>
          </div>
          <button
            className="timeline-res"
            title={t("layout.swapDimensions")}
            onClick={() => {
              onUpdateSetting("width", outputHeight);
              onUpdateSetting("height", outputWidth);
              onResetPreviewView();
            }}
          >
            {outputWidth}×{outputHeight}
          </button>
        </div>
      </div>

      <aside className="inspector-sidebar">
        <div className="widget-toolbar">
          <button onClick={onAddWidget}><Plus size={15} /> {t("layout.add")}</button>
          <button onClick={onDuplicateWidget} disabled={!selectedItem}><Copy size={15} /> {t("layout.duplicate")}</button>
          <button onClick={onDeleteWidget} disabled={!selectedItem}><Trash2 size={15} /> {t("layout.delete")}</button>
          <button onClick={onResetLayout}>{t("layout.reset")}</button>
        </div>

        <label className="field">
          <span>{t("layout.selectedWidget")}</span>
          <select value={selectedItemId} onChange={(e) => onSetSelectedItemId(e.target.value)}>
            <option value="">{t("layout.noWidgetSelected")}</option>
            {layoutItems.map(([id, item]) => (
              <option value={id} key={id}>{itemName(id, item)}</option>
            ))}
          </select>
        </label>

        {selectedItem ? (
          <div className="inspector">
            <Field label={t("layout.name")} value={selectedItem.name} onChange={(v) => onUpdateSelectedItem("name", v)} />
            <Field label={t("layout.label")} value={selectedItem.label} onChange={(v) => onUpdateSelectedItem("label", v)} />
            <label className="field">
              <span>{t("layout.source")}</span>
              <select value={selectedItem.source} onChange={(e) => onChangeSelectedSource(e.target.value)}>
                {metadata.sources.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t("layout.widgetType")}</span>
              <select value={selectedItem.widget} onChange={(e) => onUpdateSelectedItem("widget", e.target.value)}>
                {widgetTypesForSource(metadata, selectedItem.source).map((w) => (
                  <option key={w} value={w}>{widgetTypeLabel(w)}</option>
                ))}
              </select>
            </label>
            <Field label="X" value={selectedItem.x} onChange={(v) => onUpdateSelectedNumber("x", v, 0.05, 0.95)} />
            <Field label="Y" value={selectedItem.y} onChange={(v) => onUpdateSelectedNumber("y", v, 0.05, 0.95)} />
            {(() => {
              const [baseW, baseH] = widgetSize(selectedItem.widget);
              const sc = Math.max(0.2, Math.min(outputWidth / 1920, outputHeight / 1080));
              const pxW = Math.round(Math.max(32, baseW * sc * selectedItem.scale_x));
              const pxH = Math.round(Math.max(24, baseH * sc * selectedItem.scale_y));
              return (
                <>
                  <Field label={t("layout.widthPx")} value={pxW} onChange={(v) => {
                    const px = Math.max(1, Number(v));
                    if (Number.isFinite(px)) onUpdateSelectedItem("scale_x", clamp(px / (baseW * sc), 0.2, 12));
                  }} />
                  <Field label={t("layout.heightPx")} value={pxH} onChange={(v) => {
                    const px = Math.max(1, Number(v));
                    if (Number.isFinite(px)) onUpdateSelectedItem("scale_y", clamp(px / (baseH * sc), 0.2, 12));
                  }} />
                </>
              );
            })()}
            <label className="check">
              <input
                type="checkbox"
                checked={selectedItem.shadow_visible !== false}
                onChange={(e) => onUpdateSelectedItem("shadow_visible", e.target.checked)}
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
                        onChange={(e) => onUpdateSelectedItem(toggleKey as keyof LayoutItem, e.target.checked as LayoutItem[keyof LayoutItem])}
                      />
                      {t(labelKey)}
                    </>
                  ) : t(labelKey)}
                </span>
                <input
                  type="color"
                  disabled={isOff}
                  value={String(selectedItem[key as keyof LayoutItem])}
                  onChange={(e) => onUpdateSelectedItem(key as keyof LayoutItem, e.target.value as never)}
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
  );
}
