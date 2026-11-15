# -*- coding: utf-8 -*-
"""读取标注表（Word 或 Excel）→ 校验 → 压缩图片 → 生成 knowledge/03_styles.jsonl。

支持两种源，谁新用谁：
    data/styles/_标注表.docx   （段落格式，推荐）
    data/styles/_标注表.xlsx

用法（在项目根目录）：
    python scripts/import-styles.py
"""
import json
import re
import sys
from pathlib import Path

from docx import Document
from openpyxl import load_workbook
from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
STYLE_DIR = ROOT / "data" / "styles"
WEB_DIR = STYLE_DIR / "web"
DOCX = STYLE_DIR / "_标注表.docx"
XLSX = STYLE_DIR / "_标注表.xlsx"
JSONL = ROOT / "knowledge" / "03_styles.jsonl"
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}

TAXONOMY = {
    "主色系": ["裸色系", "粉调", "红调", "蓝绿", "紫调", "黑白灰", "金属", "多色", "透明"],
    "长度": ["短", "中", "长", "延长"],
    "显白度": ["显白", "一般", "挑肤色"],
    "需要延长": ["不需要", "建议延长", "必须延长"],
    "难度": ["低", "中", "高"],
    "风格": ["纯色", "猫眼", "法式", "晕染", "渐变", "手绘", "贴钻", "波点", "腮红", "魔镜粉", "浮雕", "醋酸", "卡通"],
    "场合": ["日常", "通勤", "约会", "婚礼", "拍照", "节日", "蹦迪"],
    "适合手型": ["手指短", "手指长", "手细", "手粗", "关节明显", "都可以"],
}

STYLE_TO_SKU = {
    "纯色": [], "猫眼": [], "法式": ["S2"], "波点": ["S2"], "腮红": ["S2"],
    "渐变": ["S2"], "晕染": ["S2"], "手绘": ["S3"], "卡通": ["S5"],
    "贴钻": ["S6"], "浮雕": ["S6"], "醋酸": ["S6"], "魔镜粉": ["S7"],
}

FIELD_ALIASES = {
    "款式名": "name", "名称": "name", "款式": "name",
    "主色系": "color", "色系": "color", "颜色": "color",
    "风格": "style",
    "长度": "length", "甲长": "length",
    "显白度": "skin", "显白": "skin",
    "场合": "occasion",
    "适合手型": "hand", "手型": "hand",
    "需要延长": "extend", "延长": "extend",
    "难度": "difficulty",
    "备注": "note",
}

ORDER = ["name", "color", "style", "length", "skin", "occasion", "hand", "extend", "difficulty", "note"]
REQUIRED = [("name", "款式名"), ("color", "主色系"), ("style", "风格"), ("length", "长度"), ("skin", "显白度")]
SPLIT = re.compile(r"[,，/、\s]+")


