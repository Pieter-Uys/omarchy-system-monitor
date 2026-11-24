// Pure parsing, grouping and level helpers for system-monitor; display text is in Format.js.
// Everything read from the helper script is treated as untrusted and bounded here.

// Bounds for one sample from the helper: how many lines, and fields per line.
var MAX_SAMPLE_LINES = 64
var MAX_FIELDS = 8
// The helper lists every process so each program's can be added up; the panel shows the top few.
var MAX_PROCS = 4000
var MAX_ROWS = 12
var MAX_NAME = 48

function toInt(value) {
  var s = String(value === undefined || value === null ? "" : value).trim()
  if (!/^-?\d{1,18}$/.test(s)) return NaN
  return parseInt(s, 10)
}

function toNumber(value) {
  var s = String(value === undefined || value === null ? "" : value).trim()
  if (!/^-?\d{1,12}(\.\d{1,6})?$/.test(s)) return NaN
  return parseFloat(s)
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value))
}

// "key\tf1\tf2\n..." -> { key: ["f1", "f2"] }
function parseSample(raw) {
  var out = {}
  var lines = String(raw || "").split("\n")
  for (var i = 0; i < lines.length && i < MAX_SAMPLE_LINES; i++) {
    var parts = lines[i].split("\t")
    if (parts.length < 2) continue
    var key = parts[0]
    if (!/^[a-z]{1,16}$/.test(key)) continue
    out[key] = parts.slice(1, 1 + MAX_FIELDS)
  }
  return out
}

// Builds a reading from a fresh sample and the previous raw CPU counters.
function reading(sample, prevCpu) {
  var r = {
    cpu: NaN, cpuCounters: null,
    memFraction: NaN, memUsedKb: NaN, memTotalKb: NaN,
    swapFraction: NaN, swapUsedKb: NaN, swapTotalKb: NaN,
    load: [], uptimeSec: NaN, cores: 1,
    cpuTemp: Number.NaN, gpuTemp: Number.NaN, gpuLoad: Number.NaN, gpuAsleep: false
  }

  if (sample.cpu) {
    var idle = toInt(sample.cpu[0])
    var total = toInt(sample.cpu[1])
    if (!isNaN(idle) && !isNaN(total) && total >= idle && idle >= 0) {
      r.cpuCounters = { idle: idle, total: total }
      if (prevCpu && total > prevCpu.total) {
        var dTotal = total - prevCpu.total
        var dIdle = idle - prevCpu.idle
        r.cpu = clamp(1 - dIdle / dTotal, 0, 1)
      }
    }
  }

  if (sample.mem) {
    var mt = toInt(sample.mem[0]), ma = toInt(sample.mem[1])
    if (mt > 0 && ma >= 0 && ma <= mt) {
      r.memTotalKb = mt
      r.memUsedKb = mt - ma
      r.memFraction = r.memUsedKb / mt
    }
  }

  if (sample.swap) {
    var st = toInt(sample.swap[0]), sf = toInt(sample.swap[1])
    if (st > 0 && sf >= 0 && sf <= st) {
      r.swapTotalKb = st
      r.swapUsedKb = st - sf
      r.swapFraction = r.swapUsedKb / st
    } else if (st === 0) {
      r.swapTotalKb = 0
    }
  }

  if (sample.load) {
    for (var i = 0; i < 3 && i < sample.load.length; i++) {
      var l = toNumber(sample.load[i])
      if (!isNaN(l) && l >= 0 && l < 100000) r.load.push(l)
    }
  }

  if (sample.uptime) {
    var up = toInt(sample.uptime[0])
    if (up >= 0) r.uptimeSec = up
  }

  if (sample.cores) {
    var c = toInt(sample.cores[0])
    if (c >= 1 && c <= 4096) r.cores = c
  }

  r.cpuTemp = tempC(sample.cputemp ? sample.cputemp[0] : undefined)
  r.gpuTemp = tempC(sample.gputemp ? sample.gputemp[0] : undefined)
  var gl = toInt(sample.gpuload ? sample.gpuload[0] : undefined)
  if (gl >= 0 && gl <= 100) r.gpuLoad = gl / 100
  // A powered-down card is shown as asleep; the helper never wakes it to read it.
  r.gpuAsleep = Number.isNaN(r.gpuTemp) && Number.isNaN(r.gpuLoad) && !!sample.gpusleep && sample.gpusleep[0] === "1"
  return r
}

