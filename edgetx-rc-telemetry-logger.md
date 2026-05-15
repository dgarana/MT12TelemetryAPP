# EdgeTX RC Input Logger for RadioMaster MT12

## 1. Recommended architecture

### Architecture goal

Split the system into two layers:

1. **Logging core**
   - Channel and switch reading.
   - Sample-rate control.
   - RAM buffer.
   - Batched SD writes.
   - Recording state management.
   - Stable CSV format for post-production.

2. **EdgeTX wrappers**
   - `Telemetry Script`: recommended mode for live use on the bench or track.
   - `Tool Script`: useful for manual tests or one-off sessions.

### Why this architecture

- The core is decoupled from the script type and can be reused as-is.
- The `Telemetry` version can record in the background via `background()`.
- The `Tool` version lets you launch the logger from `SYSTEM > TOOLS` without touching the model configuration.
- The CSV format stays stable for the desktop app, Python, DaVinci Resolve, and any future replay tooling.

### Important technical decision

For channels the script prioritises `getOutputValue(outputIndex)` over `getValue("ch1")`.

Reason:

- `getOutputValue(0)` reads the **final output of CH1** directly by zero-based index.
- It avoids a source-name lookup on every call.
- It is more explicit when the goal is to log the post-mixer channel output.

`getFieldInfo("ch1")` is used once at startup for validation and as a fallback compatibility check.

### Internal logger flow

1. `init()`
   - Detects EdgeTX version.
   - Resolves configured channels.
   - Resolves optional switches.
   - Initialises buffer and state.

2. `background()`
   - Refreshes current values.
   - Samples according to `getTime()`.
   - Flushes in batches when due.

3. `run()`
   - Handles menu and key events.
   - Calls the same internal service loop.
   - Draws state on the LCD.

4. `destroy()`
   - Forces a final flush.
   - Closes any open handles.
   - Leaves state consistent.

---

## 2. SD card folder structure

```text
SDCARD/
├── LOGS/
│   ├── 20260512_214501_TT02.csv
│   └── 20260512_220812_TEKNO.csv
└── SCRIPTS/
    ├── RCLOG/
    │   └── RCLOGC.lua
    ├── TELEMETRY/
    │   └── RCLOG.lua
    └── TOOLS/
        └── RCLOG.lua
```

Notes:

- `RCLOG.lua` respects the short filename limit for scripts on monochrome EdgeTX radios.
- `RCLOGC.lua` is the shared core.
- `LOGS/` already exists on a normal EdgeTX SD card; the script does not create directories.
- Log filenames follow the pattern `YYYYMMDD_HHMMSS_MODELNAME.csv`. If no RTC is available a tick-based fallback name is used: `t<tick>_MODELNAME.csv`.

---

## 3. Generated CSV

All channel values in the CSV are **normalised** by `applyChannelCalibration` before being written, regardless of whether the guided calibration wizard has been run:

- **Without guided calibration**: a simple linear normalisation — `roundNearest((value × 100) / 1024)` — is applied to every channel. This keeps values in approximately `−100..100`.
- **With guided calibration** (CH1 and CH2 only): the actual measured travel is used, so `−100` and `100` match the real endpoints of the stick/wheel/trigger on that specific radio and model.

Example output:

```csv
timestamp,ch1,ch2,ch3,ch4
100,-95,0,50,0
100,-93,3,50,0
100,-90,6,50,0
```

### Conventions

- `timestamp` uses `getTime()` units — **10 ms ticks**.
- All channel values are normalised to approximately `−100..100`.
- `0` represents the real centre. `−100` is full left/reverse, `100` is full right/forward.
- After guided calibration, CH1 and CH2 reflect the actual travel of that specific radio/model, correcting asymmetric trims, subtrims, or EPA.
- CH3/CH4 use the simple fixed normalisation (`÷ 1024 × 100`) and are not affected by the calibration wizard.

### Guided calibration at recording start

Current on-screen flow:

1. Opening the script shows a two-item menu.
2. You can choose `Start Recording` or `Calibrate`.
3. `Calibrate` launches the guided assistant.
4. Each step is confirmed manually by pressing **ENTER**.
5. `Start Recording` begins writing the CSV using the last available calibration.

Wizard steps:

1. `STEP 1/5`: release the wheel and trigger to centre.
2. `STEP 2/5`: full left turn.
3. `STEP 3/5`: full right turn.
4. `STEP 4/5`: full throttle.
5. `STEP 5/5`: full reverse.
6. The script records the raw CH1 and CH2 values at each confirmed position and computes the real centre and travel range.

At each step you move the radio to the requested position and press **ENTER**. The script captures the current raw value of CH1 and CH2 at that instant as the reference for that step. No samples are written to the CSV during calibration.

This is better than a simple "neutral" calibration because it:

