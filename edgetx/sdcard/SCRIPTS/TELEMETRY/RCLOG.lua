local coreChunk = loadScript("/SCRIPTS/RCLOG/RCLOGC.lua")

if not coreChunk then
  local function run()
    lcd.clear()
    lcd.drawText(0, 0, "RCLOG core missing", 0)
    lcd.drawText(0, 12, "/SCRIPTS/RCLOG/", SMLSIZE)
    return 0
  end

  return { run = run }
end

local ok, newLoggerApp = pcall(coreChunk)
if not ok or type(newLoggerApp) ~= "function" then
  local function run()
    lcd.clear()
    lcd.drawText(0, 0, "RCLOG core error", 0)
    lcd.drawText(0, 12, "/SCRIPTS/RCLOG/", SMLSIZE)
    return 0
  end

  return { run = run }
end

local app = newLoggerApp({
  mode = "telemetry",
  scriptLabel = "RCLOG TEL",
})

return {
  init = app.init,
  background = app.background,
  run = app.run,
}
