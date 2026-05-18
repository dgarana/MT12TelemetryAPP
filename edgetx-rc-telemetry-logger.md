# EdgeTX RC Input Logger for RadioMaster MT12

## 1. Architecture

### Overview

The logger is split into two layers:

1. **Logging core** (`RCLOG/RCLOGC.lua`)
   - Auto-discovers all available sources at startup.
   - Controls sample rate via `getTime()`.
   - Buffers samples in RAM and flushes to the SD card in batches.
   - Manages recording state and file lifecycle.
   - Writes a stable CSV format for the desktop app.

2. **EdgeTX wrappers**
   - `TELEMETRY/RCLOG.lua` — recommended for real sessions; runs in the background via `background()` while the model is active.
   - `TOOLS/RCLOG.lua` — useful for manual tests launched from `SYSTEM > TOOLS` without touching model configuration.

Both wrappers call the same core. The core is configured via an `options` table passed to `newLoggerApp()`.

### Source discovery

At `init()` the script auto-discovers all available sources by calling `getFieldInfo(name)` for each candidate and storing the returned `id`. Sources that don't exist on the radio are silently skipped.

Discovery order and candidates:

| Group | Names tried |
|-------|-------------|
| Raw inputs (pre-mixer) | `input1` … `input16` |
| Output channels (post-mixer) | `ch1` … `ch16` |
| Switches | `sa` `sb` `sc` `sd` `se` `sf` `sg` `sh` |
| System | `tx-voltage` `timer1` `timer2` `rssi` |
| Telemetry sensors | `RxBt` `Curr` `Cels` `Tmp1` `Tmp2` `RPM` |

At runtime, values are read with `getValue(fieldId)` — a single call per source per tick using the pre-resolved field ID. `getFieldInfo()` is never called inside the sample loop.

### Internal flow

```
init()
  → detect EdgeTX version
  → auto-discover sources (getFieldInfo per candidate)
  → refreshValues() once

background() / run()  [called every EdgeTX tick]
  → refreshValues()   [getValue(fieldId) for each source]
  → sample(nowTick)   [write csvRow to buffer if interval elapsed]
  → shouldFlush()     [flush buffer to SD if threshold reached]

destroy()
  → flushBuffer()     [final write, close file]
```

---

## 2. SD card folder structure

```text
SDCARD/
├── LOGS/
│   ├── 20260512_214501_TT02.csv
│   └── 20260512_220812_TEKNO.csv
└── SCRIPTS/
    ├── RCLOG/
    │   └── RCLOGC.lua        ← shared core
    ├── TELEMETRY/
    │   └── RCLOG.lua         ← telemetry wrapper
    └── TOOLS/
        └── RCLOG.lua         ← tool wrapper
```

Notes:

- `LOGS/` already exists on a normal EdgeTX SD card; the script does not create directories.
- Log filenames follow the pattern `YYYYMMDD_HHMMSS_MODELNAME.csv`. If no RTC is available, a tick-based fallback is used: `t<tick>_MODELNAME.csv`.
- `RCLOGC.lua` is the shared core — never called directly by EdgeTX.

---

## 3. Generated CSV

Values are written **raw** — exactly as returned by `getValue(fieldId)`. No normalization or calibration is applied.

Typical raw value ranges:

| Source type | Range |
|-------------|-------|
| Analog (inputs, channels) | `−1024 … 1024` |
| Switch | `−1024`, `0`, or `1024` (3-pos) / `−1024` or `1024` (2-pos) |
| Telemetry (RxBt, Curr, etc.) | Sensor-dependent units |

Example output with the default 4-channel layout:

```csv
timestamp,input1,input2,ch1,ch2,ch3,ch4,sa,sb,tx-voltage
100,-512,0,-530,10,512,0,-1024,1024,124
104,-490,12,-510,14,512,0,-1024,1024,124
108,-470,24,-492,18,512,0,-1024,1024,124
```

### Conventions

- `timestamp` — `getTime()` ticks, **10 ms each**. The desktop app converts to `time_ms` by subtracting the first tick.
- Column names are exactly the source names discovered at `init()` — whatever `getFieldInfo()` returned for that radio.
- Only sources that existed on the radio at startup appear as columns.
- Values of `0` are written if `getValue()` returns `nil` for a source.

