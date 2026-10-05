/**
 * 元状态与主脊层注册表的公共类型。
 *
 * 设计（DESIGN_OUTLINE §3 / §5）：主脊 S0→S1→…→S5 + 五行算子层（轴 C）。
 * 本阶段只实装 S0 / S1（用户定案：先把 S0/S1 做扎实，不急着向后推进），
 * 但 LayerModule 接口已为 S2–S5 预留通用挂载点（不写死 S0/S1 特例）。
 *
 * 经济（2026-10-02 定案）：**0阶货币（每层主资源）+ 1阶货币「序」**，
 * 「迭代 It」已整体取消，详见 `docs/PLAN_economy_v3.md`。
 */

import type { Decimal } from '../core/decimal';

export type LayerId = 's0' | 's1';
export type LayerKind = 'ordinal' | 'board';

/** 五行精华种类（DESIGN_OUTLINE §6，S0/S1 阶段仅占位，永不清零） */
export type EssenceKind = 'metal' | 'wood' | 'water' | 'fire' | 'earth';

export interface FiveState {
  /** 五种精华的累计量（跨层持久） */
  essences: Record<EssenceKind, Decimal>;
  /** 当前部署（轮回会清空部署，不删精华总量） */
  deployed: Partial<Record<EssenceKind, number>>;
}

export interface MetaState {
  /** 当前激活层 */
  current: LayerId;
  /** 已解锁、可访问的层 */
  unlocked: LayerId[];
  /** 维度 D（全局进度轴，整数位是层的锚点） */
  dim: number;
  /**
   * 1阶货币「序 Order」。
   *
   * 设计定案（2026-10-02，用户拍板）：货币分两阶，
   *   - **0阶货币** = 每层自己的主资源（S0 序数 / S1 ε / S2 L / S3 A / S4 V），
   *     层内自产自销；**离散阶段不保留**（离开该层即清零）。
   *   - **1阶货币「序」** = **离散阶段每次从 S4 重回 S0** 才 +1，
   *     **跨 0阶重置保留**，用来买 1阶升级（独立界面，首次完成 S4 后解锁）。
   * 取代旧的「迭代 It」（已整体取消：S0 不再产出任何跨层货币）。
   * 现在只有数据位与展示位——S4 尚未实装 ⇒ 恒定 0、界面显示「未解锁」。
   */
  order1: Decimal;
  /** 通用累计银行（完成层产出的持久货币，暂仅展示，耦合留待后续层） */
  bank: Decimal;
  milestones: Record<string, number>;
  challenges: Record<string, number>;
  five: FiveState;
  /** 涌升次数 */
  ascensions: number;
  /**
   * v0.1 终局标记：S0 的 base2 涌升完成、但 S1 尚未实装。
   * 到达即弹「已达 v0.1 版本终局」提示，不进入 S1（玩家可选重置 / 解锁调试）。
   */
  endgame: boolean;
  /** 终局后玩家选择「解锁调试模式」：持久开启调试注入（设置面板调试区默认展开） */
  debugUnlocked: boolean;
  /**
   * 序数增长刷新步长（毫秒）。
   *
   * 显示层定案（2026-10-03）：序数增长逻辑改为「每次刷新即变动」，
   * 刷新频率由本字段动态控制（默认 20ms/次）。引擎 advance 的
   * 单步时长 = tickMs / 1000，bridge 的 refresh 则按此频率触发，
   * 二者解耦：tick 决定逻辑步长，UI 渲染仍走 rAF（~60fps）。
   */
  tickMs: number;
}

/**
 * 周期重置（每层动词）的返回。
 *
 * 注：旧字段 `itYield`（跨层货币「迭代 It」的产出）已随经济切换删除——
 * **层资源留在层内**（离散阶段不上缴），引擎不再统一入账。
 */
export interface CycleResult {
  /** 本轮是否触发了涌升（通常涌升是手动动作，这里留作扩展） */
  ascended: boolean;
}
