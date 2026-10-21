"""アプリアイコン生成スクリプト（開発時に一度だけ実行、生成物は public/icons にコミットする）。
外部素材を使わず、アプリのアクセントカラーで「旗（チャレンジの到達点）」のグリフを描く。
"""
from PIL import Image, ImageDraw
import math
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)

ACCENT = (10, 132, 255, 255)
ACCENT_DARK = (6, 100, 201, 255)
WHITE = (255, 255, 255, 255)


def rounded_square(size, radius_ratio, bg):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=bg)
    return img


def draw_flag(img, cx, cy, scale, color):
    d = ImageDraw.Draw(img)
    pole_w = max(2, int(scale * 0.09))
    pole_top = cy - scale * 0.62
    pole_bottom = cy + scale * 0.62
    d.rounded_rectangle(
        [cx - pole_w / 2, pole_top, cx + pole_w / 2, pole_bottom],
        radius=pole_w / 2,
        fill=color,
    )
    # 旗本体（三角〜波打つ旗っぽいシルエットを簡易ポリゴンで）
    fx0 = cx + pole_w / 2
    fy0 = pole_top + scale * 0.02
    flag_w = scale * 0.62
    flag_h = scale * 0.46
    points = [
        (fx0, fy0),
        (fx0 + flag_w, fy0 + flag_h * 0.28),
        (fx0 + flag_w * 0.78, fy0 + flag_h * 0.5),
        (fx0 + flag_w, fy0 + flag_h * 0.72),
        (fx0, fy0 + flag_h),
    ]
    d.polygon(points, fill=color)
    # 台座（達成の土台）
    base_w = scale * 0.5
    base_h = scale * 0.1
    d.rounded_rectangle(
        [cx - base_w / 2, pole_bottom - base_h * 0.3, cx + base_w / 2, pole_bottom + base_h * 0.7],
        radius=base_h / 2,
        fill=color,
    )


def make_icon(size, padding_ratio, bg, fg, radius_ratio):
    img = rounded_square(size, radius_ratio, bg)
    scale = size * (1 - padding_ratio * 2) * 0.72
    draw_flag(img, size / 2, size / 2 + size * 0.02, scale, fg)
    return img


# 通常アイコン（白地に角丸、中にブルーの旗）
for size, name in [(192, "icon-192.png"), (512, "icon-512.png")]:
    make_icon(size, padding_ratio=0.16, bg=WHITE, fg=ACCENT, radius_ratio=0.22).save(os.path.join(OUT, name))

# maskable（セーフゾーンを広めに確保、背景はブルー・旗は白）
make_icon(512, padding_ratio=0.26, bg=ACCENT, fg=WHITE, radius_ratio=0.0).save(
    os.path.join(OUT, "icon-maskable-512.png")
)

# apple-touch-icon（透過なし・iOS側で角丸にするので正方形のまま）
apple = Image.new("RGBA", (180, 180), WHITE)
draw_flag(apple, 90, 92, 180 * 0.68, ACCENT)
apple.convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"))

print("icons generated:", os.listdir(OUT))
