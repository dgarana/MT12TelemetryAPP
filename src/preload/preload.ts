import { contextBridge, ipcRenderer } from "electron";
import type { BridgeEvent, OverlayApi, UpdaterApi, UpdateStatus } from "../shared/types";

const api: OverlayApi = {
  metadata: () => ipcRenderer.invoke("native:request", "metadata", {}),
  defaultLayout: () => ipcRenderer.invoke("native:request", "default_layout", {}),
  loadSettings: () => ipcRenderer.invoke("native:request", "load_settings", {}),
  saveSettings: (settings) => ipcRenderer.invoke("native:request", "save_settings", { settings }),
  chooseCsv: () => ipcRenderer.invoke("dialog:csv"),
  chooseDirectory: () => ipcRenderer.invoke("dialog:directory"),
  chooseMovOutput: () => ipcRenderer.invoke("dialog:mov"),
  chooseFfmpeg: () => ipcRenderer.invoke("dialog:ffmpeg"),
  loadCsvSummary: (payload) => ipcRenderer.invoke("native:request", "load_csv_summary", payload),
  previewState: (payload) => ipcRenderer.invoke("native:request", "preview_state", payload),
  renderOverlay: (payload) => ipcRenderer.invoke("native:request", "render_overlay", payload),
  discoverRadios: () => ipcRenderer.invoke("native:request", "discover_radios", {}),
  listRadioLogs: (root) => ipcRenderer.invoke("native:request", "list_radio_logs", { root }),
  calibrate: (payload) => ipcRenderer.invoke("native:request", "calibrate", payload),
  createWidget: (payload) => ipcRenderer.invoke("native:request", "create_widget", payload),
  discoverFfmpeg: () => ipcRenderer.invoke("native:request", "discover_ffmpeg", {}),
  downloadFfmpeg: () => ipcRenderer.invoke("native:request", "download_ffmpeg", {}),
  installScripts: (root, lang) => ipcRenderer.invoke("native:request", "install_scripts", { root, lang }),
  onBridgeEvent: (callback) => {
    const listener = (_event: unknown, payload: BridgeEvent) => callback(payload);
    ipcRenderer.on("native:event", listener);
    return () => ipcRenderer.removeListener("native:event", listener);
  },
};

contextBridge.exposeInMainWorld("overlayApi", api);

const updaterApi: UpdaterApi = {
  check: () => ipcRenderer.send("updater:check"),
  download: () => ipcRenderer.send("updater:download"),
  quitAndInstall: () => ipcRenderer.send("updater:quit-and-install"),
  getStatus: () => ipcRenderer.invoke("updater:get-status"),
  onStatus: (callback) => {
    const listener = (_event: unknown, status: UpdateStatus) => callback(status);
    ipcRenderer.on("updater:status", listener);
    return () => ipcRenderer.removeListener("updater:status", listener);
  },
};

contextBridge.exposeInMainWorld("updaterApi", updaterApi);
