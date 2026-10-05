/**
 * 离散格子：构形引擎的地基。
 *
 * 「离散」的三层含义（DESIGN_OUTLINE §4.8.1）：
 *   ① 位置吸附到格 —— 点击永远精确
 *   ② 块型有限枚举 —— 构形空间是有限集
 *   ③ 容许规则是局部谓词 —— 可判定、可夹逼、无浮点退化
 *
 * 存储一律展平（Uint8Array / Float32Array），四维也是一维（戒律：四维展平成一维 TypedArray）。
 */

export type LatticeKind = 'square' | 'hex';

export interface Board {
  kind: LatticeKind;
  /** 每边位点数 */
  size: number;
  /** 位点总数 */
  count: number;
  /** 位点连续坐标 [x0,y0,x1,y1,...]，用于距离计算 */
  pos: Float32Array;
  /** 占据图：0 空 / 1 占 */
  occ: Uint8Array;
  /** 已放置数 */
  placed: number;
  /** 盘面跨度（连续坐标下的边长），用于 Φ* 上界计算 */
  span: number;
  /** 当前最小成对距离（增量维护；-1 表示未计算） */
  minDist: number;
  /** 结构版本号，供渲染层判断是否需要重取快照 */
  version: number;
}

/**
 * 构建盘面。
 * square：size×size 方格位点，坐标间距 1。
 * hex：size 行 × size 列，奇数行偏移 0.5，行距 √3/2（即三角格，每点 6 邻居）。
 */
export function createBoard(kind: LatticeKind, size: number): Board {
  const safeSize = Math.max(2, Math.floor(size));
  const count = safeSize * safeSize;
  const pos = new Float32Array(count * 2);
  let span = 1;

  if (kind === 'square') {
    for (let r = 0; r < safeSize; r++) {
      for (let c = 0; c < safeSize; c++) {
        const i = r * safeSize + c;
        pos[i * 2] = c;
        pos[i * 2 + 1] = r;
      }
    }
    span = safeSize - 1;
  } else {
    const rowH = Math.sqrt(3) / 2;
    for (let r = 0; r < safeSize; r++) {
      for (let c = 0; c < safeSize; c++) {
        const i = r * safeSize + c;
        pos[i * 2] = c + (r % 2 === 1 ? 0.5 : 0);
        pos[i * 2 + 1] = r * rowH;
      }
    }
    span = Math.max(safeSize - 1, (safeSize - 1) * rowH);
  }

  return {
    kind,
    size: safeSize,
    count,
    pos,
    occ: new Uint8Array(count),
    placed: 0,
    span,
    minDist: -1,
    version: 0,
  };
}

export function cloneBoard(b: Board): Board {
  return {
    kind: b.kind,
    size: b.size,
    count: b.count,
    pos: b.pos,
    occ: b.occ.slice(),
    placed: b.placed,
    span: b.span,
    minDist: b.minDist,
    version: b.version,
  };
}

export function isFree(b: Board, i: number): boolean {
  return i >= 0 && i < b.count && b.occ[i] === 0;
}

/** 两点间欧氏距离 */
export function dist(b: Board, i: number, j: number): number {
  const dx = b.pos[i * 2] - b.pos[j * 2];
  const dy = b.pos[i * 2 + 1] - b.pos[j * 2 + 1];
  return Math.sqrt(dx * dx + dy * dy);
}

/** 某点到所有已放点的最小距离；无已放点时返回 +∞ */
export function distToPlaced(b: Board, i: number): number {
  let best = Infinity;
  for (let j = 0; j < b.count; j++) {
    if (j === i || b.occ[j] === 0) continue;
    const d = dist(b, i, j);
    if (d < best) best = d;
  }
  return best;
}

/**
 * 放置。返回是否成功。
 * minDist 增量更新：取 min(旧值, 该点到已放点的最小距离)。
 */
export function place(b: Board, i: number): boolean {
  if (!isFree(b, i)) return false;
  const d = distToPlaced(b, i);
  b.occ[i] = 1;
  b.placed++;
  if (d < b.minDist || b.minDist < 0) b.minDist = b.placed >= 2 ? d : Infinity;
  b.version++;
  return true;
}

export function remove(b: Board, i: number): boolean {
  if (i < 0 || i >= b.count || b.occ[i] === 0) return false;
  b.occ[i] = 0;
  b.placed--;
  // 移除可能抬高 minDist，无法增量 → 标记失效，由 minPairDist 惰性重算
  b.minDist = -1;
  b.version++;
  return true;
}

export function clearBoard(b: Board): void {
  b.occ.fill(0);
  b.placed = 0;
  b.minDist = -1;
  b.version++;
}

/**
 * 最小成对距离（惰性全量重算，O(N²)）。
 * 只在 remove / 周期重置后触发；放置路径走增量（place）。
 */
export function minPairDist(b: Board): number {
  if (b.minDist >= 0) return b.minDist;
  if (b.placed < 2) {
    b.minDist = Infinity;
    return Infinity;
  }
  let best = Infinity;
  for (let i = 0; i < b.count; i++) {
    if (b.occ[i] === 0) continue;
    for (let j = i + 1; j < b.count; j++) {
      if (b.occ[j] === 0) continue;
      const d = dist(b, i, j);
      if (d < best) best = d;
    }
  }
  b.minDist = best;
  return best;
}

export function occupiedList(b: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.count; i++) if (b.occ[i] === 1) out.push(i);
  return out;
}
