# -*- coding: utf-8 -*-
"""从「图 + 字段」格式的 Word 文档导入整套款式库。

适合店主自己写的款式分析文档：每款一张图，后面跟「款式名：/主色系：/风格：…」

用法：
    python scripts/import-from-docx.py "C:\\path\\to\\款式分析.docx"
"""
import json
import re
import sys
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from style_map import (  # noqa: E402
    FIELD_ALIASES, NEEDS_CONFIRM_STYLE, NORMALIZE, STYLE_TO_SKU, TAXONOMY,
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
STYLE_DIR = ROOT / "data" / "styles"
WEB_DIR = STYLE_DIR / "web"
JSONL = ROOT / "knowledge" / "03_styles.jsonl"

SPLIT = re.compile(r"[,，/、\s]+")
BAD_CHARS = re.compile(r'[\\/:*?"<>|]')
ORDER = ["name", "shape", "color", "style", "length", "skin", "occasion", "hand", "extend", "difficulty", "note"]


def split_multi(v):
    return [x for x in SPLIT.split(str(v or "").strip()) if x]


def expand_token(tok):
    """把「猫眼渐变醋酸钻球」这类连写拆成词表里的已知风格词。"""
    if tok in STYLE_TO_SKU:
        return [tok]
    hits = [kw for kw in sorted(STYLE_TO_SKU, key=len, reverse=True) if kw in tok]
    return hits or [tok]


def clean_value(v):
    """剥离「中长（甲膜）」这类括号注，返回 (值, 括号里的内容)。"""
    v = str(v or "").strip()
    m = re.match(r"^(.*?)\s*[（(]([^）)]*)[）)]\s*$", v)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return v, ""


def extract_images(doc):
    out = []
    for para in doc.paragraphs:
        for blip in para._p.findall(".//" + qn("a:blip")):
            rid = blip.get(qn("r:embed"))
            if not rid:
                continue
            part = doc.part.related_parts.get(rid)
            if part is None:
                continue
            ext = str(part.partname).rsplit(".", 1)[-1].lower()
            out.append((ext, part.blob))
    return out


def parse_records(doc):
    records, cur = [], None
    for para in doc.paragraphs:
        t = para.text.strip()
        if not t:
            continue
        m = re.match(r"^([^：:]{1,6})\s*[：:]\s*(.*)$", t)
        if not m:
            continue
        field = FIELD_ALIASES.get(m.group(1).strip())
        if not field:
            continue
        val = m.group(2).strip()
        # 甲型常写在款式名前面：如果当前记录还没名字，就填进去；已经完整了就新起一条
        if field == "shape":
            if cur is None or cur.get("name"):
                cur = {k: "" for k in ORDER}
                cur["shape"] = val
                records.append(cur)
            else:
                cur["shape"] = val
            continue

        if field == "name":
            if cur is not None and not cur.get("name"):
                # 填补刚才由甲型开出来的那条
                cur["name"] = val
            else:
                cur = {k: "" for k in ORDER}
                cur["name"] = val
                records.append(cur)
            continue

        if cur is not None:
            cur[field] = val
    return records


def main():
    if len(sys.argv) < 2:
        print("用法：python scripts/import-from-docx.py <docx路径>")
        return 2
    src = Path(sys.argv[1])
    if not src.exists():
        print(f"文件不存在：{src}")
        return 2

    doc = Document(src)
    images = extract_images(doc)
    records = parse_records(doc)
    print(f"解析到 {len(records)} 条记录、{len(images)} 张图")

    if len(images) != len(records):
        print(f"⚠ 图 {len(images)} 张 ≠ 记录 {len(records)} 条，按顺序对齐前 {min(len(images), len(records))} 条")

    STYLE_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DIR.mkdir(parents=True, exist_ok=True)

    out, warnings, notes = [], [], []
    normalized_log = {}
    added_log = []

    for i, rec in enumerate(records):
        name = str(rec.get("name", "")).strip()
        if not name:
            warnings.append(f"第 {i + 1} 条：没有款式名，跳过")
            continue

        sid = f"ST{len(out) + 1:03d}"

        # ---- 风格：拆分 + 归一化 + 连写展开 ----
        raw_styles = split_multi(rec.get("style", ""))
        styles = []
        for s in raw_styles:
            for part in expand_token(s):
                if part in NORMALIZE:
                    key = f"{part} → {NORMALIZE[part]}"
                    normalized_log[key] = normalized_log.get(key, 0) + 1
                    part = NORMALIZE[part]
                if part not in styles:
                    styles.append(part)

        style_ids = sorted({sku for s in styles for sku in STYLE_TO_SKU.get(s, [])})

        # 店主确认：名字里写到的做法，补进风格标签（只补收费相关词，不补颜色）
        # 「法式猫眼」是猫眼的一种，不算加法式
        name_for_match = name.replace("法式猫眼", "猫眼").replace("法式猫眼款", "猫眼")
        name_added = []
        for kw in sorted(STYLE_TO_SKU, key=len, reverse=True):
            if kw in name_for_match and kw not in styles:
                styles.append(kw)
                name_added.append(kw)
        if name_added:
            style_ids = sorted({sku for s in styles for sku in STYLE_TO_SKU.get(s, [])})
            added_log.append(f"{name} → 补 {'、'.join(name_added)}")
        unknown_style = [s for s in styles if s not in STYLE_TO_SKU]
        if unknown_style:
            warnings.append(f"第 {i + 1} 条（{name}）：风格「{'、'.join(unknown_style)}」没有对应价格项，已保留")

        # 每个加价项实际对应哪些做法（明细显示「波点」而不是整个类名）
        style_labels = {}
        for s in styles:
            for sku in STYLE_TO_SKU.get(s, []):
                style_labels.setdefault(sku, []).append(s)

        confirm_price = [s for s in styles if s in NEEDS_CONFIRM_STYLE]

        # ---- 长度 / 延长：剥离括号注 ----
        length, lnote = clean_value(rec.get("length", ""))
        extend, enote = clean_value(rec.get("extend", ""))
        extra = "、".join(x for x in (lnote, enote) if x)
        if extra:
            rec["note"] = "；".join(x for x in (rec.get("note", ""), extra) if x)

        # ---- 图片 ----
        img_path = ""
        if i < len(images):
            ext, blob = images[i]
            safe = BAD_CHARS.sub("", name).replace(" ", "")
            fname = f"{i + 1:03d}_{safe}.{ext}"
            raw_path = STYLE_DIR / fname
            raw_path.write_bytes(blob)
            web_name = f"{sid}.webp"
            with Image.open(raw_path) as im:
                im = im.convert("RGB")
                im.thumbnail((900, 900), Image.LANCZOS)
                dim = im.size
                im.save(WEB_DIR / web_name, "WEBP", quality=82, method=6)
            img_path = f"/data/styles/web/{web_name}"
            src_name = fname
            size_kb = round((WEB_DIR / web_name).stat().st_size / 1024)
        else:
            src_name = ""
            dim = (0, 0)
            size_kb = 0

        out.append({
            "id": sid,
            "file": src_name,
            "img": img_path,
            "name": name,
            "tags": {
                "color": str(rec.get("color", "")).strip(),
                "style": styles,
                "length": length,
                "occasion": [x for x in split_multi(rec.get("occasion", "")) if x] or ["日常"],
                "skin_effect": str(rec.get("skin", "")).strip(),
                "hand_fit": [x for x in split_multi(rec.get("hand", "")) if x] or ["都可以"],
                "extend": extend or "不需要",
                "shape": str(rec.get("shape", "")).strip(),
                "difficulty": str(rec.get("difficulty", "")).strip() or "中",
            },
            "style_ids": style_ids,
            "style_labels": style_labels,
            "price_confirm": bool(confirm_price),
            "raw_style": raw_styles,
            "note": str(rec.get("note", "")).strip(),
        })
        flag = " ⚠价" if confirm_price else ""
        print(f"  ✓ {sid} {name:<22} {dim[0]}x{dim[1]} {size_kb:>4}KB  sku={style_ids}{flag}")

    JSONL.parent.mkdir(parents=True, exist_ok=True)
    with JSONL.open("w", encoding="utf-8") as f:
        for r in out:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"\n生成 {len(out)} 条 → {JSONL}")
    if normalized_log:
        print("\n已自动统一写法：")
        for k, v in normalized_log.items():
            print(f"  · {k}（{v} 处）")

    confirm_names = [r["name"] for r in out if r["price_confirm"]]
    if confirm_names:
        print(f"\n有 {len(confirm_names)} 款的价格需要你确认（价目表里没明确对应）：")
        for n in confirm_names:
            print(f"  · {n}")

    if added_log:
        print(f"\n按你的确认，从名字补进风格的 {len(added_log)} 处：")
        for a in added_log:
            print("  · " + a)

    if warnings:
        print(f"\n提醒 {len(warnings)} 条：")
        for w in warnings:
            print("  · " + w)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())