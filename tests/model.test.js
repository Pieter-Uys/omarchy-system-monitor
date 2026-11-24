// Run with: node --test ~/.config/omarchy/plugins/io.github.pieter-uys.system-monitor/tests/
const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const root = path.join(__dirname, "..")
const M = {}
vm.runInNewContext(fs.readFileSync(path.join(root, "Model.js"), "utf8"), M)

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
  const procs = M.parseProcs(`proc\t42\t12.5\t1.0\t0\t0\t${evil}\nproc\t43\t1\t1\t0\t0\t${"x".repeat(500)}`, 16)
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
    "proc\t4\t99999\t500\t0\t0\tclamped"
  ].join("\n"))
  assert.deepStrictEqual(Array.from(procs, p => p.name), ["bad[31mname", "clamped"])
  assert.strictEqual(procs[1].cpu, 100)
  assert.strictEqual(procs[1].mem, 100)
})

test("caps the process list at 50", () => {
  const raw = Array.from({ length: 60 }, (_, i) => `proc\t${i + 1}\t1\t1\t0\t0\tp${i}`).join("\n")
  assert.strictEqual(M.parseProcs(raw).length, 50)
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
  for (const r of ["sent", "gone", "changed", "refused"]) assert.strictEqual(M.parseKillResult(r + "\n"), r)
  assert.strictEqual(M.parseKillResult("<b>stopped</b>"), "refused")
  assert.strictEqual(M.parseKillResult(""), "refused")
})

test("a failed check is never read as every process having exited", () => {
  assert.deepStrictEqual(Object.keys(M.parseAlive("alive\t12\nalive\t34\nok\n")), ["12", "34"])
  assert.deepStrictEqual(Object.keys(M.parseAlive("ok\n")), [])
  for (const raw of ["", "alive\t12\n", "alive\tabc\nok", "<b>ok</b>"]) assert.strictEqual(M.parseAlive(raw), null)
})

test("stopping processes stay pinned at the top with live readings", () => {
  const procs = [
    { pid: 1, start: "10", name: "busy", cpu: 9, mem: 1, killable: true },
    { pid: 2, start: "20", name: "steam", cpu: 3, mem: 2, killable: true }
  ]
  const stopping = [
    { pid: 2, start: "20", name: "steam", cpu: 8, mem: 8, forced: false, since: 5 },
    { pid: 3, start: "30", name: "idle", cpu: 0.5, mem: 4, forced: true, since: 6 }
  ]
  const rows = M.mergeStopping(procs, stopping)
  assert.deepStrictEqual(Array.from(rows, r => [r.name, r.stopping, r.forced, r.cpu]), [
    ["steam", true, false, 3], ["idle", true, true, 0.5], ["busy", false, false, 9]
  ])
  assert.strictEqual(rows[0].killable, false)
  assert.strictEqual(rows[2].killable, true)
})

test("a reused PID isn't pinned as the process being stopped", () => {
  const rows = M.mergeStopping([{ pid: 2, start: "99", name: "new", cpu: 1, mem: 1, killable: true }],
    [{ pid: 2, start: "20", name: "old", cpu: 0, mem: 0, forced: false, since: 1 }])
  assert.deepStrictEqual(Array.from(rows, r => [r.name, r.stopping]), [["old", true], ["new", false]])
})

test("meters keep their order and have translated labels", () => {
  assert.deepStrictEqual(Array.from(M.METERS), ["cpu", "memory", "swap", "cpuTemp", "gpuTemp"])
  const en = JSON.parse(fs.readFileSync(path.join(root, "i18n", "en.json"), "utf8"))
  for (const key of M.METERS) assert.ok(key in en, `missing i18n key: ${key}`)
})

test("each meter's visibility, fill and level", () => {
  const stats = { cpu: 0.8, memFraction: 0.95, swapTotalKb: 1000, swapFraction: 0.5, cpuTemp: 72, gpuTemp: 90 }
  const read = key => { const m = M.meter(key, stats); return [m.visible, m.fraction, m.level] }
  assert.deepStrictEqual(read("cpu"), [true, 0.8, "warm"])
  assert.deepStrictEqual(read("memory"), [true, 0.95, "hot"])
  assert.deepStrictEqual(read("swap"), [true, 0.5, "normal"])
  assert.deepStrictEqual(read("cpuTemp"), [true, 0.72, "warm"])
  assert.deepStrictEqual(read("gpuTemp"), [true, 0.9, "hot"])
})

test("meters handle no swap and missing readings", () => {
  const noSwap = M.meter("swap", { swapTotalKb: 0, swapFraction: NaN })
  assert.deepStrictEqual([noSwap.visible, noSwap.fraction, noSwap.level], [true, 0, "normal"])
  assert.strictEqual(M.meter("swap", { swapTotalKb: NaN, swapFraction: NaN }).visible, false)
  for (const key of ["cpuTemp", "gpuTemp"]) {
    const m = M.meter(key, { cpuTemp: NaN, gpuTemp: NaN })
    assert.strictEqual(m.visible, false)
    assert.ok(isNaN(m.fraction))
    assert.strictEqual(m.level, "normal")
  }
  const cpu = M.meter("cpu", { cpu: NaN })
  assert.deepStrictEqual([cpu.visible, cpu.level], [true, "normal"])
  assert.strictEqual(M.meter("unknown", {}).visible, false)
})
