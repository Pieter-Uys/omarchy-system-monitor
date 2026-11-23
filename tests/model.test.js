// Run with: node --test ~/.config/omarchy/plugins/system-monitor/tests/
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
  const procs = M.parseProcs(`proc\t42\t12.5\t1.0\t${evil}\nproc\t43\t1\t1\t${"x".repeat(500)}`, 16)
  assert.strictEqual(procs.length, 2)
  // Kept verbatim (never interpreted) — the QML sink is Text.PlainText.
  assert.strictEqual(procs[0].name, evil)
  assert.ok(procs[1].name.length <= 48)
})

test("strips control characters and rejects bad rows", () => {
  const procs = M.parseProcs([
    "proc\t1\t5\t1\tbad\u001b[31mname",
    "proc\tnotapid\t5\t1\tx",
    "proc\t2\tNaN\t1\tx",
    "other\t3\t1\t1\tx",
    "proc\t4\t99999\t500\tclamped"
  ].join("\n"))
  assert.deepStrictEqual(Array.from(procs, p => p.name), ["bad[31mname", "clamped"])
  assert.strictEqual(procs[1].cpu, 100)
  assert.strictEqual(procs[1].mem, 100)
})

test("caps the process list at five", () => {
  const raw = Array.from({ length: 20 }, (_, i) => `proc\t${i + 1}\t1\t1\tp${i}`).join("\n")
  assert.strictEqual(M.parseProcs(raw, 1).length, 5)
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

test("every Text in Panel.qml is plain text", () => {
  const qml = fs.readFileSync(path.join(root, "Panel.qml"), "utf8")
  const texts = qml.match(/\bText\s*\{/g) || []
  // The only raw Text is the local PlainText component, which pins the format.
  assert.strictEqual(texts.length, 1)
  assert.match(qml, /component PlainText: Text \{\s*textFormat: Text\.PlainText/)
  assert.doesNotMatch(qml, /Text\.(RichText|StyledText|AutoText|MarkdownText)/)
})

test("every translation key used in Panel.qml exists in en.json", () => {
  const qml = fs.readFileSync(path.join(root, "Panel.qml"), "utf8")
  const en = JSON.parse(fs.readFileSync(path.join(root, "i18n", "en.json"), "utf8"))
  const keys = [...qml.matchAll(/strings\.tn?\("([^"]+)"/g)].map(m => m[1])
  assert.ok(keys.length > 0)
  for (const k of keys) assert.ok(k in en, `missing i18n key: ${k}`)
})