// hwmon millidegrees -> °C, rejecting nonsense readings.
function tempC(milli) {
  var v = toInt(milli)
  if (isNaN(v)) return NaN
  var c = v / 1000
  return c > -40 && c < 150 ? c : NaN
}

// Strip control characters and bound the length of a process name.
function cleanName(name) {
  var s = String(name || "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim()
  if (s.length > MAX_NAME) s = s.substring(0, MAX_NAME - 1) + "…"
  return s
}

// CPU arrives from the helper as a share of the whole machine, so 100 is the ceiling.
// Memory arrives as resident KiB.
function parseProcs(raw) {
  var out = []
  var lines = String(raw || "").split("\n")
  for (var i = 0; i < lines.length && i < MAX_PROCS + 1 && out.length < MAX_PROCS; i++) {
    var p = lines[i].split("\t")
    if (p.length < 7 || p[0] !== "proc") continue
    if (!/^\d{1,10}$/.test(p[1])) continue
    var cpu = toNumber(p[2]), memKb = toInt(p[3])
    if (Number.isNaN(cpu) || Number.isNaN(memKb) || memKb < 0) continue
    if (!/^[01]$/.test(p[4]) || !/^\d{1,20}$/.test(p[5])) continue
    var name = cleanName(p.slice(6).join(" "))
    if (name === "") continue
    out.push({ pid: Number.parseInt(p[1], 10), cpu: clamp(cpu, 0, 100), memKb: memKb, killable: p[4] === "1" && p[5] !== "0", start: p[5], name: name })
  }
  return out
}

// One row per program: processes sharing a name are added up, so a browser's dozens of
// processes read as one line. A program can be stopped only if every one of its processes can.
// Sorted by "cpu" or "memory", busiest first, and cut to the top `limit`.
function groupProcs(procs, sortKey, limit) {
  // No prototype, so a program named "constructor" or "__proto__" is just another key.
  var byName = Object.create(null), groups = []
  for (const p of procs) {
    var g = byName[p.name]
    if (!g) {
      g = byName[p.name] = { name: p.name, count: 0, cpu: 0, memKb: 0, killable: true, members: [] }
      groups.push(g)
    }
    g.count++
    g.cpu += p.cpu
    g.memKb += p.memKb
    g.killable = g.killable && p.killable
    g.members.push({ pid: p.pid, start: p.start })
  }
  var key = sortKey === "cpu" ? "cpu" : "memKb", other = key === "cpu" ? "memKb" : "cpu"
  groups.sort(function(a, b) {
    return b[key] - a[key] || b[other] - a[other] || compareNames(a.name, b.name)
  })
  for (const g of groups) g.cpu = clamp(g.cpu, 0, 100)
  return groups.slice(0, limit === undefined ? MAX_ROWS : limit)
}

// Alphabetical order, the last tie-break between programs.
function compareNames(a, b) {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

// Anything unexpected from the helper counts as refused.
function parseKillResult(raw) {
  var s = String(raw || "").trim()
  return ["sent", "gone", "refused"].includes(s) ? s : "refused"
}

// The PIDs a --check of `asked` processes found running, or null if the check didn't finish.
function parseAlive(raw, asked) {
  var lines = String(raw || "").trim().split("\n")
  var limit = asked >= 0 ? asked : MAX_PROCS
  // Not lines.at(-1): the shell's JavaScript engine (Qt 6.12) has no Array.prototype.at.
  if (lines[lines.length - 1] !== "ok" || lines.length > limit + 1) return null // NOSONAR javascript:S7755
  var alive = {}
  for (var i = 0; i < lines.length - 1; i++) {
    var p = lines[i].split("\t")
    if (p.length !== 2 || p[0] !== "alive" || !/^\d{1,10}$/.test(p[1])) return null
    alive[parseInt(p[1], 10)] = true
  }
  return alive
}

// Programs shutting down stay pinned at the top, even if they'd drop out of the top rows.
function mergeStopping(groups, stopping) {
  var out = [], pinned = Object.create(null), live = Object.create(null), i
  for (i = 0; i < groups.length; i++) live[groups[i].name] = groups[i]
  for (i = 0; i < stopping.length; i++) {
    var s = stopping[i], now = live[s.name] || s
    pinned[s.name] = true
    out.push({ name: s.name, count: now.count, cpu: now.cpu, memKb: now.memKb, killable: false,
      members: s.members, stopping: true, forced: s.forced, since: s.since })
  }
  for (i = 0; i < groups.length; i++) {
    var g = groups[i]
    if (pinned[g.name]) continue
    out.push({ name: g.name, count: g.count, cpu: g.cpu, memKb: g.memKb, killable: g.killable,
      members: g.members, stopping: false, forced: false, since: 0 })
  }
  return out
}

// "normal" | "warm" | "hot" for a 0..1 fraction, used to tint the meters.
function level(fraction) {
  if (isNaN(fraction)) return "normal"
  if (fraction >= 0.9) return "hot"
  if (fraction >= 0.75) return "warm"
  return "normal"
}

function tempLevel(c) {
  if (isNaN(c)) return "normal"
  if (c >= 85) return "hot"
  if (c >= 70) return "warm"
  return "normal"
}

// The panel's meters, in display order. Each key is also its translation key.
// CPU and GPU carry their temperature in the label, so there's no separate temperature row.
var METERS = ["cpu", "gpu", "memory", "swap"]

// Whether a meter shows, how full it is, its warning level, and the temperature beside its
// label (NaN for none). A meter tints for whichever of its load and temperature runs hotter.
function meter(key, stats) {
  switch (key) {
  case "cpu":
    return { visible: true, fraction: stats.cpu, temp: stats.cpuTemp,
      level: worstLevel(level(stats.cpu), tempLevel(stats.cpuTemp)) }
  case "gpu":
    if (stats.gpuAsleep) return { visible: true, fraction: 0, temp: Number.NaN, level: "normal" }
    // Without a load reading (NVIDIA under nouveau, Intel, radeon), the bar shows temperature.
    if (Number.isNaN(stats.gpuLoad)) {
      return { visible: !Number.isNaN(stats.gpuTemp), fraction: stats.gpuTemp / 100, temp: Number.NaN, level: tempLevel(stats.gpuTemp) }
    }
    return { visible: true, fraction: stats.gpuLoad, temp: stats.gpuTemp,
      level: worstLevel(level(stats.gpuLoad), tempLevel(stats.gpuTemp)) }
  case "memory":
    return { visible: true, fraction: stats.memFraction, temp: Number.NaN, level: level(stats.memFraction) }
  case "swap":
    return {
      visible: !Number.isNaN(stats.swapTotalKb),
      fraction: stats.swapTotalKb === 0 ? 0 : stats.swapFraction,
      temp: Number.NaN,
      level: level(stats.swapFraction)
    }
  }
  return { visible: false, fraction: Number.NaN, temp: Number.NaN, level: "normal" }
}

// Split seconds into { days, hours, minutes } for translated formatting.
function uptimeParts(sec) {
  if (isNaN(sec) || sec < 0) return null
  return {
    days: Math.floor(sec / 86400),
    hours: Math.floor((sec % 86400) / 3600),
    minutes: Math.floor((sec % 3600) / 60)
  }
}

var LABELS = ["CPU + Memory", "CPU", "Memory", "Temperature", "Icon only"]

function normalizeLabel(value) {
  return LABELS.indexOf(value) >= 0 ? value : "CPU + Memory"
}

// The worse of two levels, so a combined readout tints for whichever runs hot.
function worstLevel(a, b) {
  var rank = { normal: 0, warm: 1, hot: 2 }
  return (rank[b] || 0) > (rank[a] || 0) ? b : a
}

function nextLabel(value) {
  var i = LABELS.indexOf(normalizeLabel(value))
  return LABELS[(i + 1) % LABELS.length]
}

function intervalMs(value) {
  var n = toInt(value)
  if (isNaN(n)) n = 3
  return clamp(n, 1, 60) * 1000
}
