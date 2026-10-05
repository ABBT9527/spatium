/**
 * 存档序列化。
 *
 * 戒律（存档戒律）：
 *   - 每 10 s + 关键动作保存
 *   - 迁移链 migrations[version]（见 migrations.ts）
 *   - **禁止以重置玩家存档作为升级方案**
 *
 * 新结构：{ saveVersion, clock, meta, layers: { s0, s1 } }。
 * Decimal 字段 → 字符串；Ordinal 字段（α）本身是纯数据，直接 JSON 化。
 */

import { Decimal, dec } from '../core/decimal';
import type { GameState } from '../core/engine';
import type { S0State } from '../layers/s0/state';
import type { S1State } from '../layers/s1/state';
import type { MetaState } from '../meta/types';
import { type Ordinal } from '../ordinal/cnf';
import { S0_MODULE } from '../layers/s0/module';
import { S1_MODULE } from '../layers/s1/module';
import { S0_BASE2_LADDER } from '../layers/s0/defs';
import { migrate } from './migrations';

// 存储键：**不要改名**——它只是 localStorage 的键字符串，改名会孤立老档。
// 真正的存档版本在 saveVersion 字段里，由 migrations.ts 的迁移链处理。
const KEY = 'spatium.save.v2';

const ESSENCE_KEYS: Array<keyof MetaState['five']['essences']> = [
  'metal', 'wood', 'water', 'fire', 'earth',
];

function serS0(s0: S0State): Record<string, unknown> {
  // S0 全部字段都是纯数据（number / Ordinal / boolean）；α 也直接 JSON 化。
  return { ...s0, alpha: s0.alpha as unknown as Ordinal };
}

function serS1(s1: S1State): Record<string, unknown> {
  return {
    ...s1,
    v: s1.v.toString(),
    eps: s1.eps.toString(),
    c0: s1.c0.toString(),
    history: s1.history.slice(-50),
    occ: s1.occ.slice(0, 8192), // 上限保护：极端盘面也不炸存档
  };
}

function serMeta(m: MetaState): Record<string, unknown> {
  const essences: Record<string, string> = {};
  for (const k of ESSENCE_KEYS) essences[k] = m.five.essences[k].toString();
  return {
    current: m.current,
    unlocked: m.unlocked,
    dim: m.dim,
    // 1阶货币「序」（取代已取消的「迭代 It」）
    order1: m.order1.toString(),
    bank: m.bank.toString(),
    milestones: m.milestones,
    challenges: m.challenges,
    ascensions: m.ascensions,
    // v0.1 终局标记 + 调试解锁（缺字段回落 false，绝不出现 undefined）
    endgame: m.endgame === true,
    debugUnlocked: m.debugUnlocked === true,
    // 序数刷新步长（显示层定案：默认 20ms/次，动态可由设置页调节）
    tickMs: m.tickMs,
    five: { essences, deployed: m.five.deployed },
  };
}

function ser(state: GameState): string {
  return JSON.stringify({
    saveVersion: state.saveVersion,
    clock: state.clock,
    lastSeen: Date.now(),
    meta: serMeta(state.meta),
    layers: { s0: serS0(state.layers.s0), s1: serS1(state.layers.s1) },
  });
}

