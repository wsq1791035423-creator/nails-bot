# -*- coding: utf-8 -*-
"""扫描 data/styles/ 里的图片，生成带下拉的标注表 _标注表.xlsx。

用法（在项目根目录）：
    python scripts/make-sheet.py
"""
import json
import re
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
STYLE_DIR = ROOT / "data" / "styles"
JSONL = ROOT / "knowledge" / "03_styles.jsonl"
OUT = STYLE_DIR / "_标注表.xlsx"
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

HEADERS = [
    ("序号", 6), ("文件名", 26), ("款式名", 20), ("主色系", 12), ("风格", 26),
    ("长度", 8), ("场合", 20), ("显白度", 10), ("适合手型", 20),
    ("需要延长", 12), ("难度", 8), ("备注", 30),
]
MULTI = {"风格", "场合", "适合手型"}
HINT = {
    "风格": "可多选，用逗号分隔，如：猫眼,法式",
    "场合": "可多选，用逗号分隔，如：日常,通勤",
    "适合手型": "可多选，用逗号分隔；不确定填「都可以」",
    "备注": "复杂手绘请写「复杂」，会对应更贵的加价项",
}


def load_existing():
    """读取已有 jsonl，按文件名预填，避免重复劳动。"""
    rows = {}
    if not JSONL.exists():
        return rows
    for line in JSONL.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        rows[d.get("file", "")] = d
    return rows


def guess_name(filename: str) -> str:
    stem = Path(filename).stem
    m = re.match(r"^\d+[_\-\s]*(.+)$", stem)
    return (m.group(1) if m else stem).strip()


def main():
    if not STYLE_DIR.exists():
        print(f"目录不存在：{STYLE_DIR}")
        return 1

    images = sorted(
        p for p in STYLE_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in IMG_EXT and not p.name.startswith("_")
    )
    if not images:
        print(f"还没有图片。把款式图放进：{STYLE_DIR}")
        return 1

    existing = load_existing()

    wb = Workbook()
    ws = wb.active
    ws.title = "标注"

    head_fill = PatternFill("solid", fgColor="F2E6E9")
    head_font = Font(bold=True, color="4A3B3F")
    for i, (name, width) in enumerate(HEADERS, start=1):
        c = ws.cell(row=1, column=i, value=name)
        c.fill = head_fill
        c.font = head_font
        c.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[c.column_letter].width = width
        if name in HINT:
            c.comment = Comment(HINT[name], "美甲bot")
    ws.freeze_panes = "C2"
    ws.row_dimensions[1].height = 24

    for idx, img in enumerate(images, start=1):
        prev = existing.get(img.name, {})
        tags = prev.get("tags", {})
        values = [
            idx,
            img.name,
            prev.get("name") or guess_name(img.name),
            tags.get("color", ""),
            ",".join(tags.get("style", [])) if isinstance(tags.get("style"), list) else tags.get("style", ""),
            tags.get("length", ""),
            ",".join(tags.get("occasion", [])) if isinstance(tags.get("occasion"), list) else tags.get("occasion", ""),
            tags.get("skin_effect", ""),
            ",".join(tags.get("hand_fit", [])) if isinstance(tags.get("hand_fit"), list) else tags.get("hand_fit", ""),
            tags.get("extend", ""),
            tags.get("difficulty", ""),
            prev.get("note", ""),
        ]
        for col, v in enumerate(values, start=1):
            ws.cell(row=idx + 1, column=col, value=v)

    # 单选框：严格下拉；多选框不加验证，靠批注提示
    col_map = {name: i for i, (name, _) in enumerate(HEADERS, start=1)}
    for field in ["主色系", "长度", "显白度", "需要延长", "难度"]:
        opts = ",".join(TAXONOMY[field])
        dv = DataValidation(type="list", formula1=f'"{opts}"', allow_blank=True, showErrorMessage=True)
        dv.error = "请从下拉里选"
        dv.errorTitle = "标签不在词表里"
        col = col_map[field]
        letter = ws.cell(row=1, column=col).column_letter
        ws.add_data_validation(dv)
        dv.add(f"{letter}2:{letter}{len(images) + 1}")

    # 词表 sheet
    wt = wb.create_sheet("词表")
    wt.column_dimensions["A"].width = 12
    wt.column_dimensions["B"].width = 70
    wt["A1"], wt["B1"] = "维度", "可选值"
    for k in ("A1", "B1"):
        wt[k].font = head_font
        wt[k].fill = head_fill
    for r, (field, opts) in enumerate(TAXONOMY.items(), start=2):
        wt.cell(row=r, column=1, value=field)
        wt.cell(row=r, column=2, value=" / ".join(opts))

    wb.save(OUT)
    print(f"已生成：{OUT}")
    print(f"共 {len(images)} 张图，必填：款式名、主色系、风格、长度、显白度")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())