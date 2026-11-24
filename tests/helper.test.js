// Locks in the helper's output. Run from the repository with: node --test tests/*.test.js
const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawn, spawnSync } = require("node:child_process")

const HELPER = path.join(__dirname, "..", "bin", "system-monitor")

const HEADER = "    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND"
const row = (pid, cpu, mem, name) => `${pid} user 20 0 1000 100 10 R ${cpu} ${mem} 0:01.00 ${name}`
// The helper counts cores from /proc/stat, so fixtures give top's per-core figure for a
// chosen share of the whole machine.
const CORES = fs.readFileSync("/proc/stat", "utf8").split("\n").filter(l => /^cpu\d/.test(l)).length
const perCore = share => (share * CORES).toFixed(2)
const TOP_OUTPUT = [
  "top - 12:00:00 up 1 day",
  HEADER,
  row(900, "0.0", "9.9", "first-frame-only"),
  "",
  "top - 12:00:01 up 1 day",
  HEADER,
  row(9000101, perCore(50), "5.0", "busy proc --flag"),
  row(9000102, perCore(1), "1.5", "small"),
  row(9000103, perCore(0.7), "0.1", "top"),
  row(9000104, perCore(0.5), "0.2", "third"),
  row(9000105, perCore(0.2), "0.3", "fourth"),
  row(9000106, perCore(0.1), "0.4", "fifth"),
  row(9000107, perCore(0.1), "0.5", "sixth")
].join("\n")

// Runs the helper as Panel.qml does, from another directory, with top stubbed and an empty
// sysfs unless a test supplies one. `stubs` adds more commands to PATH.
function run(args, topOutput = TOP_OUTPUT, { sys, stubs = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "system-monitor-test-"))
  try {
    const fixture = path.join(dir, "top-output")
    fs.writeFileSync(fixture, topOutput + "\n")
    fs.writeFileSync(path.join(dir, "top"), `#!/bin/sh\ncat "${fixture}"\n`, { mode: 0o755 })
    for (const [name, body] of Object.entries(stubs)) {
      fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    }
    const emptySys = path.join(dir, "sys")
    fs.mkdirSync(emptySys)
    return spawnSync("bash", [HELPER, ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SYSTEM_MONITOR_SYS: sys || emptySys }
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
  assert.deepStrictEqual(lines.map(l => l[0]), ["cpu", "mem", "swap", "load", "uptime", "cores"])
  assert.deepStrictEqual(lines[5], ["cores", String(CORES)])
  for (const l of lines.slice(0, 3)) {
    assert.strictEqual(l.length, 3)
    assert.match(l[1], /^\d+$/)
    assert.match(l[2], /^\d+$/)
  }
  assert.strictEqual(lines[3].length, 4)
  for (const v of lines[3].slice(1)) assert.match(v, /^\d+\.\d+$/)
  assert.match(lines[4][1], /^\d+$/)
  const cpu = lines[0].slice(1).map(Number)
  assert.ok(cpu[1] >= cpu[0] && cpu[0] > 0)
})

