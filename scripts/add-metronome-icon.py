"""
向 resources/icon.woff2 添加 metronome 字形（U+E01E）。

用法: python scripts/add-metronome-icon.py
"""
import sys

from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

FONT_PATH = "resources/icon.woff2"
GLYPH_NAME = "metronome"
GLYPH_CODE = 0xE01E

# 5 个轮廓（y 向上，1000 em）：
# 1. 三角琴体外轮廓
# 2. 三角琴体内部镂空（与 1 反向绕行，形成描边）
# 3. 底部底座
# 4. 摆杆
# 5. 摆锤
CONTOURS = [
    [(500, 680), (180, 60), (820, 60)],
    [(500, 600), (758, 100), (242, 100)],
    [(150, -45), (850, -45), (770, 60), (230, 60)],
    [(475, 255), (525, 255), (525, 600), (475, 600)],
    [(440, 215), (560, 215), (560, 255), (440, 255)],
]


def build_glyph():
    pen = TTGlyphPen(None)
    for pts in CONTOURS:
        pen.moveTo(pts[0])
        for p in pts[1:]:
            pen.lineTo(p)
        pen.closePath()
    return pen.glyph()


def main():
    font = TTFont(FONT_PATH)

    if GLYPH_NAME in font.getGlyphOrder():
        print(f"glyph '{GLYPH_NAME}' already exists, updating outline...")
    else:
        order = font.getGlyphOrder()
        order.append(GLYPH_NAME)
        font.setGlyphOrder(order)
        font["maxp"].numGlyphs = len(order)

    glyph = build_glyph()
    font["glyf"].glyphs[GLYPH_NAME] = glyph
    glyph.recalcBounds(font["glyf"])

    font["hmtx"][GLYPH_NAME] = (1000, glyph.xMin)

    added = 0
    for table in font["cmap"].tables:
        if table.format in (4, 12):
            table.cmap[GLYPH_CODE] = GLYPH_NAME
            added += 1
    if added == 0:
        print("warning: no supported cmap subtable found", file=sys.stderr)

    font.flavor = "woff2"
    font.save(FONT_PATH)
    print(f"added '{GLYPH_NAME}' (U+{GLYPH_CODE:04X}) to {FONT_PATH}")


if __name__ == "__main__":
    main()