- determines the real steering centre from the left/right extremes,
- determines the real throttle centre from the gas/reverse extremes,
- learns the actual travel used on this specific radio and model,
- and reduces problems from trim, subtrim, or asymmetric endpoints.

---

## 4. Possible future improvements

### Professional overlay for crawler / trail driving

- Steering wheel overlay derived from CH1.
- Throttle/brake bar derived from CH2.
- Named switch indicators.
- Winch state from a dedicated channel or switch.
- Light state from a switch or proportional channel.
- Diff lock, 2WD/4WD, DIG indicators, etc.

### Replay and analytics

- CSV session player in Python.
- Synchronisation with video via manual offset and a start clap/beep.
- Export to an intermediate JSON format for complex compositors.
- Input analysis: full-throttle time, braking events, steering jitter, etc.

### DaVinci Resolve integration

- CSV → normalised JSON for Fusion.
- CSV → PNG sequence with alpha channel.
- CSV → Fusion macro generator.
- Templates for wheel, trigger, bars, and crawler iconography.

---

## 5. Performance recommendations

### What to do

- Keep sampling at `10 Hz` or `20 Hz`.
- Write to the SD card in blocks only, not on every sample.
- Open the file only during a flush.
- Close immediately after each flush.
- Use `getOutputValue()` for final channel outputs.
- Call `getFieldInfo()` only once at startup, never inside the sample loop.

### What to avoid

- Calling `getValue("ch1")` by name on every frame.
- Keeping a file handle open throughout the entire session.
- Drawing large amounts of text or complex layouts on every iteration.
- Large `string.format()` calls or unnecessary concatenations on every tick.
- Attempting high sample rates like `50 Hz` in Lua on monochrome radios for this use case.

### Actual execution frequency

EdgeTX does not guarantee that `run()` and `background()` fire with exactly the same period every time.

Consequences:

- The script **must not assume** an exact 10 Hz or 20 Hz callback.
- Sample timing must be based on `getTime()`, not on counting callbacks.
- If the scheduler delays an iteration, the next sample must use the real clock — never synthesise intermediate values.

### SD I/O and corruption

The main real risk on RC radios is not "corruption from appending" but rather:

- power cut during a write,
- too many small writes,
- unflushed buffers at exit,
- file handles left open too long.

The design addresses this by:

- buffering several samples in RAM,
- flushing every 10 samples or at least once per second,
- writing in append mode,
- closing the file immediately after each flush,
- and doing a final flush on `STOP`.

If the user forces the script to close or cuts power, everything already written to the SD is intact; at most the samples still in RAM are lost.

---

## 6. Video synchronisation system

### Practical recommendation

Use three levels of synchronisation:

1. **Primary sync via EdgeTX timestamp**
   - `timestamp` field in 10 ms ticks.

2. **Visible/audible sync mark when REC starts**
   - A beep, haptic, or visible switch change on the video.
   - That point is aligned in post-production.

3. **Manual offset in the overlay generator**
   - `offset_ms` parameter in MT12 Telemetry.
   - Corrects camera latency, capture card delay, or recording start offset.

### Recommended pipeline

1. Record the session video.
2. Start the logger and create a visible or audible sync mark.
3. Export the CSV from the SD card.
4. Process the CSV in the desktop app (MT12 Telemetry).
5. Generate the overlay or intermediate data for DaVinci Resolve.
6. Adjust `offset_ms` once per session.

### Preparation for a professional pipeline

Recommended future CSV fields:

- `session_id`
- `model_name`
- `radio_name`
- `rate_hz`
- `timestamp`
- `ch1..chN`
- `switch_*`
- `telemetry_*`
- `event_marker`

---

## Official verified sources

- [EdgeTX Lua Reference Guide](https://luadoc.edgetx.org/)
- [General Functions 2.9](https://luadoc.edgetx.org/2.9/part_iii_-_opentx_lua_api_reference/general-functions-less-than-greater-than-luadoc-begin-general)
- [getOutputValue(outputIndex)](https://luadoc.edgetx.org/2.10/part_iii_-_opentx_lua_api_reference/general-functions-less-than-greater-than-luadoc-begin-general/getoutputvalue-outputindex)
- [getTime()](https://luadoc.edgetx.org/lua-api-reference/time/gettime)
- [Data Exchange with the EdgeTX Model Setup](https://luadoc.edgetx.org/2.11/lua-api-programming/data-exchange-with-the-edgetx-model-setup)
- [Telemetry Scripts](https://luadoc.edgetx.org/overview/script-types/telemetry-scripts)
- [One-Time Scripts / Tool Scripts](https://luadoc.edgetx.org/2.9/part_i_-_script_type_overview/one-time_scripts)
- [Function Scripts](https://luadoc.edgetx.org/overview/script-types/function-scripts)
- [EdgeTX manual for monochrome radios](https://manual.edgetx.org/bw-radios)
- [RadioMaster MT12 product page](https://radiomasterrc.com/products/mt12-surface-radio-controller)
