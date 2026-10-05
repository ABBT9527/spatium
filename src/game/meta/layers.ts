/**
 * LayerModule：主脊每层的统一接口。
 *
 * 设计意图：六层共用同一套节奏引擎（tick / cycle / Governor / Φ 档位），
 * 差异只在状态形状与「构形」来源（S0 是序数操作、S1–S5 是棋盘）。
 * 引擎与桥接层只认 LayerModule，不认具体层 ⇒ S2–S5 后续可无侵入挂载。
 *
 * 戒律约束（沿用）：
 *   - tick 是唯一改 state 的地方；禁止 import Vue / DOM
 *   - 周期重置对 lv 恒定为 +1（N7）
 *   - 任何层都一样：R = R₀·s^lv·Φ，Θ 吸收偏差
 */

import type { Decimal } from '../core/decimal';
import type { LayerTargets } from '../economy/formulas';
import type { MetaState, LayerId, LayerKind, CycleResult } from './types';

export interface LayerModule<S, R> {
  id: LayerId;
  name: string;
  kind: LayerKind;
  /** 该层 pacing 目标曲线（bal-sim 反解 c0 用） */
  targets: LayerTargets;

  /** 新游戏的默认层状态（内部已含 c0 / τ_eff 标定） */
  createState(): S;
  /** 非序列化运行态（棋盘、RNG、预计算阶梯等） */
  createRuntime(st: S): R;

  /** 单个逻辑步；返回本轮是否触发周期重置（层资源留在层内，引擎不入账） */
  tick(st: S, rt: R, dt: number, clock: number): CycleResult | null;

  /** 周期重置（该层的动词：S0 换基 / S1 离散 …） */
  cycle(st: S, rt: R, clock: number): CycleResult;

  /** 该层可进入的条件（涌升解锁判定也走这里） */
  entryPredicate(meta: MetaState): boolean;
  /** 涌升目标层；null = 终局（S5 之后） */
  next(): LayerId | null;

  /** 层内 Θ₀ 预标定（让 Governor 从正确位置起步，避免前 10 轮漂移） */
  precalibrateTheta(c0: Decimal, tauEff: number, tStart: number): number;
  /** bal-sim / 冒烟用：用真实 tick 模拟首轮耗时 */
  simulateFirstRound(c0: Decimal, tauEff: number, theta0: number): number;

  /** 进入该层时（涌升后）的初始化钩子（可选） */
  onEnter?(st: S, meta: MetaState): void;
}
