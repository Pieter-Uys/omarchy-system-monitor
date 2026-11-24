import QtQuick
import Quickshell.Io
import "../Model.js" as Model

// Asks a program's processes to quit and follows them until they've all exited. Nothing is
// force-killed unless the user asks, so a slow app can take as long as it needs.
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
  property int asked: 0

  signal processGone(string name)

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
    var command = ["bash", controller.helperPath, "--kill"]
    controller.target.members.forEach(function(m) { command.push(String(m.pid), m.start) })
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

  function forget(name) {
    controller.stopping = controller.stopping.filter(function(s) { return s.name !== name })
    controller.processGone(name)
  }

  function onResult(raw) {
    var job = controller.pending
    controller.pending = null
    if (!job) return
    var result = Model.parseKillResult(raw)
    if (result === "sent") {
      if (job.forced) {
        controller.stopping = controller.stopping.map(function(s) {
          return s.name === job.proc.name ? Object.assign({}, s, { forced: true }) : s
        })
      } else {
        controller.now = Date.now()
        controller.stopping = controller.stopping.concat([{
          name: job.proc.name, members: job.proc.members, count: job.proc.count,
          cpu: job.proc.cpu, memKb: job.proc.memKb, forced: false, since: controller.now
        }])
      }
    } else if (result === "gone") {
      controller.forget(job.proc.name)
      controller.showNotice("killGone", job.proc.name)
    } else {
      controller.showNotice("killFailed", job.proc.name)
    }
  }

  function check() {
    if (checkProc.running || controller.stopping.length === 0) return
    var command = ["bash", controller.helperPath, "--check"]
    var asked = 0
    controller.checking = controller.stopping.map(function(s) {
      s.members.forEach(function(m) { command.push(String(m.pid), m.start) })
      asked += s.members.length
      return s.name
    })
    controller.asked = asked
    checkProc.command = command
    checkProc.running = true
  }

  function onChecked(raw) {
    var checked = controller.checking
    var alive = Model.parseAlive(raw, controller.asked)
    if (!alive) return
    // Keep following only the processes still running, so a force kill targets just those.
    controller.stopping = controller.stopping.map(function(s) {
      if (checked.indexOf(s.name) < 0) return s
      return Object.assign({}, s, { members: s.members.filter(function(m) { return alive[m.pid] }) })
    })
    controller.stopping.filter(function(s) {
      return checked.indexOf(s.name) >= 0 && s.members.length === 0
    }).forEach(function(s) {
      controller.forget(s.name)
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