test("an unknown argument prints usage and fails", () => {
  const r = run(["--bad"])
  assert.strictEqual(r.status, 1)
  assert.strictEqual(r.stdout, "")
  assert.match(r.stderr, /^Usage: system-monitor \[--gpu \| --top \| --kill <pid> <start> \[--force\] \| --check <pid> <start>\.\.\.\]\n$/)
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
// It runs in its own process group, so cleanup also ends anything it started.
function withProcess(command, args, comm, fn) {
  const child = spawn(command, args, { stdio: "ignore", detached: true })
  try {
    for (let i = 0; i < 200 && readComm(child.pid) !== comm; i++) sleepMs(10)
    assert.strictEqual(readComm(child.pid), comm)
    fn(child.pid)
  } finally {
    try { process.kill(-child.pid, "SIGKILL") } catch {}
  }
}

test("--top marks your own process as stoppable", () => {
  withProcess("sleep", ["30"], "sleep", pid => {
    const r = run(["--top"], [HEADER, "", HEADER, row(pid, perCore(0.1), "0.1", "sleep")].join("\n"))
    assert.strictEqual(r.stdout, `proc\t${pid}\t0.1\t0.1\t1\t${startOf(pid)}\tsleep\n`)
  })
})

// Runs fn with a copy of bash started under the given file name, which becomes its comm
// (cut to 15 characters, as the kernel does). bash rather than sleep, because sleep can be
// one binary shared by many commands that picks which to be from its own name.
// The trailing ":" keeps bash from replacing itself with sleep.
function withNamedProcess(file, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "system-monitor-test-"))
  try {
    const fake = path.join(dir, file)
    fs.copyFileSync(fs.realpathSync("/bin/bash"), fake)
    fs.chmodSync(fake, 0o755)
    withProcess(fake, ["-c", "sleep 30; :"], file.slice(0, 15), fn)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("a critical desktop process can't be listed as stoppable or stopped", () => {
  const critical = ["Hyprland", "start-hyprland", "quickshell", "hyprlock", "hypridle", "gnome-keyring-daemon"]
  for (const file of critical) {
    withNamedProcess(file, pid => {
      const comm = file.slice(0, 15)
      const top = run(["--top"], [HEADER, "", HEADER, row(pid, perCore(0.1), "0.1", comm)].join("\n"))
      assert.strictEqual(top.stdout, `proc\t${pid}\t0.1\t0.1\t0\t0\t${comm}\n`, file)
      assert.strictEqual(run(["--kill", String(pid), startOf(pid), "--force"]).stdout, "refused\n", file)
      assert.ok(isLive(pid), file)
    })
  }
})

test("a process name shaped like a placeholder or markup passes through untouched", () => {
  withNamedProcess("%1%2<b>x<i>", pid => {
    const name = "%1%2<b>x<i>"
    const top = run(["--top"], [HEADER, "", HEADER, row(pid, perCore(0.1), "0.1", name)].join("\n"))
    assert.strictEqual(top.stdout, `proc\t${pid}\t0.1\t0.1\t1\t${startOf(pid)}\t${name}\n`)
  })
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

// A fake /sys with the given hwmon sensors and NVIDIA cards.
// hwmon: [{ name, temps: { 1: "45000" }, labels: { 1: "edge" }, vram, asleep }]
// nvidia: [{ bus, asleep }]
function fakeSys(hwmon = [], nvidia = []) {
  const sys = fs.mkdtempSync(path.join(os.tmpdir(), "system-monitor-sys-"))
  const device = (dir, { vram, asleep }) => {
    fs.mkdirSync(path.join(dir, "power"), { recursive: true })
    fs.writeFileSync(path.join(dir, "power", "runtime_status"), asleep ? "suspended\n" : "active\n")
    if (vram !== undefined) fs.writeFileSync(path.join(dir, "mem_info_vram_total"), `${vram}\n`)
  }
  hwmon.forEach((h, i) => {
    const dir = path.join(sys, "class", "hwmon", `hwmon${i}`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "name"), h.name + "\n")
    for (const [n, v] of Object.entries(h.temps || {})) fs.writeFileSync(path.join(dir, `temp${n}_input`), v + "\n")
    for (const [n, v] of Object.entries(h.labels || {})) fs.writeFileSync(path.join(dir, `temp${n}_label`), v + "\n")
    const dev = path.join(sys, "devices", `hwmon${i}`)
    device(dev, h)
    fs.symlinkSync(dev, path.join(dir, "device"))
  })
  for (const card of nvidia) {
    const dev = path.join(sys, "devices", card.bus)
    device(dev, card)
    const drv = path.join(sys, "bus", "pci", "drivers", "nvidia")
    fs.mkdirSync(drv, { recursive: true })
    fs.symlinkSync(dev, path.join(drv, card.bus))
  }
  return sys
}

// The temperature lines of a sample taken against a fake /sys.
function temps(args, sys, stubs) {
  try {
    const r = run(args, TOP_OUTPUT, { sys, stubs })
    assert.strictEqual(r.status, 0)
    assert.strictEqual(r.stderr, "")
    return r.stdout.split("\n").filter(l => /^(cputemp|gputemp|gpusleep)\t/.test(l))
  } finally {
    fs.rmSync(sys, { recursive: true, force: true })
  }
}

const AMD_IGPU = { name: "amdgpu", temps: { 1: "47000" }, labels: { 1: "edge" }, vram: 536870912 }
const AMD_CARD = { name: "amdgpu", temps: { 1: "66000" }, labels: { 1: "edge" }, vram: 8589934592 }

test("the GPU is read only when asked for", () => {
  assert.deepStrictEqual(temps([], fakeSys([AMD_IGPU])), [])
  assert.deepStrictEqual(temps(["--gpu"], fakeSys([AMD_IGPU])), ["gputemp\t47000"])
})

test("an NVIDIA card is read through nvidia-smi instead of the CPU's graphics", () => {
  const sys = fakeSys([AMD_IGPU], [{ bus: "0000:01:00.0" }])
  assert.deepStrictEqual(temps(["--gpu"], sys, { "nvidia-smi": "echo 61" }), ["gputemp\t61000"])
})

test("nvidia-smi is asked about the awake card only", () => {
  const sys = fakeSys([], [{ bus: "0000:01:00.0", asleep: true }, { bus: "0000:02:00.0" }])
  const log = path.join(os.tmpdir(), `system-monitor-nvsmi-${process.pid}`)
  try {
    assert.deepStrictEqual(temps(["--gpu"], sys, { "nvidia-smi": `echo "$@" > "${log}"; echo 61` }), ["gputemp\t61000"])
    assert.match(fs.readFileSync(log, "utf8"), /^-i 0000:02:00\.0 --query-gpu=temperature\.gpu /)
  } finally {
    fs.rmSync(log, { force: true })
  }
})

test("a sleeping NVIDIA card reads as asleep and isn't woken", () => {
  const sys = fakeSys([AMD_IGPU], [{ bus: "0000:01:00.0", asleep: true }])
  const log = path.join(os.tmpdir(), `system-monitor-nvsmi-${process.pid}`)
  try {
    assert.deepStrictEqual(temps(["--gpu"], sys, { "nvidia-smi": `touch "${log}"; echo 61` }), ["gpusleep\t1"])
    assert.ok(!fs.existsSync(log), "nvidia-smi was run against a sleeping card")
  } finally {
    fs.rmSync(log, { force: true })
  }
})

test("an NVIDIA card that can't be read shows nothing rather than the CPU's graphics", () => {
  for (const body of ["exit 9", "echo '[N/A]'", "echo '<b>61</b>'"]) {
    assert.deepStrictEqual(temps(["--gpu"], fakeSys([AMD_IGPU], [{ bus: "0000:01:00.0" }]), { "nvidia-smi": body }), [], body)
  }
})

test("an AMD card wins over AMD graphics in the CPU, whichever is listed first", () => {
  assert.deepStrictEqual(temps(["--gpu"], fakeSys([AMD_IGPU, AMD_CARD])), ["gputemp\t66000"])
  assert.deepStrictEqual(temps(["--gpu"], fakeSys([AMD_CARD, AMD_IGPU])), ["gputemp\t66000"])
  assert.deepStrictEqual(temps(["--gpu"], fakeSys([{ ...AMD_CARD, asleep: true }, AMD_IGPU])), ["gpusleep\t1"])
})

test("the CPU's package sensor is preferred, and a missing or garbled reading is left out", () => {
  const k10 = { name: "k10temp", temps: { 1: "51000", 3: "58500" }, labels: { 1: "Tccd1", 3: "Tctl" } }
  assert.deepStrictEqual(temps([], fakeSys([{ name: "nvme", temps: { 1: "40000" } }, k10])), ["cputemp\t58500"])
  const intel = { name: "coretemp", temps: { 1: "62000", 2: "55000" }, labels: { 1: "Package id 0", 2: "Core 0" } }
  assert.deepStrictEqual(temps([], fakeSys([intel])), ["cputemp\t62000"])
  for (const bad of ["", "garbage", "1e9"]) {
    assert.deepStrictEqual(temps(["--gpu"], fakeSys([{ name: "k10temp", temps: { 1: bad } }, { ...AMD_IGPU, temps: { 1: bad } }])), [], bad)
  }
  assert.deepStrictEqual(temps(["--gpu"], fakeSys([{ name: "k10temp" }, { name: "amdgpu" }])), [])
})
