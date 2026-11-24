import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model
import "components"

// System Stats: a CPU/memory/temperature readout in the bar with a detail
// panel. All readings come from the bundled bin/system-monitor, which reads
// /proc and /sys only. Every displayed string is plain text.
Panel {
  id: root
  moduleName: "io.github.pieter-uys.system-monitor"
  ipcTarget: "io.github.pieter-uys.system-monitor"
  manageIpc: false

  readonly property string helperPath: String(Qt.resolvedUrl("bin/system-monitor")).replace(/^file:\/\//, "")
  readonly property string chipGlyph: String.fromCodePoint(0xF061A)
  readonly property string memGlyph: String.fromCodePoint(0xF035B)

  readonly property string barLabel: Model.normalizeLabel(String(setting("barLabel", "CPU + Memory")))
  // Both readings with their icons; on a vertical bar it falls back to the single icon button.
  readonly property bool combined: barLabel === "CPU + Memory" && !button.vertical
  readonly property Item anchorButton: combined ? comboButton : button

  readonly property int intervalMs: Model.intervalMs(setting("refreshIntervalSec", 3))

  property var stats: Model.reading({}, null)
  property var prevCpu: null
  property var procs: []
  property bool procsLoaded: false
  property bool procListHovered: false
  // Hold the list still while it's being aimed at, so a row can't move under the cursor.
  readonly property bool procsHeld: procListHovered || killer.target !== null

  readonly property var procRows: Model.mergeStopping(root.procs, killer.stopping)

  readonly property color fg: root.bar ? root.bar.foreground : Commons.Color.foreground
  readonly property string fontFamily: root.bar ? root.bar.fontFamily : Style.font.family

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  function levelColor(lvl) {
    if (lvl === "hot") return Commons.Color.urgent
    if (lvl === "warm") return Qt.tint(root.fg, Qt.rgba(Commons.Color.urgent.r, Commons.Color.urgent.g, Commons.Color.urgent.b, 0.5))
    return root.fg
  }

  function pct(fraction) {
    if (isNaN(fraction)) return "—"
    return strings.t("percent").arg(Commons.I18n.formatNumber(Math.round(fraction * 100)))
  }

  function deg(c) {
    if (isNaN(c)) return "—"
    return strings.t("degrees").arg(Commons.I18n.formatNumber(Math.round(c)))
  }

  function memText(usedKb, totalKb) {
    if (isNaN(usedKb) || isNaN(totalKb)) return "—"
    return strings.t("memValue")
      .arg(Commons.I18n.formatNumber(Model.gib(usedKb), 1))
      .arg(Commons.I18n.formatNumber(Model.gib(totalKb), 1))
  }

  function meterValue(key) {
    var s = root.stats
    if (key === "cpu") return root.pct(s.cpu)
    if (key === "memory") return root.memText(s.memUsedKb, s.memTotalKb)
    if (key === "swap") return s.swapTotalKb === 0 ? strings.t("noSwap") : root.memText(s.swapUsedKb, s.swapTotalKb)
    return root.deg(key === "cpuTemp" ? s.cpuTemp : s.gpuTemp)
  }

  function uptimeText(sec) {
    var p = Model.uptimeParts(sec)
    if (!p) return ""
    var f = Commons.I18n.formatNumber
    if (p.days > 0) return strings.t("uptimeDays").arg(f(p.days)).arg(f(p.hours))
    if (p.hours > 0) return strings.t("uptimeHours").arg(f(p.hours)).arg(f(p.minutes))
    return strings.t("uptimeMinutes").arg(f(p.minutes))
  }

  readonly property string barText: {
    if (barLabel === "Memory") return pct(stats.memFraction)
    if (barLabel === "Temperature") return isNaN(stats.cpuTemp) ? "—" : Commons.I18n.formatNumber(Math.round(stats.cpuTemp)) + "°"
    if (barLabel === "CPU") return pct(stats.cpu)
    return ""
  }

  readonly property string barLevel: {
    if (barLabel === "CPU + Memory") return Model.worstLevel(Model.level(stats.cpu), Model.level(stats.memFraction))
    if (barLabel === "Memory") return Model.level(stats.memFraction)
    if (barLabel === "Temperature") return Model.tempLevel(stats.cpuTemp)
    return Model.level(stats.cpu)
  }

  function cycleLabel() {
    root.settings = Object.assign({}, root.settings, { barLabel: Model.nextLabel(root.barLabel) })
    if (root.bar && root.bar.shell) root.bar.shell.updateEntryInline(root.moduleName, root.settings)
  }

  function refresh() {
    if (!sampleProc.running) sampleProc.running = true
  }

  function refreshProcs() {
    if (!topProc.running) topProc.running = true
  }

  function onSample(raw) {
    var next = Model.reading(Model.parseSample(raw), root.prevCpu)
    if (next.cpuCounters) root.prevCpu = next.cpuCounters
    // The first sample has no CPU delta yet; keep the previous figure and
    // take a second reading shortly so the bar fills in quickly at startup.
    if (isNaN(next.cpu)) {
      next.cpu = root.stats.cpu
      if (isNaN(next.cpu)) warmup.restart()
    }
    root.stats = next
  }

  ShellIpc {
    target: "io.github.pieter-uys.system-monitor"
    function open() { root.open() }
    function close() { root.close() }
    function show() { root.open() }
    function hide() { root.close() }
    function toggle() { root.toggle() }
    function cycleLabel() { root.cycleLabel() }
  }

  onOpenedChanged: {
    if (opened) {
      refresh()
      refreshProcs()
    } else {
      killer.cancel()
      procListHovered = false
    }
  }

  Process {
    id: sampleProc
    command: ["bash", root.helperPath]
    stdout: StdioCollector { waitForEnd: true; onStreamFinished: root.onSample(text) }
  }

  Process {
    id: topProc
    command: ["bash", root.helperPath, "--top"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        if (root.procsLoaded && root.procsHeld) return
        root.procs = Model.parseProcs(text)
        root.procsLoaded = true
      }
    }
  }

  KillController {
    id: killer
    helperPath: root.helperPath
    translations: strings
    active: root.opened
    onProcessGone: function(pid) {
      root.procs = root.procs.filter(function(p) { return p.pid !== pid })
    }
  }

  Timer { id: warmup; interval: 600; repeat: false; onTriggered: root.refresh() }
  Timer { interval: root.intervalMs; running: true; repeat: true; triggeredOnStart: true; onTriggered: root.refresh() }
  Timer { interval: Math.max(3000, root.intervalMs); running: root.opened && !root.procsHeld; repeat: true; onTriggered: root.refreshProcs() }

  readonly property bool showLabel: barText !== "" && !button.vertical
  readonly property real openPanelIndicatorWidth: combined ? comboRow.width : (showLabel ? button.glyphPaintedWidth : 0)

  implicitWidth: combined ? comboButton.implicitWidth : button.implicitWidth
  implicitHeight: combined ? comboButton.implicitHeight : button.implicitHeight

  readonly property string barTooltip: root.opened ? "" : strings.t("tooltip")
    .arg(root.pct(root.stats.cpu))
    .arg(root.pct(root.stats.memFraction))
    .arg(root.deg(root.stats.cpuTemp))

  function onBarPressed(b) {
    if (b === Qt.RightButton) root.cycleLabel()
    else root.toggle()
  }

  WidgetButton {
    id: comboButton
    anchors.fill: parent
    visible: root.combined
    bar: root.bar
    labelVisible: false
    hasVisualContent: true
    foreground: root.levelColor(root.barLevel)
    horizontalMargin: 4
    fixedWidth: Math.ceil(comboRow.implicitWidth + scaledHorizontalMargin * 2)
    tooltipText: root.barTooltip
    onPressed: function(b) { root.onBarPressed(b) }

    Row {
      id: comboRow
      x: Math.round((parent.width - width) / 2)
      y: Math.round((parent.height - height) / 2)
      spacing: Style.space(6)
      scale: comboButton.pressScale

      BarStat {
        glyph: root.chipGlyph
        value: root.pct(root.stats.cpu)
        tint: comboButton.foreground
        bar: root.bar
        fontFamily: root.fontFamily
      }

      BarStat {
        glyph: root.memGlyph
        value: root.pct(root.stats.memFraction)
        tint: comboButton.foreground
        bar: root.bar
        fontFamily: root.fontFamily
      }
    }
  }

  // Size the slot for the widest reading so the bar never jitters as digits change.
  TextMetrics {
    id: widest
    font.family: root.fontFamily
    font.pixelSize: Style.bar.iconFont
    text: "100%"
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    visible: !root.combined
    bar: root.bar
    text: root.chipGlyph
    labelText: root.showLabel && !root.combined ? root.barText : ""
    foreground: root.levelColor(root.barLevel)
    slotSize: root.showLabel && !root.combined
      ? Math.max(Style.bar.iconSlot, Style.bar.iconCanvas + widest.advanceWidth + Style.space(10))
      : Style.bar.iconSlot
    tooltipText: root.barTooltip
    onPressed: function(b) { root.onBarPressed(b) }
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorButton
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: panel.loadedContent
    contentWidth: panel.fittedContentWidth(Style.space(360))
    contentHeight: panel.fittedContentHeight(panel.loadedContentHeight)

    content: PanelKeyCatcher {
      anchors.fill: parent
      implicitHeight: column.implicitHeight
      onCloseRequested: killDialog.opened ? killer.cancel() : root.close()
      onTabRequested: function(direction) {
        if (killDialog.opened) killDialog.selectedIndex = 1 - killDialog.selectedIndex
        else root.switchPanel(direction)
      }
      onMoveRequested: function(dx, dy) {
        if (killDialog.opened && dx !== 0) killDialog.selectedIndex = 1 - killDialog.selectedIndex
      }
      onActivateRequested: {
        if (!killDialog.opened) return
        if (killDialog.selectedIndex === 0) killer.cancel()
        else killer.confirm()
      }

      // Cancel is the default, so a stray Enter never stops anything.
      ConfirmDialog {
        id: killDialog
        anchors.fill: parent
        z: 10
        opened: killer.target !== null
        selectedIndex: 0
        foreground: root.fg
        fontFamily: root.fontFamily
        confirmText: strings.t(killer.force ? "killForce" : "killStop")
        message: killer.target
          ? strings.t(killer.force ? "killForceConfirm" : "killConfirm").arg(killer.target.pid).arg(killer.target.name)
          : ""
        onOpenedChanged: if (opened) selectedIndex = 0
        onCanceled: killer.cancel()
        onConfirmed: killer.confirm()
      }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(14)

        PanelHero {
          foreground: root.fg
          fontFamily: root.fontFamily
          title: strings.t("title")
          meta: {
            var parts = [strings.tn("coresMeta", root.stats.cores).arg(Commons.I18n.formatNumber(root.stats.cores))]
            var up = root.uptimeText(root.stats.uptimeSec)
            if (up !== "") parts.push(strings.t("uptime") + " " + up)
            return parts.join(" · ")
          }
          detail: root.stats.load.length > 0
            ? strings.t("load") + " " + Commons.I18n.formatNumber(root.stats.load[0], 2)
            : ""
          iconComponent: PlainText {
            text: root.chipGlyph
            color: root.fg
            font.family: root.fontFamily
            font.pixelSize: Style.font.display
          }
        }

        // The list never changes, so refreshes update the meters instead of
        // rebuilding them, which keeps their bars animating.
        Repeater {
          model: Model.METERS

          Meter {
            required property string modelData
            readonly property var reading: Model.meter(modelData, root.stats)
            foreground: root.fg
            fontFamily: root.fontFamily
            visible: reading.visible
            label: strings.t(modelData)
            value: root.meterValue(modelData)
            fraction: reading.fraction
            tint: root.levelColor(reading.level)
          }
        }

        PanelSeparator { foreground: root.fg }

        Column {
          width: parent.width
          spacing: Style.space(8)

          ProcRow {
            foreground: root.fg
            fontFamily: root.fontFamily
            header: true
            name: strings.t("process")
            cpu: strings.t("cpu")
            mem: strings.t("memory")
          }

          PlainText {
            visible: !root.procsLoaded
            text: strings.t("loading")
            color: root.fg
            font.family: root.fontFamily
            opacity: 0.6
            font.pixelSize: Style.font.bodySmall
          }

          PlainText {
            visible: killer.notice !== ""
            text: killer.notice
            color: root.fg
            font.family: root.fontFamily
            opacity: 0.7
            elide: Text.ElideRight
            width: parent.width
            font.pixelSize: Style.font.bodySmall
          }

          // A Flickable keeps its scroll position when the list refreshes.
          Flickable {
            id: procList
            width: parent.width
            height: Math.min(contentHeight, Style.space(220))
            contentWidth: width
            contentHeight: procColumn.implicitHeight
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentHeight > height

            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

            HoverHandler { onHoveredChanged: root.procListHovered = hovered }

            Column {
              id: procColumn
              width: procList.width
              spacing: Style.space(8)

              Repeater {
                model: root.procRows
                ProcRow {
                  required property var modelData
                  foreground: root.fg
                  fontFamily: root.fontFamily
                  name: modelData.name
                  cpu: strings.t("percent").arg(Commons.I18n.formatNumber(modelData.cpu, 1))
                  mem: root.pct(modelData.mem / 100)
                  killable: modelData.killable
                  stopping: modelData.stopping
                  forced: modelData.forced
                  forceText: strings.t("killForce")
                  status: modelData.stopping
                    ? strings.t(modelData.forced ? "killForcing" : "killStopping")
                      .arg(Commons.I18n.formatNumber(Math.max(0, Math.floor((killer.now - modelData.since) / 1000))))
                    : ""
                  onKillRequested: killer.request(modelData)
                }
              }
            }
          }
        }
      }
    }
  }
}
