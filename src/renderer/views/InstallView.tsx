import { useTranslation } from "react-i18next";
import QRCode from "react-qr-code";
import topercLogo from "../assets/toperc-logo.png";
import {
  Antenna,
  Download,
  FolderOpen,
  RefreshCcw,
} from "lucide-react";
import type { RadioSource } from "../../shared/types";

export interface InstallViewProps {
  busy: boolean;
  installMode: "manual" | "auto";
  installDir: string;
  installResult: string[];
  radios: RadioSource[];
  selectedRadioRoot: string;
  onSetInstallMode: (mode: "manual" | "auto") => void;
  onDiscoverRadios: () => void;
  onSetSelectedRadioRoot: (root: string) => void;
  onPickInstallDir: () => void;
  onRunInstall: (root: string) => void;
}

export function InstallView(props: InstallViewProps) {
  const { t } = useTranslation();
  const {
    busy,
    installMode,
    installDir,
    installResult,
    radios,
    selectedRadioRoot,
    onSetInstallMode,
    onDiscoverRadios,
    onSetSelectedRadioRoot,
    onPickInstallDir,
    onRunInstall,
  } = props;

  return (
    <div className="view-body source-view">
      <div className="install-card source-card source-card-active">

        <div className="mode-toggle">
          <button
            className={`mode-toggle-btn${installMode === "manual" ? " active" : ""}`}
            onClick={() => onSetInstallMode("manual")}
          >
            <FolderOpen size={14} /> {t("install.manualTab")}
          </button>
          <button
            className={`mode-toggle-btn${installMode === "auto" ? " active" : ""}`}
            onClick={() => onSetInstallMode("auto")}
          >
            <Antenna size={14} /> {t("install.autoTab")}
          </button>
        </div>

        <p className="install-mode-desc">
          {installMode === "auto" ? t("install.autoDesc") : t("install.manualDesc")}
        </p>

        {installMode === "auto" && (<>
          <button
            className="wide"
            onClick={onDiscoverRadios}
            disabled={busy}
          >
            <RefreshCcw size={17} /> {busy ? t("install.scanning") : t("install.scanForRadio")}
          </button>
          <label className="field">
            <span>{t("install.radioUnit")}</span>
            <select value={selectedRadioRoot} onChange={(e) => onSetSelectedRadioRoot(e.target.value)}>
              <option value="">{t("install.noRadioFound")}</option>
              {radios.map((r) => (
                <option key={r.root} value={r.root}>{r.display_name}</option>
              ))}
            </select>
          </label>
        </>)}

        {installMode === "manual" && (<>
          <button
            className="wide"
            onClick={onPickInstallDir}
            disabled={busy}
          >
            <FolderOpen size={17} /> {t("install.chooseDir")}
          </button>
          <input
            className="path"
            readOnly
            value={installDir}
            placeholder={t("install.noDirSelected")}
          />
        </>)}

        <button
          className="wide"
          onClick={() => onRunInstall(installMode === "auto" ? selectedRadioRoot : installDir)}
          disabled={busy || (installMode === "auto" ? !selectedRadioRoot : !installDir)}
        >
          <Download size={17} /> {installMode === "auto" ? t("install.installToRadio") : t("install.saveScripts")}
        </button>

      </div>

      {installResult.length > 0 && (
        <div className="install-result">
          <p className="install-result-title">{t("install.installedTitle")}</p>
          <ul>
            {installResult.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
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
