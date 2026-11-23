// Locks in the helper's output. Run with: node --test ~/.config/omarchy/plugins/system-monitor/tests/
const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawn, spawnSync } = require("node:child_process")

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
  row(9000101, "800.0", "5.0", "busy proc --flag"),
  row(9000102, "16.0", "1.5", "small"),
  row(9000103, "12.0", "0.1", "top"),
  row(9000104, "8.0", "0.2", "third"),
  row(9000105, "4.0", "0.3", "fourth"),
  row(9000106, "1.6", "0.4", "fifth"),
  row(9000107, "0.8", "0.5", "sixth")
].join("\n")

// Runs the helper as Panel.qml does, from another directory, with top and nproc stubbed.
function run(args, topOutput = TOP_OUTPUT) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "system-monitor-test-"))
  try {
    const fixture = path.join(dir, "top-output")
    fs.writeFileSync(fixture, topOutput + "\n")
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
    "proc\t9000101\t50.0\t5.0\t0\t0\tbusy proc --flag",
    "proc\t9000102\t1.0\t1.5\t0\t0\tsmall",
    "proc\t9000104\t0.5\t0.2\t0\t0\tthird",
    "proc\t9000105\t0.2\t0.3\t0\t0\tfourth",
    "proc\t9000106\t0.1\t0.4\t0\t0\tfifth",
    "proc\t9000107\t0.1\t0.5\t0\t0\tsixth",
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
  assert.match(r.stderr, /^Usage: system-monitor \[--top \| --kill <pid> <start> \[--force\] \| --check <pid> <start>\.\.\.\]\n$/)
})

const sleepMs = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const readComm = pid => { try { return fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim() } catch { return "" } }
const statFields = pid => fs.readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\) /s, "").split(" ")
const startOf = pid => statFields(pid)[19]
const isLive = pid => { try { return statFields(pid)[0] !== "Z" } catch { return false } }

function waitUntilGone(pid) {
  for (let i = 0; i < 200 && isLive(pid); i++) sleepMs(10)
  assert.ok(!isLive(pid))
}

// Every process stopped here is one this test spawned itself.
function withProcess(command, args, comm, fn) {
  const child = spawn(command, args, { stdio: "ignore" })
  try {
    for (let i = 0; i < 200 && readComm(child.pid) !== comm; i++) sleepMs(10)
    assert.strictEqual(readComm(child.pid), comm)
    fn(child.pid)
  } finally {
    child.kill("SIGKILL")
  }
}

test("--top marks your own process as stoppable", () => {
  withProcess("sleep", ["30"], "sleep", pid => {
    const r = run(["--top"], [HEADER, "", HEADER, row(pid, "1.6", "0.1", "sleep")].join("\n"))
    assert.strictEqual(r.stdout, `proc\t${pid}\t0.1\t0.1\t1\t${startOf(pid)}\tsleep\n`)
  })
})

test("a critical desktop process can't be listed as stoppable or stopped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "system-monitor-test-"))
  try {
    const fake = path.join(dir, "Hyprland")
    fs.copyFileSync(fs.realpathSync("/usr/bin/sleep"), fake)
    fs.chmodSync(fake, 0o755)
    withProcess(fake, ["30"], "Hyprland", pid => {
      const top = run(["--top"], [HEADER, "", HEADER, row(pid, "1.6", "0.1", "Hyprland")].join("\n"))
      assert.strictEqual(top.stdout, `proc\t${pid}\t0.1\t0.1\t0\t0\tHyprland\n`)
      assert.strictEqual(run(["--kill", String(pid), startOf(pid), "--force"]).stdout, "refused\n")
      assert.ok(isLive(pid))
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("--kill stops the process it was asked to", () => {
  withProcess("sleep", ["30"], "sleep", pid => {
    assert.strictEqual(run(["--kill", String(pid), startOf(pid)]).stdout, "sent\n")
    waitUntilGone(pid)
  })
})

test("--kill leaves a process alone if its PID was reused", () => {
  withProcess("sleep", ["30"], "sleep", pid => {
    assert.strictEqual(run(["--kill", String(pid), "1"]).stdout, "changed\n")
    assert.ok(isLive(pid))
  })
})

test("only --force ends a process that ignores the graceful stop", () => {
  withProcess("bash", ["-c", 'trap "" TERM; exec sleep 30'], "sleep", pid => {
    const start = startOf(pid)
    assert.strictEqual(run(["--kill", String(pid), start]).stdout, "sent\n")
    sleepMs(300)
    assert.ok(isLive(pid))
    assert.strictEqual(run(["--kill", String(pid), start, "--force"]).stdout, "sent\n")
    waitUntilGone(pid)
  })
})

test("--check reports only the exact processes still running", () => {
  withProcess("sleep", ["30"], "sleep", pid => {
    const start = startOf(pid)
    assert.strictEqual(run(["--check", String(pid), start, "9000199", "5"]).stdout, `alive\t${pid}\nok\n`)
    assert.strictEqual(run(["--check", String(pid), "1"]).stdout, "ok\n")
    assert.strictEqual(run(["--check", "1;id", start]).stdout, "ok\n")
  })
})

test("--kill rejects bad input and reports a missing process", () => {
  assert.strictEqual(run(["--kill", "9000199", "5"]).stdout, "gone\n")
  for (const args of [[], ["abc", "1"], ["1;id", "1"], ["0", "1"], ["-1", "1"], ["123", "x"], ["123", "1", "--other"]]) {
    assert.strictEqual(run(["--kill", ...args]).stdout, "refused\n")
  }
})
