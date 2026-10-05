/**
 * S0 计数层 · 逻辑。
 *
 * 全部机制压到三动词 + 一条映射（用户定案：S0 要最简、可复用）：
 *   后继 Succ  ：n += succGain（默认 1）。**只动计数，绝不直接改 α**。
 *   极限 Limit ：当 n ≥ base（计数溢出基数）可用；把处理后的 n（×极限深化份数）累加进
 *               序数计数 a（a ← a + n·copies），再派生 α = V_base(a)；n ← 0（已兑现）。
 *               这是「计数 → 序数」的真实遗传进位，α 只在此刻变更；后继不碰 α。
 *   换基 Rebase：base − 1，并**重置 n / a / α / upgrades**（S0 的周期重置）。
 *   映射 V_b   ：α = V_base(a) = hereditaryToOrdinal(a, base)（a 即序数计数）。
 *
 * 极限的「收益」（用户核心诉求）：升级的**价格直接用序数表示**，且**花费序数计数 a**（非 n）。
 *   价格 = 序数 P(lv)（初始 ω/ω/ω²/ω³/ω⁴ 阶梯，resonance 经重做为 ω⁶/ω⁸）；
 *   低基买同一序数更便宜 —— 换基的第二条杠杆。
 *
 * 平衡层重做（2026-10-03）—— 取消深度缩放：
 *   旧版「已购升级随 α 深度 ×2^d」在到达 ω^ω 后三个升级同时 ×8，跨步过大。
 *   现改为**完全线性、无深度缩放**：
 *     - 后继增益 = 步伐（1/2/4/8） + 序数共鸣加成（底数 +0.5/级）
 *     - 自动后继 = 固定阶梯（步/秒）
 *     - 极限深化 = 自然 1 份 + lv 份（1 + lv），无深度缩放
 *     - 序数共鸣 = 把后继增益的底数 +0.5/级（定理式分级，跨阶段持久、不可重复购买）
 *   序数计数 a 累加极限处理的 n，α = V_base(a) 由此派生（系数恒 < base，双射不变量自守）。
 *
 * 换基门槛（S0_REBASE_GATE）：α ≥ 当前基对应的门槛序数即可换基，门槛随换基进度递增
 * （10:ω² / 9:ω³·3 / 8:ω⁴·4 / 7:ω⁵·2 / 6..3:ω^ω）。
 *
 * 计数 n 的「小数累加器 + 取整显示」（用户定案 2026-10-03）：
 *   n 内部是**连续量**（自动后继每 tick 加 v·dt；手动后继步长也可能是半整数），
 *   凡是要整数的语义（**显示** / **可极限判定** / **极限兑现**）一律取 nFloor = ⌊n⌋：
 *     - 显示：bridge 暴露给 UI 的 s0.n 已是 ⌊n⌋ ⇒ 页面上只见整数；
 *     - 极限：只兑现 ⌊n⌋ 份 ω-内容进 a，小数余量 n − ⌊n⌋ 留作计数继续累积（不丢产量）。
 *
 * 自动后继 = 连续流 **v·dt**（用户定案 2026-10-03）：
 *   速度 v = 速率(步/秒) × 步长(succGain) = **理论每秒增加的计数**；
 *   每个 tick（刷新间隔 dt）执行 n += v·dt。
 *   ⇒ 「步长 2 / 速率 1」= v 2/s ⇒ 每 0.5 秒 +1（取整显示即每 0.5 秒跳 1），
 *   而非旧实现的「每 1 秒 +2」。tickMs 只改步长细度，不改每秒产量。
 *
 * 戒律（三层分离 · 逻辑层）：唯一改 state 的地方；禁止 import Vue / DOM。
 */

import {
  cmp, hereditaryToOrdinal, isEps0, omegaDepth, omegaPow, fromNat,
  ZERO, type Ordinal,
} from '../../ordinal/cnf';
import type { CycleResult, MetaState } from '../../meta/types';
import {
  S0_N_CAP, S0_LADDER_SCAN_MAX, S0_BASE_MIN,
  S0_SUCC_GAIN_BASE, S0_RESONANCE_BASE_STEP, S0_SUCC_RATE_STEPS,
  S0_UPGRADE_BY_ID, S0_REBASE_GATE, s0UpgradeMax, isUpgradeUnlocked,
  S0_BASE2_CAP_N, S0_BASE2_UP_COUNT, S0_BASE2_UP_MULT, S0_BASE2_UP_PRICE, S0_BASE2_ROOT2,
  S0_BASE2_LADDER, displayCountOf, countFromDisplay,
  type S0UpgradeId,
} from './defs';
import type { S0State } from './state';
import { createUpgrades } from './state';

