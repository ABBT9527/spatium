/**
 * S1 点层 · 内容数据表。
 *
 * 所有数值来自 `scripts/sim.mjs` 的反解，**禁止手改**。
 * 要改时长：先加内容条目（抬 runs），再改 tStart/tEnd；**禁止动 r / s / e\***。
 */

import { Decimal } from '../../core/decimal';
import type { LayerTargets } from '../../economy/formulas';

export const S1_TARGETS: LayerTargets = {
  tStart: 240, // 4 min
  tEnd: 1200, // 20 min
  runs: 130,
  tOps: 90,
};

/**
 * 三角格（hex）解锁：内容节拍 + S1 的第一个 sink。
 *
 * 经济口径（用户 Q2 定案「0阶货币买 0阶升级」）：用 **S1 自己的 0阶货币 ε** 购买，
 * 不再用已取消的「迭代 It」。价格由 headless 冒烟在「第 40 轮的实际 ε」上校验：
 * 玩家走到第 40 轮时 ε 必须已够买（见 `smokeS1` 的 HEX 段）。
 */
export const HEX_UNLOCK_RUN = 40;
export const HEX_COST_EPS = new Decimal('1e18');

/** 盘面容量阶梯（内容条目，非数值旋钮） */
export const S1_BOARD_STEPS = [8, 12, 16, 24, 32, 48, 64];

/** 格子阶梯：解锁更"圆"的格子会抬高可达 Φ*（戒律 N13/N14） */
export const S1_LATTICE_UNLOCK = [
  { kind: 'square' as const, atRun: 0, label: '方格' },
  { kind: 'hex' as const, atRun: 40, label: '三角格' },
];

/**
 * Φ* 归一化表（戒律 N12）。
 * 这些是**解析估算**；Phase 1 DoD 要求由离线求解器在标准规模实测后覆盖。
 * 修改本表必须同步调用 Governor 的 Θ 下调（见 logic.ts 的 onLatticeUpgrade）。
 */
export const S1_PHI_STAR = {
  square: Math.sqrt(Math.PI) / 2, // 0.8862
  hex: Math.sqrt((2 * Math.PI) / Math.sqrt(3)) / 2, // 0.9523
};

/** 该层内容条目数（与 runs 的比值必须 ≥ 1.0，bal-sim 表 6 验收） */
export const S1_ITEM_COUNT = 150;
