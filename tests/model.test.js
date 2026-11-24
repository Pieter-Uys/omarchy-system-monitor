// Run from the repository with: node --test tests/*.test.js
const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const root = path.join(__dirname, "..")
const M = {}
vm.runInNewContext(fs.readFileSync(path.join(root, "Model.js"), "utf8"), M)
// Objects made inside the model's context have its own prototypes, so compare them as plain data.
const plain = v => JSON.parse(JSON.stringify(v))

const SAMPLE = [
  "cpu\t900\t1000",
  "mem\t32000000\t8000000",
  "swap\t1000\t250",
  "load\t1.92\t0.73\t0.56",
  "uptime\t93784",
  "cores\t16",
  "cputemp\t50000",
  "gputemp\t44000"
].join("\n")

test("parses a full sample and computes CPU from the delta", () => {
  const r = M.reading(M.parseSample(SAMPLE), { idle: 800, total: 800 })
  assert.ok(Math.abs(r.cpu - 0.5) < 1e-9) // 100 idle of 200 total
  assert.strictEqual(r.memFraction, 0.75)
  assert.strictEqual(r.swapFraction, 0.75)
  assert.deepStrictEqual(Array.from(r.load), [1.92, 0.73, 0.56])
  assert.strictEqual(r.cores, 16)
  assert.strictEqual(r.cpuTemp, 50)
  assert.strictEqual(r.gpuTemp, 44)
  assert.deepStrictEqual({ ...M.uptimeParts(r.uptimeSec) }, { days: 1, hours: 2, minutes: 3 })
})

test("first sample has no CPU figure yet", () => {
  const r = M.reading(M.parseSample(SAMPLE), null)
  assert.ok(isNaN(r.cpu))
  assert.deepStrictEqual({ ...r.cpuCounters }, { idle: 900, total: 1000 })
})

test("rejects malformed and out-of-range values", () => {
  const r = M.reading(M.parseSample("cpu\tabc\t1\nmem\t10\t20\ncputemp\t999999\ncores\t0\nload\t1e9"), null)
  assert.strictEqual(r.cpuCounters, null)
  assert.ok(isNaN(r.memFraction)) // available > total
  assert.ok(isNaN(r.cpuTemp))
  assert.strictEqual(r.cores, 1)
  assert.strictEqual(r.load.length, 0)
})

test("no swap reads as zero total", () => {
  const r = M.reading(M.parseSample("swap\t0\t0"), null)
  assert.strictEqual(r.swapTotalKb, 0)
})

test("bounds the number of lines parsed", () => {
  const raw = Array.from({ length: 1000 }, (_, i) => `k${String.fromCharCode(97 + (i % 26))}\t${i}`).join("\n")
  assert.ok(Object.keys(M.parseSample(raw)).length <= 26)
})

test("markup-shaped process names stay inert strings and are bounded", () => {
  const evil = '<img src="https://example.invalid/tracker">'
  const procs = M.parseProcs(`proc\t42\t12.5\t1024\t0\t0\t${evil}\nproc\t43\t1\t1\t0\t0\t${"x".repeat(500)}`, 16)
  assert.strictEqual(procs.length, 2)
  // Kept verbatim (never interpreted) — the QML sink is Text.PlainText.
  assert.strictEqual(procs[0].name, evil)
  assert.ok(procs[1].name.length <= 48)
})

test("strips control characters and rejects bad rows", () => {
  const procs = M.parseProcs([
    "proc\t1\t5\t1\t0\t0\tbad\u001b[31mname",
    "proc\tnotapid\t5\t1\t0\t0\tx",
    "proc\t2\tNaN\t1\t0\t0\tx",
    "other\t3\t1\t1\tx",
    "proc\t5\t1\t1.5\t0\t0\tfractional-memory",
    "proc\t6\t1\t-1\t0\t0\tnegative-memory",
    "proc\t4\t99999\t500\t0\t0\tclamped"
  ].join("\n"))
  assert.deepStrictEqual(Array.from(procs, p => p.name), ["bad[31mname", "clamped"])
  assert.strictEqual(procs[1].cpu, 100)
  assert.strictEqual(procs[1].memKb, 500)
})

test("caps the process list it reads", () => {
  const raw = Array.from({ length: 4100 }, (_, i) => `proc\t${i + 1}\t1\t1\t0\t0\tp${i}`).join("\n")
  assert.strictEqual(M.parseProcs(raw).length, 4000)
})