export interface S0Rung {
  /** 该计数阈值的 n */
  n: number;
  /** 阈值的序数 α = V_base(n)（参考：在此 n 处极限会并入此 ω-内容） */
  alpha: Ordinal;
}

export interface S0Runtime {
  /** 当前基下「α = V_base(n) 随 n 递增」的参考阶梯（只作教学/参考展示） */
  rungs: S0Rung[];
}

export function createRuntime(st: S0State): S0Runtime {
  return { rungs: computeRungs(st.base) };
}

/**
 * 当前基下的参考阶梯：n 从 1 递增，只记录「领先塔 ω-深度上升」的临界 n。
 * 注：这是 V_base(n) 的参考曲线，并非玩家的已实现 α（α 由极限累积，二者在
 * 玩家于该 n 处极限时一致）。
 */
export function computeRungs(base: number, nMax = S0_LADDER_SCAN_MAX): S0Rung[] {
  const out: S0Rung[] = [];
  let lastDepth = -1;
  for (let n = 1; n <= nMax; n++) {
    const a = hereditaryToOrdinal(n, base);
    const d = isEps0(a) ? 99 : omegaDepth(a);
    if (d > lastDepth) {
      out.push({ n, alpha: a });
      lastDepth = d;
      if (isEps0(a)) break;
    }
  }
  return out;
}

// ───────────────────────── 序数工具 ─────────────────────────

/** 由序数计数 a 重算已实现序数 α = V_base(a)（α 的唯一权威来源，保证系数 < base） */
function recomputeAlpha(st: S0State): void {
  st.alpha = hereditaryToOrdinal(st.ordinalCount, st.base);
}

/** 已实现序数的深度 d = omegaDepth(α)：0=有限, 1≥ω, 2≥ω^ω, …（仅用于里程碑/调试） */
export function alphaDepthOf(st: S0State): number {
  return omegaDepth(st.alpha);
}

/**
 * 序数共鸣 Resonance 的加成：把后继增益的**指数底数** +0.5/级。
 *   lv=0 → +0（无共鸣）；lv=1 → +0.5；lv=2 → +1.0。
 * 这是定理式分级升级（跨阶段持久、用序数计数 a 购买、不可重复购买、有等级上限）。
 * 取代旧版的「随最大项指数走对数曲线」动态倍率（跨步过大、且与整数显示冲突）。
 *
 * ⚠️ 加成作用在**底数**上、不是加在结果上（用户定案 2026-10-03）：
 *   后继增益 = (S0_SUCC_GAIN_BASE + resonanceBonus) ^ succGainLv
 *   即共鸣 1 级 ⇒ 2.5^lv（不是 2^lv + 0.5）；共鸣 2 级 ⇒ 3^lv。
 *   旧实现写成 `2^lv + 0.5·resLv`，在 lv≥2 时几乎无感（共鸣 2 级只 +1），故改。
 */
export function resonanceBonus(st: S0State): number {
  const lv = st.upgrades.resonance ?? 0;
  return S0_RESONANCE_BASE_STEP * lv;
}

/**
 * 破限 LimitBreak 的等级：第 1~3 级给**前两个升级**（succGain / succStream）上限各 +1/级；
 * 第 4 级额外给第 4 个升级（resonance）上限 +1。它自己**不给任何直接加成** ——
 * 效果是「解锁更高的等级空间」，与 resonance（抬增益底数）区分开。
 * 具体分配见 defs.ts 的 `limitBreakBonusTo`。
 */
export function limitBreakLv(st: S0State): number {
  return Math.max(0, st.upgrades.limitBreak ?? 0);
}

// ───────────────────────── 升级（0阶货币 = 计数 n；价格 = 序数，花费计数） ─────────────────────────

const lvClamp = (arrLen: number, lv: number): number => Math.max(0, Math.min(lv, arrLen - 1));

