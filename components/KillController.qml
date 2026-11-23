import QtQuick
import Quickshell.Io
import "../Model.js" as Model

// Stops one process at a time: ask it to quit, then offer a force kill
// only if it keeps running.
Item {
  id: controller

  property string helperPath: ""
  property var translations: null
  property var target: null
  property bool force: false
  property string notice: ""
  readonly property bool running: killProc.running

  signal processGone(var pid)

  function request(proc) {
    controller.notice = ""
    controller.force = false
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
    killProc.command = command
    killProc.running = true
  }

  function onResult(raw) {
    var proc = controller.target
    if (!proc) return
    var result = Model.parseKillResult(raw)
    if (result === "running" && !controller.force) {
      controller.force = true
      return
    }
    controller.cancel()
    if (result === "stopped" || result === "gone" || result === "changed") controller.processGone(proc.pid)
    controller.notice = controller.translations.t(result === "stopped" ? "killStopped"
      : (result === "gone" || result === "changed") ? "killGone" : "killFailed").arg(proc.name)
    noticeTimer.restart()
  }

  Process {
    id: killProc
    stdout: StdioCollector { waitForEnd: true; onStreamFinished: controller.onResult(text) }
  }

  Timer { id: noticeTimer; interval: 5000; repeat: false; onTriggered: controller.notice = "" }
}
