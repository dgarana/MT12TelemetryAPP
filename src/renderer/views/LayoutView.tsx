import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import type { AppMetadata, AppSettings, CsvSummary, FrameState, LayoutItem } from "../../shared/types";
import type { RunningStats } from "../../shared/widgetDraw";
import { Field } from "../components/Field";
import { WidgetCanvas } from "../components/WidgetCanvas";
import {
  clamp,
  colorControlLabel,
  itemName,
  widgetSize,
  widgetTypesForSource,
  widgetTypeLabel,
} from "../utils";
import type { ColorKey, HandleId } from "../utils";

export interface LayoutViewProps {
  settings: AppSettings;
  metadata: AppMetadata;
  summary: CsvSummary | null;
  previewState: FrameState;
  runningStats: RunningStats;
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
  const dragIndex = useRef<number>(-1);
  const {
    settings,
    metadata,
    summary,
    previewState,
    runningStats,
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
              <WidgetCanvas
                layout={settings.layout}
                state={previewState}
                runningStats={runningStats}
                timeMs={previewTime}
                width={outputWidth}
                height={outputHeight}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
              />
              {/* Editor chrome: widget name labels + selection handles */}
              <div className="editor-chrome-layer">
                {layoutItems.map(([id, item]) => {
                  const [l, t, r, b] = boundsForPreviewItem(id, item);
                  const sel = id === selectedItemId;
                  return (
                    <div
                      key={id}
                      className={`widget-chrome${sel ? " selected" : ""}`}
                      style={{
                        left: `${(l / outputWidth) * 100}%`,
                        top: `${(t / outputHeight) * 100}%`,
                        width: `${((r - l) / outputWidth) * 100}%`,
                        height: `${((b - t) / outputHeight) * 100}%`,
                      }}
                    >
                      <span className="widget-name">{itemName(id, item)}</span>
                      {sel && (["nw","n","ne","e","se","s","sw","w"] as HandleId[]).map((h) => (
                        <div key={h} className={`rh rh-${h}`} />
                      ))}
                    </div>
                  );
                })}
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
          <button onClick={onAddWidget}><Plus size={18} /> {t("layout.add")}</button>
          <button onClick={onDuplicateWidget} disabled={!selectedItem}>{t("layout.duplicate")}</button>
          <button onClick={onDeleteWidget} disabled={!selectedItem}>{t("layout.delete")}</button>
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

            {/* ── Identity ── */}
            <input
              className="inspector-name-input"
              value={selectedItem.name}
              onChange={(e) => onUpdateSelectedItem("name", e.target.value)}
              placeholder={t("layout.name")}
            />
            <div className="prop-row">
              <span className="prop-label">{t("layout.source")}</span>
              <select className="prop-select" value={selectedItem.source} onChange={(e) => onChangeSelectedSource(e.target.value)}>
                {metadata.sources.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="prop-row">
              <span className="prop-label">{t("layout.widgetType")}</span>
              <select className="prop-select" value={selectedItem.widget} onChange={(e) => onUpdateSelectedItem("widget", e.target.value)}>
                {widgetTypesForSource(metadata, selectedItem.source).map((w) => (
                  <option key={w} value={w}>{widgetTypeLabel(w)}</option>
                ))}
              </select>
            </div>
            {selectedItem.source !== "time" && (() => {
              const transforms = selectedItem.transforms ?? [];
              const setTransforms = (next: string[]) => onUpdateSelectedItem("transforms", next);
              const onDragStart = (i: number) => { dragIndex.current = i; };
              const onDragOver = (e: React.DragEvent, i: number) => {
                e.preventDefault();
                const from = dragIndex.current;
                if (from === i || from === -1) return;
                const next = [...transforms];
                next.splice(i, 0, next.splice(from, 1)[0]);
                dragIndex.current = i;
                setTransforms(next);
              };
              return (
                <details className="inspector-section" open>
                  <summary><span className="section-dot active" />{t("layout.sectionDataPipeline")}</summary>
                  <div className="section-body">
                    <div className="transforms-list">
                      {transforms.map((tr, i) => (
                        <div key={i} className="transform-item">
                          <div className="transform-row" draggable
                            onDragStart={() => onDragStart(i)}
                            onDragOver={(e) => onDragOver(e, i)}
                            onDragEnd={() => { dragIndex.current = -1; }}
                          >
                            <span className="drag-handle">⠿</span>
                            <select className="prop-select" value={tr}
                              onChange={(e) => { const next = [...transforms]; next[i] = e.target.value; setTransforms(next); }}>
                              {(["min", "max", "avg", "%"] as const).map((v) => (
                                <option key={v} value={v}>{t(`layout.transform_${v}`)}</option>
                              ))}
                            </select>
                            <button className="transform-remove" onClick={() => setTransforms(transforms.filter((_, idx) => idx !== i))}>×</button>
                          </div>
                          {tr === "%" && (
                            <div className="transform-options">
                              <span className="prop-label">{t("layout.rangeMin")}</span>
                              <input type="number" className="prop-number wide" value={selectedItem.range_min ?? -1024}
                                onChange={(e) => onUpdateSelectedItem("range_min", Number(e.target.value))} />
                              <span className="prop-label center">{t("layout.rangeCenter")}</span>
                              <input type="number" className="prop-number wide" value={selectedItem.range_center ?? 0}
                                onChange={(e) => onUpdateSelectedItem("range_center", Number(e.target.value))} />
                              <span className="prop-label center">{t("layout.rangeMax")}</span>
                              <input type="number" className="prop-number wide" value={selectedItem.range_max ?? 1024}
                                onChange={(e) => onUpdateSelectedItem("range_max", Number(e.target.value))} />
                            </div>
                          )}
                        </div>
                      ))}
                      <button className="transform-add" onClick={() => setTransforms([...transforms, "min"])}>+ {t("layout.addTransform")}</button>
                    </div>
                  </div>
                </details>
              );
            })()}

            {/* ── Transformación ── */}
            <details className="inspector-section" open>
              <summary><span className="section-dot active" />{t("layout.sectionTransform")}</summary>
              <div className="section-body">
                <div className="prop-subgroup-label">{t("layout.subgroupPosition")}</div>
                <div className="prop-row">
                  <span className="prop-label">X</span>
                  <input type="range" className="prop-slider" min={0.05} max={0.95} step={0.001}
                    value={selectedItem.x}
                    onChange={(e) => onUpdateSelectedNumber("x", e.target.value, 0.05, 0.95)} />
                  <input type="number" className="prop-number" min={0.05} max={0.95} step={0.001}
                    value={Number(selectedItem.x).toFixed(3)}
                    onChange={(e) => onUpdateSelectedNumber("x", e.target.value, 0.05, 0.95)} />
                </div>
                <div className="prop-row">
                  <span className="prop-label">Y</span>
                  <input type="range" className="prop-slider" min={0.05} max={0.95} step={0.001}
                    value={selectedItem.y}
                    onChange={(e) => onUpdateSelectedNumber("y", e.target.value, 0.05, 0.95)} />
                  <input type="number" className="prop-number" min={0.05} max={0.95} step={0.001}
                    value={Number(selectedItem.y).toFixed(3)}
                    onChange={(e) => onUpdateSelectedNumber("y", e.target.value, 0.05, 0.95)} />
                </div>
                {(() => {
                  const [baseW, baseH] = widgetSize(selectedItem.widget);
                  const sc = Math.max(0.2, Math.min(outputWidth / 1920, outputHeight / 1080));
                  const pxW = Math.round(Math.max(32, baseW * sc * selectedItem.scale_x));
                  const pxH = Math.round(Math.max(24, baseH * sc * selectedItem.scale_y));
                  const maxW = Math.round(baseW * sc * 12);
                  const maxH = Math.round(baseH * sc * 12);
                  const minW = Math.round(Math.max(32, baseW * sc * 0.2));
                  const minH = Math.round(Math.max(24, baseH * sc * 0.2));
                  const updateW = (px: number) => { if (Number.isFinite(px) && px >= 1) onUpdateSelectedItem("scale_x", clamp(px / (baseW * sc), 0.2, 12)); };
                  const updateH = (px: number) => { if (Number.isFinite(px) && px >= 1) onUpdateSelectedItem("scale_y", clamp(px / (baseH * sc), 0.2, 12)); };
                  return (
                    <>
                      <div className="prop-subgroup-label">{t("layout.subgroupSize")}</div>
                      <div className="prop-row">
                        <span className="prop-label">W</span>
                        <input type="range" className="prop-slider" min={minW} max={maxW} step={1}
                          value={pxW} onChange={(e) => updateW(Number(e.target.value))} />
                        <input type="number" className="prop-number" min={1} value={pxW}
                          onChange={(e) => updateW(Number(e.target.value))} />
                      </div>
                      <div className="prop-row">
                        <span className="prop-label">H</span>
                        <input type="range" className="prop-slider" min={minH} max={maxH} step={1}
                          value={pxH} onChange={(e) => updateH(Number(e.target.value))} />
                        <input type="number" className="prop-number" min={1} value={pxH}
                          onChange={(e) => updateH(Number(e.target.value))} />
                      </div>
                    </>
                  );
                })()}
              </div>
            </details>

            {/* ── Apariencia ── */}
            <details className="inspector-section" open>
              <summary>
                <span
                  className={`section-dot${selectedItem.shadow_visible !== false ? " active" : ""}`}
                  title={t("layout.shadow")}
                  onClick={(e) => { e.preventDefault(); onUpdateSelectedItem("shadow_visible", selectedItem.shadow_visible === false); }}
                />
                {t("layout.appearance")}
              </summary>
              <div className="section-body">
                <div className="color-grid">
                  {(["accent_color","negative_color","positive_color","text_color","bg_color","outline_color"] as ColorKey[])
                    .map((key) => [key, colorControlLabel(selectedItem, key)] as const)
                    .filter((entry): entry is readonly [ColorKey, string] => entry[1] !== null)
                    .map(([key, labelKey]) => {
                      const isOff =
                        (key === "bg_color" && selectedItem.bg_visible === false) ||
                        (key === "outline_color" && selectedItem.outline_visible === false);
                      const hasToggle = key === "bg_color" || key === "outline_color";
                      const toggleKey = key === "bg_color" ? "bg_visible" : "outline_visible";
                      return (
                        <div key={key} className={`color-cell${isOff ? " off" : ""}`}>
                          <span className="color-cell-label">{t(labelKey)}</span>
                          <div className="color-cell-top">
                            {hasToggle && (
                              <input type="checkbox" className="color-cell-toggle"
                                checked={!isOff}
                                onChange={(e) => onUpdateSelectedItem(toggleKey as keyof LayoutItem, e.target.checked as LayoutItem[keyof LayoutItem])}
                              />
                            )}
                            <div className="color-cell-swatch-wrap"
                              style={{ "--swatch-color": String(selectedItem[key as keyof LayoutItem]) } as React.CSSProperties}
                            >
                              <input type="color" className="color-cell-swatch"
                                disabled={isOff}
                                value={String(selectedItem[key as keyof LayoutItem])}
                                onChange={(e) => onUpdateSelectedItem(key as keyof LayoutItem, e.target.value as never)}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </details>

          </div>
        ) : (
          <div className="empty small">{t("layout.selectOrAdd")}</div>
        )}
      </aside>
    </div>
  );
}
