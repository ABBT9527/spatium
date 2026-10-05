/**
 * 元进度推进：主脊层切换、维度 D 推进、涌升解锁。
 *
 * 戒律（软重置戒律）：任何推进 / 重置都**不删除元进度**。
 * 推进只做三件事：切当前层 / 解锁目标层 / 推进维度锚点。
 *
 * 经济（2026-10-02 定案）：**取消「迭代 It」**。层资源留在层内（0阶货币），
 * 只有 1阶货币「序 order1」跨 0阶重置保留 —— 它由「离散阶段每次 S4 → S0 折返」+1
 * 获得（`grantOrder1`）。S4 尚未实装 ⇒ 现在恒为 0。
 * S1 的三角格解锁改为**花本层的 0阶货币 ε**（值在 s1/defs.ts 标定）。
 */

import { Decimal, dZero } from '../core/decimal';
import type { MetaState, LayerId, FiveState } from './types';
import { LAYERS } from './registry';
import { ensureBoard, type S1Runtime } from '../layers/s1/logic';
import type { S1State } from '../layers/s1/state';
import { HEX_UNLOCK_RUN, HEX_COST_EPS } from '../layers/s1/defs';

/** 新建元状态：从 S0 起步，维度 0，五行精华全 0。 */
export function createMeta(): MetaState {
  const five: FiveState = {
    essences: {
      metal: dZero(),
      wood: dZero(),
      water: dZero(),
      fire: dZero(),
      earth: dZero(),
    },
    deployed: {},
  };
  return {
    current: 's0',
    unlocked: ['s0'],
    dim: 0,
    order1: dZero(),
    bank: dZero(),
    milestones: {},
    challenges: {},
    five,
    ascensions: 0,
    // v0.1 终局标记 + 调试解锁：默认 false，base2 涌升完成时由 useGame.ascend 置位
    endgame: false,
    debugUnlocked: false,
    // 序数刷新步长（显示层定案：默认 20ms/次，动态可由设置页调节）
    tickMs: 20,
  };
}

/**
 * 1阶货币「序」的**唯一产出**：离散阶段从 S4 重回 S0 时 +1。
 * S4 尚未实装 ⇒ 现在没有任何调用点；此处先落接口与口径（`PLAN_economy_v3` P3）。
 */
export function grantOrder1(meta: MetaState, amount = 1): void {
  meta.order1 = meta.order1.add(amount);
}

/**
 * 是否满足涌升条件：
 *   - 当前层存在 next（主脊下一层）
 *   - S0 专用：须已抵达 ε₀ 且尚未涌升
 *
 * 注意：目标层在**本次涌升中**由 doAscension 解锁（见其 unlocked.push），
 * 因此这里**不**要求 nextId 已预先在 unlocked 中——否则 S0→S1 永远无法触发
 * （chicken-and-egg：S1 只在涌升时才解锁）。解锁是涌升的*结果*，不是前置条件。
 */
export function canAscend(meta: MetaState, layers: Record<LayerId, unknown>): boolean {
  const mod = LAYERS[meta.current];
  const nextId = mod.next();
  if (!nextId) return false;
  if (meta.current === 's0') {
    const s0 = layers.s0 as { reachedEps0?: boolean; ascended?: boolean } | undefined;
    return !!s0?.reachedEps0 && !s0?.ascended;
  }
  return true;
}

/**
 * S1 内容节拍：三角格（hex）解锁。
 *
 * 设计（DESIGN_OUTLINE §5.1 / MEMORY §2 格子阶梯）：第 40 轮后，玩家可花
 * **本层的 0阶货币 ε** 把盘面从方格切换到三角格。三角格密度更高
 * （CELL_DENSITY 1.1547），更易摆出高 Φ，是合理的"被解冻参数"。
 * 这是 S1 的第一个 sink（戒律7：每个 source 必须有对应 sink）。
 *
 * 造价口径（用户 Q2 定案：**0阶货币买 0阶升级**）：价格写在 s1/defs.ts
 * （`HEX_COST_EPS`，由 headless 冒烟在「第 40 轮的实际 ε」上校验可达）。
 */
export function tryUnlockHex(
  meta: MetaState,
  layers: Record<LayerId, unknown>,
  rt: { s1: S1Runtime },
): boolean {
  const s1 = layers.s1 as S1State;
  if (!s1 || s1.hexUnlocked) return false;
  if (s1.round < HEX_UNLOCK_RUN) return false;
  if (s1.eps.lt(HEX_COST_EPS)) return false;

  s1.eps = s1.eps.sub(HEX_COST_EPS);
  s1.hexUnlocked = true;
  s1.lattice = 'hex';
  ensureBoard(s1, rt.s1); // 盘面类型变更 ⇒ 重建为三角格并清空 occ

  if (!s1.milestones.includes('s1.hex')) s1.milestones.push('s1.hex');
  meta.milestones['s1.hex'] = s1.round;
  return true;
}

/**
 * 执行涌升。成功返回 true。任何情况下都不删除元进度（软重置戒律）。
 * 维度锚点：S1 落点 D=0；S2–S5 在其实装时补各自 D 锚点（见 DESIGN_OUTLINE §3.2）。
 */
export function doAscension(meta: MetaState, layers: Record<LayerId, unknown>): boolean {
  if (!canAscend(meta, layers)) return false;
  const mod = LAYERS[meta.current];
  const nextId = mod.next()!;

  meta.current = nextId;
  if (!meta.unlocked.includes(nextId)) meta.unlocked.push(nextId);
  meta.ascensions += 1;

  if (nextId === 's1') meta.dim = 0;

  // 标记本层已涌升（防止重复触发）
  if (meta.current === 's1') {
    const s0 = layers.s0 as { ascended?: boolean } | undefined;
    if (s0) s0.ascended = true;
  }

  const nextMod = LAYERS[nextId];
  const st = layers[nextId];
  if (st && nextMod.onEnter) nextMod.onEnter(st, meta);
  return true;
}

export { HEX_UNLOCK_RUN, HEX_COST_EPS };
/** 便于 UI/测试引用：三角格的 ε 价格（Decimal 只读副本） */
export const hexCostEps = (): Decimal => HEX_COST_EPS;
