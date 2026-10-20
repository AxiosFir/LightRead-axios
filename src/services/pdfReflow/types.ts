/**
 * PDF → 电子书 (重排) 的中间表示. 坐标均为 PDF 点 (pt), 左上原点 (MuPDF 结构化文本的约定).
 * 设计见 docs/plans/pdf-reflow.md.
 */

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 同一样式的一段连续文字 */
export interface RSpan {
  text: string
  bold?: boolean
  italic?: boolean
  mono?: boolean
}

/** 一行文字 (MuPDF stext line, 已合并同一视觉行的碎片) */
export interface RLine extends Rect {
  /** 主字号 (按字符数取众数) */
  size: number
  spans: RSpan[]
  /** 多数字符是等宽字体 */
  mono: boolean
  /** 全部可见字符都是粗体 */
  bold: boolean
  /** 竖排 */
  vertical?: boolean
  /** 数学字体 (CMMI / CMSY / … Math) 字符的占比 0-1, 用于识别独立公式 */
  math?: number
}

export interface RVector extends Rect {
  stroked: boolean
}

/** extract 产出的一页原始几何 */
export interface RawPage {
  /** 0 起的页序号 */
  index: number
  w: number
  h: number
  lines: RLine[]
  vectors: RVector[]
  images: Rect[]
}

export interface OutlineNode {
  title: string
  /** 0 起的页序号 */
  page?: number
  children: OutlineNode[]
}

export type BlockKind = 'h' | 'p' | 'li' | 'pre' | 'caption' | 'figure'

/** 排好阅读顺序、合并好段落的块 */
export interface Block {
  kind: BlockKind
  /** 标题级别 1-3 */
  level?: number
  /** 标题字号 (按书签层级校正同字号标题的级别) */
  size?: number
  /** 文字内容 (pre 内含换行) */
  spans: RSpan[]
  /** 起始页 (0 起) */
  page: number
  /** 起始位置占页高的比例 0-1 */
  y: number
  /** 小字 (脚注、旁注) */
  small?: boolean
  /** 引用 / 提示框 */
  quote?: boolean
  /** figure: 要裁切渲染的区域 */
  rect?: Rect
  /** figure: 含位图 (用 JPEG), 否则 PNG */
  raster?: boolean
}

/** 整书版式统计 */
export interface BookMetrics {
  bodySize: number
  /** 正文行距 (相邻两行 y0 之差) */
  pitch: number
  /** 首行缩进排版 (多数段落首行缩进); 否则靠段间距分段 */
  indentStyle: boolean
  /** 标题字号 (降序), 下标 + 1 即级别 */
  headingSizes: number[]
}

/** 自动判定的 PDF 类型: text 才默认电子书 */
export type PdfKind = 'text' | 'scan' | 'sparse' | 'garbled' | 'image' | 'vertical'

export interface PdfSampleStats {
  pages: number
  /** 抽样各页的可见字符数 */
  perPage: number[]
  /** U+FFFD / 私用区 / 控制字符数 */
  badChars: number
  /** 竖排行的字符数 */
  verticalChars: number
  /** 抽样页里大图 (≥ 页面 50%) 的页数 */
  imagePages: number
}
