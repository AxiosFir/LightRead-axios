#!/usr/bin/env bash
# 重新生成桌面界面展示字体子集 src/assets/fonts/lxgw-wenkai-ui.woff2:
# 霞鹜文楷 (OFL, 全量字体在 App 的 src/mobile/assets/fonts/) 只保留界面词典 (zh/en) 用到的字 + 常用标点.
# 改了标题类文案后重跑. 需要 uv (自动下载 fonttools).
set -euo pipefail
cd "$(dirname "$0")/.."
chars=$(mktemp)
trap 'rm -f "$chars"' EXIT
python3 - "$chars" <<'PY'
import sys
chars = {chr(c) for c in range(0x20, 0x7f)} | set('“”‘’「」『』《》〈〉（）【】、，。：；！？…—·～　')
for path in ('src/i18n/zh.ts', 'src/i18n/en.ts'):
    chars |= set(open(path, encoding='utf8').read())
open(sys.argv[1], 'w', encoding='utf8').write(''.join(sorted(c for c in chars if c.isprintable())))
PY
uv tool run --from fonttools --with brotli pyftsubset src/mobile/assets/fonts/lxgw-wenkai.woff2 \
  --text-file="$chars" --flavor=woff2 --layout-features='*' --output-file=src/assets/fonts/lxgw-wenkai-ui.woff2
ls -l src/assets/fonts/lxgw-wenkai-ui.woff2
