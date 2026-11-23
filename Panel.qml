import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model

// System Stats: a CPU/memory/temperature readout in the bar with a detail
// panel. All readings come from the bundled bin/system-stats, which reads
// /proc and /sys only. Every displayed string is plain text.
Panel {
  id: root
  moduleName: "system-monitor"
  ipcTarget: "system-monitor"
  manageIpc: false

  readonly property string helperPath: String(Qt.resolvedUrl("bin/system-stats")).replace(/^file:\/\//, "")
  readonly property string chipGlyph: String.fromCodePoint(0xF061A)
  readonly property string memGlyph: String.fromCodePoint(0xF035B)

  readonly property string barLabel: Model.normalizeLabel(String(setting("barLabel", "CPU + Memory")))
  // Both readings with their icons; on a vertical bar it falls back to the single icon button.
  readonly property bool combined: barLabel === "CPU + Memory" && !button.vertical
  readonly property Item anchorButton: combined ? comboButton : button

  function comboText(cpu, mem) {
    return root.chipGlyph + " " + cpu + " " + root.memGlyph + " " + mem
  }
  readonly property int intervalMs: Model.intervalMs(setting("refreshIntervalSec", 3))

  property var stats: Model.reading({}, null)
  property var prevCpu: null
  property var procs: []
  property bool procsLoaded: false

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
    target: "system-monitor"
    function open() { root.open() }
    function close() { root.close() }
    function show() { root.open() }
    function hide() { root.close() }
    function toggle() { root.toggle() }
    function cycleLabel() { root.cycleLabel() }
  }

  onOpenedChanged: if (opened) { refresh(); refreshProcs() }

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
        root.procs = Model.parseProcs(text)
        root.procsLoaded = true
      }
    }
  }

  Timer { id: warmup; interval: 600; repeat: false; onTriggered: root.refresh() }
  Timer { interval: root.intervalMs; running: true; repeat: true; triggeredOnStart: true; onTriggered: root.refresh() }
  Timer { interval: Math.max(3000, root.intervalMs); running: root.opened; repeat: true; onTriggered: root.refreshProcs() }

  readonly property bool showLabel: barText !== "" && !button.vertical
  readonly property real openPanelIndicatorWidth: combined ? comboButton.labelWidth : (showLabel ? button.glyphPaintedWidth : 0)

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

  // Fit the readings on screen. Measuring every digit as "0" means the width
  // only changes when a reading gains or loses a digit, so the bar doesn't jitter.
  TextMetrics {
    id: widestCombo
    font.family: root.fontFamily
    font.pixelSize: Style.font.body
    text: root.comboText(root.pct(root.stats.cpu), root.pct(root.stats.memFraction)).replace(/\d/g, "0")
  }

  WidgetButton {
    id: comboButton
    anchors.fill: parent
    visible: root.combined
    bar: root.bar
    text: root.comboText(root.pct(root.stats.cpu), root.pct(root.stats.memFraction))
    foreground: root.levelColor(root.barLevel)
    horizontalMargin: 4
    fixedWidth: Math.ceil(widestCombo.advanceWidth + scaledHorizontalMargin * 2)
    tooltipText: root.barTooltip
    onPressed: function(b) { root.onBarPressed(b) }
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
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

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
            font.pixelSize: Style.font.display
          }
        }

        Meter {
          label: strings.t("cpu")
          value: root.pct(root.stats.cpu)
          fraction: root.stats.cpu
          tint: root.levelColor(Model.level(root.stats.cpu))
        }

        Meter {
          label: strings.t("memory")
          value: root.memText(root.stats.memUsedKb, root.stats.memTotalKb)
          fraction: root.stats.memFraction
          tint: root.levelColor(Model.level(root.stats.memFraction))
        }

        Meter {
          visible: !isNaN(root.stats.swapTotalKb)
          label: strings.t("swap")
          value: root.stats.swapTotalKb === 0 ? strings.t("noSwap") : root.memText(root.stats.swapUsedKb, root.stats.swapTotalKb)
          fraction: root.stats.swapTotalKb === 0 ? 0 : root.stats.swapFraction
          tint: root.levelColor(Model.level(root.stats.swapFraction))
        }

        Meter {
          visible: !isNaN(root.stats.cpuTemp)
          label: strings.t("cpuTemp")
          value: root.deg(root.stats.cpuTemp)
          fraction: root.stats.cpuTemp / 100
          tint: root.levelColor(Model.tempLevel(root.stats.cpuTemp))
        }

        Meter {
          visible: !isNaN(root.stats.gpuTemp)
          label: strings.t("gpuTemp")
          value: root.deg(root.stats.gpuTemp)
          fraction: root.stats.gpuTemp / 100
          tint: root.levelColor(Model.tempLevel(root.stats.gpuTemp))
        }

        PanelSeparator { foreground: root.fg }

        Column {
          width: parent.width
          spacing: Style.space(8)

          PanelSectionHeader {
            text: strings.t("topProcesses")
            foreground: root.fg
            fontFamily: root.fontFamily
          }

          ProcRow {
            header: true
            name: strings.t("process")
            cpu: strings.t("cpu")
            mem: strings.t("memory")
          }

          PlainText {
            visible: !root.procsLoaded
            text: strings.t("loading")
            opacity: 0.6
            font.pixelSize: Style.font.bodySmall
          }

          Repeater {
            model: root.procs
            ProcRow {
              required property var modelData
              name: modelData.name
              cpu: strings.t("percent").arg(Commons.I18n.formatNumber(modelData.cpu, 1))
              mem: root.pct(modelData.mem / 100)
            }
          }
        }
      }
    }
  }

  // ---------- local components ----------

  component PlainText: Text {
    textFormat: Text.PlainText
    color: root.fg
    font.family: root.fontFamily
    font.pixelSize: Style.font.body
  }

  component Meter: Column {
    property string label: ""
    property string value: ""
    property real fraction: 0
    property color tint: root.fg

    width: parent.width
    spacing: Style.space(6)

    Item {
      width: parent.width
      implicitHeight: Math.max(meterLabel.implicitHeight, meterValue.implicitHeight)

      PlainText {
        id: meterLabel
        anchors.left: parent.left
        text: label
        opacity: 0.6
        font.pixelSize: Style.font.bodySmall
      }

      PlainText {
        id: meterValue
        anchors.right: parent.right
        text: value
        color: tint
        font.pixelSize: Style.font.bodySmall
        font.bold: true
      }
    }

    Item {
      width: parent.width
      implicitHeight: Style.space(6)

      Rectangle {
        id: track
        anchors.fill: parent
        radius: height / 2
        color: Qt.rgba(root.fg.r, root.fg.g, root.fg.b, 0.12)
      }

      Rectangle {
        anchors.left: track.left
        anchors.verticalCenter: track.verticalCenter
        height: track.height
        radius: track.radius
        color: tint
        width: isNaN(fraction) ? 0 : Math.max(track.height, track.width * Math.max(0, Math.min(1, fraction)))

        Behavior on width { NumberAnimation { duration: Style.duration(240); easing.type: Easing.OutCubic } }
        Behavior on color { ColorAnimation { duration: Style.duration(200) } }
      }
    }
  }

  component ProcRow: Row {
    property bool header: false
    property string name: ""
    property string cpu: ""
    property string mem: ""
    readonly property real numWidth: Style.space(52)

    width: parent.width
    spacing: Style.space(8)
    opacity: header ? 0.6 : 1

    PlainText {
      width: parent.width - parent.numWidth * 2 - parent.spacing * 2
      text: name
      elide: Text.ElideRight
      font.pixelSize: Style.font.bodySmall
    }

    PlainText {
      width: parent.numWidth
      horizontalAlignment: Text.AlignRight
      text: cpu
      font.pixelSize: Style.font.bodySmall
    }

    PlainText {
      width: parent.numWidth
      horizontalAlignment: Text.AlignRight
      text: mem
      font.pixelSize: Style.font.bodySmall
    }
  }
}