const proc = (pid, name, cpu, memKb, killable = true) => ({ pid, start: String(pid * 10), name, cpu, memKb, killable })

test("processes sharing a name add up to one row per program", () => {
  const rows = M.groupProcs([
    proc(1, "chromium", 2, 1000), proc(2, "chromium", 1.5, 3000), proc(3, "kitty", 0.5, 500), proc(4, "chromium", 0, 200)
  ], "memory")
  assert.deepStrictEqual(Array.from(rows, r => [r.name, r.count, r.cpu, r.memKb]), [["chromium", 3, 3.5, 4200], ["kitty", 1, 0.5, 500]])
  assert.deepStrictEqual(plain(rows[0].members), [{ pid: 1, start: "10" }, { pid: 2, start: "20" }, { pid: 4, start: "40" }])
})

test("a program can be stopped only if every one of its processes can", () => {
  const rows = M.groupProcs([proc(1, "app", 1, 1), proc(2, "app", 1, 1, false), proc(3, "solo", 1, 1)], "memory")
  assert.deepStrictEqual(Array.from(rows, r => [r.name, r.killable]), [["app", false], ["solo", true]])
})

test("programs sort by memory or CPU, busiest first, cut to the top rows", () => {
  const procs = [proc(1, "a", 9, 100), proc(2, "b", 1, 900), proc(3, "c", 5, 500)]
  assert.deepStrictEqual(Array.from(M.groupProcs(procs, "memory"), r => r.name), ["b", "c", "a"])
  assert.deepStrictEqual(Array.from(M.groupProcs(procs, "cpu"), r => r.name), ["a", "c", "b"])
  assert.deepStrictEqual(Array.from(M.groupProcs(procs, "junk"), r => r.name), ["b", "c", "a"])
  assert.deepStrictEqual(Array.from(M.groupProcs(procs, "memory", 2), r => r.name), ["b", "c"])
  const many = Array.from({ length: 30 }, (_, i) => proc(i + 1, `p${i}`, 1, i))
  assert.strictEqual(M.groupProcs(many, "memory").length, 12)
})

test("a program's CPU share never reads above 100%", () => {
  assert.strictEqual(M.groupProcs([proc(1, "x", 70, 1), proc(2, "x", 60, 1)], "cpu")[0].cpu, 100)
})

test("sizes read in MiB below 1 GiB and GiB above", () => {
  assert.deepStrictEqual(plain(M.size(0)), { value: 0, decimals: 0, unit: "MiB" })
  assert.deepStrictEqual(plain(M.size(204800)), { value: 200, decimals: 0, unit: "MiB" })
  assert.deepStrictEqual(plain(M.size(1048576 * 13.4)), { value: 13.4, decimals: 1, unit: "GiB" })
  assert.strictEqual(M.size(NaN), null)
  assert.strictEqual(M.size(-1), null)
})

test("label cycling and interval clamping", () => {
  assert.strictEqual(M.nextLabel("CPU"), "Memory")
  assert.strictEqual(M.nextLabel("Icon only"), "CPU + Memory")
  assert.strictEqual(M.nextLabel("CPU + Memory"), "CPU")
  assert.strictEqual(M.normalizeLabel("<b>x</b>"), "CPU + Memory")
  assert.strictEqual(M.worstLevel("normal", "hot"), "hot")
  assert.strictEqual(M.worstLevel("warm", "normal"), "warm")
  assert.strictEqual(M.intervalMs(0), 1000)
  assert.strictEqual(M.intervalMs(999), 60000)
  assert.strictEqual(M.intervalMs("junk"), 3000)
})

test("levels", () => {
  assert.strictEqual(M.level(0.5), "normal")
  assert.strictEqual(M.level(0.8), "warm")
  assert.strictEqual(M.level(0.95), "hot")
  assert.strictEqual(M.tempLevel(90), "hot")
})

// Panel.qml plus its components.
function allQml() {
  const dir = path.join(root, "components")
  const parts = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".qml")).map(f => path.join(dir, f)) : []
  return [path.join(root, "Panel.qml"), ...parts].map(f => fs.readFileSync(f, "utf8")).join("\n")
}

