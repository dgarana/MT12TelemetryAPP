-- Shared RC input logger core for EdgeTX 2.9+ on monochrome radios such as the RadioMaster MT12.
--
-- Design goals:
-- 1. Prioritize getOutputValue() for final channel outputs.
-- 2. Sample using getTime() rather than callback count, because EdgeTX scheduling is cooperative.
-- 3. Batch writes in RAM and flush in groups to reduce SD wear and reduce the chance of a partially
--    written line if power is removed mid-session.
-- 4. Keep the code usable from both a Telemetry Script and a Tool Script wrapper.
--
-- Important runtime limitation:
-- EdgeTX does not provide a universal "destroy callback" for Telemetry scripts the same way a desktop
-- application might. For that reason this logger never keeps the file permanently open. It opens the
-- file only when a flush is needed, appends a group of buffered rows, and closes it immediately.
-- This means a forced script stop may lose the last in-RAM samples, but it greatly reduces the risk of
-- SD corruption and avoids having a long-lived file handle.

local function newLoggerApp(options)
  options = options or {}
  local beginCalibrationStep
  local finishCalibrationStep
  local completeGuidedCalibration

  local function joinCsv(values)
    local result = ""
    local i

    for i = 1, #values do
      if i > 1 then
        result = result .. ","
      end
      result = result .. tostring(values[i])
    end

    return result
  end

  local STRINGS = {
    en = {
      menuStart    = "Start Recording",
      menuCal      = "Calibrate",
      calStepShort = { "CTR", "LEFT", "RIGHT", "THR",  "REV"  },
      calStepLong  = { "Release sticks", "Full left", "Full right", "Full throttle", "Full reverse" },
      calDone      = "CAL done",
      calReady     = "Cal OK",
      recSuffix    = "REC",
      stopLabel    = "STOP",
      calLabel     = "CAL",
      navHint      = "NAV",
      enterHint    = "ENTER=OK",
      rawLabel     = "RAW",
      warnNoCalib  = "Recording uncalibrated",
      warnHz       = "Change Hz in STOP",
      warnCh       = "CH%d not available",
      warnSw       = "Switch %s unavailable",
      warnEdgetx   = "Script for EdgeTX only",
      warnVersion  = "Target: EdgeTX 2.9+",
      errNoFile    = "No active session for flush.",
      errOpenW     = "Cannot open %s for write.",
      errCsvWrite  = "CSV write error: %s",
      flushPeriod  = "Flush %s",
      infoRate     = "Rate %dHz",
    },
    es = {
      menuStart    = "Iniciar grabacion",
      menuCal      = "Calibrar",
      calStepShort = { "CTR", "IZQ", "DER", "GAS", "REV" },
      calStepLong  = { "Suelta mando", "Gira a tope", "Gira a tope", "Gas a tope", "Marcha atras" },
      calDone      = "CAL lista",
      calReady     = "Cal OK",
      recSuffix    = "REC",
      stopLabel    = "STOP",
      calLabel     = "CAL",
      navHint      = "NAV",
      enterHint    = "ENTER=OK",
      rawLabel     = "RAW",
      warnNoCalib  = "Grabando sin calibrar",
      warnHz       = "Cambia Hz solo en STOP",
      warnCh       = "Canal CH%d no disponible",
      warnSw       = "Switch %s no disponible",
      warnEdgetx   = "Script para EdgeTX",
      warnVersion  = "Objetivo: EdgeTX 2.9+",
      errNoFile    = "Sin archivo de sesion activo.",
      errOpenW     = "No se pudo abrir %s.",
      errCsvWrite  = "Error CSV: %s",
      flushPeriod  = "Flush %s",
      infoRate     = "Rate %dHz",
    },
    de = {
      menuStart    = "Aufnahme starten",
      menuCal      = "Kalibrieren",
      calStepShort = { "MIT", "LNK", "RCH", "GAS", "RUK" },
      calStepLong  = { "Sticks loslassen", "Ganz links", "Ganz rechts", "Vollgas", "Voller Rueckwarts" },
      calDone      = "KAL fertig",
      calReady     = "Kal OK",
      recSuffix    = "REC",
      stopLabel    = "STOP",
      calLabel     = "KAL",
      navHint      = "NAV",
      enterHint    = "ENTER=OK",
      rawLabel     = "ROH",
      warnNoCalib  = "Aufnahme unkalibriert",
      warnHz       = "Hz nur bei STOP aendern",
      warnCh       = "KA%d nicht verfuegbar",
      warnSw       = "Schalter %s fehlt",
      warnEdgetx   = "Nur fuer EdgeTX",
      warnVersion  = "Ziel: EdgeTX 2.9+",
      errNoFile    = "Keine aktive Sitzung.",
      errOpenW     = "%s kann nicht geoeffnet werden.",
      errCsvWrite  = "CSV-Fehler: %s",
      flushPeriod  = "Flush %s",
      infoRate     = "Rate %dHz",
    },
    fr = {
      menuStart    = "Demarrer enreg.",
      menuCal      = "Calibrer",
      calStepShort = { "CTR", "GAU", "DRT", "GAZ", "MAR" },
      calStepLong  = { "Relacher manette", "Plein gauche", "Plein droite", "Plein gaz", "Pleine marche arr." },
      calDone      = "CAL terminee",
      calReady     = "Cal OK",
      recSuffix    = "REC",
      stopLabel    = "STOP",
      calLabel     = "CAL",
      navHint      = "NAV",
      enterHint    = "ENTREE=OK",
      rawLabel     = "BRT",
      warnNoCalib  = "Enreg. non calibre",
      warnHz       = "Changer Hz a l'arret",
      warnCh       = "CH%d non disponible",
      warnSw       = "Inter. %s absent",
      warnEdgetx   = "Pour EdgeTX seulement",
      warnVersion  = "Cible: EdgeTX 2.9+",
      errNoFile    = "Pas de session active.",
      errOpenW     = "Impossible d'ouvrir %s.",
      errCsvWrite  = "Erreur CSV: %s",
      flushPeriod  = "Flush %s",
      infoRate     = "Rate %dHz",
    },
  }

  local lang = options.lang or "en"
  if not STRINGS[lang] then lang = "en" end
  local S = STRINGS[lang]

  local config = {
    mode = options.mode or "telemetry",
    scriptLabel = options.scriptLabel or "RC Logger",

    -- The MT12 is a monochrome 128x64 radio. We still guard with LCD_W/LCD_H to stay portable.
    lcdWidth = LCD_W or 128,
    lcdHeight = LCD_H or 64,

    -- Logging setup. The user asked for 10 Hz and 20 Hz only, so the UI cycles between those values.
    supportedRates = { 10, 20 },
    defaultRateIndex = 1,

    -- Final channels we log by default. This keeps the base CSV exactly as requested:
    -- timestamp,ch1,ch2,ch3,ch4
    primaryChannels = { 1, 2, 3, 4 },

    -- Future expansion point. Keep this disabled by default so downstream tools can rely on a stable
    -- 5-column CSV until we intentionally version the format.
    includeExtraChannels = false,
    extraChannels = { 5, 6, 7, 8 },

    -- Switch names are optional and model-specific. Leave empty by default. If you enable any of them,
    -- the logger will append extra columns after ch4.
    -- Examples on a monochrome EdgeTX radio could be: "SA" .. CHAR_UP, "SB" .. CHAR_DOWN, etc.
    switchNames = {},

    -- File strategy. Generated filenames are safer for logging sessions because each run gets a clean
    -- header and we avoid mixing multiple recordings into one file unless the user explicitly wants that.
    useGeneratedFilename = true,
    fixedFilename = "/LOGS/rcinput.csv",
    generatedPrefix = "rcinput",

    -- Buffered writing. At 10 Hz, 10 samples ~= 1 second. At 20 Hz, 10 samples ~= 0.5 seconds.
    -- This is a practical compromise: enough buffering to reduce SD chatter, small enough to avoid
    -- losing too much data if the radio powers off unexpectedly.
    flushEverySamples = 10,
    flushAtLeastEveryTicks = 100, -- 100 ticks = 1 second because getTime() units are 10 ms.

    -- Guided calibration. Each step captures a short hold window so the radio can learn the real center
    -- and the actual travel seen on CH1/CH2 after trims, subtrims and endpoint setup.
    calibrationStepDurationTicks = 100, -- 1 second per guided step.

    -- UI behaviour.
    showCh3Ch4 = false,
  }

  local state = {
    versionString = "unknown",
    versionMajor = 0,
    versionMinor = 0,
    versionOs = nil,

    rateIndex = config.defaultRateIndex,
    sampleIntervalTicks = 10,

    recording = false,
    sessionFilename = nil,
    sessionStartTick = 0,
    nextSampleTick = 0,
    lastFlushTick = 0,
    totalSamples = 0,
    totalFlushes = 0,

    buffer = {},
    currentValues = {},
    rawCurrentValues = {},
    channelMeta = {},
    switchMeta = {},

    calibrationActive = false,
    calibrationStepIndex = 0,
    calibrationStepStartTick = 0,
    calibrationStepSampleCount = 0,
    calibrationStepSums = {},
    calibrationCenter = {},
    calibrationMin = {},
    calibrationMax = {},
    calibrationPrompt = nil,
    calibrationReady = false,
    menuIndex = 1,
    menuItems = { S.menuStart, S.menuCal },

    lastError = nil,
    lastWarning = nil,
    lastInfo = nil,

    requestedExit = false,
    initialized = false,
  }

  local function setInfo(message)
    state.lastInfo = message
  end

  local function setWarning(message)
    state.lastWarning = message
  end

  local function setError(message)
    state.lastError = message
  end

  local function clearTransientMessages()
    state.lastInfo = nil
    state.lastWarning = nil
    state.lastError = nil
  end

  local function currentRateHz()
    return config.supportedRates[state.rateIndex]
  end

  local function isBusy()
    return state.recording or state.calibrationActive
  end

  local function updateSampleInterval()
    local hz = currentRateHz()
    if hz <= 0 then
      hz = 10
    end
    -- getTime() is in 10 ms ticks. 10 Hz => 10 ticks. 20 Hz => 5 ticks.
    state.sampleIntervalTicks = math.max(1, math.floor(100 / hz + 0.5))
  end

  local function eventIs(event, constantName)
    local constantValue = _G[constantName]
    return constantValue ~= nil and event == constantValue
  end

  local function formatNumber(value)
    if value == nil then
      return "---"
    end
    return tostring(value)
  end

  local function clamp(value, minValue, maxValue)
    if value < minValue then
      return minValue
    end
    if value > maxValue then
      return maxValue
    end
    return value
  end

  local function roundNearest(value)
    if value >= 0 then
      return math.floor(value + 0.5)
    end
    return math.ceil(value - 0.5)
  end

  local function formatPercent(value)
    if value == nil then
      return "---"
    end
    return tostring(value) .. "%"
  end

  local function formatSecondsFromTicks(ticks)
    local totalTenths = math.floor((ticks or 0) / 1)
    local seconds = math.floor(totalTenths / 100)
    local tenths = math.floor((totalTenths % 100) / 10)
    local minutes = math.floor(seconds / 60)
    local remSeconds = seconds % 60
    return string.format("%02d:%02d.%01d", minutes, remSeconds, tenths)
  end

  local function shortFilename(path)
    if not path then
      return "-"
    end
    local lastSlash = string.match(path, ".*/()")
    if lastSlash then
      return string.sub(path, lastSlash)
    end
    return path
  end

  local function sanitizeFilenamePart(text)
    return string.gsub(text or "", "[^%w_%-]", "_")
  end

  local function resolveModelFilenamePart()
    local modelName = nil

    if type(model) == "table" and type(model.getInfo) == "function" then
      local info = model.getInfo()
      if info and info.name then
        modelName = info.name
      end
    end

    if not modelName and type(getModelInfo) == "function" then
      local info = getModelInfo()
      if info and info.name then
        modelName = info.name
      end
    end

    modelName = sanitizeFilenamePart(modelName or "MODEL")
    if modelName == "" then
      modelName = "MODEL"
    end

    return modelName
  end

  local function buildGeneratedFilename()
    local now = nil
    local modelPart = resolveModelFilenamePart()
    if type(getDateTime) == "function" then
      now = getDateTime()
    end

    if now and now.year and now.mon and now.day and now.hour and now.min and now.sec then
      local year = now.year
      if year < 100 then
        year = 2000 + year
      end
      return string.format(
        "/LOGS/%04d%02d%02d_%02d%02d%02d_%s.csv",
        year,
        now.mon,
        now.day,
        now.hour,
        now.min,
        now.sec,
        modelPart
      )
    end

    -- Fallback when no RTC/date is available on the radio.
    return string.format(
      "/LOGS/t%u_%s.csv",
      getTime(),
      modelPart
    )
  end

  local function fileExists(path)
    local handle = io.open(path, "r")
    if handle then
      io.close(handle)
      return true
    end
    return false
  end

  local function buildCsvHeader()
    local columns = { "timestamp" }
    local i

    for i = 1, #config.primaryChannels do
      columns[#columns + 1] = "ch" .. config.primaryChannels[i]
    end

    if config.includeExtraChannels then
      for i = 1, #config.extraChannels do
        columns[#columns + 1] = "ch" .. config.extraChannels[i]
      end
    end

    for i = 1, #config.switchNames do
      columns[#columns + 1] = "sw_" .. sanitizeFilenamePart(config.switchNames[i])
    end

    return joinCsv(columns)
  end

  local function resolveChannelMeta(channelNumber)
    local sourceName = "ch" .. channelNumber
    local info = getFieldInfo(sourceName)

    return {
      channelNumber = channelNumber,
      sourceName = sourceName,
      sourceInfo = info,
      exists = info ~= nil,
      outputIndex = channelNumber - 1,
    }
  end

  local function resolveSwitchMeta(sourceName)
    local switchIndex = nil
    if type(getSwitchIndex) == "function" then
      switchIndex = getSwitchIndex(sourceName)
    end

    return {
      sourceName = sourceName,
      switchIndex = switchIndex,
      exists = switchIndex ~= nil,
    }
  end

  local function readOutputChannel(meta)
    -- Why prefer getOutputValue()?
    -- - It reads the final output channel directly by zero-based channel index.
    -- - It matches the user requirement to log the post-mixer/post-trim output that actually leaves CH1..CHn.
    -- - It avoids repeated source-name lookup.
    --
    -- Why not only use getValue("ch1")?
    -- - Passing a string forces EdgeTX to resolve the source name every time.
    -- - It is more expensive than using a pre-resolved numeric identifier.
    -- - More importantly for this use case, getValue() is a more general source API, while getOutputValue()
    --   states very clearly that we are after channel outputs.
    --
    -- Why still keep getFieldInfo()/getValue() around?
    -- - getFieldInfo("ch1") lets us detect that the channel source exists when the script initializes.
    -- - getValue(meta.sourceInfo.id) provides a compatibility fallback if a particular build lacks
    --   getOutputValue(), even though this project targets EdgeTX 2.9+ where getOutputValue exists.
    if not meta or not meta.exists then
      return 0, false, "missing"
    end

    if type(getOutputValue) == "function" then
      return getOutputValue(meta.outputIndex), true, "output"
    end

    if meta.sourceInfo and type(getValue) == "function" then
      return getValue(meta.sourceInfo.id), true, "field"
    end

    return 0, false, "unsupported"
  end

  local function readSwitchValue(meta)
    if not meta or not meta.exists or type(getSwitchValue) ~= "function" then
      return 0, false
    end

    return getSwitchValue(meta.switchIndex) and 1 or 0, true
  end

  local function collectConfiguredChannels()
    local allChannels = {}
    local i

    for i = 1, #config.primaryChannels do
      allChannels[#allChannels + 1] = config.primaryChannels[i]
    end

    if config.includeExtraChannels then
      for i = 1, #config.extraChannels do
        allChannels[#allChannels + 1] = config.extraChannels[i]
      end
    end

    return allChannels
  end

  local function resetCalibration()
    local allChannels = collectConfiguredChannels()
    local i

    state.calibrationStepIndex = 0
    state.calibrationStepStartTick = 0
    state.calibrationStepSampleCount = 0
    state.calibrationStepSums = {}
    state.calibrationCenter = {}
    state.calibrationMin = {}
    state.calibrationMax = {}
    state.calibrationPrompt = nil
    state.calibrationReady = false

    for i = 1, #allChannels do
      local channelNumber = allChannels[i]
      state.calibrationCenter[channelNumber] = 0
      state.calibrationMin[channelNumber] = -1024
      state.calibrationMax[channelNumber] = 1024
    end
  end

  local function applyChannelCalibration(channelNumber, value)
    local center = state.calibrationCenter[channelNumber] or 0
    local minimum = state.calibrationMin[channelNumber] or -1024
    local maximum = state.calibrationMax[channelNumber] or 1024
    local delta = value - center
    local scaled = 0

    -- For CH1/CH2 we want a true normalized output after calibration:
    -- - left/reverse should map to -100
    -- - center should map to 0
    -- - right/forward should map to 100
    -- This fixes asymmetric travels caused by trim, subtrim, dual rate or EPA.
    if state.calibrationReady and (channelNumber == 1 or channelNumber == 2) then
      if delta < 0 then
        local negativeSpan = center - minimum
        if negativeSpan <= 0 then
          return 0
        end
        scaled = roundNearest((delta * 100) / negativeSpan)
      elseif delta > 0 then
        local positiveSpan = maximum - center
        if positiveSpan <= 0 then
          return 0
        end
        scaled = roundNearest((delta * 100) / positiveSpan)
      else
        scaled = 0
      end

      return clamp(scaled, -100, 100)
    end

    -- For channels without guided calibration data, keep a simple fixed normalization.
    scaled = roundNearest((delta * 100) / 1024)
    return clamp(scaled, -100, 100)
  end

  local function refreshCurrentValues()
    local allChannels = collectConfiguredChannels()
    local i

    for i = 1, #allChannels do
      local channelNumber = allChannels[i]
      local meta = state.channelMeta[channelNumber]
      local value, exists = readOutputChannel(meta)

      if exists then
        state.rawCurrentValues["ch" .. channelNumber] = value
        state.currentValues["ch" .. channelNumber] = applyChannelCalibration(channelNumber, value)
      else
        state.rawCurrentValues["ch" .. channelNumber] = 0
        state.currentValues["ch" .. channelNumber] = 0
      end
    end

    for i = 1, #config.switchNames do
      local switchName = config.switchNames[i]
      local meta = state.switchMeta[switchName]
      local value = 0
      local exists = false

      value, exists = readSwitchValue(meta)
      if exists then
        state.currentValues["sw:" .. switchName] = value
      else
        state.currentValues["sw:" .. switchName] = 0
      end
    end
  end

  local function buildCsvRow(timestampTick)
    local row = { tostring(timestampTick) }
    local i

    for i = 1, #config.primaryChannels do
      row[#row + 1] = tostring(state.currentValues["ch" .. config.primaryChannels[i]] or 0)
    end

    if config.includeExtraChannels then
      for i = 1, #config.extraChannels do
        row[#row + 1] = tostring(state.currentValues["ch" .. config.extraChannels[i]] or 0)
      end
    end

    for i = 1, #config.switchNames do
      row[#row + 1] = tostring(state.currentValues["sw:" .. config.switchNames[i]] or 0)
    end

    return joinCsv(row)
  end

  local function appendHeaderIfNeeded(path)
    local shouldWriteHeader = not fileExists(path)
    local handle = io.open(path, "a")

    if not handle then
      return false, "No se pudo abrir " .. path .. " para append. Verifica SD y /LOGS."
    end

    if shouldWriteHeader then
      local ok, err = io.write(handle, buildCsvHeader(), "\n")
      if not ok then
        io.close(handle)
        return false, "No se pudo escribir cabecera en " .. path .. ": " .. tostring(err)
      end
    end

    io.close(handle)
    return true
  end

  local function flushBuffer(reason)
    if #state.buffer == 0 then
      return true
    end

    if not state.sessionFilename then
      setError(S.errNoFile)
      return false
    end

    local handle = io.open(state.sessionFilename, "a")
    if not handle then
      setError(string.format(S.errOpenW, state.sessionFilename))
      return false
    end

    local i
    for i = 1, #state.buffer do
      local ok, err = io.write(handle, state.buffer[i], "\n")
      if not ok then
        io.close(handle)
        setError(string.format(S.errCsvWrite, tostring(err)))
        return false
      end
    end

    io.close(handle)
    state.buffer = {}
    state.lastFlushTick = getTime()
    state.totalFlushes = state.totalFlushes + 1
    setInfo(string.format(S.flushPeriod, tostring(reason or "periodic")))
    return true
  end

  local function pushSample(timestampTick)
    state.buffer[#state.buffer + 1] = buildCsvRow(timestampTick)
    state.totalSamples = state.totalSamples + 1
  end

  local function shouldFlush(nowTick)
    if #state.buffer == 0 then
      return false
    end

    if #state.buffer >= config.flushEverySamples then
      return true
    end

    if (nowTick - state.lastFlushTick) >= config.flushAtLeastEveryTicks then
      return true
    end

    return false
  end

  local function sessionFilename()
    if config.useGeneratedFilename then
      return buildGeneratedFilename()
    end
    return config.fixedFilename
  end

  local function startRecording()
    clearTransientMessages()

    if isBusy() then
      return
    end

    if not state.calibrationReady then
      setWarning(S.warnNoCalib)
    end

    local path = sessionFilename()
    local ok, err = appendHeaderIfNeeded(path)
    if not ok then
      setError(err)
      return
    end

    state.recording = true
    state.sessionFilename = path
    state.sessionStartTick = getTime()
    state.nextSampleTick = state.sessionStartTick
    state.lastFlushTick = state.sessionStartTick
    state.buffer = {}
    state.totalSamples = 0
    state.totalFlushes = 0
    setInfo(S.recSuffix .. " -> " .. shortFilename(path))
  end

  local function stopRecording()
    clearTransientMessages()

    if not state.recording then
      return
    end

    flushBuffer("stop")
    state.recording = false
    state.calibrationActive = false
    setInfo(S.stopLabel)
  end

  local function startCalibration()
    clearTransientMessages()

    if isBusy() then
      return
    end

    resetCalibration()
    state.calibrationActive = true
    beginCalibrationStep(1, getTime())
  end

  local function destroy()
    -- Explicit cleanup path. This is guaranteed when the Tool wrapper chooses to exit itself, and it is
    -- also called when the user toggles STOP. It is not guaranteed for every forced EdgeTX shutdown path,
    -- which is why the logger design avoids leaving a file open between flushes.
    if state.recording then
      flushBuffer("destroy")
      state.recording = false
    end
  end

  local function cycleRate(delta)
    if state.recording then
      setWarning(S.warnHz)
      return
    end

    state.rateIndex = state.rateIndex + delta

    if state.rateIndex < 1 then
      state.rateIndex = #config.supportedRates
    elseif state.rateIndex > #config.supportedRates then
      state.rateIndex = 1
    end

    updateSampleInterval()
    setInfo(string.format(S.infoRate, currentRateHz()))
  end

  local function handleInput(event)
    if event == nil then
      return
    end

    if eventIs(event, "EVT_ENTER_BREAK") or eventIs(event, "EVT_MENU_BREAK") then
      if state.recording then
        stopRecording()
      elseif state.calibrationActive then
        state.calibrationStepSums[1] = state.rawCurrentValues.ch1 or 0
        state.calibrationStepSums[2] = state.rawCurrentValues.ch2 or 0
        state.calibrationStepSampleCount = 1
        finishCalibrationStep(state.calibrationStepIndex)

        if state.calibrationStepIndex < 5 then
          beginCalibrationStep(state.calibrationStepIndex + 1, getTime())
        else
          completeGuidedCalibration(getTime())
        end
      else
        if state.menuIndex == 1 then
          startRecording()
        else
          startCalibration()
        end
      end
      return
    end

    if eventIs(event, "EVT_PLUS_BREAK") or eventIs(event, "EVT_ROT_RIGHT") then
      if state.calibrationActive then
        return
      elseif state.recording then
        cycleRate(1)
      else
        state.menuIndex = state.menuIndex + 1
        if state.menuIndex > #state.menuItems then
          state.menuIndex = 1
        end
      end
      return
    end

    if eventIs(event, "EVT_MINUS_BREAK") or eventIs(event, "EVT_ROT_LEFT") then
      if state.calibrationActive then
        return
      elseif state.recording then
        cycleRate(-1)
      else
        state.menuIndex = state.menuIndex - 1
        if state.menuIndex < 1 then
          state.menuIndex = #state.menuItems
        end
      end
      return
    end

    if config.mode == "tool" and (eventIs(event, "EVT_EXIT_BREAK") or eventIs(event, "EVT_RTN_BREAK")) then
      destroy()
      state.requestedExit = true
    end
  end

  local function calibrationStepName(stepIndex)
    if stepIndex == 1 then
      return "CENTER"
    elseif stepIndex == 2 then
      return "LEFT"
    elseif stepIndex == 3 then
      return "RIGHT"
    elseif stepIndex == 4 then
      return "THR"
    elseif stepIndex == 5 then
      return "REV"
    end
    return "DONE"
  end

  local function calibrationStepInfo(stepIndex)
    local short = S.calStepShort[stepIndex] or "OK"
    local long  = S.calStepLong[stepIndex]  or S.calDone
    return short, long
  end

  finishCalibrationStep = function(stepIndex)
    local avgCh1 = 0
    local avgCh2 = 0

    if state.calibrationStepSampleCount > 0 then
      avgCh1 = math.floor((state.calibrationStepSums[1] or 0) / state.calibrationStepSampleCount + 0.5)
      avgCh2 = math.floor((state.calibrationStepSums[2] or 0) / state.calibrationStepSampleCount + 0.5)
    end

    if stepIndex == 1 then
      state.calibrationCenter[1] = avgCh1
      state.calibrationCenter[2] = avgCh2
    elseif stepIndex == 2 then
      state.calibrationMin[1] = avgCh1
    elseif stepIndex == 3 then
      state.calibrationMax[1] = avgCh1
    elseif stepIndex == 4 then
      state.calibrationMax[2] = avgCh2
    elseif stepIndex == 5 then
      state.calibrationMin[2] = avgCh2
    end
  end

  beginCalibrationStep = function(stepIndex, nowTick)
    local shortName, prompt = calibrationStepInfo(stepIndex)
    state.calibrationStepIndex = stepIndex
    state.calibrationStepStartTick = nowTick
    state.calibrationStepSampleCount = 0
    state.calibrationStepSums = {}
    state.calibrationPrompt = prompt
    setInfo(S.calLabel .. " " .. tostring(stepIndex) .. "/5 -> " .. shortName)
  end

  completeGuidedCalibration = function(nowTick)
    if state.calibrationMin[1] > state.calibrationMax[1] then
      local temp = state.calibrationMin[1]
      state.calibrationMin[1] = state.calibrationMax[1]
      state.calibrationMax[1] = temp
    end

    if state.calibrationMin[2] > state.calibrationMax[2] then
      local temp2 = state.calibrationMin[2]
      state.calibrationMin[2] = state.calibrationMax[2]
      state.calibrationMax[2] = temp2
    end

    state.calibrationActive = false
    refreshCurrentValues()
    state.calibrationReady = true
    setInfo(S.calDone)
  end

  local function sampleScheduler(nowTick)
    if not state.recording then
      return
    end

    if state.calibrationActive then
      return
    end

    if nowTick < state.nextSampleTick then
      return
    end

    -- We log the current state at the scheduler tick chosen by getTime(). We intentionally do not try to
    -- "catch up" with multiple synthetic samples if the radio was busy and a callback arrived late. For
    -- video overlay use, a real timestamped sparse sample is better than inventing intermediate values that
    -- never actually existed.
    pushSample(nowTick)
    state.nextSampleTick = nowTick + state.sampleIntervalTicks
  end

  local function serviceLoop()
    local nowTick = getTime()
    refreshCurrentValues()
    sampleScheduler(nowTick)

    if shouldFlush(nowTick) then
      flushBuffer("periodic")
    end
  end

  local function drawLine(y, label, value, flags)
    lcd.drawText(0, y, label, SMLSIZE)
    lcd.drawText(48, y, value or "", flags or SMLSIZE)
  end

  local function drawScreen()
    local ch1 = state.currentValues.ch1 or 0
    local ch2 = state.currentValues.ch2 or 0
    local elapsed = 0
    local statusText = S.stopLabel
    local calibrationLabel = nil
    local calibrationPrompt = nil
    local footerText = nil

    if state.recording and not state.calibrationActive then
      elapsed = getTime() - state.sessionStartTick
    end

    if state.calibrationActive then
      calibrationLabel, calibrationPrompt = calibrationStepInfo(state.calibrationStepIndex)
    end

    lcd.clear()
    lcd.drawText(0, 0, config.scriptLabel, SMLSIZE)
    lcd.drawText(78, 0, tostring(currentRateHz()) .. "Hz", SMLSIZE)

    if state.calibrationActive then
      statusText = S.calLabel
      lcd.drawText(0, 10, statusText, INVERS)
    elseif state.recording then
      statusText = S.recSuffix
      lcd.drawText(0, 10, statusText, INVERS)
    else
      lcd.drawText(0, 10, statusText, 0)
    end

    if state.calibrationActive then
      lcd.drawText(28, 10, tostring(state.calibrationStepIndex) .. "/5", SMLSIZE)
      lcd.drawText(56, 10, "ENTER", SMLSIZE)
    else
      lcd.drawText(36, 10, formatSecondsFromTicks(elapsed), SMLSIZE)
    end
    lcd.drawText(92, 10, tostring(#state.buffer) .. "B", SMLSIZE)

    drawLine(22, "CH1", formatPercent(ch1), SMLSIZE)
    drawLine(32, "CH2", formatPercent(ch2), SMLSIZE)

    if state.calibrationActive then
      lcd.drawText(0, 42, calibrationLabel or S.calLabel, INVERS)
      lcd.drawText(28, 42, calibrationPrompt or "", SMLSIZE)
      lcd.drawText(0, 52, S.rawLabel, SMLSIZE)
      lcd.drawText(28, 52, formatNumber(state.rawCurrentValues.ch1 or 0) .. "/" .. formatNumber(state.rawCurrentValues.ch2 or 0), SMLSIZE)
      footerText = S.enterHint
    elseif not state.recording then
      if state.menuIndex == 1 then
        lcd.drawText(0, 42, "> " .. S.menuStart, INVERS)
        lcd.drawText(0, 52, "  " .. S.menuCal, SMLSIZE)
      else
        lcd.drawText(0, 42, "  " .. S.menuStart, SMLSIZE)
        lcd.drawText(0, 52, "> " .. S.menuCal, INVERS)
      end

      if state.calibrationReady then
        footerText = S.calReady
      else
        footerText = S.navHint
      end
    elseif config.showCh3Ch4 then
      drawLine(42, "CH3", formatPercent(state.currentValues.ch3 or 0), SMLSIZE)
      drawLine(52, "CH4", formatPercent(state.currentValues.ch4 or 0), SMLSIZE)
    else
      lcd.drawText(0, 42, "SMP", SMLSIZE)
      lcd.drawText(48, 42, tostring(state.totalSamples), SMLSIZE)
      lcd.drawText(0, 52, "FILE", SMLSIZE)
      lcd.drawText(30, 52, shortFilename(state.sessionFilename), SMLSIZE)
    end

    if state.lastError then
      lcd.drawText(0, config.lcdHeight - 10, state.lastError, SMLSIZE)
    elseif state.lastWarning then
      lcd.drawText(0, config.lcdHeight - 10, state.lastWarning, SMLSIZE)
    elseif footerText then
      if not state.recording and not state.calibrationActive then
        lcd.drawText(86, config.lcdHeight - 10, footerText, SMLSIZE)
      else
        lcd.drawText(70, config.lcdHeight - 10, footerText, SMLSIZE)
      end
    end
  end

  local function init()
    local versionString, radio, major, minor, rev, osname = getVersion()
    local allChannels = collectConfiguredChannels()
    local i

    state.versionString = versionString or "unknown"
    state.versionMajor = major or 0
    state.versionMinor = minor or 0
    state.versionOs = osname

    updateSampleInterval()
    resetCalibration()

    for i = 1, #allChannels do
      local channelNumber = allChannels[i]
      state.channelMeta[channelNumber] = resolveChannelMeta(channelNumber)
      if not state.channelMeta[channelNumber].exists then
        setWarning(string.format(S.warnCh, channelNumber))
      end
    end

    for i = 1, #config.switchNames do
      local switchName = config.switchNames[i]
      state.switchMeta[switchName] = resolveSwitchMeta(switchName)
      if not state.switchMeta[switchName].exists then
        setWarning(string.format(S.warnSw, switchName))
      end
    end

    if state.versionOs ~= nil and state.versionOs ~= "EdgeTX" then
      setWarning(S.warnEdgetx)
    end

    if state.versionMajor < 2 or (state.versionMajor == 2 and state.versionMinor < 9) then
      setWarning(S.warnVersion)
    end

    refreshCurrentValues()
    state.initialized = true
  end

  local function background()
    serviceLoop()
  end

  local function run(event)
    handleInput(event)
    serviceLoop()
    drawScreen()

    if config.mode == "tool" and state.requestedExit then
      return 2
    end

    return 0
  end

  return {
    init = init,
    background = background,
    run = run,
    destroy = destroy,
  }
end

return newLoggerApp
