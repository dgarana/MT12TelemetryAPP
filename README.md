# MT12 Telemetry

Desktop app for creating professional RC telemetry video overlays from RadioMaster MT12 sessions. Records channel data via Lua scripts on the radio, then generates frame-accurate transparent video overlays you can composite in any editor.

Built with **Electron 33 · React 19 · TypeScript 5.6 · Vite 7**.

---

## What it does

The workflow has three steps, mirrored in the app's tab navigation:

### 1 · Source
Load a telemetry CSV from your radio, either manually or by plugging the MT12 in via USB and letting the app discover it automatically.

- **Manual CSV** — browse to any `.csv` file or paste a path directly
- **MT12 Unit (Auto)** — scans connected drives for an EdgeTX SD card, lists available log files by model and date
- **Install Scripts to SD** — copies the bundled Lua logger scripts to the radio's SD card in one click

### 2 · Layout
Visual overlay editor. Drag widgets onto a live preview of your frame, resize them, and style every color.

- **Widget types** — `wheel` (steering), `vertical_bar` (throttle/brake), `bar` (horizontal channel), `circle` (gauge), `text` (value label or timer)
- **Sources** — `time` (session clock) plus any channel present in the CSV (`ch1`, `ch2`, … `chN`)
- **Preview timeline** — scrub through the session to see live animated widget values
- **Zoom & pan** — mouse wheel to zoom, drag the background to pan; zoom controls in the timeline bar
- **Inspector** — name, label, position (X/Y as frame fractions), pixel size, shadow toggle, and per-widget color controls for each visual element
- **Calibration-aware** — values are normalized using per-channel offsets recorded during the guided calibration on the radio

### 3 · Export
Render the overlay to a sequence of PNG frames and optionally encode a transparent ProRes 4444 MOV using ffmpeg.

- Configure FPS, output resolution (width × height), and output paths
- Progress bar with frame counter during rendering
- ffmpeg auto-detect (PATH search), auto-download, or manual path selection
- Export MOV is transparency-ready for compositing over any video in DaVinci Resolve, Premiere, Final Cut, etc.

---

## Lua logger scripts

The `edgetx/sdcard/SCRIPTS/` folder contains the Lua scripts that run on the radio and write CSV data to the SD card.

```
SCRIPTS/
├── RCLOG/
│   └── RCLOGC.lua        ← shared core module
├── TELEMETRY/
│   └── RCLOG.lua         ← telemetry script (runs in background during flight)
└── TOOLS/
    └── RCLOG.lua         ← one-time tool script (launch from SYSTEM > TOOLS)
```

The **Telemetry** variant is recommended for real sessions — it runs via `background()` and logs while the model is active. The **Tools** variant is useful for quick tests without touching model configuration.

### Automatic installation

Connect the MT12 via USB, open the **Source** tab in MT12 Telemetry, select the radio unit, choose the script language, and click **Install Scripts to SD**. The app copies the three files to the correct locations automatically.

### Manual installation

