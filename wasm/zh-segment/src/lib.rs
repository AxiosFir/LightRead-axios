//! 中文分词的 DAG 最小代价切分 (`cutHan`) 与歧义标记, 与 `src/services/readingModes/zhSegment.ts` 逐位一致.
//!
//! 只搬热循环; 文本分段 (`splitRuns`, Unicode 类) 与词表解析 (`Math.log` 代价) 仍在 JS,
//! 代价由 JS 算好传进来, 这里只做相同顺序的浮点加法与比较, 结果与 JS 完全相同 (scripts/test-zh-segment-wasm.mjs)。
//! 下标是 UTF-16 码元, 代理对的步进规则与 JS 相同。
//!
//! 导出 (wasm32, C ABI, 无 wasm-bindgen):
//!   alloc(n) / dealloc(ptr, n)              线性内存
//!   lex_build(words, lens, costs, n, max_len, unk) -> 句柄   词表: UTF-16 拼接 + 每词长度 (≤ 8) + 代价
//!   lex_free(h)
//!   cut(h, run, len, margin, out_ends, out_unsure) -> 段数     margin 为 NaN 表示不做歧义检查 (JS 的 null)

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

/// FNV-1a: 词很短, 比默认 SipHash 快得多; 不涉及不可信输入的 DoS 问题
#[derive(Default)]
pub struct Fnv(u64);
impl Hasher for Fnv {
  fn finish(&self) -> u64 {
    self.0
  }
  fn write(&mut self, bytes: &[u8]) {
    let mut h = if self.0 == 0 { 0xcbf2_9ce4_8422_2325 } else { self.0 };
    for &b in bytes {
      h ^= b as u64;
      h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    self.0 = h;
  }
}

pub struct Lexicon {
  cost: HashMap<Box<[u16]>, f64, BuildHasherDefault<Fnv>>,
  max_len: usize,
  unk: f64,
}

impl Lexicon {
  pub fn new(words: &[u16], lens: &[u8], costs: &[f64], max_len: usize, unk: f64) -> Self {
    let mut cost = HashMap::with_capacity_and_hasher(lens.len(), Default::default());
    let mut at = 0;
    for (len, c) in lens.iter().zip(costs) {
      let len = *len as usize;
      cost.insert(words[at..at + len].into(), *c);
      at += len;
    }
    Lexicon { cost, max_len: max_len.max(1), unk }
  }
}

/// 与 JS cutHan 相同: 返回各词终点 (递增) 与「没把握」标记
pub fn cut_han(run: &[u16], lex: &Lexicon, margin: Option<f64>) -> (Vec<u32>, Vec<bool>) {
  let n = run.len();
  let l = lex.max_len;
  let mut best = vec![0f64; n + 1];
  let mut next = vec![0usize; n + 1];
  let mut dag_end = vec![0usize; n * l];
  let mut dag_cost = vec![0f64; n * l];
  let mut dag_n = vec![0usize; n];
  let cost = &lex.cost;
  for i in (0..n).rev() {
    let pair = (run[i] & 0xfc00) == 0xd800 && run.get(i + 1).is_some_and(|c| (c & 0xfc00) == 0xdc00);
    let step = if pair { 2 } else { 1 };
    let mut b = lex.unk + best[i + step];
    let mut nx = i + step;
    if step == 1 {
      if let Some(&single) = cost.get(&run[i..i + 1]) {
        if single + best[i + 1] < b {
          b = single + best[i + 1];
        }
      }
    }
    let lim = n.min(i + l);
    let mut k = 0;
    for j in i + 2..=lim {
      let Some(&c) = cost.get(&run[i..j]) else { continue };
      dag_end[i * l + k] = j;
      dag_cost[i * l + k] = c;
      k += 1;
      let v = c + best[j];
      if v < b {
        b = v;
        nx = j;
      }
    }
    dag_n[i] = k;
    best[i] = b;
    next[i] = nx;
  }
  let mut ends = Vec::new();
  let mut unsure = Vec::new();
  let mut i = 0;
  while i < n {
    let j = next[i];
    ends.push(j as u32);
    let mut u = false;
    if let Some(margin) = margin {
      if j - i >= 2 {
        // JS: cost.get(...)! + margin; 不在词表 (代理对单字) 时是 NaN, 比较全为 false
        let lim = cost.get(&run[i..j]).copied().unwrap_or(f64::NAN) + margin;
        let mut a = i.saturating_sub(l - 1);
        while a < j && !u {
          if a != i {
            let base = a * l;
            for k in 0..dag_n[a] {
              let e = dag_end[base + k];
              let crosses = if a < i { e > i && e < j } else { e > j };
              if crosses && dag_cost[base + k] <= lim {
                u = true;
                break;
              }
            }
          }
          a += 1;
        }
      }
    }
    unsure.push(u);
    i = j;
  }
  (ends, unsure)
}

// ---------------- wasm 导出 ----------------

static mut LEXICONS: Vec<Option<Lexicon>> = Vec::new();

#[allow(static_mut_refs)]
fn lexicons() -> &'static mut Vec<Option<Lexicon>> {
  // wasm32-unknown-unknown 单线程; 只在这里访问
  unsafe { &mut LEXICONS }
}

