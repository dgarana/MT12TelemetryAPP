-- toolName = TNS|RC Input Logger|TNE

local coreChunk = loadScript("/SCRIPTS/RCLOG/RCLOGC.lua")

if not coreChunk then
  local function run()
    lcd.clear()
    lcd.drawText(0, 0, "RCLOG core missing", 0)
    lcd.drawText(0, 12, "/SCRIPTS/RCLOG/", SMLSIZE)
    lcd.drawText(0, 24, "EXIT to close", SMLSIZE)
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
    lcd.drawText(0, 24, "EXIT to close", SMLSIZE)
    return 0
  end

  return { run = run }
end

local app = newLoggerApp({
  mode = "tool",
  scriptLabel = "RCLOG TOOL",
  lang = "{{LANG}}",
})

return {
  init = app.init,
  run = app.run,
}
