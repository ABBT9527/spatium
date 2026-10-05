/**
 * S0 计数层 · 状态。
 *
 * 戒律（三层分离 · 数据层）：纯数据、可 JSON 序列化；禁止放方法。
 * α 是 Ordinal 纯数据（{t:'cnf',terms} / {t:'eps0'}），可直接 JSON 化。
 */

import { ZERO, type Ordinal } from '../../ordinal/cnf';
import {
  S0_BASE_START, S0_UPGRADES, S0_BASE2_UP_COUNT, type S0UpgradeId,
} from './defs';

/** 各升级的当前等级（0 = 未买；上限见 defs.S0_UPGRADES） */
export type S0Upgrades = Record<S0UpgradeId, number>;

export function createUpgrades(): S0Upgrades {
  const u = {} as S0Upgrades;
  for (const def of S0_UPGRADES) u[def.id] = 0;
  return u;
}

export interface S0State {
  /**
   * 计数 n：S0 的根本资源（触发后继/极限的输入；极限后清零，不充当货币）。
   *
   * **内部是小数累加器**（用户定案 2026-10-03）：自动后继是连续流（每 tick 加 v·dt），
   * 手动后继也可能加半整数步长（共鸣 +0.5）⇒ n 天然带小数。
   * **显示与所有整数语义一律取 Math.floor(n)**（见 logic.nFloor / bridge 暴露的 s0.n）；
   * 极限只兑现整数部分（floor），小数余量留作计数继续累积 —— 既不丢产量也不显示小数。
   */
  n: number;
  /**
   * 序数计数 a（S0 的**真实货币**）：极限把处理后的 n 累加进 a，
   * 已实现序数 α = hereditaryToOrdinal(a, base) 由此派生。
   * 升级消耗的是 a（而非 n）—— 见 logic.buyUpgrade。
   */
  ordinalCount: number;
  /** 当前基数 b（10 → 2）；换基逐步降低 */
  base: number;
  /**
   * 已实现序数 α（由序数计数 a 派生：α = V_base(a)，只在「极限 / 购买升级」时变更）。
   * 关键：α 不是 V_b(n) 的派生显示，而是「极限把处理后的 n 累加进 a 后」的累积量；
   * 后继只动 n，α 不变，直到玩家主动极限。这就是「计数 → 序数」的真实动作。
   */
  alpha: Ordinal;
  /** 引擎周期计数 = 已换基次数（换基即 S0 的周期重置） */
  round: number;
  /**
   * 自动后继的分数累加器 —— **已废弃**（保留字段仅为存档向后兼容，逻辑层不再读写）。
   * 旧实现按「整步」累积（succAcc += rate·dt，满 1 才调一次 succS0），
   * 导致「步长 2 / 速率 1」表现为每 1 秒 +2；现改为连续流 v·dt 直接加在 n 上（见 logic.tickS0）。
   */
  succAcc: number;
  /** 升级等级表（买下后保留；**换基时重置**，见 logic.rebaseS0） */
  upgrades: S0Upgrades;
  /**
   * 基 2 专属升级的购买标记（0 / 1，长度 6）。
   * 基 2 用的是**双层对数经济**（价格按显示单位 D 计、实际扣除后内部计数向下取整），
   * 与 base ≥ 3 的「序数计价 + 花序数计数 a」完全不是一套 —— 故独立存一份，互不干扰。
   */
  base2Up: number[];
  /**
   * 基 2 已完成的**脚本化极限**次数（0..4）。
   * α 不再由 V₂ 派生，而是照 S0_BASE2_LADDER 逐格推进；到 4 即 ω^ω ⇒ ε₀ ⇒ 可涌升。
   * 用户定案 2026-10-04（二次）：每次极限（前 3 次）都会把计数清零、升级重置
   * ⇒ base2 是**四圈循环**，本字段同时充当「跨圈持久后继倍率 (√2)^n」的指数（见 logic.base2Root2Of）。
   */
  base2LimitStep: number;
  /** 本层已达成里程碑 id 列表（纯成就记录，不发数值奖励） */
  milestones: string[];
  /** 是否已抵达 ε₀（⇒ 可涌升） */
  reachedEps0: boolean;
  /** 是否已涌升到 S1 */
  ascended: boolean;
  /**
   * base3 → base2 涌升演出是否已播完（进入 base2 永久故障态的标记）。
   * 为真后：文字/成就前三条常驻乱码、升级全失效，但游戏全程可玩、可继续换基。
   */
  base3CineDone: boolean;
  /** 上次操作时刻（游戏内秒） */
  lastActionAt: number;
  /** 距上次操作的秒数（由 tick 写入，供 UI 只读展示） */
  clockSinceAction: number;
  /** 随机种子（预留，保持存档结构稳定） */
  rngSeed: number;
}

export function createS0State(): S0State {
  return {
    n: 0,
    ordinalCount: 0,
    base: S0_BASE_START,
    alpha: ZERO,
    round: 0,
    succAcc: 0,
    upgrades: createUpgrades(),
    base2Up: new Array(S0_BASE2_UP_COUNT).fill(0),
    base2LimitStep: 0,
    milestones: [],
    reachedEps0: false,
    ascended: false,
    base3CineDone: false,
    lastActionAt: 0,
    clockSinceAction: 0,
    rngSeed: 20261002,
  };
}
