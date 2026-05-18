// Generates docs/example_session.csv — a 30-second RC crawling demo session.
const fs   = require("fs");
const path = require("path");

const TICK_START = 1000;
const TICK_STEP  = 4;       // 25 Hz
const DURATION_S = 30;
const N          = DURATION_S * 25;

const cols = [
  "timestamp", "input1", "input2",
  ...Array.from({ length: 14 }, (_, i) => `input${i + 3}`),
  "ch1", "ch2", "ch3", "ch4",
  ...Array.from({ length: 12 }, (_, i) => `ch${i + 5}`),
  "sa", "sb", "sc", "sd", "tx-voltage", "timer1", "timer2",
];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function wave(t, freq, phase = 0) {
  return Math.sin(2 * Math.PI * freq * t + phase);
}

function smoothNoise(t) {
  return 0.6 * wave(t, 0.7) + 0.3 * wave(t, 1.61, 1.1) + 0.1 * wave(t, 3.99, 2.7);
}

const rows = [];
for (let i = 0; i < N; i++) {
  const t    = i / 25;
  const tick = TICK_START + i * TICK_STEP;

  // Steering (ch1 / input2): slow turns with micro-corrections
  const steerRaw =
    80 * wave(t, 0.08) +
    30 * wave(t, 0.25, 0.5) +
    8  * smoothNoise(t);
  const steer = clamp(Math.round(steerRaw), -100, 100);

  // Throttle (ch2 / input1): crawling forward, two reverses
  let thrRaw;
  if (t > 8 && t < 10)        thrRaw = -40 - 10 * wave(t - 8, 0.5);
  else if (t > 22 && t < 24)  thrRaw = -30 -  8 * wave(t - 22, 0.5);
  else thrRaw = 55 + 25 * wave(t, 0.06, 0.8) + 10 * smoothNoise(t * 0.57);
  const throttle = clamp(Math.round(thrRaw), -100, 100);

  // ch3: winch engaged 15–18 s
  const ch3 = (t >= 15 && t <= 18) ? 100 : 0;
  // ch4: lights on after 5 s
  const ch4 = t >= 5 ? 100 : 0;

  const voltage = Math.round((8.4 - (t / DURATION_S) * 0.6) * 10) / 10;
  const timer1  = i * TICK_STEP;

  rows.push([
    tick, throttle, steer,
    ...Array(14).fill(0),
    steer, throttle, ch3, ch4,
    ...Array(12).fill(0),
    -1024, -1024, -1024, -1024,
    voltage, timer1, 0,
  ]);
}

fs.mkdirSync("docs", { recursive: true });
const outPath = path.join("docs", "example_session.csv");
const lines   = [cols.join(","), ...rows.map((r) => r.join(","))];
fs.writeFileSync(outPath, lines.join("\r\n") + "\r\n");
console.log(`Written ${rows.length} rows → ${outPath}`);
