/**
 * 参数标定：c0 与 τ_eff 由**目标反解**，禁止拍脑袋（戒律 N9 的另一半）。
 *
 * c0 ← 二分法使「首轮耗时 = tStart」
 * τ  ← τ_eff = min(层操作预算, 每日注意力上限 ÷ 日轮数)
 * 二者互相依赖 ⇒ 外层做 4 次不动点迭代（与 bal-sim v9 runLayer 完全一致）
 *
 * 时间求解**复用** formulas.solveT，不另写一套（戒律：离线/标定/运行时同一条路径）。
 */

import { Decimal } from '../core/decimal';
import { DAILY_ATTN_SEC } from '../constants';
import { costOf, solveT, vstarOf, type LayerTargets } from './formulas';

export interface Calibration {
  c0: Decimal;
  tauEff: number;
  roundsPerDay: number;
}

export function calibrate(t: LayerTargets): Calibration {
  let tauEff = t.tOps;
  let c0 = new Decimal(1);
  let roundsPerDay = 1;

  for (let outer = 0; outer < 4; outer++) {
    c0 = solveC0(t, tauEff);
    let meanT = 0;
    for (let n = 0; n < t.runs; n++) {
      // 首轮近似用 Θ=1 的目标（正式跑由 Governor 把耗时拉回目标曲线）
      const vstar = vstarOf(costOf(c0, n));
      meanT += solveT(vstar, n, tauEff).T / t.runs;
    }
    // 日推进时间占比：在线 4h + 离线结算 4h
    const dayPush = 8 * 3600;
    roundsPerDay = dayPush / Math.max(meanT, 1);
    tauEff = Math.min(t.tOps, DAILY_ATTN_SEC / Math.max(roundsPerDay, 1e-9));
  }

  return { c0, tauEff, roundsPerDay };
}

/** 二分求 c0 使首轮耗时命中 tStart */
export function solveC0(t: LayerTargets, tau: number): Decimal {
  const firstRunTime = (c0v: Decimal): number => solveT(vstarOf(costOf(c0v, 0)), 0, tau).T;
  let lo = new Decimal(1);
  let hi = new Decimal(1e14);
  for (let k = 0; k < 160; k++) {
    const m = lo.mul(hi).sqrt();
    if (firstRunTime(m) > t.tStart) hi = m;
    else lo = m;
  }
  return lo.add(hi).div(2);
}

/** 供调试/文档：标定结果摘要 */
export function describeCalibration(t: LayerTargets): string {
  const c = calibrate(t);
  return `c0=${c.c0.toExponential(4)}  τ_eff=${c.tauEff.toFixed(1)}s  日轮数=${c.roundsPerDay.toFixed(1)}`;
}