### Sample rate

Fixed at **25 Hz** (`sampleIntervalTicks = 4` ticks of 10 ms). EdgeTX does not guarantee exact callback timing, so sample timing is based on `getTime()` — never on counting callbacks.

### Flush policy

Samples are accumulated in a RAM buffer and written to the SD card in batches:

- After **25 samples** (1 second at 25 Hz), or
- After **100 ticks** (1 second) have elapsed since the last flush — whichever comes first.

The file is opened in append mode, written, and closed immediately after each flush. This minimises the open-file window and limits data loss to at most 1 second of samples if power is cut.

---

## 4. User interface (LCD)

The LCD layout on the MT12 monochrome display:

```
RCLOG TEL                    25Hz
────────────────────────────────
ST  [████████░░░░░░░░░░░░░]  +42%
THR [░░░░░░░░░░█████░░░░░░]  +28%
────────────────────────────────
REC  00:12.4              3108
/LOGS/20260517_180258_TT02.csv
                          ENTER
```

- **ST bar** — live display of `input2` (steering), normalized for display only.
- **THR bar** — live display of `input1` (throttle), normalized for display only.
- **ENTER** — toggles recording on/off.
- While recording: shows elapsed time and total sample count.
- While stopped: shows number of discovered sources and `ENTER` hint.
- Errors and warnings appear in the footer line.

Note: the display normalization (`normalizeRaw`) divides by 1024 and clamps to `−100..100`. This is **only for the bars on screen** — it does not affect the CSV values.

---

## 5. Recording control

ENTER toggles between stopped and recording:

- **Stopped → Recording**: opens (or creates) the session file, writes the CSV header if the file is new, starts sampling.
- **Recording → Stopped**: flushes the buffer and closes the session.
- In Tool mode, EXIT or RTN calls `destroy()` and exits the script.

There is no menu, no calibration wizard, and no pre-recording setup. The script starts immediately on ENTER.

---

## 6. Performance notes

### What the design does

- Resolves all `getFieldInfo()` calls once at `init()` — never inside the sample loop.
- Uses `getValue(fieldId)` (by numeric ID) rather than `getValue("ch1")` (by name) — avoids string lookups on every tick.
- Buffers samples in a Lua table; writes to SD only on flush, not on every sample.
- Opens and closes the file on each flush — no persistent file handle.

### What to avoid when extending

- Calling `getFieldInfo()` inside `background()` or `run()`.
- Keeping a file handle open between flushes.
- Complex `string.format()` calls or large concatenations inside `sample()`.
- Targeting sample rates above 25 Hz in Lua on monochrome radios — the scheduler cannot reliably sustain them.

---

## 7. Video synchronisation

### Practical approach

1. **Primary**: use the `timestamp` field (10 ms ticks) as the session clock.
2. **Sync mark**: create a visible or audible event when recording starts (switch flip, beep) — align this point in the video editor.
3. **Fine offset**: use `offset_ms` in MT12OverlayStudio to correct camera latency or capture-card delay.

### Recommended workflow

1. Record the session video.
2. Press ENTER on the radio to start logging; create a sync mark.
3. Transfer the CSV from the SD card.
4. Load the CSV in MT12OverlayStudio.
5. Adjust `offset_ms` once per session until the overlay aligns.

---

## 8. Official sources

- [EdgeTX Lua Reference Guide](https://luadoc.edgetx.org/)
- [getFieldInfo / getValue](https://luadoc.edgetx.org/2.9/part_iii_-_opentx_lua_api_reference/general-functions-less-than-greater-than-luadoc-begin-general)
- [getTime()](https://luadoc.edgetx.org/lua-api-reference/time/gettime)
- [Telemetry Scripts](https://luadoc.edgetx.org/overview/script-types/telemetry-scripts)
- [One-Time / Tool Scripts](https://luadoc.edgetx.org/2.9/part_i_-_script_type_overview/one-time_scripts)
- [EdgeTX manual for monochrome radios](https://manual.edgetx.org/bw-radios)
- [RadioMaster MT12 product page](https://radiomasterrc.com/products/mt12-surface-radio-controller)
