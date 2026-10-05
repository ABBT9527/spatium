/**
 * 统一公式层（bal-sim v9 模型的 1:1 TypeScript 移植）。
 *
 * 三条不可违反的硬规则：
 *   N1  有效弹性恒等于 e* —— 换基 / 换相 / 阶段推进都**不能**改变它
 *   N7  每次周期重置对 lv 的推进**恒定为 1 级**（禁止 while 多买）
 *   N8  尺度轴 Ξ 必须对称地乘在产出侧与目标侧（本文件里 Ξ 不出现在求 t 的路径中）
 *
 * 单位口径（v8 踩过的坑）：
 *   产出侧单位是 V（流量禀赋），流速 R
 *   货币侧单位是 ε，换算 ε = A · V^e*
 *   重置目标在 ε 单位：tgtEps = Θ · c0 · r^(lv+lead)
 *   所需产出        ：V* = tgtEps^(1/e*)      ← 必须先做单位换算
 */

import { Decimal, toNum } from '../core/decimal';
import {
  R_COST, S_EFFECT, E_STAR, LEAD, R0,
  PHI_HAND, PHI_IDLE, PHI_DECAY_TAU, GOV_LAM, GOV_RATE_LIM, GOV_DEADBAND, MAX_ROUND_SEC,
} from '../constants';

export interface LayerTargets {
  /** 首轮目标耗时（秒） */
  tStart: number;
  /** 末轮目标耗时（秒） */
  tEnd: number;
  /** 该层轮数（= 内容条目数的下界） */
  runs: number;
  /** 该层单轮操作预算上限（秒） */
  tOps: number;
}

/** 第 n 级成本：C(n) = c0 · r^(n+lead) */
export function costOf(c0: Decimal, lv: number): Decimal {
  return c0.mul(new Decimal(R_COST).pow(lv + LEAD));
}

/** 产能：R = R₀ · s^lv（Φ 由调用方作为档位乘入，见 rateWith） */
export function prodRate(lv: number): Decimal {
  return new Decimal(R0).mul(new Decimal(S_EFFECT).pow(lv));
}

/** 双档流速：主动档 / 挂机档。这是**唯一**的主动:挂机倍率来源（Q3） */
export function rateWith(lv: number, hand: boolean): Decimal {
  return prodRate(lv).mul(hand ? PHI_HAND : PHI_IDLE);
}

/** ε → V*：V* = tgtEps^(1/e*) */
export function vstarOf(tgtEps: Decimal): Decimal {
  return tgtEps.pow(new Decimal(1).div(E_STAR));
}

/** V → ε：ε = V^e*（对称于 vstarOf） */
export function epsOf(v: Decimal): Decimal {
  return v.pow(E_STAR);
}

export interface SolveTResult {
  T: number;
  ops: number;
  wait: number;
  /** 超过单轮上限（戒律 N9：那就是纯等待，必须报警而不是继续调数值） */
  stalled: boolean;
}

/**
 * 单轮墙钟求解（含熵衰，**与运行时同一模型**）。
 *
 * 旧版是阶跃的：前 τ 秒 hand 档，之后立刻 idle 档。
 * 但运行时 Φ 是**指数衰减**的（PHI_DECAY_TAU），等待期的实际产能高于 idle 档
 * ⇒ 实测每轮比模型快约 5%，控制器只能靠把 Θ 一路推高去"假装"追赶（Θ 漂到 7.5×）。
 *
 * 现在显式积分衰减项：
 *   V(T) = R·[φ_hand·τ + φ_idle·(T−τ) + (φ_hand−φ_idle)·τ_d·(1−e^(−(T−τ)/τ_d))]
 * 单调递增 ⇒ 二分求 T。
 */
export function solveT(
  vstar: Decimal,
  lv: number,
  tau: number,
  phiHand = PHI_HAND,
  phiIdle = PHI_IDLE,
  tauD = PHI_DECAY_TAU,
): SolveTResult {
  const R = prodRate(lv);
  const vAt = (T: number): Decimal => {
    if (T <= tau) return R.mul(phiHand).mul(T);
    const w = T - tau;
    const decay = (phiHand - phiIdle) * tauD * (1 - Math.exp(-w / tauD));
    return R.mul(phiHand * tau + phiIdle * w + decay);
  };

  if (vstar.lte(vAt(tau))) {
    const T = toNum(vstar.div(R.mul(phiHand)));
    return { T, ops: T, wait: 0, stalled: T > MAX_ROUND_SEC };
  }

  let lo = tau;
  let hi = tau + MAX_ROUND_SEC;
  let guard = 0;
  while (vAt(hi).lt(vstar) && guard < 60) {
    hi *= 2;
    guard++;
  }
  for (let k = 0; k < 80; k++) {
    const m = (lo + hi) / 2;
    if (vAt(m).lt(vstar)) lo = m;
    else hi = m;
  }
  const T = (lo + hi) / 2;
  return { T, ops: tau, wait: T - tau, stalled: !isFinite(T) || T > MAX_ROUND_SEC };
}

/** 第 n 轮的目标耗时曲线（几何插值） */
export function targetTime(t: LayerTargets, n: number): number {
  const N = Math.max(1, t.runs);
  return t.tStart * Math.pow(t.tEnd / t.tStart, N > 1 ? n / (N - 1) : 0);
}

/**
 * Governor Θ 的单步修正（戒律：把"等式约束"降级为"负反馈"）。
 *   raw = (T_n / T_target(n))^(−λ)，再限速到 ±25%。
 */
export function thetaStep(tn: number, tTarget: number): number {
  if (!(tn > 0) || !(tTarget > 0)) return 1;
  const dev = Math.log(tn / tTarget);
  if (Math.abs(dev) < GOV_DEADBAND) return 1; // 死区：跟踪得住就不动
  const raw = Math.pow(tn / tTarget, -GOV_LAM);
  return Math.max(1 / GOV_RATE_LIM, Math.min(GOV_RATE_LIM, raw));
}

/** 重置目标（ε 单位）：Θ · c0 · r^(lv+lead) */
export function targetEps(c0: Decimal, lv: number, theta: number): Decimal {
  return costOf(c0, lv).mul(theta);
}

/** 相对进度移动的软上限阈值（戒律 N4：绝不能写成绝对值） */
export function softcapThreshold(base: Decimal, progressExp: number, factor: number): Decimal {
  return base.mul(new Decimal(factor).pow(progressExp));
}
