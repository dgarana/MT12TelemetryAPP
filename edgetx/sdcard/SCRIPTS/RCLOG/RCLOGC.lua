-- Shared RC input logger core for EdgeTX 2.9+ on monochrome radios such as the RadioMaster MT12.
--
-- Auto-discovers all available sources (inputs, channels, switches, system, telemetry) and logs
-- them all to CSV. The user picks which ones to visualise in the companion desktop app.

local function newLoggerApp(options)
  options = options or {}

  local S = {
    recSuffix   = "REC",
    stopLabel   = "STOP",
    navHint     = "ENTER",
    warnEdgetx  = "Script for EdgeTX only",
    warnVersion = "Target: EdgeTX 2.9+",
    warnNoSrc   = "No sources found!",
    errNoFile   = "No active session.",
    errOpenW    = "Cannot open %s.",
    errCsvWrite = "CSV error: %s",
  }

  local config = {
    mode        = options.mode or "telemetry",
    scriptLabel = options.scriptLabel or "RC Logger",

    lcdWidth  = LCD_W or 128,
    lcdHeight = LCD_H or 64,

    -- Fixed at 25 Hz (4 ticks of 10 ms). Exact with EdgeTX getTime() resolution.
    sampleRateHz = 25,

    -- Sources shown as bars on the display (pilot's primary controls on the MT12).
    displaySt  = "input2",
    displayThr = "input1",

    useGeneratedFilename   = true,
    fixedFilename          = "/LOGS/rcinput.csv",
    flushEverySamples      = 25,  -- 1 second at 25 Hz → 1 SD write/sec instead of 2.5
    flushAtLeastEveryTicks = 100,
  }

  local state = {
    versionMajor = 0,
    versionMinor = 0,
    versionOs    = nil,

    sampleIntervalTicks = 4,

    -- Resolved at init. Each entry: { name = "input1", fieldId = N }
    sources       = {},
    currentValues = {},

    recording        = false,
    sessionFilename  = nil,
    sessionStartTick = 0,
    nextSampleTick   = 0,
    lastFlushTick    = 0,
    totalSamples     = 0,
    totalFlushes     = 0,

    buffer = {},

    lastError   = nil,
    lastWarning = nil,

    requestedExit = false,
    initialized   = false,
  }

  -- ── helpers ────────────────────────────────────────────────────────────────

  local function setWarning(msg) state.lastWarning = msg end
  local function setError(msg)   state.lastError   = msg end

  local function clearMessages()
    state.lastWarning = nil
    state.lastError   = nil
  end

  local function eventIs(event, name)
    local v = _G[name]
    return v ~= nil and event == v
  end

  local function clamp(v, lo, hi)
    if v < lo then return lo end
    if v > hi then return hi end
    return v
  end

  local function round(v)
    if v >= 0 then return math.floor(v + 0.5) end
    return math.ceil(v - 0.5)
  end

  -- Normalizes a raw EdgeTX axis value (-1024..1024) to percentage (-100..100) for display.
  local function normalizeRaw(v)
    return clamp(round((v or 0) * 100 / 1024), -100, 100)
  end

  local function formatTime(ticks)
    local s = math.floor((ticks or 0) / 100)
    local t = math.floor(((ticks or 0) % 100) / 10)
    return string.format("%02d:%02d.%01d", math.floor(s / 60), s % 60, t)
  end

  local function shortName(path)
    if not path then return "-" end
    local pos = string.match(path, ".*/()")
    if pos then return string.sub(path, pos) end
    return path
  end

  local function sanitize(text)
    return string.gsub(text or "", "[^%w_%-]", "_")
  end

  -- ── file naming ────────────────────────────────────────────────────────────

  local function modelPart()
    local name = nil
    if type(model) == "table" and type(model.getInfo) == "function" then
      local info = model.getInfo()
      if info and info.name then name = info.name end
    end
    if not name and type(getModelInfo) == "function" then
      local info = getModelInfo()
      if info and info.name then name = info.name end
    end
    name = sanitize(name or "MODEL")
    if name == "" then name = "MODEL" end
    return name
  end

  local function generatedFilename()
    local mp  = modelPart()
    local now = type(getDateTime) == "function" and getDateTime()
    if now and now.year and now.mon and now.day then
      local y = now.year < 100 and (2000 + now.year) or now.year
      return string.format("/LOGS/%04d%02d%02d_%02d%02d%02d_%s.csv",
        y, now.mon, now.day, now.hour or 0, now.min or 0, now.sec or 0, mp)
    end
    return string.format("/LOGS/t%u_%s.csv", getTime(), mp)
  end

  local function sessionPath()
    if config.useGeneratedFilename then return generatedFilename() end
    return config.fixedFilename
  end

  -- ── CSV ────────────────────────────────────────────────────────────────────

  local function csvJoin(parts)
    local r = ""
    for i = 1, #parts do
      if i > 1 then r = r .. "," end
      r = r .. parts[i]
    end
    return r
  end

  local function csvHeader()
    local cols = { "timestamp" }
    for i = 1, #state.sources do
      cols[#cols + 1] = state.sources[i].name
    end
    return csvJoin(cols)
  end

  local function csvRow(tick)
    local parts = { tostring(tick) }
    for i = 1, #state.sources do
      parts[#parts + 1] = tostring(state.currentValues[state.sources[i].name] or 0)
    end
    return csvJoin(parts)
  end

  -- ── I/O ────────────────────────────────────────────────────────────────────

  local function fileExists(path)
    local h = io.open(path, "r")
    if h then io.close(h); return true end
    return false
  end

  local function openSession(path)
    local needHeader = not fileExists(path)
    local h = io.open(path, "a")
    if not h then return false, string.format(S.errOpenW, path) end
    if needHeader then
      local ok, err = io.write(h, csvHeader(), "\n")
      if not ok then io.close(h); return false, string.format(S.errCsvWrite, tostring(err)) end
    end
    io.close(h)
    return true
  end

  local function flushBuffer()
    if #state.buffer == 0 then return true end
    if not state.sessionFilename then setError(S.errNoFile); return false end
    local h = io.open(state.sessionFilename, "a")
    if not h then setError(string.format(S.errOpenW, state.sessionFilename)); return false end
    for i = 1, #state.buffer do
      local ok, err = io.write(h, state.buffer[i], "\n")
      if not ok then
        io.close(h)
        setError(string.format(S.errCsvWrite, tostring(err)))
        return false
      end
    end
    io.close(h)
    state.buffer         = {}
    state.lastFlushTick  = getTime()
    state.totalFlushes   = state.totalFlushes + 1
    return true
  end

  -- ── sampling ───────────────────────────────────────────────────────────────

  local function refreshValues()
    if type(getValue) ~= "function" then return end
    for i = 1, #state.sources do
      local src = state.sources[i]
      local v = getValue(src.fieldId)
      if v ~= nil then state.currentValues[src.name] = v end
    end
  end

  local function sample(nowTick)
    if not state.recording then return end
    if nowTick < state.nextSampleTick then return end
    state.buffer[#state.buffer + 1] = csvRow(nowTick)
    state.totalSamples   = state.totalSamples + 1
    state.nextSampleTick = nowTick + state.sampleIntervalTicks
  end

  local function shouldFlush(nowTick)
    if #state.buffer == 0 then return false end
    if #state.buffer >= config.flushEverySamples then return true end
    return (nowTick - state.lastFlushTick) >= config.flushAtLeastEveryTicks
  end

  local function serviceLoop()
    local now = getTime()
    refreshValues()
    sample(now)
    if shouldFlush(now) then flushBuffer() end
  end

  -- ── recording control ──────────────────────────────────────────────────────

  local function startRecording()
    clearMessages()
    if state.recording then return end
    local path = sessionPath()
    local ok, err = openSession(path)
    if not ok then setError(err); return end
    state.recording        = true
    state.sessionFilename  = path
    state.sessionStartTick = getTime()
    state.nextSampleTick   = state.sessionStartTick
    state.lastFlushTick    = state.sessionStartTick
    state.buffer           = {}
    state.totalSamples     = 0
    state.totalFlushes     = 0
  end

  local function stopRecording()
    clearMessages()
    if not state.recording then return end
    flushBuffer()
    state.recording = false
  end

  local function destroy()
    if state.recording then flushBuffer(); state.recording = false end
  end

  -- ── input ──────────────────────────────────────────────────────────────────

  local function handleInput(event)
    if event == nil then return end
    if eventIs(event, "EVT_ENTER_BREAK") or eventIs(event, "EVT_MENU_BREAK") then
      if state.recording then stopRecording() else startRecording() end
      return
    end
    if config.mode == "tool" and (eventIs(event, "EVT_EXIT_BREAK") or eventIs(event, "EVT_RTN_BREAK")) then
      destroy()
      state.requestedExit = true
    end
  end

  -- ── display ────────────────────────────────────────────────────────────────

  local function drawBar(x, y, w, h, value)
    local half = math.floor(w / 2)
    local cx   = x + half
    lcd.drawLine(x,         y,         x + w - 1, y,         SOLID, 0)
    lcd.drawLine(x,         y + h - 1, x + w - 1, y + h - 1, SOLID, 0)
    lcd.drawLine(x,         y,         x,         y + h - 1, SOLID, 0)
    lcd.drawLine(x + w - 1, y,         x + w - 1, y + h - 1, SOLID, 0)
    lcd.drawLine(cx, y + 1, cx, y + h - 2, DOTTED, 0)
    local fillW = math.min(math.floor(math.abs(value) * half / 100 + 0.5), half - 1)
    if fillW < 1 then return end
    local fx = value > 0 and (cx + 1) or (cx - fillW)
    for row = y + 1, y + h - 2 do
      lcd.drawLine(fx, row, fx + fillW - 1, row, SOLID, 0)
    end
  end

  local function signedPct(v)
    if v == nil then return "---" end
    if v > 0 then return "+" .. tostring(v) .. "%" end
    return tostring(v) .. "%"
  end

  local function drawScreen()
    local st  = normalizeRaw(state.currentValues[config.displaySt])
    local thr = normalizeRaw(state.currentValues[config.displayThr])
    local elapsed = state.recording and (getTime() - state.sessionStartTick) or 0

    lcd.clear()

    -- top bar
    lcd.drawText(0,  0, config.scriptLabel, SMLSIZE)
    lcd.drawText(96, 0, tostring(config.sampleRateHz) .. "Hz", SMLSIZE)
    lcd.drawLine(0, 8, config.lcdWidth - 1, 8, SOLID, 0)

    -- ST bar
    lcd.drawText(0, 11, "ST", SMLSIZE)
    drawBar(18, 10, 78, 9, st)
    lcd.drawText(98, 11, signedPct(st), SMLSIZE)

    -- THR bar
    lcd.drawText(0, 22, "THR", SMLSIZE)
    drawBar(18, 21, 78, 9, thr)
    lcd.drawText(98, 22, signedPct(thr), SMLSIZE)

    lcd.drawLine(0, 32, config.lcdWidth - 1, 32, SOLID, 0)

    -- status
    if state.recording then
      lcd.drawText(0,  34, S.recSuffix,                 INVERS)
      lcd.drawText(28, 34, formatTime(elapsed),          SMLSIZE)
      lcd.drawText(80, 34, tostring(state.totalSamples), SMLSIZE)
      lcd.drawText(0,  44, shortName(state.sessionFilename), SMLSIZE)
    else
      lcd.drawText(0,  34, S.stopLabel, SMLSIZE)
      lcd.drawText(0,  44, tostring(#state.sources) .. " src", SMLSIZE)
    end

    -- footer
    if state.lastError then
      lcd.drawText(0, 55, state.lastError, SMLSIZE)
    elseif state.lastWarning then
      lcd.drawText(0, 55, state.lastWarning, SMLSIZE)
    elseif not state.recording then
      lcd.drawText(96, 55, S.navHint, SMLSIZE)
    end
  end

  -- ── init ───────────────────────────────────────────────────────────────────

  local function init()
    local _, _, major, minor, _, osname = getVersion()
    state.versionMajor = major  or 0
    state.versionMinor = minor  or 0
    state.versionOs    = osname

    state.sampleIntervalTicks = math.max(1, math.floor(100 / config.sampleRateHz + 0.5))

    -- Discover all available sources and store their field IDs.
    local function tryAdd(name)
      if type(getFieldInfo) ~= "function" then return end
      local info = getFieldInfo(name)
      if info then
        state.sources[#state.sources + 1] = { name = name, fieldId = info.id }
      end
    end

    -- Raw inputs (pilot controls, pre-mixer)
    for i = 1, 16 do tryAdd("input" .. i) end

    -- Output channels (post-mixer, what the servos/ESC receive)
    for i = 1, 16 do tryAdd("ch" .. i) end

    -- Switches
    for _, sw in ipairs({ "sa", "sb", "sc", "sd", "se", "sf", "sg", "sh" }) do
      tryAdd(sw)
    end

    -- System sources
    for _, src in ipairs({ "tx-voltage", "timer1", "timer2", "rssi" }) do
      tryAdd(src)
    end

    -- Common telemetry sensors (skipped silently if not connected)
    for _, src in ipairs({ "RxBt", "Curr", "Cels", "Tmp1", "Tmp2", "RPM" }) do
      tryAdd(src)
    end

    if #state.sources == 0 then setWarning(S.warnNoSrc) end

    if state.versionOs ~= nil and state.versionOs ~= "EdgeTX" then
      setWarning(S.warnEdgetx)
    end
    if state.versionMajor < 2 or (state.versionMajor == 2 and state.versionMinor < 9) then
      setWarning(S.warnVersion)
    end

    refreshValues()
    state.initialized = true
  end

  -- ── public API ─────────────────────────────────────────────────────────────

  local function background() serviceLoop() end

  local function run(event)
    handleInput(event)
    serviceLoop()
    drawScreen()
    if config.mode == "tool" and state.requestedExit then return 2 end
    return 0
  end

  return { init = init, background = background, run = run, destroy = destroy }
end

return newLoggerApp
