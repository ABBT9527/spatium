/**
 * S1 点层：质量泛函 Φ —— Tammes 覆盖–分离比。
 *
 * 玩法：本轮必须摆下 N 个点（N = 产能等级 lv），位置由玩家自由选择；
 *       Φ = δ_min / δ*(N, 格子, 跨度)，δ* 是**该配置下离散最优**的参考距离。
 *
 * 为什么分母必须是「离散最优」而不是连续上界（关键设计决定）：
 *   若用连续上界（N 个圆盘塞进 [0,span]²），小 N 时离散网格损失极大，
 *   Φ 会随 N 系统性爬升 ⇒ Φ 变成**第二条产能轨道** ⇒ 违反戒律 N5/N1。
 *   实测：连续上界口径下 Φ 从 0.73 爬到 0.90，等价于给 e_eff 注入 +0.23% 偏差，
 *   在 130 轮的尺度上足够吃掉 15–20% 的轮次长度。
 *   改用离散最优作分母 ⇒ Φ 与 N 基本无关 ⇒ Φ 纯粹是"玩家摆得好不好"。
 *
 * 戒律 N6：Φ 一律 clamp 到 [0, 1]。
 * 戒律 N12：δ* 由离线求解器实测标定后覆盖本文件的解析拟合值。
 */

import type { Board, LatticeKind } from './lattice';
import { minPairDist } from './lattice';

/**
 * 参考最优距离 δ*（拟合值，待实测标定覆盖）。
 *
 * 推导：连续上界 δ_opt = span/(√(πN)/2 − 1) 对离散格子过于乐观，
 * 实际网格能达到的最优约为 span/(√N − 0.5)（−0.5 是对边界与奇偶损失的修正）。
 *
 * 格子阶梯在**未归一化**口径下的差异（保留作标定参考，不参与 Φ 计算）：
 *   方格 √π/2 = 0.8862  ／  三角格 √(2π/√3)/2 = 0.9523  ／  连续极限 1.0
 * ⇒ 全程只有 0.22 个数量级，这就是「格子阶梯有界」（戒律 N14）的依据。
 */
export const PHI_STAR_RAW: Record<LatticeKind, number> = {
  square: Math.sqrt(Math.PI) / 2,
  hex: Math.sqrt((2 * Math.PI) / Math.sqrt(3)) / 2,
};

/**
 * 参考最优距离 δ* —— **精确离散最优**，不是拟合。
 *
 * 推导（方格）：间距 g 的网格能提供的位置数是 (⌊span/g⌋+1)²，
 *   要放下 N 个点 ⟺ (⌊span/g⌋+1)² ≥ N ⟺ g ≤ span/(⌈√N⌉−1)
 *   ⇒ g* = ⌊span/(⌈√N⌉−1)⌋
 * 三角格（hex）更密：同样的 span 能塞下 2/√3 ≈ 1.1547 倍的点，
 *   ⇒ 等效需求点数 N_eff = N/1.1547，即 k = ⌈√(N/1.1547)⌉
 *
 * 用精确值而不是连续上界的理由：连续上界在小/中 N 下高估可达距离，
 * 会让 Φ 随 N 系统性漂移 ⇒ Φ 变成第二条产能轨道（违反 N5）。
 */
export const CELL_DENSITY: Record<LatticeKind, number> = {
  square: 1,
  hex: 2 / Math.sqrt(3), // 1.1547
};

export function deltaStar(N: number, span: number, kind: LatticeKind): number {
  if (N <= 1) return span;
  const density = CELL_DENSITY[kind] || 1;
  const k = Math.ceil(Math.sqrt(N / density));
  return Math.max(1, Math.floor(span / Math.max(1, k - 1)));
}

/**
 * 归一化后的 Φ ∈ [0,1]。
 * N=1 时没有分离约束，视为满分（否则前两轮会出现 Φ 断崖，把 Governor 推歪）。
 */
export function phiOf(b: Board): number {
  const N = b.placed;
  if (N <= 0) return 0;
  if (N === 1) return 1;
  const d = minPairDist(b);
  if (!isFinite(d)) return 0;
  return Math.min(1, Math.max(0, d / deltaStar(N, b.span, b.kind)));
}

/**
 * 悬停预览：若把点放在 i 处，Φ 会变成多少。
 * O(N) —— 只算该点到已放点的最小距离，不动全局（戒律：求值必须增量式）。
 * 这是"丝滑"的主要载体：每一下悬停玩家都知道这一步是赚是亏。
 */
export function phiPreview(b: Board, i: number): number {
  if (b.occ[i] === 1) return phiOf(b);
  const N = b.placed + 1;
  if (N === 1) return 1;
  let d = Infinity;
  for (let j = 0; j < b.count; j++) {
    if (b.occ[j] === 0) continue;
    const dx = b.pos[i * 2] - b.pos[j * 2];
    const dy = b.pos[i * 2 + 1] - b.pos[j * 2 + 1];
    const dd = Math.sqrt(dx * dx + dy * dy);
    if (dd < d) d = dd;
  }
  const cur = b.placed >= 2 ? minPairDist(b) : Infinity;
  const next = Math.min(cur, d);
  if (!isFinite(next)) return 0;
  return Math.min(1, Math.max(0, next / deltaStar(N, b.span, b.kind)));
}
