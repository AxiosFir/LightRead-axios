#!/usr/bin/env bash
# 重新编译中文分词核心 (wasm/zh-segment) 到 src/wasm/zh_segment.wasm。改了 lib.rs 后运行, 再跑
# `npm run test:zh-segment-wasm` 确认与 JS 实现逐位一致。需要 `rustup target add wasm32-unknown-unknown`。
set -euo pipefail
cd "$(dirname "$0")/../wasm/zh-segment"
cargo test -q
cargo build -q --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/zh_segment.wasm ../../src/wasm/zh_segment.wasm
ls -l ../../src/wasm/zh_segment.wasm