/**
 * 后继增益（每次后继 n += 此值）：**底数 ^ 等级**，无深度缩放。
 *   底数 = S0_SUCC_GAIN_BASE + resonanceBonus(st)（共鸣抬底数，不是加结果）
 *   例：lv3 未共鸣 → 2³ = 8；lv3 + 共鸣1级 → 2.5³ = 15.625；lv3 + 共鸣2级 → 3³ = 27。
 *   lv=0 恒为 1（底数⁰ = 1），与未购买时一致。
 */
export function succGainOf(st: S0State): number {
  // 基 2 走**独立经济**（双层对数 + 累乘倍率 + 跨圈 √2 补偿），与 base ≥ 3 的「底数^等级」无关
  if (st.base === 2) return base2MultOf(st) * base2Root2Of(st);
  const lv = st.upgrades.succGain ?? 0;
  return Math.pow(S0_SUCC_GAIN_BASE + resonanceBonus(st), lv);
}

/** 基 2 升级的**累乘**倍率：第 n 个给 ×MULT[n−1]，总倍率 = 已购各项之积（满配 60） */
export function base2MultOf(st: S0State): number {
  let m = 1;
  for (let k = 0; k < S0_BASE2_UP_COUNT; k++) {
    if (st.base2Up[k] === 1) m *= S0_BASE2_UP_MULT[k] ?? 1;
  }
  return m;
}

/**
 * 基 2 的**跨圈持久**后继倍率 = (√2)^已极限次数（用户定案 2026-10-04）。
 * 每次极限都会把计数与 6 个升级全部重置（要重新攒、重新买），这一份奖励不重置：
 *   ⇒ 第 k 圈的后继增益 = 本圈重买的升级累乘 × (√2)^k，「每次重来都比上次强」。
 * 由 `base2LimitStep` 纯派生，无需新存档字段。
 */
export function base2Root2Of(st: S0State): number {
  return Math.pow(S0_BASE2_ROOT2, Math.max(0, Math.floor(st.base2LimitStep)));
}

/** 基 2 第 idx 个升级的价格（显示单位 D） */
export function base2UpPrice(idx: number): number {
  return S0_BASE2_UP_PRICE[idx] ?? Infinity;
}

/** 基 2 第 idx 个升级是否可买：基 2 + 未买 + 前一个已买（顺序解锁）+ 显示计数够 */
export function canBuyBase2Upgrade(st: S0State, idx: number): boolean {
  if (st.base !== 2) return false;
  if (!Number.isInteger(idx) || idx < 0 || idx >= S0_BASE2_UP_COUNT) return false;
  if (st.base2Up[idx] === 1) return false;
  if (idx > 0 && st.base2Up[idx - 1] !== 1) return false;
  return displayCountOf(nFloor(st)) >= base2UpPrice(idx);
}

/**
 * 买基 2 第 idx 个升级：**实际扣除** —— 显示计数减掉价格，再反解回内部计数并向下取整。
 *   D_new = D(n) − price ； n = ⌊2^(2^D_new)⌋
 * ⇒ 每次购买都会把 n 打回 2（显示 0）：「花光重来」，这正是基 2 锯齿感的来源。
 */
export function buyBase2Upgrade(st: S0State, idx: number, clock: number): boolean {
  if (!canBuyBase2Upgrade(st, idx)) return false;
  const d = displayCountOf(nFloor(st)) - base2UpPrice(idx);
  st.n = Math.floor(countFromDisplay(d));
  st.base2Up[idx] = 1;
  st.lastActionAt = clock;
  sync(st);
  return true;
}

/** 自动后继速率（**步 / 秒**）；线性、无深度缩放。0 = 未购后继流 */
export function autoSuccRateOf(st: S0State): number {
  const lv = st.upgrades.succStream ?? 0;
  return S0_SUCC_RATE_STEPS[lvClamp(S0_SUCC_RATE_STEPS.length, lv)];
}

/**
 * 计数增长**速度 v**：理论每秒增加的计数 = 速率(步/秒) × 步长(每步计数)。
 * 自动后继按连续流累加：每个刷新间隔 dt 加 v·dt（见 tickS0）。
 * 例：步长 2 / 速率 1 ⇒ v = 2/s ⇒ 每 0.5 秒 +1（取整显示即每 0.5 秒跳 1）。
 */
export function succVelocityOf(st: S0State): number {
  return autoSuccRateOf(st) * succGainOf(st);
}

