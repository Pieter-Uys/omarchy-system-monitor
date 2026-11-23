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
  readonly property real killSlot: Style.space(18)
  property bool header: false
  property string name: ""
  property string cpu: ""
  property string mem: ""
  readonly property real numWidth: Style.space(52)
  // Keeps the numbers clear of the scrollbar, in the header row too.
  readonly property real scrollbarInset: Style.space(10)

  width: parent.width
  spacing: Style.space(8)
  opacity: header ? 0.6 : 1

  PlainText {
    width: parent.width - parent.numWidth * 2 - parent.killSlot - parent.spacing * 3 - parent.scrollbarInset
    text: procRow.name
    color: procRow.foreground
    font.family: procRow.fontFamily
    elide: Text.ElideRight
    font.pixelSize: Style.font.bodySmall
  }

  PlainText {
    width: parent.numWidth
    horizontalAlignment: Text.AlignRight
    text: procRow.cpu
    color: procRow.foreground
    font.family: procRow.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  PlainText {
    width: parent.numWidth
    horizontalAlignment: Text.AlignRight
    text: procRow.mem
    color: procRow.foreground
    font.family: procRow.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  HoverHandler { id: rowHover }

  // The slot is always reserved, so the columns don't shift on hover.
  Item {
    width: parent.killSlot
    height: killGlyph.implicitHeight

    PlainText {
      id: killGlyph
      anchors.centerIn: parent
      text: String.fromCodePoint(0xF0156)
      visible: procRow.killable && rowHover.hovered
      color: killMouse.containsMouse ? Commons.Color.urgent : procRow.foreground
      font.family: procRow.fontFamily
      font.pixelSize: Style.font.body
    }

    MouseArea {
      id: killMouse
      anchors.fill: parent
      anchors.margins: -Style.space(3)
      enabled: procRow.killable && rowHover.hovered
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: procRow.killRequested()
    }
  }
}
