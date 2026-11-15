# 把款式图放这里

直接把 jpg / png / webp 拖进这个目录即可，命名随意（建议 `001_款式名.jpg`）。

放好后在项目根目录运行：

```bash
python scripts/make-sheet-docx.py   # 生成 Word 标注表（推荐）
# 填完 data/styles/_标注表.docx 后
python scripts/import-styles.py     # 校验 + 压缩 + 生成图库
```

也可以用 Excel：`python scripts/make-sheet.py` → 填 `_标注表.xlsx` → 同一个 import 命令。

两个表都在时，谁新用谁。图片原图保留，压缩后的 webp 输出到 `web/` 子目录。

说明见 `knowledge/style-taxonomy.md`。