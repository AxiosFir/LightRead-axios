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

# 西文界面字体 src/assets/fonts/inter-ui.woff2 (Inter 4.1 可变字体, OFL) 是一次性生成的拉丁子集:
#   下载 https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip 到单独目录, 取 InterVariable.ttf, 然后
#   uv tool run --from fonttools --with brotli pyftsubset InterVariable.ttf \
#     --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD" \
#     --layout-features="kern,liga,calt,tnum,case,ccmp,locl,mark,mkmk,cv11" --flavor=woff2 --output-file=src/assets/fonts/inter-ui.woff2
# unicode-range 与 src/styles/main.css 的 @font-face 保持一致.
