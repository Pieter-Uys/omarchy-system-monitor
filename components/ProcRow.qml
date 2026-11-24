import QtQuick
import qs.Commons
import qs.Commons as Commons

// One line of the process list, or its column header.
Row {
  id: procRow
  signal killRequested()
  property color foreground: "transparent"
  property string fontFamily: ""
  property bool killable: false
  property bool header: false
  property string name: ""
  property string cpu: ""
  property string mem: ""
  // The Stop column's heading. Every row gets it, so every row sizes the column the same.
  property string stopText: ""
  readonly property real killSlot: Math.max(Style.space(18), Math.ceil(stopMetrics.advanceWidth))
  property bool stopping: false
  property bool forced: false
  property string status: ""
  property string forceText: ""
  readonly property real stoppingExtra: Style.space(34)
  readonly property real numWidth: Style.space(52)
  // Keeps the numbers clear of the scrollbar, in the header row too.
  readonly property real scrollbarInset: Style.space(10)

  width: parent.width
  spacing: Style.space(8)
  opacity: header ? 0.6 : 1

  PlainText {
    width: parent.width - parent.numWidth * 2 - parent.killSlot - parent.spacing * 3 - parent.scrollbarInset
      - (procRow.stopping ? parent.stoppingExtra : 0)
    text: procRow.name
    color: procRow.foreground
    font.family: procRow.fontFamily
    elide: Text.ElideRight
    font.pixelSize: Style.font.bodySmall
  }

  PlainText {
    width: parent.numWidth
    horizontalAlignment: Text.AlignRight
    visible: !procRow.stopping
    text: procRow.cpu
    color: procRow.foreground
    font.family: procRow.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  PlainText {
    width: parent.numWidth
    horizontalAlignment: Text.AlignRight
    visible: !procRow.stopping
    text: procRow.mem
    color: procRow.foreground
    font.family: procRow.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  TextMetrics {
    id: stopMetrics
    font.family: procRow.fontFamily
    font.pixelSize: Style.font.bodySmall
    text: procRow.stopText
  }

  // The Stop column: its heading in the header row, and a stop button on every process
  // that's safe to stop. Protected processes leave it empty.
  Item {
    visible: !procRow.stopping
    width: parent.killSlot
    height: procRow.header ? stopHeading.implicitHeight : killGlyph.implicitHeight

    PlainText {
      id: stopHeading
      anchors.centerIn: parent
      visible: procRow.header
      text: procRow.stopText
      color: procRow.foreground
      font.family: procRow.fontFamily
      font.pixelSize: Style.font.bodySmall
    }

    PlainText {
      id: killGlyph
      anchors.centerIn: parent
      text: String.fromCodePoint(0xF0156)
      visible: procRow.killable && !procRow.header
      color: killMouse.containsMouse ? Commons.Color.urgent : procRow.foreground
      // Quiet until pointed at, so a long list of buttons doesn't crowd the readings.
      opacity: killMouse.containsMouse ? 1 : 0.45
      font.family: procRow.fontFamily
      font.pixelSize: Style.font.body
    }

    MouseArea {
      id: killMouse
      anchors.fill: parent
      anchors.margins: -Style.space(3)
      enabled: procRow.killable && !procRow.header
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: procRow.killRequested()
    }
  }

  // While a process shuts down, its row shows the wait and a force option.
  PlainText {
    visible: procRow.stopping
    width: parent.numWidth * 2 + parent.killSlot + parent.spacing * 2 + parent.stoppingExtra
      - (forceCell.visible ? forceCell.width + parent.spacing : 0)
    horizontalAlignment: Text.AlignRight
    text: procRow.status
    color: procRow.foreground
    opacity: 0.7
    font.family: procRow.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  Item {
    id: forceCell
    visible: procRow.stopping && !procRow.forced
    width: forceLabel.implicitWidth
    height: forceLabel.implicitHeight

    PlainText {
      id: forceLabel
      text: procRow.forceText
      color: forceMouse.containsMouse ? Commons.Color.urgent : procRow.foreground
      font.family: procRow.fontFamily
      font.pixelSize: Style.font.bodySmall
      font.bold: true
    }

    MouseArea {
      id: forceMouse
      anchors.fill: parent
      anchors.margins: -Style.space(3)
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: procRow.killRequested()
    }
  }
}
