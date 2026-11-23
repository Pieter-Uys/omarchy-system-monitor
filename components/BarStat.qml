import QtQuick
import qs.Commons
import qs.Ui

// An icon drawn the way Omarchy draws its bar icons, with its reading beside it.
// Measuring every digit as "0" means the width only changes when a reading
// gains or loses a digit, so the bar doesn't jitter.
Item {
  id: stat
  property var bar: null
  property string fontFamily: ""
  property string glyph: ""
  property string value: ""
  property color tint: "transparent"

  implicitWidth: Style.bar.iconCanvas + Style.space(3) + Math.ceil(valueSlot.advanceWidth)
  implicitHeight: Style.bar.iconCanvas

  Behavior on tint {
    enabled: !stat.bar || stat.bar.foregroundAnimationEnabled
    ColorAnimation { duration: Style.duration(160) }
  }

  OpticalGlyph {
    width: Style.bar.iconCanvas
    height: Style.bar.iconCanvas
    text: stat.glyph
    fontFamily: stat.fontFamily
    fontSize: Style.bar.iconFont
    paintedSize: Style.bar.iconSize
    color: stat.tint
  }

  TextMetrics {
    id: valueSlot
    font: valueText.font
    text: stat.value.replace(/\d/g, "0")
  }

  FontMetrics {
    id: valueMetrics
    font: valueText.font
  }

  PlainText {
    id: valueText
    x: Style.bar.iconCanvas + Style.space(3)
    y: (parent.height - height) / 2
      + (valueMetrics.descent - valueMetrics.ascent + valueMetrics.tightBoundingRect("0").height) / 2
    text: stat.value
    color: stat.tint
    font.family: stat.fontFamily
    renderType: Text.NativeRendering
  }
}