/** 每次极限并入的 ω-内容份数（极限深化升级增加份数；自然 1 份，无深度缩放） */
export function limitDeepenCopies(st: S0State): number {
  const lv = st.upgrades.limitDeepen ?? 0; // 0=1 份, 1=2 份, 2=3 份
  return 1 + lv;
}

/** 是否已装自动极限 */
export function hasAutoLimit(st: S0State): boolean {
  return (st.upgrades.autoLimit ?? 0) >= 1;
}

/** 下一级价格：序数 + 当前基下的计数等价量；满级为 null */
export interface S0Price {
  /** 序数价格 P(lv+1) */
  ordinal: Ordinal;
  /** ordinalToCount(P, base)：买下一级要花的计数 n */
  count: number;
}

/**
 * 下一级价格。⚠️ `limitBreak` 必须传（当前破限等级）：
 *   前三条升级的有效上限会被破限抬高，用脏的默认值会把「破限后本该还能买的那几级」
 *   误判成已满级 ⇒ 出现「买了破限却买不动升级」的假死。所有从 state 出发的调用
 *   （canBuyUpgrade / buyUpgrade / bridge）都必须传 `limitBreakLv(st)`。
 */
export function upgradeCostOf(
  id: S0UpgradeId, level: number, base: number, limitBreak = 0
): S0Price | null {
  const def = S0_UPGRADE_BY_ID[id];
  if (!def) return null;
  const max = s0UpgradeMax(id, base, limitBreak);
  if (level >= max) return null;
  const ordinal = def.price(level + 1, base);
  // 计数等价量：mkPrice 系列直接算（= base^E）；破限走 ordinalToCount（二分）—— 见 defs 的说明
  return { ordinal, count: def.priceCount(level + 1, base) };
}

export function canBuyUpgrade(st: S0State, id: S0UpgradeId): boolean {
  // 未随换基进度解锁 ⇒ 不可买（即便货币够）
  if (!isUpgradeUnlocked(id, st.base)) return false;
  const lb = limitBreakLv(st);
  const c = upgradeCostOf(id, st.upgrades[id] ?? 0, st.base, lb);
  return c !== null && st.ordinalCount >= c.count;
}

/**
 * 买一级升级：**花费序数计数 a**（序数的计数等价量 ordinalToCount(P, base)），而非后继计数 n。
 * 与极限/换基竞争同一份序数进度 —— 花费模型制造「买升级 vs 攒门槛」的取舍张力。
 * 返回是否成功。
 */
export function buyUpgrade(st: S0State, id: S0UpgradeId, clock: number): boolean {
  // 换基进度门控：未解锁的升级即便货币充足也不允许购买
  if (!isUpgradeUnlocked(id, st.base)) return false;
  const lv = st.upgrades[id] ?? 0;
  const c = upgradeCostOf(id, lv, st.base, limitBreakLv(st));
  if (c === null || st.ordinalCount < c.count) return false;
  st.ordinalCount -= c.count;
  st.upgrades[id] = lv + 1;
  recomputeAlpha(st);
  st.lastActionAt = clock;
  sync(st);
  return true;
}

// ───────────────────────── 状态同步 / 里程碑 ─────────────────────────

/** 里程碑检查（不重写 α：α 只由极限累积，后继不改 α） */
function sync(st: S0State): void {
  if (isEps0(st.alpha)) st.reachedEps0 = true;
  const d = omegaDepth(st.alpha);
  const add = (id: string) => {
    if (!st.milestones.includes(id)) st.milestones.push(id);
  };
  if (d >= 1) add('s0.omega');
  if (d >= 2 || isEps0(st.alpha)) add('s0.omegaomega');
  // base3 硬上限里程碑：撞上 ω^(ω^ω) = V_3 的 ε₀ 封顶点
  if (st.base === 3 && st.reachedEps0) add('s0.cap3');
  // ε₀ 成就：仅留给 base2 真正的 ε₀ 高潮（基 3 的 reachedEps0 是硬上限，不计入此项）。
  // ⚠️ 用 reachedEps0 而非 isEps0(α)：基 2 末格 α 是**脚本化的 ω^ω**（t 仍是 'cnf'），
  //    isEps0 判不出来 —— 但它在 base2 语义上就是 ε₀（epsDepthFor(2)=2）。
  if (st.base <= S0_BASE_MIN && st.reachedEps0) add('s0.eps0');
  if (st.base <= S0_BASE_MIN) add('s0.base2');
}

