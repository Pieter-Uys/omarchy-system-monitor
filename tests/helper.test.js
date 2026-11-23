// Locks in the helper's output. Run with: node --test ~/.config/omarchy/plugins/system-monitor/tests/
const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const HELPER = path.join(__dirname, "..", "bin", "system-monitor")

const HEADER = "    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND"
const row = (pid, cpu, mem, name) => `${pid} user 20 0 1000 100 10 R ${cpu} ${mem} 0:01.00 ${name}`
const TOP_OUTPUT = [
  "top - 12:00:00 up 1 day",
  HEADER,
  row(900, "0.0", "9.9", "first-frame-only"),
  "",
  "top - 12:00:01 up 1 day",
  HEADER,
  row(101, "800.0", "5.0", "busy proc --flag"),
  row(102, "16.0", "1.5", "small"),
  row(103, "12.0", "0.1", "top"),
  row(104, "8.0", "0.2", "third"),
  row(105, "4.0", "0.3", "fourth"),
  row(106, "1.6", "0.4", "fifth"),
  row(107, "0.8", "0.5", "sixth")
].join("\n")

// Runs the helper as Panel.qml does, from another directory, with top and nproc stubbed.
function run(args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "system-monitor-test-"))
  try {
    const fixture = path.join(dir, "top-output")
    fs.writeFileSync(fixture, TOP_OUTPUT + "\n")
    fs.writeFileSync(path.join(dir, "top"), `#!/bin/sh\ncat "${fixture}"\n`, { mode: 0o755 })
    fs.writeFileSync(path.join(dir, "nproc"), "#!/bin/sh\necho 16\n", { mode: 0o755 })
    return spawnSync("bash", [HELPER, ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("--top reports the second frame as a share of all cores", () => {
  const r = run(["--top"])
  assert.strictEqual(r.status, 0)
  assert.strictEqual(r.stderr, "")
  assert.strictEqual(r.stdout, [
    "proc\t101\t50.0\t5.0\tbusy proc --flag",
    "proc\t102\t1.0\t1.5\tsmall",
    "proc\t104\t0.5\t0.2\tthird",
    "proc\t105\t0.2\t0.3\tfourth",
    "proc\t106\t0.1\t0.4\tfifth",
    ""
  ].join("\n"))
})

test("the default sample keeps its keys, order and field shapes", () => {
  const r = run([])
  assert.strictEqual(r.status, 0)
  assert.strictEqual(r.stderr, "")
  const lines = r.stdout.trimEnd().split("\n").map(l => l.split("\t"))
  assert.deepStrictEqual(lines.slice(0, 6).map(l => l[0]), ["cpu", "mem", "swap", "load", "uptime", "cores"])
  assert.deepStrictEqual(lines[5], ["cores", "16"])
  for (const l of lines.slice(0, 3)) {
    assert.strictEqual(l.length, 3)
    assert.match(l[1], /^\d+$/)
    assert.match(l[2], /^\d+$/)
  }
  assert.strictEqual(lines[3].length, 4)
  assert.match(lines[4][1], /^\d+$/)
  for (const l of lines.slice(6)) {
    assert.match(l[0], /^(cpu|gpu)temp$/)
    assert.match(l[1], /^-?\d+$/)
  }
})

test("an unknown argument prints usage and fails", () => {
  const r = run(["--bad"])
  assert.strictEqual(r.status, 1)
  assert.strictEqual(r.stdout, "")
  assert.match(r.stderr, /^Usage: \S+ \[--top\]\n$/)
})
