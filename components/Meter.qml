import QtQuick
import qs.Commons

// A labelled reading with a bar beneath it.
Column {
  id: meter
  property color foreground: "transparent"
  property string fontFamily: ""
  property string label: ""
  property string value: ""
  property real fraction: 0
  property color tint: foreground

  width: parent.width
  spacing: Style.space(6)

  Item {
    width: parent.width
    implicitHeight: Math.max(meterLabel.implicitHeight, meterValue.implicitHeight)

    PlainText {
      id: meterLabel
      anchors.left: parent.left
      text: meter.label
      color: meter.foreground
      font.family: meter.fontFamily
      opacity: 0.6
      font.pixelSize: Style.font.bodySmall
    }

    PlainText {
      id: meterValue
      anchors.right: parent.right
      text: meter.value
      color: meter.tint
      font.family: meter.fontFamily
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
      color: Qt.rgba(meter.foreground.r, meter.foreground.g, meter.foreground.b, 0.12)
    }

    Rectangle {
      anchors.left: track.left
      anchors.verticalCenter: track.verticalCenter
      height: track.height
      radius: track.radius
      color: meter.tint
      width: isNaN(meter.fraction) ? 0 : Math.max(track.height, track.width * Math.max(0, Math.min(1, meter.fraction)))

      Behavior on width { NumberAnimation { duration: Style.duration(240); easing.type: Easing.OutCubic } }
      Behavior on color { ColorAnimation { duration: Style.duration(200) } }
    }
  }
}
