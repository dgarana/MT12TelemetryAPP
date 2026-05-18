import { app } from "electron";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";

const SETTLE_MS  = 1800;  // initial render settle
const NAV_MS     = 700;   // wait after clicking a nav tab
const CSV_MS     = 1500;  // wait after loading a CSV (React state + canvas repaint)

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function navigateTo(win: BrowserWindow, view: string) {
  await win.webContents.executeJavaScript(`
    (() => {
      const btns = Array.from(document.querySelectorAll('.nav-step'));
      const target = btns.find(b => b.textContent.toLowerCase().includes('${view}'));
      if (target) { target.click(); return true; }
      const idx = { source: 1, layout: 2, export: 3 }['${view}'];
      if (idx !== undefined && btns[idx]) { btns[idx].click(); return true; }
      return false;
    })()
  `);
  await sleep(NAV_MS);
}

async function loadCsvIntoApp(win: BrowserWindow, csvPath: string) {
  await win.webContents.executeJavaScript(`
    (async () => {
      const fn = window.__screenshotLoadCsv;
      if (typeof fn === 'function') await fn(${JSON.stringify(csvPath)});
    })()
  `);
  await sleep(CSV_MS);
}

async function capture(win: BrowserWindow, outDir: string, name: string, rect?: Electron.Rectangle) {
  const image = await win.webContents.capturePage(rect);
  const filePath = path.join(outDir, `${name}.png`);
  writeFileSync(filePath, image.toPNG());
  console.log(`  saved: ${filePath}`);
}

export async function runScreenshots(win: BrowserWindow) {
  const outDir = path.join(app.getAppPath(), "docs", "screenshots");
  mkdirSync(outDir, { recursive: true });

  console.log("MT12OverlayStudio — screenshot mode");
  console.log(`  output dir: ${outDir}`);

  await sleep(SETTLE_MS);

  const csvPath = process.env.MT12_SCREENSHOT_CSV || "";

  // Install view
  console.log("  capturing: install");
  await navigateTo(win, "install");
  await capture(win, outDir, "install");

  // Source view — before loading CSV so it shows the empty/initial state
  console.log("  capturing: source");
  await navigateTo(win, "source");
  await capture(win, outDir, "source");

  // Load CSV so layout and export views show real data
  if (csvPath) {
    console.log(`  loading CSV: ${csvPath}`);
    await loadCsvIntoApp(win, csvPath);
  }

  // Layout view — widgets animated with CSV data
  console.log("  capturing: layout");
  await navigateTo(win, "layout");
  await capture(win, outDir, "layout");

  // Export view
  console.log("  capturing: export");
  await navigateTo(win, "export");
  await capture(win, outDir, "export");

  // Transforms detail — go back to layout, configure ch1 with % transform, crop inspector
  console.log("  capturing: transforms");
  await navigateTo(win, "layout");
  await win.webContents.executeJavaScript(`
    (() => {
      const sel = window.__screenshotSelectWidget;
      const upd = window.__screenshotUpdateLayout;
      if (sel) sel('item_ch1_1');
      if (upd) upd('item_ch1_1', { transforms: ['%'], range_min: -1024, range_center: 0, range_max: 1024 });
    })()
  `);
  await sleep(700);
  // Crop to the inspector panel (right side of the window)
  const [width, height] = win.getContentSize();
  const inspectorX = Math.round(width * 0.727);
  await capture(win, outDir, "transforms", { x: inspectorX, y: 60, width: width - inspectorX, height: height - 60 });

  console.log("  done.");
  app.quit();
}