1. Connect the MT12 to your PC via USB and open the SD card (e.g. `E:\`).
2. Copy the files from `edgetx/sdcard/SCRIPTS/` in this repo to the matching folders on the SD card:

   | File in repo | Destination on SD card |
   |---|---|
   | `RCLOG/RCLOGC.lua` | `SCRIPTS/RCLOG/RCLOGC.lua` |
   | `TELEMETRY/RCLOG.lua` | `SCRIPTS/TELEMETRY/RCLOG.lua` |
   | `TOOLS/RCLOG.lua` | `SCRIPTS/TOOLS/RCLOG.lua` |

3. Open `SCRIPTS/TELEMETRY/RCLOG.lua` and `SCRIPTS/TOOLS/RCLOG.lua` in a text editor and set the `lang` option to your preferred language:

   ```lua
   local app = newLoggerApp({
     mode = "telemetry",
     scriptLabel = "RCLOG TEL",
     lang = "es",   -- "en" | "es" | "de" | "fr"
   })
   ```

4. Safely eject the SD card and reinsert it in the radio.
5. On the radio, go to **MODEL > Telemetry** and add a new telemetry script pointing to `RCLOG`. The script will start logging automatically when the model is active.
6. Optionally, the Tools variant is available under **SYSTEM > Tools > RC Input Logger** for manual one-off sessions.

### CSV format

```csv
timestamp,ch1,ch2,ch3,ch4
100,-100,0,12,0
20,-20,64,10,0
```

- `timestamp` — `getTime()` ticks (10 ms each)
- Channel values — raw output values from the mixer (`getOutputValue()`), normalized to `−100..100` after calibration
- The app auto-detects the scale mode (`percent` vs `legacy`) from the value range

### Guided calibration on the radio

Before recording, the Lua script walks through a 5-step calibration:

| Step | Action |
|------|--------|
| 1/5 | Sticks centered |
| 2/5 | Full left (CH1 min) |
| 3/5 | Full right (CH1 max) |
| 4/5 | Full throttle (CH2 max) |
| 5/5 | Full reverse (CH2 min) |

Each step is confirmed with `ENTER`. The recorded offsets are stored in the app settings and applied during preview and export.

---

## Internationalisation

The UI is available in four languages selectable at runtime from the topbar:

| Code | Language |
|------|----------|
| `en` | English |
| `es` | Español |
| `de` | Deutsch |
| `fr` | Français |

The selected language persists in `localStorage`. Translation files live in `src/renderer/locales/{lang}/translation.json`.

---

## Development

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- ffmpeg on PATH (optional — the app can download it automatically)

### Install

```powershell
npm install
```

### Run

| Command | Description |
|---------|-------------|
| `npm start` | Full build → open Electron from dist files |
| `npm run start:dev` | Vite dev server + Electron with hot reload |
| `npm run build` | TypeScript + Vite production build |
| `npm run typecheck` | Type-check renderer and main process without building |
| `npm run smoke` | Non-interactive smoke test (build + quick IPC check) |

`start:dev` is the fastest iteration loop — Vite handles the renderer with HMR while the main process is rebuilt on demand.

### Project layout

```
src/
├── renderer/             # React UI (single App.tsx + styles)
│   ├── App.tsx           # All UI logic and state
│   ├── styles.css        # Dark theme styles
│   ├── i18n.ts           # i18next initialisation + language persistence
│   └── locales/          # Translation JSON files
│       ├── en/translation.json
│       ├── es/translation.json
│       ├── de/translation.json
│       └── fr/translation.json
├── main/
│   ├── main.ts           # Electron window, IPC routing, file dialogs
│   ├── nativeApi.ts      # Backend logic: CSV parsing, rendering, radio discovery
│   ├── frameRenderer.ts  # @napi-rs/canvas frame drawing
│   └── updater.ts        # electron-updater (GitHub Releases)
├── preload/
│   └── preload.ts        # contextBridge — overlayApi + updaterApi to renderer
└── shared/
    └── types.ts          # TypeScript interfaces shared across processes
edgetx/
└── sdcard/SCRIPTS/       # Lua logger scripts for the RadioMaster MT12
edgetx-rc-telemetry-logger.md   # Detailed Lua logger design reference
```

---

## Distribution

Builds a native installer for each platform.

```powershell
npm run dist          # current platform
npm run dist:win      # Windows NSIS installer
npm run dist:mac      # macOS DMG (arm64 + x64)
npm run dist:linux    # Linux AppImage + deb
```

Output goes to `release/`. Auto-updates are published via GitHub Releases (`dgarana/MT12TelemetryAPP`). The bundled Lua scripts are included as extra resources so **Install Scripts to SD** works without internet access.

---

## Architecture notes

### IPC bridge

The renderer calls `window.overlayApi.*` methods (defined in `preload.ts`). Each call becomes `ipcRenderer.invoke("native:request", command, payload)` routed to `handleNativeCommand()` in `nativeApi.ts`. Long-running operations (render, ffmpeg download) stream progress back via `emit()` → `ipcMain.send("native:event")` → the `onBridgeEvent` callback in the renderer.

### Frame rendering

`nativeApi.ts` drives the render loop: it interpolates CSV samples frame-by-frame, updates the layout state, and calls `renderFrameToCanvas()` which uses `@napi-rs/canvas` to draw each widget. If `render_video` is enabled, ffmpeg is spawned to encode the PNG sequence into ProRes 4444 MOV.

### Widget preview in the renderer

The renderer keeps its own in-memory copy of CSV samples (`previewSamples`) and runs the same linear-interpolation logic as the main process. This lets the timeline slider scrub smoothly without any IPC round-trips.

### Settings persistence

Settings (layout, colors, paths, calibration, ffmpeg path) are saved to `overlay_ui_settings.json` in the Electron `userData` directory:

| Platform | Path |
|----------|------|
| Windows  | `%APPDATA%\MT12TelemetryAPP\` |
| macOS    | `~/Library/Application Support/MT12TelemetryAPP/` |
| Linux    | `~/.config/MT12TelemetryAPP/` |

---

## Made by

**TopeRC** · RC crawling and trail driving content in Spanish.

▶ [youtube.com/@TopeRC-es](https://www.youtube.com/@TopeRC-es)
