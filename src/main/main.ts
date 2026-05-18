import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { handleNativeCommand } from "./nativeApi";
import { initUpdater, checkForUpdates, downloadUpdate, quitAndInstall, getLastUpdaterStatus } from "./updater";
import { runScreenshots } from "./screenshots";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "local-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#101418",
    title: "MT12OverlayStudio",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (app.isPackaged || process.env.MT12_ELECTRON_FILE === "1") {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  } else {
    win.loadURL(process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173");
  }

  if (process.env.MT12_SCREENSHOT === "1") {
    win.webContents.once("did-finish-load", () => {
      runScreenshots(win).catch((err) => {
        console.error("Screenshot error:", err);
        app.exit(1);
      });
    });
  }

  if (process.env.MT12_ELECTRON_SMOKE === "1") {
    win.webContents.once("did-finish-load", async () => {
      try {
        const result = await win.webContents.executeJavaScript(`
          (async () => {
            const metadata = await window.overlayApi.metadata();
            const settings = await window.overlayApi.loadSettings();
            const radios = await window.overlayApi.discoverRadios();
            const csvPath = ${JSON.stringify(process.env.MT12_SMOKE_CSV || "")};
            let preview = null;
            if (csvPath) {
              const summary = await window.overlayApi.loadCsvSummary({ csv_path: csvPath, offset_ms: 0 });
            preview = await window.overlayApi.previewState({
                csv_path: csvPath,
                time_ms: Math.min(1000, summary.duration_ms),
                layout: settings.layout,
                calibration: settings.calibration,
              });
            }
            return {
              sourceCount: metadata.sources.length,
              layoutCount: Object.keys(settings.layout || {}).length,
              radioCount: radios.sources.length,
              previewOk: preview ? Boolean(preview.state) : null,
            };
          })();
        `);
        console.log(`MT12_ELECTRON_SMOKE ${JSON.stringify(result)}`);
        app.quit();
      } catch (error) {
        console.error("MT12_ELECTRON_SMOKE_ERROR", error);
        app.exit(1);
      }
    });
  }
}

app.whenReady().then(() => {
  protocol.handle("local-file", (request) => {
    const filePath = decodeURIComponent(new URL(request.url).pathname.replace(/^\/([A-Za-z]:\/)/, "$1"));
    return fetch(pathToFileURL(filePath).toString());
  });

  ipcMain.handle("native:request", (event, command: string, payload: Record<string, unknown>) => {
    const emit = (bridgeEvent: unknown) => {
      if (!event.sender.isDestroyed()) event.sender.send("native:event", bridgeEvent);
    };
    return handleNativeCommand(command, payload, emit);
  });

  ipcMain.handle("dialog:csv", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select EdgeTX CSV",
      properties: ["openFile"],
      filters: [
        { name: "CSV files", extensions: ["csv"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("dialog:directory", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select output frames directory",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("dialog:mov", async () => {
    const result = await dialog.showSaveDialog({
      title: "Select overlay video output",
      defaultPath: "overlay.mov",
      filters: [
        { name: "QuickTime MOV", extensions: ["mov"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle("dialog:ffmpeg", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select ffmpeg executable",
      properties: ["openFile"],
      filters: [
        { name: "Executable", extensions: process.platform === "win32" ? ["exe"] : ["*"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.on("updater:check", () => checkForUpdates());
  ipcMain.on("updater:download", () => downloadUpdate());
  ipcMain.on("updater:quit-and-install", () => quitAndInstall());
  ipcMain.handle("updater:get-status", () => getLastUpdaterStatus());

  initUpdater();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
