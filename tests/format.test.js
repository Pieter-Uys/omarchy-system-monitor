// Locks in the panel's display text. Run from the repository with: node --test tests/*.test.js
const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const root = path.join(__dirname, "..")
const en = JSON.parse(fs.readFileSync(path.join(root, "i18n", "en.json"), "utf8"))

// QML adds String.prototype.arg; Node doesn't have it. Like Qt's, this replaces every
// occurrence of the lowest-numbered %N with the value.
const ctx = {}
vm.runInNewContext(`
  String.prototype.arg = function(value) {
    var markers = this.match(/%[1-9]/g)
    if (!markers) return String(this)
    var lowest = markers.sort()[0]
    return this.split(lowest).join(String(value))
  }
`, ctx)
vm.runInNewContext(fs.readFileSync(path.join(root, "Format.js"), "utf8"), ctx)
const F = ctx
const plain = v => JSON.parse(JSON.stringify(v))

// The English catalog and a plain number formatter, standing in for the shell's.
const fx = {
  t: key => {
    const v = en[key]
    return typeof v === "object" ? v.other : (v || key)
  },
  num: (value, decimals) => decimals === undefined ? String(value) : value.toFixed(decimals)
}

test("percentages and temperatures round to whole numbers, with a dash for no reading", () => {
  assert.strictEqual(F.pct(fx, 0.126), "13%")
  assert.strictEqual(F.pct(fx, 0), "0%")
  assert.strictEqual(F.pct(fx, NaN), "—")
  assert.strictEqual(F.deg(fx, 58.4), "58°C")
  assert.strictEqual(F.deg(fx, NaN), "—")
})

test("memory reads as used and total GiB to one decimal", () => {
  assert.strictEqual(F.memText(fx, 19.7 * 1048576, 30.5 * 1048576), "19.7 / 30.5 GiB")
  assert.strictEqual(F.memText(fx, NaN, 1048576), "—")
})

test("sizes read in MiB below 1 GiB and GiB above", () => {
  assert.deepStrictEqual(plain(F.size(0)), { value: 0, decimals: 0, unit: "MiB" })
  assert.deepStrictEqual(plain(F.size(204800)), { value: 200, decimals: 0, unit: "MiB" })
  assert.deepStrictEqual(plain(F.size(1048576 * 13.4)), { value: 13.4, decimals: 1, unit: "GiB" })
  assert.strictEqual(F.size(NaN), null)
  assert.strictEqual(F.size(-1), null)
  assert.strictEqual(F.sizeText(fx, 840 * 1024), "840 MiB")
  assert.strictEqual(F.sizeText(fx, 2.6 * 1048576), "2.6 GiB")
  assert.strictEqual(F.sizeText(fx, NaN), "—")
})

test("a program with several processes shows its count, and markup in a name stays as text", () => {
  assert.strictEqual(F.groupName(fx, { name: "brave", count: 32 }), "brave ×32")
  assert.strictEqual(F.groupName(fx, { name: "kitty", count: 1 }), "kitty")
  // Names go to a PlainText sink; this just checks they pass through unchanged.
  assert.strictEqual(F.groupName(fx, { name: "<b>x</b>", count: 2 }), "<b>x</b> ×2")
})

test("meter labels carry the temperature when there is one", () => {
  assert.strictEqual(F.meterLabel(fx, "cpu", 58), "CPU · 58°C")
  assert.strictEqual(F.meterLabel(fx, "gpu", NaN), "GPU")
  assert.strictEqual(F.meterLabel(fx, "memory", NaN), "Memory")
})

test("meter readings for each meter, including no swap and a sleeping or load-less GPU", () => {
  const s = {
    cpu: 0.28, memUsedKb: 19.7 * 1048576, memTotalKb: 30.5 * 1048576,
    swapUsedKb: 4.3 * 1048576, swapTotalKb: 61 * 1048576,
    gpuLoad: 0.93, gpuTemp: 72, gpuAsleep: false
  }
  assert.strictEqual(F.meterValue(fx, "cpu", s), "28%")
  assert.strictEqual(F.meterValue(fx, "memory", s), "19.7 / 30.5 GiB")
  assert.strictEqual(F.meterValue(fx, "swap", s), "4.3 / 61.0 GiB")
  assert.strictEqual(F.meterValue(fx, "swap", { ...s, swapTotalKb: 0 }), "None")
  assert.strictEqual(F.meterValue(fx, "gpu", s), "93%")
  assert.strictEqual(F.meterValue(fx, "gpu", { ...s, gpuLoad: NaN }), "72°C")
  assert.strictEqual(F.meterValue(fx, "gpu", { ...s, gpuAsleep: true }), "Asleep")
})

test("uptime picks days and hours, hours and minutes, or minutes", () => {
  assert.strictEqual(F.uptimeText(fx, { days: 2, hours: 3, minutes: 4 }), "2d 3h")
  assert.strictEqual(F.uptimeText(fx, { days: 0, hours: 11, minutes: 42 }), "11h 42m")
  assert.strictEqual(F.uptimeText(fx, { days: 0, hours: 0, minutes: 5 }), "5m")
  assert.strictEqual(F.uptimeText(fx, null), "")
})