/** 把本层已达成里程碑并入元状态（成就跨层持久，软重置不清） */
export function mergeS0Milestones(meta: MetaState, st: S0State, at: number): void {
  for (const m of st.milestones) {
    if (!(m in meta.milestones)) meta.milestones[m] = at;
  }
}

// ───────────────────────── 三动词 ─────────────────────────

/**
 * 后继 Succ：n += succGain。抵达 ε₀ 后不再增长（S0 终局）。
 * 注意：后继**只动 n**，α 不变 —— α 的变更权只在极限手里。
 */
export function succS0(st: S0State, clock: number): boolean {
  if (st.reachedEps0 || st.n >= S0_N_CAP) return false;
  // 基 2 硬上限：内部计数到 65536（显示 4）后继即报废，交给「极限」接手
  if (st.base === 2 && nFloor(st) >= S0_BASE2_CAP_N) return false;
  st.n = Math.min(st.n + succGainOf(st), S0_N_CAP);
  st.lastActionAt = clock;
  sync(st);
  return true;
}

/**
 * 计数 n 的**整数语义值** = ⌊n⌋。
 * n 内部是连续量（自动后继 v·dt 连续流 + 半整数步长），
 * 但显示、可极限判定、极限兑现三处都必须走这个取整值 ⇒ 页面上只见整数。
 *
 * FLOOR_EPS：连续累加会引入浮点漂移（如 25 × 20ms 得 1.0000000000000002，
 * 反之也可能得 0.9999999999999999）。给一个 1e-9 的容差，避免「刚好到 1 却显示 0」
 * 这种跳变；容差远小于任何真实步长（最小步长 0.5），不会影响平衡。
 */
const FLOOR_EPS = 1e-9;

export function nFloor(st: S0State): number {
  const n = st.n;
  if (!(n > 0)) return 0;
  return Math.floor(n + FLOOR_EPS);
}

/** 基 2 是否已撞满硬上限（内部计数 ≥ 65536 ⇔ 显示计数 = 4） */
export function atBase2Cap(st: S0State): boolean {
  return st.base === 2 && nFloor(st) >= S0_BASE2_CAP_N;
}

/** 极限是否可用：未达 ε₀ 且计数溢出基数（⌊n⌋ ≥ base，存在可兑现的 ω-内容） */
export function canLimit(st: S0State): boolean {
  // 基 2：只有撞满 65536（显示 4）才解锁「极限」，且脚本阶梯只走 4 步
  if (st.base === 2) {
    return nFloor(st) >= S0_BASE2_CAP_N && st.base2LimitStep < S0_BASE2_LADDER.length;
  }
  return !st.reachedEps0 && nFloor(st) >= Math.max(2, Math.floor(st.base));
}

/**
 * 极限 Limit：把计数的 ω-内容并入已实现序数 α（遗传进位），n 回落到有限余数。
 * 例（base 10）：n=10 → ω-内容=ω，α+=ω、n=0（10→ω）；
 *   再 10 次后继 n=10 → 极限 → α=ω·2（ω+10→ω·2）。
 * 极限深化升级会让一次极限并入多份 ω-内容；limitDeepenCopies ≥ 1（自然 1 份）。
 *
 * 整数语义：只兑现 **⌊n⌋** 份（a += ⌊n⌋·copies），小数余量 n − ⌊n⌋ **保留在 n 里**
 * 继续累积 —— 既不丢产量，也不让序数计数 a 出现小数（a 必须是整数，hereditaryToOrdinal 要求）。
 */
