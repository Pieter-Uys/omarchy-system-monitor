import QtQuick
import Quickshell.Io
import "../Model.js" as Model

// Asks a process to quit and follows it until it exits. Nothing is force-killed
// unless the user asks, so a slow app can take as long as it needs.
Item {
  id: controller

  property string helperPath: ""
  property var translations: null
  // Checks on stopping processes only while the panel is open.
  property bool active: false
  property var target: null
  property bool force: false
  property string notice: ""
  property var stopping: []
  property real now: Date.now()
  property var pending: null
  property var checking: []

  signal processGone(var pid)

  function request(proc) {
    if (killProc.running) return
    controller.notice = ""
    controller.force = !!proc.stopping
    controller.target = proc
  }

  function cancel() {
    controller.target = null
    controller.force = false
  }

  function confirm() {
    if (!controller.target || killProc.running) return
    var command = ["bash", controller.helperPath, "--kill", String(controller.target.pid), controller.target.start]
    if (controller.force) command.push("--force")
    controller.pending = { proc: controller.target, forced: controller.force }
    controller.cancel()
    killProc.command = command
    killProc.running = true
  }

  function showNotice(key, name) {
    controller.notice = controller.translations.t(key).arg(name)
    noticeTimer.restart()
  }

  function forget(pid) {
    controller.stopping = controller.stopping.filter(function(s) { return s.pid !== pid })
    controller.processGone(pid)
  }

  function onResult(raw) {
    var job = controller.pending
    controller.pending = null
    if (!job) return
    var result = Model.parseKillResult(raw)
    if (result === "sent") {
      if (job.forced) {
        controller.stopping = controller.stopping.map(function(s) {
          return s.pid === job.proc.pid ? Object.assign({}, s, { forced: true }) : s
        })
      } else {
        controller.now = Date.now()
        controller.stopping = controller.stopping.concat([{
          pid: job.proc.pid, start: job.proc.start, name: job.proc.name,
          cpu: job.proc.cpu, mem: job.proc.mem, forced: false, since: controller.now
        }])
      }
    } else if (result === "gone" || result === "changed") {
      controller.forget(job.proc.pid)
      controller.showNotice("killGone", job.proc.name)
    } else {
      controller.showNotice("killFailed", job.proc.name)
    }
  }

  function check() {
    if (checkProc.running || controller.stopping.length === 0) return
    var command = ["bash", controller.helperPath, "--check"]
    controller.checking = controller.stopping.map(function(s) {
      command.push(String(s.pid), s.start)
      return s.pid
    })
    checkProc.command = command
    checkProc.running = true
  }

  function onChecked(raw) {
    var checked = controller.checking
    var alive = Model.parseAlive(raw, checked.length)
    if (!alive) return
    controller.stopping.filter(function(s) {
      return checked.indexOf(s.pid) >= 0 && !alive[s.pid]
    }).forEach(function(s) {
      controller.forget(s.pid)
      controller.showNotice("killStopped", s.name)
    })
  }

  Process {
    id: killProc
    stdout: StdioCollector { waitForEnd: true; onStreamFinished: controller.onResult(text) }
  }

  Process {
    id: checkProc
    stdout: StdioCollector { waitForEnd: true; onStreamFinished: controller.onChecked(text) }
  }

  Timer {
    interval: 1000
    running: controller.active && controller.stopping.length > 0
    repeat: true
    triggeredOnStart: true
    onTriggered: {
      controller.now = Date.now()
      controller.check()
    }
  }

  Timer { id: noticeTimer; interval: 5000; repeat: false; onTriggered: controller.notice = "" }
}
