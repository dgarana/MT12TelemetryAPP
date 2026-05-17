import React from "react";
import { useTranslation } from "react-i18next";
import QRCode from "react-qr-code";
import topercLogo from "../assets/toperc-logo.png";
import {
  Antenna,
  ArrowRight,
  FolderOpen,
  RefreshCcw,
} from "lucide-react";
import type { AppSettings, CsvSummary, RadioLog, RadioSource } from "../../shared/types";

export interface SourceViewProps {
  settings: AppSettings;
  summary: CsvSummary | null;
  busy: boolean;
  inputMode: "manual" | "radio";
  radios: RadioSource[];
  radioLogs: RadioLog[];
  selectedRadioRoot: string;
  selectedRadioLog: string;
  onSetInputMode: (mode: "manual" | "radio") => void;
  onChooseCsv: () => void;
  onUpdateCsvPath: (path: string) => void;
  onLoadCsv: (path: string) => void;
  onDiscoverRadios: () => void;
  onSelectRadioSource: (root: string) => void;
  onSetSelectedRadioLog: (path: string) => void;
  onApplyRadioLog: (path: string) => void;
  onGoToLayout: () => void;
}

export function SourceView(props: SourceViewProps) {
  const { t } = useTranslation();
  const {
    settings,
    summary,
    busy,
    inputMode,
    radios,
    radioLogs,
    selectedRadioRoot,
    selectedRadioLog,
    onSetInputMode,
    onChooseCsv,
    onUpdateCsvPath,
    onLoadCsv,
    onDiscoverRadios,
    onSelectRadioSource,
    onSetSelectedRadioLog,
    onApplyRadioLog,
    onGoToLayout,
  } = props;

  return (
    <div className="view-body source-view">
      <div className="source-card source-card-active install-card">

        <div className="mode-toggle">
          <button
            className={`mode-toggle-btn${inputMode === "manual" ? " active" : ""}`}
            onClick={() => onSetInputMode("manual")}
          >
            <FolderOpen size={14} /> {t("source.manualCsvTitle")}
          </button>
          <button
            className={`mode-toggle-btn${inputMode === "radio" ? " active" : ""}`}
            onClick={() => onSetInputMode("radio")}
          >
            <Antenna size={14} /> {t("source.mt12AutoTitle")}
          </button>
        </div>

        <p className="install-mode-desc">
          {inputMode === "manual" ? t("source.manualDesc") : t("source.radioDesc")}
        </p>

        {inputMode === "manual" && (<>
          <button
            className="wide"
            onClick={onChooseCsv}
            disabled={busy}
          >
            <FolderOpen size={17} /> {busy ? t("source.loading") : t("source.browseCsv")}
          </button>
          <input
            className="path"
            value={settings.csv_path ?? ""}
            placeholder={t("source.csvPathPlaceholder")}
            onChange={(e) => onUpdateCsvPath(e.target.value)}
            onBlur={() => {
              if (settings.csv_path && settings.csv_path !== summary?.csv_path)
                onLoadCsv(settings.csv_path);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && settings.csv_path) {
                onLoadCsv(settings.csv_path);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </>)}

        {inputMode === "radio" && (<>
          <button
            className="wide"
            onClick={onDiscoverRadios}
            disabled={busy}
          >
            <RefreshCcw size={17} /> {t("source.scanForUnits")}
          </button>
          <label className="field">
            <span>{t("source.radioUnit")}</span>
            <select value={selectedRadioRoot} onChange={(e) => onSelectRadioSource(e.target.value)}>
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
              onChange={(e) => { onSetSelectedRadioLog(e.target.value); onApplyRadioLog(e.target.value); }}
            >
              <option value="">{t("source.noLogSelected")}</option>
              {radioLogs.map((l) => (
                <option key={l.path} value={l.path}>{l.display_name}</option>
              ))}
            </select>
          </label>
        </>)}

      </div>

      {summary && (
        <div className="source-loaded">
          <div className="summary-bar">
            <span className="summary-chip">{summary.sample_count.toLocaleString()} samples</span>
            <span className="summary-chip">{(summary.duration_ms / 1000).toFixed(2)} s</span>
            <span className="summary-chip summary-chip-path">
              {settings.csv_path?.split(/[\\/]/).pop()}
            </span>
          </div>

          <button className="primary source-continue" onClick={onGoToLayout}>
            {t("source.editLayout")} <ArrowRight size={16} />
          </button>
        </div>
      )}

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
  );
}