export function limitS0(st: S0State, _rt: S0Runtime, clock: number): boolean {
  if (!canLimit(st)) return false;
  // 基 2：**脚本化极限** —— α 照 S0_BASE2_LADDER 逐格推进（ω+2 → ω·2 → ω² → ω^ω）。
  // ⚠️ 不走 V₂ 派生：base2 下系数须 < 2，而 ω+2 / ω·2 的系数是 2，根本不在 V₂ 的像里。
  //    用户拍板「就按字面写」—— 基 2 是按钮损坏的故障态，双射破裂是叙事的一部分。
  // ⚠️ 每次极限后**计数清零 + 升级重置**（见下面 else 分支）⇒ 四次极限不再是连按，
  //    而是四圈「从零攒满 65536 + 重买 6 个升级」——这正是延长 base2 阶段的手段。
  if (st.base === 2) {
    st.base2LimitStep += 1;
    const i = Math.min(st.base2LimitStep - 1, S0_BASE2_LADDER.length - 1);
    st.alpha = S0_BASE2_LADDER[i];
    if (st.base2LimitStep >= S0_BASE2_LADDER.length) {
      // 末格 ω^ω 在 base2 就是 ε₀（epsDepthFor(2)=2）⇒ 解锁涌升。
      // 这一格**不重置**：进度条留满、按钮由 2s morph 变成「涌升」，直接进收尾。
      st.reachedEps0 = true;
    } else {
      // 用户定案 2026-10-04（二次）：**每次极限后变回「后继」** ——
      // 计数清零 + 6 个升级全部重置（要重新买一遍），补偿是跨圈持久的 ×√2（base2Root2Of）。
      // ⚠️ 计数必须清零：这样 canLimit 立刻失效、按钮回到「后继」，玩家必须重新攒满 65536。
      st.n = 0;
      st.base2Up = new Array(S0_BASE2_UP_COUNT).fill(0);
    }
    st.lastActionAt = clock;
    sync(st);
    return true;
  }
  // 遗传进位：把处理后的 n（×极限深化份数）累加进序数计数 a，再派生 α = V_base(a)。
  // 加法在「计数」层面做（a += ⌊n⌋·copies），α 始终是 V_base(a) ⇒ 系数恒 < base（双射不变量）。
  const copies = limitDeepenCopies(st);
  const whole = nFloor(st);
  st.ordinalCount += whole * copies;
  // 余量夹到 0：浮点容差可能让 whole 比 n 大出 ~1e-10，兜住避免出现负计数
  st.n = Math.max(0, st.n - whole);
  recomputeAlpha(st);
  st.lastActionAt = clock;
  sync(st);
  return true;
}

/**
 * 换基门槛是否已满足：未到最低基、且 α ≥ 当前基对应的门槛序数。
 *
 * ⚠️ 这里**绝不能**再加「reachedEps0 ⇒ 不许换基」（旧实现有，2026-10-03 删）：
 *   基 3 的门槛 ω^(ω^ω) 与它的 ε₀ 封顶点**重合** —— V_3(n) 在 ω-深度 ≥ epsDepthFor(3)=3
 *   时封顶 ε₀，而首个触发点恰是 n = 3²⁷，也正是 ω^(ω^ω) 的计数等价量。若用 reachedEps0
 *   挡门，玩家会卡死在基 3：后继/极限被 reachedEps0 停掉、换基又被这条挡掉 ⇒ 完全无事可做。
 *   语义修正为：**撞上 ε₀ = 这一轮撞到不动点 ⇒ 立刻允许换基**（ε₀ 只在基 2 才是终局）。
 *   配套：`rebaseS0` 会清掉 reachedEps0，让下一轮从头开始。
 */
export function canRebase(st: S0State, _rt: S0Runtime): boolean {
  if (st.base <= S0_BASE_MIN) return false;
  const gate = S0_REBASE_GATE[st.base];
  if (!gate) return false;
  return st.reachedEps0 || cmp(st.alpha, gate) >= 0;
}

/**
 * 换基 Rebase：base → base−1，并**重置 n / α / upgrades**（S0 的周期重置）。
 * 为什么重置：换基是离散阶段的「层内归零」；α 是 base 相关的已实现序数，
 * 换基后旧 α 无意义，升级也随层重置（用户定案：升级每次换基重置）。
 * 里程碑（成就）保留。
 */
export function rebaseS0(st: S0State, rt: S0Runtime, clock: number): boolean {
  if (!canRebase(st, rt)) return false;
  st.base -= 1;
  st.n = 0;
  st.ordinalCount = 0;
  st.alpha = ZERO;
  // ⚠️ 换基是**新一轮**：必须清掉 reachedEps0（旧的 dateVersion 里它是 sticky 标记）。
  //   不清的话，从「撞到 ε₀ 的基 3」换到基 2 后，succS0 / canLimit 仍被 reachedEps0 挡着
  //   ⇒ 基 2 的 ε₀ 高潮段（4 次后继 → 极限 → ε₀ → 涌升）直接消失，全程卡在 α=0。
  st.reachedEps0 = false;
  st.upgrades = createUpgrades();
  // 基 2 专属经济也随换基归零（进基 2 时是全新一轮；从基 2 再换基不会发生）
  st.base2Up = new Array(S0_BASE2_UP_COUNT).fill(0);
  st.base2LimitStep = 0;
  st.succAcc = 0;
  st.round += 1;
  st.lastActionAt = clock;
  rt.rungs = computeRungs(st.base);
  sync(st);
  return true;
}

