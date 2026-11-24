// Display text for system-monitor: the panel's readings turned into translated strings.
// Every function takes `fx`, which the panel builds from its translations and Omarchy's number
// formatting: { t(key), num(value, decimals) }. Passing them in keeps this file plain
// JavaScript, so the tests can run it without the shell. Called from inside QML bindings, so
// a language switch still re-renders everything.

const DASH = "—"

function gib(kb) {
  return kb / 1048576
}

// { value, decimals, unit } for a size in KiB: whole MiB below 1 GiB, else GiB to one decimal.
function size(kb) {
  if (Number.isNaN(kb) || kb < 0) return null
  if (kb < 1048576) return { value: Math.max(0, Math.round(kb / 1024)), decimals: 0, unit: "MiB" }
  return { value: kb / 1048576, decimals: 1, unit: "GiB" }
}

function pct(fx, fraction) {
  if (Number.isNaN(fraction)) return DASH
  return fx.t("percent").arg(fx.num(Math.round(fraction * 100)))
}

function deg(fx, c) {
  if (Number.isNaN(c)) return DASH
  return fx.t("degrees").arg(fx.num(Math.round(c)))
}

function memText(fx, usedKb, totalKb) {
  if (Number.isNaN(usedKb) || Number.isNaN(totalKb)) return DASH
  return fx.t("memValue").arg(fx.num(gib(usedKb), 1)).arg(fx.num(gib(totalKb), 1))
}

function sizeText(fx, kb) {
  const z = size(kb)
  if (!z) return DASH
  return fx.t(z.unit === "GiB" ? "sizeGiB" : "sizeMiB").arg(fx.num(z.value, z.decimals))
}

// "brave ×32" for a program with several processes, else just its name.
function groupName(fx, row) {
  return row.count > 1 ? fx.t("groupName").arg(row.name).arg(fx.num(row.count)) : row.name
}

// "CPU · 58°C" when the meter has a temperature, else just its name.
function meterLabel(fx, key, temp) {
  return Number.isNaN(temp) ? fx.t(key) : fx.t("withTemp").arg(fx.t(key)).arg(deg(fx, temp))
}

// The reading at the right end of a meter.
function meterValue(fx, key, s) {
  if (key === "cpu") return pct(fx, s.cpu)
  if (key === "memory") return memText(fx, s.memUsedKb, s.memTotalKb)
  if (key === "swap") return s.swapTotalKb === 0 ? fx.t("noSwap") : memText(fx, s.swapUsedKb, s.swapTotalKb)
  if (s.gpuAsleep) return fx.t("gpuAsleep")
  return Number.isNaN(s.gpuLoad) ? deg(fx, s.gpuTemp) : pct(fx, s.gpuLoad)
}

// parts is Model.uptimeParts(seconds): { days, hours, minutes }, or null for no reading.
function uptimeText(fx, parts) {
  if (!parts) return ""
  if (parts.days > 0) return fx.t("uptimeDays").arg(fx.num(parts.days)).arg(fx.num(parts.hours))
  if (parts.hours > 0) return fx.t("uptimeHours").arg(fx.num(parts.hours)).arg(fx.num(parts.minutes))
  return fx.t("uptimeMinutes").arg(fx.num(parts.minutes))
}
