"""Build the GitHub profile banners with Pillow, NumPy and a system font.

Example: python scripts/build-banner.py C:/Windows/Fonts/segoeuib.ttf C:/Windows/Fonts/segoeui.ttf
"""

from pathlib import Path
import math
import sys

import numpy as np
from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont


WIDTH, HEIGHT = 1120, 320
SCALE = 2
CANVAS = WIDTH * SCALE, HEIGHT * SCALE
ASSETS = Path(__file__).resolve().parents[1] / "assets"
PALETTES = {
    "dark": {
        "background": "#0d141e", "light": "#28394b", "edge": "#314154",
        "ink": "#faf5ed", "muted": "#bac5d0", "accent": "#e9c68c", "shadow": "#050910",
        "glass": ("#7792ac", "#314559", "#1a2939"), "metal": ("#e0bd86", "#816445", "#3d2b23"),
    },
    "light": {
        "background": "#e9e4db", "light": "#fffaf2", "edge": "#d3c8b9",
        "ink": "#152333", "muted": "#46586a", "accent": "#7e562f", "shadow": "#728296",
        "glass": ("#fbfcff", "#bbc9d6", "#8397ac"), "metal": ("#fff1d8", "#d5b185", "#a78255"),
    },
}


def rgb(color):
    return ImageColor.getrgb(color)


def point(x, y):
    return round(x * SCALE), round(y * SCALE)


def plate_outline(width, height, x, y):
    vertices = np.array([(x, y - height / 2), (x + width / 2, y),
                         (x, y + height / 2), (x - width / 2, y)])
    outline = []
    for i, corner in enumerate(vertices):
        before = corner * 0.82 + vertices[i - 1] * 0.18
        after = corner * 0.82 + vertices[(i + 1) % len(vertices)] * 0.18
        for t in np.linspace(0, 1, 13):
            location = (1 - t) ** 2 * before + 2 * (1 - t) * t * corner + t**2 * after
            outline.append(point(*location))
    return outline


def plate(colors, is_accent, width, height):
    center_x, center_y, depth = 156, 59, 9
    size = point(312, 124)
    highlight, middle, base = colors["metal" if is_accent else "glass"]
    top = plate_outline(width, height, center_x, center_y)
    bottom = plate_outline(width, height, center_x, center_y + depth)
    image = Image.new("RGBA", size)
    draw = ImageDraw.Draw(image)
    draw.polygon(bottom, fill=rgb(base), outline=(*rgb(colors["edge"]), 255), width=2)

    x_grid, y_grid = np.meshgrid(np.arange(size[0]) / SCALE, np.arange(size[1]) / SCALE)
    light = np.clip(0.95 - (y_grid - 8) / 111 - (x_grid - 45) / 510, 0.0, 1.0)
    surface = np.array(rgb(middle)) + light[:, :, None] * (np.array(rgb(highlight)) - rgb(middle))
    surface = Image.fromarray(surface.clip(0, 255).astype("uint8")).convert("RGBA")
    mask = Image.new("L", size)
    ImageDraw.Draw(mask).polygon(top, fill=255)
    surface.putalpha(mask)
    image.alpha_composite(surface)

    draw = ImageDraw.Draw(image)
    draw.line(top + [top[0]], fill=rgb(middle), width=2, joint="curve")
    draw.line(top[39:] + top[:14], fill=rgb(highlight), width=2, joint="curve")
    return image


def background(colors, bold, regular):
    x, y = np.meshgrid(np.linspace(0, 1, CANVAS[0]), np.linspace(0, 1, CANVAS[1]))
    soft_light = np.exp(-((x - 0.75) / 0.56) ** 2 - ((y - 0.12) / 0.8) ** 2)
    grain = np.random.default_rng(15).normal(0, 0.54, size=y.shape)
    pixels = np.array(rgb(colors["background"])) + soft_light[:, :, None] * (
        np.array(rgb(colors["light"])) - rgb(colors["background"])
    ) + grain[:, :, None]
    image = Image.fromarray(pixels.clip(0, 255).astype("uint8")).convert("RGBA")
    draw = ImageDraw.Draw(image)
    draw.line([point(56, 72), point(94, 72)], fill=rgb(colors["accent"]), width=4)
    draw.text(point(54, 84), "Daylé García", font=bold, fill=rgb(colors["ink"]))
    draw.text(point(54, 149), "Fernández", font=bold, fill=rgb(colors["ink"]))
    draw.text(point(56, 231), "Backend Developer  ·  Java & Spring Boot", font=regular, fill=rgb(colors["muted"]))
    return image


def paint_frame(base, slabs, colors, progress, poster=False):
    image = base.copy()
    sweep = Image.new("L", CANVAS)
    pos = 841 + math.sin(progress * math.tau - 0.6) * 101
    ImageDraw.Draw(sweep).ellipse([point(pos - 98, 91), point(pos + 98, 205)], fill=23)
    tint = Image.new("RGBA", CANVAS, colors["accent"])
    tint.putalpha(sweep.filter(ImageFilter.GaussianBlur(49 * SCALE)))
    image.alpha_composite(tint)

    rest = Image.new("L", CANVAS)
    ImageDraw.Draw(rest).ellipse([point(724, 256), point(1028, 300)], fill=107)
    shadow = Image.new("RGBA", CANVAS, colors["shadow"])
    shadow.putalpha(rest.filter(ImageFilter.GaussianBlur(15 * SCALE)))
    image.alpha_composite(shadow)

    for i, slab in enumerate(slabs):
        # Lift from the top, then let each layer settle from the bottom up.
        start = 0.07 + (3 - i) * 0.04
        end = 0.74 + i * 0.045
        phase = min(1, max(0, (progress - start) / (end - start)))
        lift = math.sin(math.pi * phase) ** 2
        travel = 0 if poster else lift * (13 + i * 14)
        lag = 0 if poster else math.sin(phase * math.tau) * lift * i * 5
        image.alpha_composite(slab, point(872 - 156 + lag, 232 - i * 32 - travel - 59))

    image = image.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, WIDTH - 1, HEIGHT - 1), radius=18, outline=colors["edge"], width=1)
    rounded = Image.new("L", (WIDTH, HEIGHT))
    ImageDraw.Draw(rounded).rounded_rectangle((0, 0, WIDTH - 1, HEIGHT - 1), radius=18, fill=255)
    image.putalpha(rounded)
    return image


def main():
    bold = ImageFont.truetype(sys.argv[1], 64 * SCALE)
    regular = ImageFont.truetype(sys.argv[2], 29 * SCALE)
    for theme, colors in PALETTES.items():
        base = background(colors, bold, regular)
        slabs = [plate(colors, i == 2, 282 - 12 * i, 94 - 4 * i) for i in range(4)]
        poster = paint_frame(base, slabs, colors, 0, poster=True)
        poster.save(ASSETS / f"profile-{theme}.png", optimize=True)

        frames = [paint_frame(base, slabs, colors, frame / 64) for frame in range(64)]
        palette = poster.convert("RGB").quantize(colors=255, method=Image.Quantize.MEDIANCUT)
        indexed = []
        for frame in frames:
            quantized = frame.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE)
            quantized.paste(255, mask=frame.getchannel("A").point(lambda a: 255 - a))
            indexed.append(quantized)
        indexed[0].save(ASSETS / f"profile-{theme}.gif", save_all=True, append_images=indexed[1:],
                        duration=80, loop=0, optimize=True, transparency=255, disposal=1)


if __name__ == "__main__":
    main()