def split_multi(v) -> list[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    return [x for x in SPLIT.split(str(v).strip()) if x]


def blank_row() -> dict:
    return {k: "" for k in ORDER}


# ---------- 解析：Word 段落 ----------
def rows_from_docx_paragraphs(doc) -> list[dict]:
    rows, cur = [], None
    for p in doc.paragraphs:
        t = p.text.strip()
        if not t:
            continue
        m = re.match(r"^[【\[]\s*(.+?)\s*[】\]]\s*(.*)$", t)
        if m:
            if cur:
                rows.append(cur)
            cur = blank_row()
            cur["file"] = m.group(1).strip()
            inline = m.group(2).strip(" ：:")
            if inline:
                # 一行式：【001.jpg】雾霾蓝猫眼，蓝绿，猫眼，短，显白
                for k, v in zip(ORDER, split_multi(inline)):
                    cur[k] = v
            continue
        if cur is None:
            continue
        m2 = re.match(r"^([^：:]{1,8})[：:]\s*(.*)$", t)
        if m2:
            field = FIELD_ALIASES.get(m2.group(1).strip())
            if field:
                cur[field] = m2.group(2).strip()
    if cur:
        rows.append(cur)
    return rows


# ---------- 解析：Word 表格 ----------
def rows_from_docx_table(doc) -> list[dict]:
    if not doc.tables:
        return []
    t = doc.tables[0]
    header = [c.text.strip() for c in t.rows[0].cells]
    idx = {}
    for i, h in enumerate(header):
        if h in ("序号", "文件名"):
            idx["file"] = i if h == "文件名" else idx.get("file")
        elif h in FIELD_ALIASES:
            idx[FIELD_ALIASES[h]] = i
    if "file" not in idx:
        return []
    rows = []
    cur = blank_row()
    for r in t.rows[1:]:
        cur = blank_row()
        cur["file"] = cur.get("file", "")
        for key, i in idx.items():
            if i < len(r.cells):
                cur[key] = r.cells[i].text.strip()
        if cur.get("file") or cur.get("name"):
            rows.append(cur)
    return rows


# ---------- 解析：Excel ----------
def rows_from_xlsx(path: Path) -> list[dict]:
    wb = load_workbook(path, data_only=True)
    ws = wb["标注"]
    rows = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        vals = (list(row) + [None] * 12)[:12]
        _, filename, name, color, style, length, occasion, skin, hand, extend, difficulty, note = vals
        if not filename:
            continue
        rows.append({
            "file": str(filename).strip(), "name": name or "", "color": color or "",
            "style": style or "", "length": length or "", "skin": skin or "",
            "occasion": occasion or "", "hand": hand or "", "extend": extend or "",
            "difficulty": difficulty or "", "note": note or "",
        })
    return rows


def load_rows() -> tuple[list[dict], str]:
    has_docx, has_xlsx = DOCX.exists(), XLSX.exists()
    if has_docx and (not has_xlsx or DOCX.stat().st_mtime >= XLSX.stat().st_mtime):
        doc = Document(DOCX)
        rows = rows_from_docx_paragraphs(doc)
        if not rows:
            rows = rows_from_docx_table(doc)
        if not rows:
            raise SystemExit("Word 里没找到可解析的内容。请用【文件名】开头的段落格式，或第一行是表头的表格。")
        return rows, DOCX.name
    if has_xlsx:
        return rows_from_xlsx(XLSX), XLSX.name
    raise SystemExit(f"找不到标注表。先运行：python scripts/make-sheet-docx.py")


# ---------- 图片 ----------
def optimize_image(src: Path, dst: Path) -> tuple[int, tuple[int, int]]:
    with Image.open(src) as im:
        im = im.convert("RGB")
        im.thumbnail((900, 900), Image.LANCZOS)
        dim = im.size
        dst.parent.mkdir(parents=True, exist_ok=True)
        im.save(dst, "WEBP", quality=82, method=6)
    return dst.stat().st_size, dim


def resolve_image(file_field: str, images: list[Path], fallback_index: int) -> Path | None:
    f = file_field.strip()
    if not f:
        return images[fallback_index] if fallback_index < len(images) else None
    p = STYLE_DIR / f
    if p.exists() and p.suffix.lower() in IMG_EXT:
        return p
    # 纯数字 → 第 N 张
    if f.isdigit():
        n = int(f) - 1
        return images[n] if 0 <= n < len(images) else None
    # 模糊匹配
    stem = Path(f).stem
    for img in images:
        if stem and (stem in img.name or stem == img.stem):
            return img
    return None


def main():
    rows, source = load_rows()
    images = sorted(
        p for p in STYLE_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in IMG_EXT and not p.name.startswith("_")
    )
    print(f"读取：{source}   解析到 {len(rows)} 条   目录内图片 {len(images)} 张")

    records, warnings, errors = [], [], []
    seen_names = {}

    for i, row in enumerate(rows, start=1):
        src = resolve_image(row.get("file", ""), images, i - 1)
        if src is None:
            errors.append(f"第 {i} 条（{row.get('file') or '无文件名'}）：找不到对应图片")
            continue

        name = str(row.get("name", "")).strip()
        missing = [label for key, label in REQUIRED if not str(row.get(key, "")).strip()]
        if missing:
            errors.append(f"第 {i} 条（{src.name}）：缺必填 → {'、'.join(missing)}")
            continue

        styles = split_multi(row.get("style", ""))
        bad = [s for s in styles if s not in TAXONOMY["风格"]]
        if bad:
            errors.append(f"第 {i} 条（{src.name}）：风格不在词表 → {bad}")
            continue

        for key, label in (("color", "主色系"), ("length", "长度"), ("skin", "显白度"), ("extend", "需要延长"), ("difficulty", "难度")):
            v = str(row.get(key, "")).strip()
            if v and v not in TAXONOMY[label]:
                warnings.append(f"第 {i} 条（{src.name}）：{label}「{v}」不在词表，已保留")

        occasions = [x for x in split_multi(row.get("occasion", "")) if x in TAXONOMY["场合"]] or ["日常"]
        hands = [x for x in split_multi(row.get("hand", "")) if x in TAXONOMY["适合手型"]] or ["都可以"]

        style_ids = sorted({sku for s in styles for sku in STYLE_TO_SKU.get(s, [])})
        note = str(row.get("note", "")).strip()
        if note and "复杂" in note and "手绘" in styles:
            style_ids = sorted(set(style_ids) | {"S4"})

        sid = f"ST{len(records) + 1:03d}"
        if name in seen_names:
            warnings.append(f"第 {i} 条：款式名「{name}」与第 {seen_names[name]} 条重复")
        seen_names[name] = i

        web_name = f"{sid}.webp"
        dst = WEB_DIR / web_name
        try:
            size, dim = optimize_image(src, dst)
        except Exception as e:  # noqa: BLE001
            errors.append(f"第 {i} 条（{src.name}）：图片处理失败 {e}")
            continue

        records.append({
            "id": sid,
            "file": src.name,
            "img": f"/data/styles/web/{web_name}",
            "name": name,
            "tags": {
                "color": str(row.get("color", "")).strip(),
                "style": styles,
                "length": str(row.get("length", "")).strip(),
                "occasion": occasions,
                "skin_effect": str(row.get("skin", "")).strip(),
                "hand_fit": hands,
                "extend": str(row.get("extend", "")).strip() or "不需要",
                "difficulty": str(row.get("difficulty", "")).strip() or "中",
            },
            "style_ids": style_ids,
            "note": note,
            "_meta": {"size_kb": round(size / 1024), "px": dim},
        })
        meta = records[-1].pop("_meta")
        print(f"  ✓ {sid} {name:<12} {meta['px'][0]}x{meta['px'][1]} {meta['size_kb']}KB")

    JSONL.parent.mkdir(parents=True, exist_ok=True)
    with JSONL.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"\n生成 {len(records)} 条 → {JSONL}")
    if warnings:
        print(f"\n警告 {len(warnings)} 条：")
        for w in warnings:
            print("  · " + w)
    if errors:
        print(f"\n错误 {len(errors)} 条（已跳过）：")
        for e in errors:
            print("  ✗ " + e)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())