// ───────────────────────── 调试注入（仅设置面板的调试模式调用） ─────────────────────────

/**
 * 调试：直接给**计数 n** 加 x（绕过后继/步长）。
 * 仅用于设置面板的调试模式；唯一红线是「不得越出 number 安全整数」，其余一概不拦截
 * （要的就是能一键把状态推到任意位置）。返回是否真的改动了。
 */
export function debugAddCount(st: S0State, x: number): boolean {
  if (!Number.isFinite(x) || x <= 0) return false;
  const next = Math.min(S0_N_CAP, st.n + x);
  if (next === st.n) return false;
  st.n = next;
  sync(st);
  return true;
}

/**
 * 调试：直接给**序数计数 a** 加 x（等价于凭空极限一次，α = V_base(a) 随之重算）。
 * ⚠️ 由此可能直接撞上 ε₀：例如基 3 门槛 ω^(ω^ω) 的计数等价量恰是 V_3 的 ε₀ 封顶点，
 *     这正是真实玩法的语义（撞不动点 ⇒ 立即可以换基），不做特殊处理。
 */
export function debugAddOrdinalCount(st: S0State, x: number): boolean {
  if (!Number.isFinite(x) || x <= 0) return false;
  const inc = Math.max(1, Math.floor(x)); // a 必须是整数（hereditaryToOrdinal 的前提）
  const next = Math.min(Number.MAX_SAFE_INTEGER, st.ordinalCount + inc);
  if (next === st.ordinalCount) return false;
  st.ordinalCount = next;
  recomputeAlpha(st);
  sync(st);
  return true;
}

// ───────────────────────── 派生只读 ─────────────────────────

/** 当前基的换基门槛序数（α ≥ 此序数即可换基） */
export function rebaseGateAlpha(base: number): Ordinal {
  return S0_REBASE_GATE[base] ?? omegaPow(fromNat(2));
}

/** 下一个参考台阶（当前 n 之后第一个 ω-深度上升点），无则 null */
export function nextRung(st: S0State, rt: S0Runtime): S0Rung | null {
  const n = nFloor(st); // 与显示一致的整数语义
  for (const r of rt.rungs) {
    if (r.n > n) return r;
  }
  return null;
}

/** 参考阶梯的项数 */
export function rungCount(rt: S0Runtime): number {
  return rt.rungs.length;
}

// ───────────────────────── 引擎接缝 ─────────────────────────

/**
 * tick：自动后继（后继流）+ 自动极限。S0 无被动产能，一切产量都由后继/极限产生。
 * 返回 null —— 不触发自动换基（换基是玩家的决策，戒律：至少一个 sink 是决策而非数值）。
 *
 * 自动后继 = **连续流 v·dt**（用户定案）：
 *   v = succVelocityOf(st) = 速率(步/秒) × 步长 = 理论每秒增加的计数；
 *   每个刷新间隔 dt（= tickMs/1000）一次 n += v·dt。
 *   ⇒ 「步长 2 / 速率 1」是每 0.5 秒 +1（不是每 1 秒 +2）；
 *   tickMs 调小只让显示更平滑（跳动更细），**每秒产量恒定不变**。
 *   旧实现按整步累积（succAcc 满 1 才走一次 succS0）已被取代，succAcc 字段废弃。
 */
export function tickS0(
  st: S0State, rt: S0Runtime, dt: number, clock: number
): CycleResult | null {
  st.clockSinceAction = clock - st.lastActionAt;

  if (!st.reachedEps0 && st.n < S0_N_CAP) {
    const v = succVelocityOf(st);
    if (v > 0) {
      st.n = Math.min(st.n + v * dt, S0_N_CAP);
      st.lastActionAt = clock;
      sync(st);
    }
  }

  if (hasAutoLimit(st) && canLimit(st)) limitS0(st, rt, clock);

  return null;
}

/** 周期重置 = 换基（供 LayerModule.cycle 调用；换基由玩家手动触发） */
export function cycleS0(st: S0State, rt: S0Runtime, clock: number): CycleResult {
  rebaseS0(st, rt, clock);
  return { ascended: false };
}