test("every Text in the plugin's QML is plain text", () => {
  const qml = allQml()
  const texts = qml.match(/\bText\s*\{/g) || []
  // The only raw Text is the PlainText component, which pins the format.
  assert.strictEqual(texts.length, 1)
  assert.match(qml, /(?:component PlainText: |^)Text \{\s*textFormat: Text\.PlainText/m)
  assert.doesNotMatch(qml, /Text\.(RichText|StyledText|AutoText|MarkdownText)/)
})

test("every translation key used in the plugin's QML exists in en.json", () => {
  const qml = allQml()
  const en = JSON.parse(fs.readFileSync(path.join(root, "i18n", "en.json"), "utf8"))
  const keys = [...qml.matchAll(/strings\.tn?\("([^"]+)"/g)].map(m => m[1])
  assert.ok(keys.length > 0)
  for (const k of keys) assert.ok(k in en, `missing i18n key: ${k}`)
})

test("reads which processes can be stopped", () => {
  const procs = M.parseProcs([
    "proc\t10\t1\t1\t1\t555\tmine",
    "proc\t11\t1\t1\t0\t0\tsystem",
    "proc\t12\t1\t1\t1\t0\tno-start",
    "proc\t13\t1\t1\t2\t555\tbad-flag",
    "proc\t14\t1\t1\t1\tabc\tbad-start"
  ].join("\n"))
  assert.deepStrictEqual(Array.from(procs, p => [p.name, p.killable]), [["mine", true], ["system", false], ["no-start", false]])
  assert.strictEqual(procs[0].start, "555")
})

test("an unexpected kill result counts as refused", () => {
  for (const r of ["sent", "gone", "refused"]) assert.strictEqual(M.parseKillResult(r + "\n"), r)
  assert.strictEqual(M.parseKillResult("changed"), "refused")
  assert.strictEqual(M.parseKillResult("<b>stopped</b>"), "refused")
  assert.strictEqual(M.parseKillResult(""), "refused")
})

test("a failed check is never read as every process having exited", () => {
  assert.deepStrictEqual(Object.keys(M.parseAlive("alive\t12\nalive\t34\nok\n")), ["12", "34"])
  assert.deepStrictEqual(Object.keys(M.parseAlive("ok\n")), [])
  for (const raw of ["", "alive\t12\n", "alive\tabc\nok", "<b>ok</b>"]) assert.strictEqual(M.parseAlive(raw), null)
})

test("programs being stopped stay pinned at the top with live readings", () => {
  const groups = M.groupProcs([proc(1, "busy", 9, 100), proc(2, "steam", 3, 200), proc(5, "steam", 1, 50)], "cpu")
  const stopping = [
    { name: "steam", members: [{ pid: 2, start: "20" }], count: 2, cpu: 8, memKb: 8, forced: false, since: 5 },
    { name: "idle", members: [{ pid: 3, start: "30" }], count: 1, cpu: 0.5, memKb: 4, forced: true, since: 6 }
  ]
  const rows = M.mergeStopping(groups, stopping)
  assert.deepStrictEqual(Array.from(rows, r => [r.name, r.stopping, r.forced, r.cpu, r.count]), [
    ["steam", true, false, 4, 2], ["idle", true, true, 0.5, 1], ["busy", false, false, 9, 1]
  ])
  // A stopping row keeps the processes it's following, so a force kill targets only those.
  assert.deepStrictEqual(plain(rows[0].members), [{ pid: 2, start: "20" }])
  assert.strictEqual(rows[0].killable, false)
  assert.strictEqual(rows[2].killable, true)
})

test("meters keep their order and have translated labels", () => {
  assert.deepStrictEqual(Array.from(M.METERS), ["cpu", "gpu", "memory", "swap"])
  const en = JSON.parse(fs.readFileSync(path.join(root, "i18n", "en.json"), "utf8"))
  for (const key of M.METERS) assert.ok(key in en, `missing i18n key: ${key}`)
})

test("each meter's visibility, fill, temperature and level", () => {
  const stats = { cpu: 0.5, memFraction: 0.95, swapTotalKb: 1000, swapFraction: 0.5, cpuTemp: 72, gpuTemp: 90, gpuLoad: 0.3 }
  const read = key => { const m = M.meter(key, stats); return [m.visible, m.fraction, m.temp, m.level] }
  // CPU and GPU tint for whichever of load and temperature runs hotter.
  assert.deepStrictEqual(read("cpu"), [true, 0.5, 72, "warm"])
  assert.deepStrictEqual(read("gpu"), [true, 0.3, 90, "hot"])
  assert.deepStrictEqual(read("memory"), [true, 0.95, NaN, "hot"])
  assert.deepStrictEqual(read("swap"), [true, 0.5, NaN, "normal"])
})

test("a GPU without a load reading shows its temperature in the bar instead", () => {
  const m = M.meter("gpu", { gpuTemp: 66, gpuLoad: NaN })
  assert.deepStrictEqual([m.visible, m.fraction, m.level], [true, 0.66, "normal"])
  assert.ok(isNaN(m.temp), "the temperature isn't repeated in the label")
  assert.strictEqual(M.meter("gpu", { gpuTemp: NaN, gpuLoad: NaN }).visible, false)
  const loadOnly = M.meter("gpu", { gpuTemp: NaN, gpuLoad: 0.4 })
  assert.deepStrictEqual([loadOnly.visible, loadOnly.fraction], [true, 0.4])
  assert.ok(isNaN(loadOnly.temp))
})

test("GPU load is read as a whole percentage and anything else is dropped", () => {
  assert.strictEqual(M.reading(M.parseSample("gpuload\t37"), null).gpuLoad, 0.37)
  for (const bad of ["101", "-1", "3.5", "<b>9</b>", ""]) {
    assert.ok(isNaN(M.reading(M.parseSample(`gpuload\t${bad}`), null).gpuLoad), bad)
  }
})

test("meters handle no swap and missing readings", () => {
  const noSwap = M.meter("swap", { swapTotalKb: 0, swapFraction: NaN })
  assert.deepStrictEqual([noSwap.visible, noSwap.fraction, noSwap.level], [true, 0, "normal"])
  assert.strictEqual(M.meter("swap", { swapTotalKb: NaN, swapFraction: NaN }).visible, false)
  const cpu = M.meter("cpu", { cpu: NaN, cpuTemp: NaN })
  assert.deepStrictEqual([cpu.visible, cpu.level], [true, "normal"])
  assert.ok(isNaN(cpu.temp))
  assert.strictEqual(M.meter("unknown", {}).visible, false)
})

test("a sleeping GPU shows as asleep, never as a temperature", () => {
  const asleep = M.reading(M.parseSample("gpusleep\t1"), null)
  assert.strictEqual(asleep.gpuAsleep, true)
  assert.ok(isNaN(asleep.gpuTemp))
  const m = M.meter("gpu", asleep)
  assert.deepStrictEqual([m.visible, m.fraction, m.level], [true, 0, "normal"])
  assert.ok(isNaN(m.temp))
  // A real reading wins, and anything but "1" isn't a sleep report.
  assert.strictEqual(M.reading(M.parseSample("gputemp\t61000\ngpusleep\t1"), null).gpuAsleep, false)
  assert.strictEqual(M.reading(M.parseSample("gpuload\t5\ngpusleep\t1"), null).gpuAsleep, false)
  assert.strictEqual(M.reading(M.parseSample("gpusleep\tyes"), null).gpuAsleep, false)
  assert.strictEqual(M.reading({}, null).gpuAsleep, false)
})

test("a check can report no more processes than it was asked about", () => {
  assert.deepStrictEqual(Object.keys(M.parseAlive("alive\t12\nalive\t34\nok\n", 2)), ["12", "34"])
  assert.strictEqual(M.parseAlive("alive\t12\nalive\t34\nok\n", 1), null)
  const many = Array.from({ length: 60 }, (_, i) => `alive\t${i + 1}`).concat("ok").join("\n")
  assert.strictEqual(Object.keys(M.parseAlive(many, 60)).length, 60)
  assert.strictEqual(M.parseAlive(many, 59), null)
  const tooMany = Array.from({ length: 4001 }, (_, i) => `alive\t${i + 1}`).concat("ok").join("\n")
  assert.strictEqual(M.parseAlive(tooMany), null)
})

test("code the shell runs avoids JavaScript its engine lacks", () => {
  // The shell's engine (Qt 6.12) has no Array.prototype.at, though Node, which runs these
  // tests, does, so a stray .at() would pass here and fail in the shell.
  const code = fs.readFileSync(path.join(root, "Model.js"), "utf8") + "\n" + allQml()
  const withoutComments = code.replace(/\/\/.*$/gm, "")
  assert.doesNotMatch(withoutComments, /\.at\(/)
})
