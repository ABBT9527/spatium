/**
 * 重置分类学（DESIGN_OUTLINE §3.4）。
 *
 * 五类重置，互不混淆：
 *   ① 周期重置 Cycle   —— 每层一个动词（S0 塌缩 / S1 离散 …），由 LayerModule.cycle 实现
 *   ② 涌升 Surge       —— 分形溢出，+1 维，进入下一层（本文件 doReset 'surge' 实现）
 *   ③ 约束重演 Challenge —— 每层 4–6 个 ×3 档（Phase 4）
 *   ④ 轮回 Cycle of Five —— 五行部署（Phase 4）
 *   ⑤ 归零 Nilpotent   —— 终局一次性（Phase 7）
 *
 * 本阶段只实装 ② 涌升（依赖 progression.doAscension）。其余三类留作后续 Phase 的挂载点，
 * 此处仅保留类型与分发骨架，不写假实现（戒律：禁止 lemma 式占位奖励）。
 */

import type { MetaState, LayerId } from './types';
import { doAscension } from './progression';

export type ResetType = 'cycle' | 'surge' | 'challenge' | 'recurrence' | 'nullify';

/** 当前阶段已实装的重置类型 */
export const IMPLEMENTED_RESETS: ResetType[] = ['cycle', 'surge'];

/**
 * 统一重置分发。返回是否成功。
 * 'cycle' 由引擎经 LayerModule.tick 内部触发，不在此处理。
 */
export function doReset(
  type: ResetType,
  meta: MetaState,
  layers: Record<LayerId, unknown>,
): boolean {
  switch (type) {
    case 'surge':
      return doAscension(meta, layers);
    case 'cycle':
    case 'challenge':
    case 'recurrence':
    case 'nullify':
      // Phase 4 / 7 挂载点：当前未实装
      return false;
    default:
      return false;
  }
}