function deser(raw: string): GameState {
  const o = JSON.parse(raw);
  const s = migrate(o);

  // 元状态
  const mRaw = (s.meta ?? {}) as Record<string, any>;
  const fiveRaw = (mRaw.five ?? {}) as Record<string, any>;
  const essRaw = (fiveRaw.essences ?? {}) as Record<string, string>;
  const meta: MetaState = {
    current: mRaw.current ?? 's0',
    unlocked: Array.isArray(mRaw.unlocked) ? mRaw.unlocked : ['s0'],
    dim: typeof mRaw.dim === 'number' ? mRaw.dim : 0,
    order1: dec(mRaw.order1 ?? '0'),
    bank: dec(mRaw.bank ?? '0'),
    milestones: mRaw.milestones ?? {},
    challenges: mRaw.challenges ?? {},
    ascensions: typeof mRaw.ascensions === 'number' ? mRaw.ascensions : 0,
    endgame: mRaw.endgame === true,
    debugUnlocked: mRaw.debugUnlocked === true,
    // 旧档缺 tickMs ⇒ 回落默认 20ms（黑屏根因防线：绝不出现 undefined）
    tickMs: typeof mRaw.tickMs === 'number' ? mRaw.tickMs : 20,
    five: {
      essences: {
        metal: dec(essRaw.metal ?? '0'),
        wood: dec(essRaw.wood ?? '0'),
        water: dec(essRaw.water ?? '0'),
        fire: dec(essRaw.fire ?? '0'),
        earth: dec(essRaw.earth ?? '0'),
      },
      deployed: fiveRaw.deployed ?? {},
    },
  };

  // 各层：以「模块默认状态」为底，再用存档字段覆盖 ⇒ 存档戒律「禁止以清档升级」：
  // 旧档缺哪些（新增）字段，就自动回落到默认值，**绝不会是 undefined**。
  // （曾经直接 {...s0Raw} 展开 ⇒ 缺字段即 undefined ⇒ UI 读 .length 抛错整页黑屏）
  const s0Def = S0_MODULE.createState();
  const s0Raw = s.layers?.s0 as Record<string, any> | undefined;
  const s0: S0State = s0Raw
    ? ({
        ...s0Def,
        ...s0Raw,
        n: typeof s0Raw.n === 'number' ? s0Raw.n : 0,
        base: typeof s0Raw.base === 'number' ? s0Raw.base : s0Def.base,
        round: typeof s0Raw.round === 'number' ? s0Raw.round : 0,
        // 自动后继累加器：旧档缺失 ⇒ 回落默认（黑屏根因防线）
        succAcc: typeof s0Raw.succAcc === 'number' ? s0Raw.succAcc : 0,
        // α 已是「极限累积量」，不再由 (n, base) 派生；旧档无 α 时回落 ZERO
        alpha: (s0Raw.alpha ?? s0Def.alpha) as Ordinal,
        // 升级表：**逐键**合并默认值（不是整块替换），旧档/缺键都不会变 undefined
        upgrades: { ...s0Def.upgrades, ...(s0Raw.upgrades ?? {}) },
        milestones: Array.isArray(s0Raw.milestones) ? s0Raw.milestones : [],
        reachedEps0: s0Raw.reachedEps0 === true,
        ascended: s0Raw.ascended === true,
        base3CineDone: s0Raw.base3CineDone === true,
        // 基 2 专属：升级标记定长 6、越界/非 1 一律回落 0；脚本极限步数夹在 0..4
        base2Up: Array.from({ length: s0Def.base2Up.length }, (_, i) =>
          (Array.isArray(s0Raw.base2Up) ? s0Raw.base2Up[i] : 0) === 1 ? 1 : 0),
        base2LimitStep: typeof s0Raw.base2LimitStep === 'number'
          ? Math.max(0, Math.min(S0_BASE2_LADDER.length, Math.floor(s0Raw.base2LimitStep)))
          : 0,
      } as S0State)
    : s0Def;
  // 注：α 不再做 hered 自愈（它是极限累积量，由 limitS0 维护，存档直接信任）。

  const s1Def = S1_MODULE.createState();
  const s1Raw = s.layers?.s1 as Record<string, any> | undefined;
  const s1: S1State = s1Raw
    ? ({
        ...s1Def,
        ...s1Raw,
        v: dec(s1Raw.v ?? '0'),
        eps: dec(s1Raw.eps ?? '0'),
        c0: dec(s1Raw.c0 ?? '0'),
        history: Array.isArray(s1Raw.history) ? s1Raw.history : [],
        occ: Array.isArray(s1Raw.occ) ? s1Raw.occ : [],
        milestones: Array.isArray(s1Raw.milestones) ? s1Raw.milestones : [],
        hexUnlocked: s1Raw.hexUnlocked === true,
        autoPlaced: typeof s1Raw.autoPlaced === 'number' ? s1Raw.autoPlaced : 0,
      } as S1State)
    : s1Def;

  return {
    saveVersion: typeof s.saveVersion === 'number' ? s.saveVersion : 2,
    clock: typeof s.clock === 'number' ? s.clock : 0,
    meta,
    layers: { s0, s1 },
  };
}

export function save(state: GameState): void {
  try {
    localStorage.setItem(KEY, ser(state));
  } catch {
    /* 存档失败不阻断游戏 */
  }
}

export interface LoadResult {
  state: GameState;
  /** 离线秒数（已 clamp 到 4 h 由 Engine.offline 处理） */
  offlineSec: number;
}

export function load(): LoadResult | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const state = deser(raw);
    const o = JSON.parse(raw);
    const lastSeen = typeof o.lastSeen === 'number' ? o.lastSeen : 0;
    const offlineSec = lastSeen ? Math.max(0, (Date.now() - lastSeen) / 1000) : 0;
    return { state, offlineSec };
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// ── Base64 存档导入 / 导出（设置面板用）───────────────────────────
//
// 存档 JSON 含非 ASCII（序数 α 里的 ω / ε₀）⇒ 必须走 UTF-8 字节再 base64；
// 直接 btoa(json) 会抛 InvalidCharacterError。导出串带前缀便于识别，
// 导入时前缀可省略、夹带的空白/换行也会被容忍（用户常从聊天里拷贝）。

const EXPORT_PREFIX = 'SPATIUM:';

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 把当前存档导出为可直接复制粘贴的 Base64 文本。 */
export function exportSave(state: GameState): string {
  return EXPORT_PREFIX + bytesToBase64(new TextEncoder().encode(ser(state)));
}

export interface ImportResult {
  ok: boolean;
  /** 失败原因（面向玩家的一句话） */
  error?: string;
  /** 成功时解析出的新状态（尚未落盘，由调用方接管） */
  state?: GameState;
}

/**
 * 从 Base64 文本导入存档。宽容处理：允许缺前缀、允许夹带空白/换行。
 * 失败不抛异常，统一返回 { ok:false, error }。
 */
export function importSave(text: string): ImportResult {
  const raw = (text ?? '').trim();
  if (!raw) return { ok: false, error: '内容为空' };
  let body = raw.startsWith(EXPORT_PREFIX) ? raw.slice(EXPORT_PREFIX.length) : raw;
  body = body.replace(/\s+/g, '');
  if (!body) return { ok: false, error: '内容为空' };
  try {
    const json = new TextDecoder().decode(base64ToBytes(body));
    return { ok: true, state: deser(json) };
  } catch {
    return { ok: false, error: '不是有效的存档 Base64（请检查是否复制完整）' };
  }
}

/** 校验用：确认 Decimal 字段确实被还原成了 Decimal */
export function isDecimalOk(state: GameState): boolean {
  return (
    state.layers.s1.v instanceof Decimal &&
    state.layers.s1.eps instanceof Decimal &&
    state.layers.s1.c0 instanceof Decimal &&
    state.meta.order1 instanceof Decimal
  );
}
