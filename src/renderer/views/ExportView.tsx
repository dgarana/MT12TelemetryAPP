import { useTranslation } from "react-i18next";
import {
  Download,
  FolderOpen,
  FolderOutput,
  Play,
  Search,
} from "lucide-react";
import type { AppSettings } from "../../shared/types";
import { Field } from "../components/Field";

export interface ExportViewProps {
  settings: AppSettings;
  busy: boolean;
  ffmpegReady: boolean;
  ffmpegDownloading: boolean;
  progress: { done: number; total: number } | null;
  logs: string[];
  onUpdateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onChooseMovOutput: () => void;
  onAutoDetectFfmpeg: () => void;
  onDownloadFfmpeg: () => void;
  onChooseFfmpeg: () => void;
  onRenderOverlay: () => void;
}

export function ExportView(props: ExportViewProps) {
  const { t } = useTranslation();
  const {
    settings,
    busy,
    ffmpegReady,
    ffmpegDownloading,
    progress,
    logs,
    onUpdateSetting,
    onChooseMovOutput,
    onAutoDetectFfmpeg,
    onDownloadFfmpeg,
    onChooseFfmpeg,
    onRenderOverlay,
  } = props;

  return (
    <div className="view-body export-view">

      <div className="export-form">
        <section className="panel grid">
          <h2>{t("export.renderSettings")}</h2>
          <Field label={t("export.fps")} value={settings.fps} onChange={(v) => onUpdateSetting("fps", v)} />
          <Field label={t("export.width")} value={settings.width} onChange={(v) => onUpdateSetting("width", v)} />
          <Field label={t("export.height")} value={settings.height} onChange={(v) => onUpdateSetting("height", v)} />
          <label className="check wide-field">
            <input
              type="checkbox"
              checked={Boolean(settings.render_video)}
              onChange={(e) => onUpdateSetting("render_video", e.target.checked)}
            />
            {t("export.exportMov")}
          </label>
        </section>

        <section className="panel grid">
          <h2>{t("export.outputPaths")}</h2>
          <Field label={t("export.movOutputPath")} value={settings.video_output} onChange={(v) => onUpdateSetting("video_output", v)} wide />
          <button onClick={onChooseMovOutput}>
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
            onChange={(e) => onUpdateSetting("ffmpeg_path", e.target.value)}
          />
          <div className="row ffmpeg-actions wide-field">
            <button onClick={onAutoDetectFfmpeg} disabled={ffmpegDownloading}>
              <Search size={15} /> {t("export.autoDetect")}
            </button>
            <button
              onClick={onDownloadFfmpeg}
              disabled={ffmpegDownloading}
              className={ffmpegDownloading ? "primary" : ""}
            >
              <Download size={15} /> {ffmpegDownloading ? t("export.downloading") : t("export.download")}
            </button>
            <button
              onClick={onChooseFfmpeg}
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
            onClick={onRenderOverlay}
            disabled={!settings.csv_path || busy}
          >
            <Play size={18} /> {busy ? `${t("export.rendering")} ${progress ? `${progress.done}/${progress.total}` : ""}` : t("export.renderOverlay")}
          </button>
        </div>
      </div>

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
  );
}
