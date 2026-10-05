/**
 * S1 层内标定：Θ₀ 预标定。
 *
 * 为什么需要：bal-sim 的时间模型是**阶跃**的（前 τ 秒 hand 档，之后立刻 idle 档），
 * 但真实实现里 Φ 是**指数熵衰**（τ=60 s）的 —— 等待期的实际产能高于模型假设，
 * 于是 Θ 要从 1 一路爬到 ~7.6 才能把耗时压回目标。前 10 轮因此偏差 20–40%。
 *
 * 解法：用**真实 tick 路径**二分反解 Θ₀，让控制器从正确位置起步，而不是让它去追。
 * 这一步是「标定与运行时共用同一条代码路径」的直接体现（戒律：禁止第二套公式）。
 */

import { Decimal } from '../../core/decimal';
import { createS1State } from './state';
import { createRuntime, ensureBoard, fillReference, tickS1 } from './logic';
import { IDLE_WINDOW_SEC } from '../../constants';

const DT = 0.5;

/** 用真实 tick 模拟「首轮耗时」（参考最优摆法 + 专注窗口 + 熵衰） */
export function simulateFirstRound(c0: Decimal, tauEff: number, theta0: number): number {
  const st = createS1State(c0, tauEff);
  st.theta = theta0;
  st.auto = false;
  const rt = createRuntime(st);
  ensureBoard(st, rt);
  fillReference(st, rt);
  st.lastActionAt = 0;

  let clock = 0;
  let guard = 0;
  while (st.round === 0 && guard < 40_000) {
    // 专注窗口内持续操作（与 smoke / 真实玩家同口径）
    if (st.attnLeft > 0 && clock - st.lastActionAt >= IDLE_WINDOW_SEC * 0.5) {
      st.lastActionAt = clock;
    }
    clock += DT;
    tickS1(st, rt, DT, clock);
    guard++;
  }
  return clock;
}

/** 二分 Θ₀ 使首轮耗时命中 tStart */
export function precalibrateTheta(c0: Decimal, tauEff: number, tStart: number): number {
  let lo = 1e-3;
  let hi = 1e4;
  for (let k = 0; k < 52; k++) {
    const m = Math.sqrt(lo * hi);
    if (simulateFirstRound(c0, tauEff, m) > tStart) hi = m;
    else lo = m;
  }
  return Math.sqrt(lo * hi);
}
