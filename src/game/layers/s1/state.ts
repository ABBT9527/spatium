/**
 * S1 点层 · 状态。
 *
 * 戒律（三层分离 · 数据层）：
 *   - 纯数据，可 JSON 序列化（Decimal 由 save 层转字符串，occ 用 number[] 而非 TypedArray）
 *   - 禁止放方法
 */

import { Decimal, dZero, dOne } from '../../core/decimal';
import type { LatticeKind } from '../../board/lattice';

export interface S1State {
  /** 产能等级（唯一纵向轨道，戒律 N2）。同时决定本轮必须摆下的点数 */
  lv: number;
  /** 当前轮次 n */
  round: number;
  /** 本轮累积产出 V（流量禀赋单位） */
  v: Decimal;
  /** 累计货币 ε */
  eps: Decimal;
  /** Governor Θ */
  theta: number;
  /** 标定后的成本基数（由 scripts/sim.mjs 反解，禁止手改） */
  c0: Decimal;
  /** 每轮操作预算（秒） */
  tauEff: number;
  /** 本轮剩余注意力（秒） */
  attnLeft: number;
  /** 上次操作时刻（游戏内秒） */
  lastActionAt: number;
  /** 距上次操作的秒数（由 tick 写入，供 UI 只读展示） */
  clockSinceAction: number;
  /** 本轮开始时刻（游戏内秒） */
  roundStart: number;
  /** 上一轮实际耗时（秒） */
  lastRoundTime: number;
  /** 各轮耗时历史 */
  history: number[];
  /** 当前有效 Φ（含熵衰，见 logic） */
  phiCur: number;
  /** 历史最佳 Φ */
  bestPhi: number;
  /** 已占用位点索引（序列化用；Board 由 runtime 持有） */
  occ: number[];
  /** 盘面档位（索引进 S1_BOARD_STEPS） */
  boardIndex: number;
  /** 格子类型 */
  lattice: LatticeKind;
  /** 自动求解器开关 */
  auto: boolean;
  /** 求解器随机种子 */
  rngSeed: number;
  /** 三角格（hex）是否已解锁：第 40 轮后可花本层 0阶货币 ε 解锁（内容节拍 + S1 的 sink） */
  hexUnlocked: boolean;
  /** 本层已达成里程碑 id 列表 */
  milestones: string[];
  /**
   * 本轮由自动求解器放置的点数（自动化戒律9：>0 即封顶 Φ≈0.65 的判定依据）。
   * 用计数而非布尔，防止「自动铺满 + 手动补最后一枚」绕过封顶；每轮塌缩时清零。
   */
  autoPlaced: number;
}

export function createS1State(c0: Decimal, tauEff: number): S1State {
  return {
    lv: 0,
    round: 0,
    v: dZero(),
    eps: dZero(),
    theta: 1,
    c0,
    tauEff,
    attnLeft: tauEff,
    lastActionAt: 0,
    clockSinceAction: 0,
    roundStart: 0,
    lastRoundTime: 0,
    history: [],
    phiCur: 0,
    bestPhi: 0,
    occ: [],
    boardIndex: 0,
    lattice: 'square',
    auto: true,
    rngSeed: 20261002,
    hexUnlocked: false,
    milestones: [],
    autoPlaced: 0,
  };
}

export const S1_STATE_DEFAULTS = { c0: dOne(), tauEff: 90 };
