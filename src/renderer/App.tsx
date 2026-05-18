import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import {
  Download,
  RefreshCcw,
  Save,
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
  RadioLog,
  RadioSource,
  UpdateStatus,
} from "../shared/types";
import "./styles.css";
import "./i18n";
import {
  api,
  clamp,
  defaultSettings,
  fallbackMetadata,
  interpolateLocalState,
  itemBounds,
  itemName,
  numeric,
  widgetSize,
  widgetTypesForSource,
} from "./utils";
import type { HandleId, ResizePreview, ResizingState } from "./utils";
import { buildRunningStatsArray, getRunningStatsAt, type RunningStats } from "../shared/widgetDraw";
import { CaptureRenderer } from "./components/CaptureRenderer";
import { LangDropdown } from "./components/LangDropdown";
import { SourceView } from "./views/SourceView";
import { LayoutView } from "./views/LayoutView";
import { ExportView } from "./views/ExportView";
import { InstallView } from "./views/InstallView";

function App() {
  const { t, i18n } = useTranslation();

  if (new URLSearchParams(window.location.search).get("capture") === "1") {
    return <CaptureRenderer />;
  }

  const [metadata, setMetadata] = useState<AppMetadata>(fallbackMetadata);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [summary, setSummary] = useState<CsvSummary | null>(null);
  const [previewSamples, setPreviewSamples] = useState<CsvSample[]>([]);
  const [runningStatsArray, setRunningStatsArray] = useState<RunningStats[]>([]);
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
  const [selectedItemId, setSelectedItemId] = useState("");
  const [inputMode, setInputMode] = useState<"manual" | "radio">("manual");
  const [currentView, setCurrentView] = useState<"source" | "layout" | "export" | "install">("source");
  const [installMode, setInstallMode] = useState<"manual" | "auto">("auto");
  const [installDir, setInstallDir] = useState("");
  const [installResult, setInstallResult] = useState<string[]>([]);
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
  const runningStats: RunningStats = useMemo(
    () => getRunningStatsAt(runningStatsArray, previewSamples, previewTime),
    [runningStatsArray, previewSamples, previewTime],
  );
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

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__screenshotLoadCsv = loadCsv;
  }, [loadCsv]);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__screenshotSelectWidget = setSelectedItemId;
    w.__screenshotUpdateLayout = (id: string, updates: Partial<LayoutItem>) => {
      setSettings((current) => ({
        ...current,
        layout: { ...current.layout, [id]: { ...current.layout[id], ...updates } },
      }));
    };
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
      const loadedSamples = loaded.samples || [];
      setPreviewSamples(loadedSamples);
      setRunningStatsArray(buildRunningStatsArray(loadedSamples));
      setMetadata((current) => ({
        ...current,
        sources: loaded.sources.length ? loaded.sources : current.sources,
      }));
      const midPoint = loaded.duration_ms / 2;
      setPreviewTime(midPoint);
      updatePreviewFromSamples(loadedSamples, midPoint);
      pushSourceLog(t("logs.loadedSamples", { count: loaded.sample_count }));
    } catch (error) {
      pushSourceLog(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function refreshPreview(path = settings.csv_path, timeMs = previewTime, sourceSettings = settings) {
    if (!path) return;
    if (previewSamples.length) {
      setPreviewState(interpolateLocalState(previewSamples, timeMs));
      return;
    }
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    try {
      const result = await api.previewState({
        csv_path: path,
        offset_ms: sourceSettings.offset_ms,
        time_ms: timeMs,
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
      updatePreviewFromSamples(previewSamples, pendingPreviewTimeRef.current);
    });
  }

  function updatePreviewFromSamples(samples: CsvSample[], timeMs: number) {
    if (!samples.length) {
      void refreshPreview(settings.csv_path, timeMs, latestSettingsRef.current);
      return;
    }
    setPreviewState(interpolateLocalState(samples, timeMs));
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
      setSettings((current) => ({ ...current, settings_path: saved.settings_path }));
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
  }

  async function runInstall(root: string) {
    if (!root) return;
    setBusy(true);
    setInstallResult([]);
    try {
      const result = await api.installScripts(root);
      setInstallResult(result.installed);
    } catch (error) {
      setInstallResult([error instanceof Error ? error.message : String(error)]);
    } finally {
      setBusy(false);
    }
  }

  async function pickInstallDir() {
    const dir = await api.chooseDirectory();
    if (dir) setInstallDir(dir);
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

  function scheduleResizePreview(preview: ResizePreview) {
    resizePreviewRef.current = preview;
    if (resizeRafRef.current !== null) return;
    resizeRafRef.current = window.requestAnimationFrame(() => {
      resizeRafRef.current = null;
      setResizePreview(resizePreviewRef.current);
    });
  }

  function locateResizeHandle(frameX: number, frameY: number): HandleId | null {
    if (!selectedItemId || !previewStageRef.current) return null;
    const item = settings.layout[selectedItemId];
    if (!item) return null;
    const [l, t, r, b] = boundsForPreviewItem(selectedItemId, item);
    const mx = (l + r) / 2;
    const my = (t + b) / 2;
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

  function handlePreviewPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const point = previewPointerToFrame(event);

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

    panStartRef.current = { cx: event.clientX, cy: event.clientY, ox: previewOffset.x, oy: previewOffset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePreviewPointerMove(event: React.PointerEvent<HTMLDivElement>) {
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

    if (panStartRef.current) {
      setPreviewOffset({
        x: panStartRef.current.ox + event.clientX - panStartRef.current.cx,
        y: panStartRef.current.oy + event.clientY - panStartRef.current.cy,
      });
      return;
    }

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

    const point = previewPointerToFrame(event);
    if (point) {
      const handle = locateResizeHandle(point.x, point.y);
      if (handle) {
        const HANDLE_CURSORS: Record<HandleId, string> = {
          nw: "nw-resize", n: "n-resize", ne: "ne-resize",
          w: "w-resize", e: "e-resize",
          sw: "sw-resize", s: "s-resize", se: "se-resize",
        };
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

    if (panStartRef.current) {
      panStartRef.current = null;
      release();
      return;
    }

    if (draggingItemRef.current) {
      const committed = dragPreviewRef.current;
      if (committed) moveWidget(committed.itemId, committed.x, committed.y);
      draggingItemRef.current = null;
      dragPreviewRef.current = null;
      setDragPreview(null);
      release();
    }
  }

  return (
    <main className="shell">

      <header className="topbar">
        <div className="topbar-brand">
          <h1>{t("appTitle")}</h1>
          {summary && (
            <p>{summary.sample_count.toLocaleString()} {t("topbar.samplesUnit")} · {(summary.duration_ms / 1000).toFixed(1)} s</p>
          )}
        </div>

        <nav className="view-nav">
          <button
            className={`nav-step${currentView === "install" ? " active" : ""}`}
            onClick={() => setCurrentView("install")}
          >
            <span className="step-badge">⬇</span> {t("nav.install")}
          </button>
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

      {currentView === "source" && (
        <SourceView
          settings={settings}
          summary={summary}
          busy={busy}
          inputMode={inputMode}
          radios={radios}
          radioLogs={radioLogs}
          selectedRadioRoot={selectedRadioRoot}
          selectedRadioLog={selectedRadioLog}
          onSetInputMode={setInputMode}
          onChooseCsv={() => void chooseCsv()}
          onUpdateCsvPath={(path) => updateSetting("csv_path", path)}
          onLoadCsv={(path) => void loadCsv(path, settings)}
          onDiscoverRadios={() => void discoverRadios()}
          onSelectRadioSource={(root) => void selectRadioSource(root)}
          onSetSelectedRadioLog={setSelectedRadioLog}
          onApplyRadioLog={(path) => void applyRadioLog(path)}
          onGoToLayout={() => setCurrentView("layout")}
        />
      )}

      {currentView === "layout" && (
        <LayoutView
          settings={settings}
          metadata={metadata}
          summary={summary}
          previewState={previewState}
          runningStats={runningStats}
          previewTime={previewTime}
          selectedItemId={selectedItemId}
          selectedItem={selectedItem}
          layoutItems={layoutItems}
          outputWidth={outputWidth}
          outputHeight={outputHeight}
          previewCursor={previewCursor}
          previewZoom={previewZoom}
          previewOffset={previewOffset}
          previewStageRef={previewStageRef}
          boundsForPreviewItem={boundsForPreviewItem}
          onPointerDown={handlePreviewPointerDown}
          onPointerMove={handlePreviewPointerMove}
          onPointerUp={handlePreviewPointerUp}
          onPointerLeave={() => setPreviewCursor("default")}
          onWheel={handlePreviewWheel}
          onSetSelectedItemId={setSelectedItemId}
          onAddWidget={() => void addWidget()}
          onDuplicateWidget={() => void duplicateWidget()}
          onDeleteWidget={deleteWidget}
          onResetLayout={resetLayout}
          onChangeSelectedSource={changeSelectedSource}
          onUpdateSelectedItem={updateSelectedItem}
          onUpdateSelectedNumber={updateSelectedNumber}
          onUpdateSetting={updateSetting}
          onTimelineChange={(n) => { setPreviewTime(n); schedulePreviewAt(n); }}
          onTimelineMouseUp={(n) => void refreshPreview(settings.csv_path, n)}
          onStepZoom={stepZoom}
          onResetPreviewView={resetPreviewView}
          onGoToSource={() => setCurrentView("source")}
        />
      )}

      {currentView === "export" && (
        <ExportView
          settings={settings}
          busy={busy}
          ffmpegReady={ffmpegReady}
          ffmpegDownloading={ffmpegDownloading}
          progress={progress}
          logs={logs}
          onUpdateSetting={updateSetting}
          onChooseMovOutput={async () => { const p = await api.chooseMovOutput(); if (p) updateSetting("video_output", p); }}
          onAutoDetectFfmpeg={() => void autoDetectFfmpeg()}
          onDownloadFfmpeg={() => void handleDownloadFfmpeg()}
          onChooseFfmpeg={async () => { const p = await api.chooseFfmpeg(); if (p) updateSetting("ffmpeg_path", p); }}
          onRenderOverlay={() => void renderOverlay()}
        />
      )}

      {currentView === "install" && (
        <InstallView
          busy={busy}
          installMode={installMode}
          installDir={installDir}
          installResult={installResult}
          radios={radios}
          selectedRadioRoot={selectedRadioRoot}
          onSetInstallMode={(mode) => { setInstallMode(mode); setInstallResult([]); }}
          onDiscoverRadios={() => void discoverRadios()}
          onSetSelectedRadioRoot={setSelectedRadioRoot}
          onPickInstallDir={() => void pickInstallDir()}
          onRunInstall={(root) => void runInstall(root)}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
