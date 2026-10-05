/**
 * 自动求解器（挂机侧）。
 *
 * 戒律 §4.8.7：求解器**只做单枚贪心 + 有限候选**，不做全局重排。
 *   能做：单枚最优放置（候选受限）
 *   不能做：全局重排 / 换块型组合 / 换容器形状
 * ⇒ 强度封顶在 Φ ≈ 0.65–0.72，给主动玩家留出 2.0–2.5× 的空间（Q3）。
 *
 * 实现要点：候选数 K 就是"求解器强度"旋钮。K 越小越弱。
 * 这里 K 固定为 8（不得随进度提升，否则会吃掉主动/挂机倍率）。
 */

import type { Board } from './lattice';
import { isFree, place, dist } from './lattice';

export const SOLVER_CANDIDATES = 8;

/** 确定性伪随机（避免存档回放不一致） */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * 在 K 个随机空位里挑"到已放点距离最大"的那个放下去。
 * 返回放置的位点索引，盘面满则返回 -1。
 */
export function greedyStep(b: Board, rng: () => number, k = SOLVER_CANDIDATES): number {
  if (b.placed >= b.count) return -1;
  let bestI = -1;
  let bestD = -1;
  for (let t = 0; t < k; t++) {
    const i = Math.floor(rng() * b.count) % b.count;
    if (!isFree(b, i)) continue;
    // 到已放点的最小距离；盘面为空时取到中心的距离（避免全部相同）
    let d = Infinity;
    for (let j = 0; j < b.count; j++) {
      if (b.occ[j] === 0) continue;
      const dd = dist(b, i, j);
      if (dd < d) d = dd;
    }
    if (!isFinite(d)) d = 1e9;
    if (d > bestD) {
      bestD = d;
      bestI = i;
    }
  }
  if (bestI < 0) {
    // 采样未命中空位，退化为线性扫描第一个空位
    for (let i = 0; i < b.count; i++) {
      if (isFree(b, i)) {
        bestI = i;
        break;
      }
    }
  }
  if (bestI >= 0) place(b, bestI);
  return bestI;
}

/** 一次跑 n 步（离线结算用；步数受调用方夹逼，防止卡死主线程） */
export function greedyRun(b: Board, rng: () => number, n: number): number {
  let done = 0;
  for (let i = 0; i < n; i++) {
    if (greedyStep(b, rng) < 0) break;
    done++;
  }
  return done;
}
