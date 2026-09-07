"""色相雜湊——同一個字串跨次啟動、跨平台都對到同一個顏色。

不能用內建 `hash()`（每次啟動隨機化，同一個字串下次會配到別的顏色），
改用 md5：色相（hue）連續取自雜湊值、落在 0~359 度的色環上，不是從一組
固定色盤裡挑（色盤一旦被字串數量超過就一定撞色）。飽和度／亮度由呼叫端
決定，同一套公式給便利貼標籤、索引分類晶片、notes-web／files-web 共用。

純函式、只靠標準庫，不依賴 Tkinter。
"""

import colorsys
import hashlib


def hash_hue(text: str) -> float:
    """`text` → 0~1 的色相值。"""
    return (int(hashlib.md5(text.encode("utf-8")).hexdigest(), 16) % 360) / 360.0


def hash_hsl_hex(text: str, lightness: float, saturation: float) -> str:
    """`text` → `#rrggbb`——色相取自雜湊，亮度／飽和度由呼叫端指定。整數截斷
    （不四捨五入），跟 JS 端 `Math.trunc(x*255)` 一致。"""
    r, g, b = colorsys.hls_to_rgb(hash_hue(text), lightness, saturation)
    return f"#{int(r * 255):02x}{int(g * 255):02x}{int(b * 255):02x}"
