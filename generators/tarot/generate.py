#!/usr/bin/env python3
"""Генератор постов по картам таро DK Matrix.

Источники карт (по порядку приоритета, первая найденная версия карты побеждает):
  1. cards-pack/standard/DKMatrix_*/page.json + images/hero-landscape.webp
  2. lunar-oracle: modules/tarot/arcana/content/*.json + public/knowledge/tarot/<slug>/hero-landscape.webp

Рендерит картинку 1080×1350 (4:5, JPEG) и собирает подпись с хэштегами.
Результат: out/<slug>.jpg и out/posts.json — их отправляет в ядро push.ts через API.

Запуск: python3 generators/tarot/generate.py [cards-pack/standard] [lunar-oracle]
"""
import json
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

CARDS_PACK = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "Desktop/cards-pack/standard")
LUNAR = Path(sys.argv[2] if len(sys.argv) > 2 else Path.home() / "Desktop/lunar-oracle")
OUT = Path(__file__).parent / "out"
FONTS = Path("/System/Library/Fonts/Supplemental")

W, H = 1080, 1350
BG = (14, 11, 22)
GOLD = (214, 182, 120)
TEXT = (238, 232, 222)
MUTED = (168, 160, 178)

# cardId → (номер, название)
CARDS = {
    "00_the_fool": ("0", "Шут"),
    "01_the_magician": ("I", "Маг"),
    "02_the_high_priestess": ("II", "Верховная Жрица"),
    "03_the_empress": ("III", "Императрица"),
    "04_the_emperor": ("IV", "Император"),
    "05_the_hierophant": ("V", "Иерофант"),
    "06_the_lovers": ("VI", "Влюблённые"),
    "07_the_chariot": ("VII", "Колесница"),
    "08_strength": ("VIII", "Сила"),
    "09_the_hermit": ("IX", "Отшельник"),
    "10_wheel_of_fortune": ("X", "Колесо Фортуны"),
}

BASE_TAGS = ["таро", "старшиеарканы", "арканы", "значениекарт", "картадня", "dkmatrix"]


def font(name: str, size: int):
    return ImageFont.truetype(str(FONTS / name), size)


def centered(draw: ImageDraw.ImageDraw, y: int, text: str, f, fill, width_chars: int, spacing: int = 10) -> int:
    """Рисует текст по центру с переносом; возвращает y под последней строкой."""
    ascent, descent = f.getmetrics()
    for line in textwrap.wrap(text, width_chars) or [""]:
        w = draw.textlength(line, font=f)
        draw.text(((W - w) / 2, y), line, font=f, fill=fill)
        y += ascent + descent + spacing
    return y - spacing


def render(art_path: Path, page: dict, num: str, name: str, out: Path):
    art = Image.open(art_path).convert("RGB")
    # Арт крупнее: по высоте ART_H, по ширине обрезка по центру.
    art_h = 780
    scaled_w = round(art.width * art_h / art.height)
    art = art.resize((scaled_w, art_h), Image.LANCZOS)
    left = (scaled_w - W) // 2
    art = art.crop((left, 0, left + W, art_h))

    img = Image.new("RGB", (W, H), BG)
    # Размытая подложка из того же арта для глубины.
    glow = art.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(60))
    img = Image.blend(img, glow, 0.25)
    img.paste(art, (0, 0))

    # Плавный переход арта в фон.
    fade = Image.new("L", (1, 220))
    for i in range(220):
        fade.putpixel((0, i), int(255 * (i / 219) ** 1.6))
    fade = fade.resize((W, 220))
    img.paste(Image.new("RGB", (W, 220), BG), (0, art_h - 220), fade)

    d = ImageDraw.Draw(img)
    y = art_h - 10
    label = f"АРКАН {num}"
    f_label = font("Arial.ttf", 26)
    spaced = " ".join(label)
    d.text(((W - d.textlength(spaced, font=f_label)) / 2, y), spaced, font=f_label, fill=GOLD)
    y += 46
    y = centered(d, y, name.upper(), font("Georgia.ttf", 76 if len(name) < 10 else 60), TEXT, 22, 6)
    y += 22
    d.line([(W / 2 - 60, y), (W / 2 + 60, y)], fill=GOLD, width=2)
    y += 24
    y = centered(d, y, page["headline"], font("Georgia Italic.ttf", 44), GOLD, 34, 8)
    y += 20
    centered(d, y, page["lead"], font("Georgia.ttf", 31), MUTED, 50, 10)

    quote = page.get("quote")
    if isinstance(quote, str) and quote:
        f_q = font("Georgia Italic.ttf", 28)
        lines = textwrap.wrap(f"«{quote}»", 52)
        a, dsc = f_q.getmetrics()
        centered(d, H - 110 - len(lines) * (a + dsc + 8), f"«{quote}»", f_q, (150, 140, 160), 52, 8)

    f_brand = font("Arial.ttf", 22)
    brand = "D K   M A T R I X"
    d.text(((W - d.textlength(brand, font=f_brand)) / 2, H - 64), brand, font=f_brand, fill=(120, 110, 135))

    img.save(out, "JPEG", quality=92, optimize=True, progressive=True)


def caption(page: dict, num: str, name: str) -> str:
    tags = BASE_TAGS + [k.replace(" ", "").replace("-", "") for k in page.get("keywords", [])]
    tags = list(dict.fromkeys(tags))[:20]
    q = page.get("reflection", {}).get("questions", [])
    parts = [
        f"Аркан {num} · {name} — {page['headline']}",
        page["lead"],
        page["summary"],
        f"✨ Свет карты: {page['light'][0].rstrip('.')}\n🌑 Тень: {page['shadow'][0].rstrip('.')}",
        f"Совет: {page['meaning']['advice']}",
        f"Вопрос для себя: {q[0]}" if q else "",
        "Сохраните, чтобы вернуться к карте позже.",
        " ".join(f"#{t}" for t in tags),
    ]
    text = "\n\n".join(p for p in parts if p)
    assert len(text) <= 2200, f"подпись длиннее 2200 символов: {len(text)}"
    return text


def iter_cards():
    """(page, art_path) из всех источников; cards-pack важнее lunar-oracle."""
    for d in sorted(CARDS_PACK.glob("DKMatrix_*")):
        if (d / "page.json").exists() and (d / "images/hero-landscape.webp").exists():
            yield json.loads((d / "page.json").read_text()), d / "images/hero-landscape.webp"
    for f in sorted((LUNAR / "modules/tarot/arcana/content").glob("*.json")):
        page = json.loads(f.read_text())
        art = LUNAR / "public/knowledge/tarot" / page["slug"] / "hero-landscape.webp"
        if art.exists():
            yield page, art


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    posts, seen = [], set()
    for page, art in iter_cards():
        if page["cardId"] not in CARDS or page["cardId"] in seen:
            continue
        seen.add(page["cardId"])
        num, name = CARDS[page["cardId"]]
        out = OUT / f"{page['slug']}.jpg"
        render(art, page, num, name, out)
        posts.append(
            {
                "slug": page["slug"],
                "card_id": page["cardId"],
                "image": str(out.relative_to(Path(__file__).parent)),
                "caption": caption(page, num, name),
                "source_status": page.get("status"),
            }
        )
        print(f"✓ {num:>4} {name}: {out.name}")
    posts.sort(key=lambda p: p["card_id"])
    (OUT / "posts.json").write_text(json.dumps(posts, ensure_ascii=False, indent=2))
    print(f"Готово: {len(posts)} постов → {OUT / 'posts.json'}")


if __name__ == "__main__":
    main()