/// 8 字节对齐 (JS 要在这块内存上建 Float64Array / Uint32Array 视图)
#[no_mangle]
pub extern "C" fn alloc(n: usize) -> *mut u8 {
  let mut v = Vec::<u64>::with_capacity(n.div_ceil(8).max(1));
  let p = v.as_mut_ptr();
  std::mem::forget(v);
  p as *mut u8
}

/// # Safety
/// `ptr` 必须来自 `alloc(n)`
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, n: usize) {
  drop(Vec::from_raw_parts(ptr as *mut u64, 0, n.div_ceil(8).max(1)));
}

/// # Safety
/// 指针与长度必须指向 `alloc` 得到的有效内存
#[no_mangle]
pub unsafe extern "C" fn lex_build(words: *const u16, words_len: usize, lens: *const u8, costs: *const f64, n: usize, max_len: u32, unk: f64) -> u32 {
  let words = std::slice::from_raw_parts(words, words_len);
  let lens = std::slice::from_raw_parts(lens, n);
  let costs = std::slice::from_raw_parts(costs, n);
  let lex = Lexicon::new(words, lens, costs, max_len as usize, unk);
  let all = lexicons();
  if let Some(slot) = all.iter().position(Option::is_none) {
    all[slot] = Some(lex);
    slot as u32
  } else {
    all.push(Some(lex));
    (all.len() - 1) as u32
  }
}

#[no_mangle]
pub extern "C" fn lex_free(h: u32) {
  if let Some(slot) = lexicons().get_mut(h as usize) {
    *slot = None;
  }
}

/// # Safety
/// `run` 指向 `len` 个 u16; `out_ends` / `out_unsure` 至少能放 `len` 项
#[no_mangle]
pub unsafe extern "C" fn cut(h: u32, run: *const u16, len: usize, margin: f64, out_ends: *mut u32, out_unsure: *mut u8) -> u32 {
  let Some(Some(lex)) = lexicons().get(h as usize) else { return u32::MAX };
  let run = std::slice::from_raw_parts(run, len);
  let (ends, unsure) = cut_han(run, lex, (!margin.is_nan()).then_some(margin));
  let out_e = std::slice::from_raw_parts_mut(out_ends, ends.len());
  out_e.copy_from_slice(&ends);
  let out_u = std::slice::from_raw_parts_mut(out_unsure, unsure.len());
  for (o, u) in out_u.iter_mut().zip(&unsure) {
    *o = *u as u8;
  }
  ends.len() as u32
}

#[cfg(test)]
mod tests {
  use super::*;

  fn u16s(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
  }

  fn lex(words: &[(&str, f64)], unk: f64) -> Lexicon {
    let mut buf = Vec::new();
    let mut lens = Vec::new();
    let mut costs = Vec::new();
    let mut max = 1;
    for (w, c) in words {
      let u = u16s(w);
      max = max.max(u.len());
      lens.push(u.len() as u8);
      buf.extend(u);
      costs.push(*c);
    }
    Lexicon::new(&buf, &lens, &costs, max, unk)
  }

  #[test]
  fn cuts_by_min_cost_and_flags_crossing_ambiguity() {
    let l = lex(&[("冷风", 2.5), ("风吹", 3.0), ("冷", 5.0), ("吹", 5.0), ("风", 5.0)], 20.0);
    let (ends, unsure) = cut_han(&u16s("冷风吹"), &l, Some(2.0));
    assert_eq!(ends, vec![2, 3]);
    assert_eq!(unsure, vec![true, false]);
    let (_, unsure) = cut_han(&u16s("冷风吹"), &l, None);
    assert_eq!(unsure, vec![false, false]);
  }

  #[test]
  fn surrogate_pairs_step_together() {
    let l = lex(&[("好", 1.0)], 20.0);
    let (ends, _) = cut_han(&u16s("好𠀀好"), &l, Some(2.0));
    assert_eq!(ends, vec![1, 3, 4]);
  }
}
