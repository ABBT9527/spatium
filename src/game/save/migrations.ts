/**
 * 存档迁移链。
 * 永远向后兼容：任何字段变更都必须在这里补一条迁移，而不是清档。
 *
 * v1 → v2：结构从「平铺的 { s1 }」升级为「meta（元状态）+ layers（各层）」。
 *           v1 存档只有 S1 进度，迁移时把 s1 嵌入新结构、构造默认 meta。
 * v2 → v3：S0 层从「序数操作沙盒（Succ/Sup/Fix + Θ/Φ 节奏引擎）」重做为
 *          「计数 + 换基」；旧 S0 状态形状已失效，故只重置该层，
 *          元进度（meta）与 S1 进度一律保留（禁止以清档升级）。
 * v3 → v4：经济切换 —— 取消跨层货币「迭代 It」（`meta.it`），改为
 *          **0阶货币（层内）+ 1阶货币「序」（`meta.order1`）**。
 *          meta 与 S1 进度一律保留；S0 新字段（charge / upgrades）回落默认值。
 * v4 → v5：S0 极限语义修正（遗传进位，α 只在极限时变更）⇒ 删除 S0 旧字段
 *          `stage`（台阶计数）与 `charge`（极限槽充能），二者不再存在。
 *          α 改为极限累积量，不再由 (n, base) 派生。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;

const migrations: Record<number, (s: Any) => Any> = {
  // 1 → 2：包裹进 meta + layers
  1: (s) => {
    const meta = {
      current: 's1', // 旧档只有 S1，视作已涌升到 S1
      unlocked: ['s0', 's1'],
      dim: 0,
      order1: '0',
      bank: '0',
      milestones: {},
      challenges: {},
      five: {
        essences: { metal: '0', wood: '0', water: '0', fire: '0', earth: '0' },
        deployed: {},
      },
      ascensions: 1,
    };
    return {
      saveVersion: 2,
      clock: s.clock ?? 0,
      meta,
      layers: { s0: undefined, s1: s.s1 ?? null },
    };
  },

  // 2 → 3：S0 层形状重做 ⇒ 层内重置（meta / s1 原样保留）
  2: (s) => ({
    ...s,
    saveVersion: 3,
    layers: { ...(s.layers ?? {}), s0: null },
  }),

  // 3 → 4：取消「迭代 It」，新增 1阶货币「序」order1
  3: (s) => {
    const meta = { ...(s.meta ?? {}) };
    delete meta.it;
    meta.order1 = meta.order1 ?? '0';
    return { ...s, saveVersion: 4, meta };
  },

  // 4 → 5：删除 S0 旧字段 stage / charge（极限语义修正）
  4: (s) => {
    const layers = { ...(s.layers ?? {}) };
    if (layers.s0 && typeof layers.s0 === 'object') {
      delete (layers.s0 as Any).stage;
      delete (layers.s0 as Any).charge;
    }
    return { ...s, saveVersion: 5, layers };
  },
};

export const CURRENT_SAVE_VERSION = 5;

export function migrate(raw: Any): Any {
  let s = raw;
  let v = typeof s.saveVersion === 'number' ? s.saveVersion : 1;
  while (v < CURRENT_SAVE_VERSION) {
    const m = migrations[v];
    if (!m) break;
    s = m(s);
    v++;
    s.saveVersion = v;
  }
  if (typeof s.saveVersion !== 'number') s.saveVersion = CURRENT_SAVE_VERSION;
  return s;
}
