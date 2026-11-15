# -*- coding: utf-8 -*-
"""生成 Word 版标注模板 data/styles/_标注表.docx。

用法（在项目根目录）：
    python scripts/make-sheet-docx.py
"""
import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
STYLE_DIR = ROOT / "data" / "styles"
OUT = STYLE_DIR / "_标注表.docx"
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}

FIELDS = ["款式名", "主色系", "风格", "长度", "显白度", "场合", "适合手型", "需要延长", "难度", "备注"]

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

CN_FONT = "微软雅黑"


def set_font(run, size=10.5, bold=False, color=None):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.name = CN_FONT
    run._element.rPr.rFonts.set(qn("w:eastAsia"), CN_FONT)
    if color:
        run.font.color.rgb = RGBColor(*color)


def main():
    STYLE_DIR.mkdir(parents=True, exist_ok=True)

    images = []
    if STYLE_DIR.exists():
        images = sorted(
            p for p in STYLE_DIR.iterdir()
            if p.is_file() and p.suffix.lower() in IMG_EXT and not p.name.startswith("_")
        )

    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = CN_FONT
    style.element.rPr.rFonts.set(qn("w:eastAsia"), CN_FONT)
    style.font.size = Pt(10.5)

    h = doc.add_paragraph()
    set_font(h.add_run("美甲款式图库 · 标注表"), 16, True, (0x4A, 0x3B, 0x3F))

    tip = doc.add_paragraph()
    set_font(tip.add_run(
        "怎么填：每张图对应一个【方括号块】，在冒号后面填内容即可，不用改格式、不用删行。\n"
        "必填：款式名、主色系、风格、长度、显白度。多选的地方用逗号隔开。\n"
        "填完保存，运行：python scripts/import-styles.py"
    ), 9, False, (0x8B, 0x81, 0x86))

    doc.add_paragraph()

    if images:
        for i, img in enumerate(images, start=1):
            p = doc.add_paragraph()
            set_font(p.add_run(f"【{img.name}】"), 11, True)
            for f in FIELDS:
                fp = doc.add_paragraph()
                fp.paragraph_format.space_after = Pt(0)
                fp.paragraph_format.left_indent = Pt(12)
                set_font(fp.add_run(f"{f}："), 10.5, False, (0x55, 0x4A, 0x4D))
            if i != len(images):
                doc.add_paragraph()
    else:
        p = doc.add_paragraph()
        set_font(p.add_run("（这个目录里还没有图片。把图放进来后重新运行本脚本，会自动生成每张图的块。）"), 10, False, (0x8B, 0x81, 0x86))
        doc.add_paragraph()
        p = doc.add_paragraph()
        set_font(p.add_run("【示例：001_雾霾蓝猫眼.jpg】"), 11, True, (0x8B, 0x81, 0x86))
        for f in FIELDS:
            fp = doc.add_paragraph()
            fp.paragraph_format.space_after = Pt(0)
            fp.paragraph_format.left_indent = Pt(12)
            set_font(fp.add_run(f"{f}："), 10.5, False, (0xAA, 0xA2, 0xA6))

    doc.add_page_break()
    p = doc.add_paragraph()
    set_font(p.add_run("可选值（只能从这些词里选）"), 13, True)

    for field, opts in TAXONOMY.items():
        fp = doc.add_paragraph()
        fp.paragraph_format.space_after = Pt(2)
        set_font(fp.add_run(f"{field}："), 10.5, True)
        set_font(fp.add_run(" / ".join(opts)), 10.5)

    doc.save(OUT)
    print(f"已生成：{OUT}")
    if images:
        print(f"已为 {len(images)} 张图生成填写块")
    else:
        print("目录里还没有图片，只生成了空模板 + 词表")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())