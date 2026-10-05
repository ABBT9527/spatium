/**
 * S0 计数层 · 内容数据表。
 *
 * 定案（2026-10-02 用户拍板；2026-10-03 平衡层重做）：
 *   S0 是最底层构造 —— **最简数值增长 + 购买升级 + 数值加速增长的循环**，直到换基结束。
 *   主资源 = 计数 n（0阶货币）；已实现序数 α 由「极限」累积（10→ω、ω+10→ω·2）。
 *
 * 三动词（+ 一条映射）：
 *   后继 Succ  ：n += succGain（默认 1）。**只动计数，绝不直接改 α**。
 *   极限 Limit ：当 n ≥ base（计数溢出基数）可用；把计数的 ω-内容并入 α
 *               （α ← α + ω内容(V_base(n))），n ← n mod base（有限余数留作货币）。
 *               这是「计数 → 序数」的真实遗传进位，α 只在此刻变更。
 *   换基 Rebase：base − 1，且重置 n / α / upgrades（S0 的周期重置）。
 *   映射 V_b   ：α 的增量来自 V_base(n) = hereditaryToOrdinal(n, base)。
 *
 * 极限的「收益」（用户核心诉求）：升级的**价格直接用序数表示**，且**花费的是序数计数 a**
 *   （不是后继计数 n —— 见 logic.buyUpgrade）。
 *   价目表（用户定案 2026-10-03）：初始价 ω/ω/ω²/ω³/ω⁴；
 *   前两条升级（succGain/succStream）每级 ×ω，第三、四条（limitDeepen/resonance）每级 ×ω²。
 *   可买性 = ordinalCount ≥ ordinalToCount(P, base)（序数的「计数等价量」）；
 *   低基买同一序数更便宜（ω²@base10=100、@base9=81、@base2 封顶仅 4）—— 换基的第二条杠杆。
 *   α 由序数计数 a 派生（α = V_base(a)），故系数恒 < base，天然满足双射不变量。
 *
 * 平衡层重做（2026-10-03）—— 取消深度缩放：
 *   旧版「已购升级随 α 深度 ×2^d」跨步过大（到达 ω^ω 后三个升级同时 ×8）。
 *   现改为**完全线性、无深度缩放**：后继增益 = 步伐 + 共鸣加成；自动后继/极限深化 =
 *   固定阶梯值。序数的「计数等价量」门槛也改为按换基进度递增（见 S0_REBASE_GATE）。
 *
 * 升级随换基进度解锁（2026-10-06 修订：前两个升级价 ×ω²、Stream 初始 ω²、基9 双解锁、Deepen 推到基8）：
 *   基 10：无升级（仅 后继/极限/换基 三按钮）；
 *   基 9 ：解锁 后继增益 succGain（上限 3）+ 后继流 succStream（上限 2）；
 *   基 8 ：解锁 极限深化 limitDeepen（上限 1），且 succGain 上限抬到 4、succStream 上限抬到 3；
 *   基 7 ：**前两条升级（succGain / succStream）上限各 +1**（→ 5 / 4）；
 *   基 6 ：解锁 序数共鸣 resonance（上限 2，价格 ω⁶/ω⁸），
 *          且**前三条升级（succGain / succStream / limitDeepen）上限各 +1**（→ 6 / 5 / 3）；
 *   基 5 ：解锁 自动极限 autoLimit（上限 1）。
 *   基 4 ：**前三条升级上限各 +1**（→ 7 / 6 / 5）。
 *   基 3 ：**前三条再各 +1**（→ 8 / 7 / 6）、**第四条 resonance +2**（→ 4），
 *          并解锁 **破限 limitBreak**（让前三条上限再各 +1/级，上限 4）。
 *   （autoLimit 原在基 7，用户 2026-10-03 改到基 5：自动化不该在低基过早拿走「极限」这一决策。）
 *
 * 等级上限与阶梯数组长度（**易错点，2026-10-03 修 bug**）：
 *   阶梯数组的**下标就是等级 lv**（含 lv=0 的未升级档），所以「上限 N」要求数组
 *   **至少 N+1 项**。旧版 succGain 上限抬到 4 但数组只有 4 项（下标 0..3）
 *   ⇒ lv=4 被 clamp 回下标 3，买第 4 级**毫无提升**。
 *   后继增益已改为**幂运算**（S0_SUCC_GAIN_BASE^lv），不再受数组长度制约；
 *   仅后继流仍是数组：RATE = [0,1,2,4,8,16]（到 lv5，对应基 ≤6 的上限 5）。
 *
 * 换基门槛（S0_REBASE_GATE，α ≥ 该序数的计数等价量即可换基）：
 *   10 → ω²（100） ；9 → ω³·3（2187） ；8 → ω⁴·4（16384） ；
 *   7 → ω⁵·2（2·7⁵ = 33614） ；6 → ω^(ω+1)（6⁷ = 279936） ；5 → ω^(ω·2)（5¹⁰） ；4 → ω^(ω·3)（4¹²） ；3 → ω^(ω^ω)（3²⁷）。
 *   base 2 因 epsDepthFor(2)=2，攒到 n=4（4 次后继）再极限一次并出 ω^ω ⇒ ε₀ ⇒ 涌升 S1。
 *
 * 破限 LimitBreak（用户定案 2026-10-04）：**基 3 专属**的第 6 条升级 ——
 *   效果 = 让**前三条升级**（succGain / succStream / limitDeepen）的等级上限各 +1（每级 +1），
 *   等级上限 4 ⇒ 最多 +4（基 3 下三条上限 8/7/6 → 12/11/10）。只抬上限、不给直接加成，
 *   「解锁更多空间」而非「直接变强」，与 resonance（抬底数）区分开。
 *   价格：**初始 ω^(ω²)，每级 ×ω^ω** ⇒ 第 lv 级 = ω^(ω² + ω·(lv−1))
 *   ——  lv1 ω^ω² / lv2 ω^(ω²+ω) / lv3 ω^(ω²+ω·2) / lv4 ω^(ω²+ω·3)。
 *
 * 数值（序数价目 / 效果阶梯）是**调参旋钮**：结构先定，具体值由 bal-sim 出曲线后标定。
 */

import type { LayerTargets } from '../../economy/formulas';
import {
  omegaPow, fromNat, cnf, add, hereditaryToOrdinal, ordinalToCount,
  type Ordinal,
} from '../../ordinal/cnf';

/** 起始基数 */
export const S0_BASE_START = 10;
/** 终止基数（到达即 S0 终局段：极限至 ε₀） */
export const S0_BASE_MIN = 2;

/** 计数上限（避免越过 number 安全整数；抵达 ε₀ 后不再增长） */
export const S0_N_CAP = Number.MAX_SAFE_INTEGER;

/** 台阶预览扫描上限（UI 用；base 大时后面的台阶在天文数字上，不必展开） */
export const S0_LADDER_SCAN_MAX = 100_000;

/**
 * 后继增益 = **底数 ^ 等级**（用户定案 2026-10-03）：底数默认 2 ⇒ 2^lv
 * （lv0→1、lv1→2、lv2→4、lv3→8、lv4→16、lv5→32、lv6→64）。
 * 序数共鸣抬的就是**这个底数**（见 S0_RESONANCE_BASE_STEP）。
 *
 * ⚠️ 这里刻意**不用阶梯数组**：旧版把 2^lv 存成数组、下标当等级，结果上限一抬高
 * 数组不够长就被 clamp 回上一档 ⇒ 买了没提升（2026-10-03 修过一次，基 6 又差点再犯）。
 * 改成幂运算后上限可以随便抬，**这类 bug 从结构上被消灭**。
 */
export const S0_SUCC_GAIN_BASE = 2;

/** 序数共鸣每级给后继增益**底数**的加成：底数 = 2 + 0.5×共鸣lv（共鸣 2 级 ⇒ 3^lv） */
export const S0_RESONANCE_BASE_STEP = 0.5;
/**
 * 自动后继（后继流）速率：**下标 = 等级 lv**（下标 0 = 未购买 = 0）；单位「**步 / 秒**」。
 * 实际计数速度 v = 该速率 × 当前后继步长（见 logic.succVelocityOf），
 * 每个刷新间隔 dt 加 v·dt ⇒ 「步长 2 / 速率 1」表现为每 0.5 秒 +1。
 * lv：0→0、1→1、2→2、3→4、4→8、5→16、6→32、7→64、8→128、9→256、10→512、11→1024。
 *
 * ⚠️ 项数必须 **≥ 最大等级 + 1**（下标 = 等级，含 lv=0 档）。当前最大等级来自
 *   基 3 + 破限 4 级 ⇒ succStream 上限 7 + 4 = **11** ⇒ 数组要 12 项（smoke ⑪ 断言守着）。
 *   少一项就会被 clamp 回上一档 ⇒ 最后一级买了没提升（这个 bug 已经犯过两次）。
 */
export const S0_SUCC_RATE_STEPS = [0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024] as const;

export type S0UpgradeId =
  | 'succGain'
  | 'succStream'
  | 'limitDeepen'
  | 'resonance'
  | 'autoLimit'
  | 'limitBreak';

export interface S0UpgradeDef {
  id: S0UpgradeId;
  name: string;
  /**
   * 解锁所需基数：base ≤ unlockBase 时该升级才出现（换基进度门控）。
   * 基 10 时无升级（unlockBase 最小为 9）。
   */
  unlockBase: number;
  /**
   * 等级上限的**天花板** = 最低可解锁基下的上限（前三条升级会随换基进度抬高上限，
   * 故这里写最大值）。当前基的**有效**上限一律以 `s0UpgradeMax(id, base)` 为准。
   */
  max: number;
  /** 第 lv 级（lv 从 1 起）的**序数价格**（价格直接用序数；随基变化，见 mkPrice） */
  price: (lv: number, base: number) => Ordinal;
  /** 第 lv 级的**计数等价量** —— 恒等于 ordinalToCount(price(lv,base), base)，
   *  但直接算（base^E）而不做扫描（扫描版在 E 较大时要几十秒，见 cnf.ordinalToCount） */
  priceCount: (lv: number, base: number) => number;
  /** 第 lv 级（lv 从 1 起）的**基础**效果量（共鸣/缩放后的实际值由逻辑层拼装） */
  baseEffect: (lv: number) => number;
  /** 基础效果描述（供 UI 副标题；实际数值由逻辑层实时拼装） */
  effectText: (lv: number) => string;
}

const pick = <T>(arr: readonly T[], i: number): T => arr[Math.min(i, arr.length - 1)];

/**
 * 序数价目表（用户定案 2026-10-03；**2026-10-03 晚间修正「价格不递增」BUG**）：
 *   初始价按序：ω / ω² / ω² / ω⁶ / ω⁶；
 *   前两条升级（succGain / succStream）每级价格 ×ω²（succGain 初始 ω、succStream 初始 ω²）；
 *   第三、四条（limitDeepen / resonance）每级价格 ×ω²。
 *   resonance：初始价 ω⁶、L2 为 ω⁸。
 *   支付：花费「价格序数的计数等价量」个序数计数 a（见 logic.buyUpgrade）。
 *
 * ⚠️ 为什么价格必须是 **ω^(V_base(E))** 而不能直接写 ω^E（旧实现的 BUG）：
 *   在基 b 下可表示的序数，其指数只能是「< b 的有限数」或「≥ ω」——
 *   **ω^k（k ≥ b）这个序数根本不存在**，它的计数等价量会坍缩成 ω^ω 的 b^b。
 *   实测旧表：base6 的 resonance L1/L2 都是 46656（**白送一级**）；
 *   base4 的 succGain 后三级全是 256；base8~10 的 resonance L2 直接扫爆上限变 Infinity
 *   （**永远买不起**）。
 *   改成 ω^(V_base(E)) 后：它就是「把计数 base^E 兑现成的那个序数」，
 *   计数等价量恒为 base^E ⇒ **严格递增、不会饱和、不会溢出**，且语义更贴游戏本体。
 *   代价：价格序数随基变化（低基下 ω⁶ 会显示成 ω^ω、ω^(ω+2) 这类），这是模型决定的。
 */
const priceExp = (baseExp: number, step: number, lv: number): number =>
  baseExp + (lv - 1) * step;

/** 价格构造：指数 E 随等级线性增长 ⇒ 序数 = ω^(V_base(E))、计数 = base^E */
const mkPrice = (baseExp: number, step: number) => ({
  price: (lv: number, base: number): Ordinal =>
    omegaPow(hereditaryToOrdinal(priceExp(baseExp, step, lv), base)),
  priceCount: (lv: number, base: number): number =>
    Math.pow(base, priceExp(baseExp, step, lv)),
});

const W = (k: number): Ordinal => omegaPow(fromNat(k)); // ω^k
/** ω^ω（6^6 = 46656 在 base6 即为 ω^ω；5^5/4^4/3^3 同理各为 ω^ω） */
const OMEGA_OMEGA: Ordinal = omegaPow(omegaPow(fromNat(1)));

/**
 * 破限 LimitBreak 第 lv 级的**序数价格**（lv 从 1 起）。
 *   初始价 ω^(ω²+2)（用户定案 2026-10-04，常数 +2 **恒在**，含 L1）；
 *   每级乘 ω^(ω+2) ⇒ 第 lv 级价 = ω^(ω² + 2 + (ω+2)·(lv−1))。
 *   其中 (ω+2)·(lv−1) 是**序数乘法**（左乘有限自然数）：(ω+2)·m = ω·m + 2，
 *   故指数 = ω² + ω·(lv−1) + 2（lv=1 时即 ω²+2，无 ω·k 项）。
 *   例：L1=ω^(ω²+2)，L2=ω^(ω²+ω+2)，L3=ω^(ω²+2ω+2)，L4=ω^(ω²+3ω+2)。
 *
 * ⚠️ 指数必须是 CNF 的「ω²·1 + ω·k + 常数」写法 —— 若误把 omegaPow(ω²) 当指数就会变成
 *   ω^(ω^(ω²))，量级整个爆到塔外（这类「多套一层 ω^」的 bug 已经犯过两次）。
 *
 * ⚠️ 计数等价量走 ordinalToCount（已改二分，O(log n)），**不要**套 base^E 公式：
 *   E 在这里是序数不是自然数；序数乘法的常数项会让闭式公式算错，交给二分最稳。
 */
const OMEGA2 = cnf([{ exp: fromNat(2), coef: 1 }]); // ω²
export const limitBreakPriceOrdinal = (lv: number): Ordinal => {
  const k = Math.max(0, lv - 1);
  const mul = k > 0 ? cnf([{ exp: fromNat(1), coef: k }]) : fromNat(0); // ω·k
  // 指数 = ω² + ω·k + 2（k=0 ⇒ ω²+2）。加法次序：ω² 吸收 ω·k 项，常数 2 恒挂末尾。
  const exp = add(add(OMEGA2, mul), fromNat(2));
  return omegaPow(exp);
};

/**
 * 破限的**等级上限加成**分配（2026-10-04 二次定案）：
 *   - 第 1~3 级：只抬高**前两个**升级（succGain / succStream）各 +1/级；
 *   - 第 4 级：额外再把**第 4 个**升级（resonance）上限 +1。
 * 即：succGain / succStream 每级都 +1；resonance 仅第 4 级 +1；
 *     其余（limitDeepen / autoLimit / limitBreak）不受影响。
 * 返回「给定升级在给定破限等级下，应额外加多少级上限」。
 */
export function limitBreakBonusTo(id: S0UpgradeId, limitBreakLv: number): number {
  const lb = Math.max(0, Math.floor(limitBreakLv));
  if (id === 'succGain' || id === 'succStream') return lb; // 每级 +1（1~4 都生效）
  if (id === 'resonance') return lb >= 4 ? 1 : 0; // 仅第 4 级 +1
  return 0; // limitDeepen / autoLimit / limitBreak 不动
}

/**
 * 换基门槛：在每个基数下，α 累积到「该序数」对应的计数等价量即可换基。
 *   10 → ω²（100） ；9 → ω³·3（2187） ；8 → ω⁴·4（16384） ；7 → ω⁵·2（33614） ；
 *   6 → ω^(ω+1)（6⁷ = 279936） ；5 → ω^(ω·2)（5¹⁰ = 9765625） ；
 *   4 → ω^(ω·3)（4¹² = 16777216） ；3 → ω^(ω^ω)（3²⁷ = 7625597484987）。
 * 注：门槛随换基进度递增，制造「越往后越要囤更多序数才能换基」的张力；
 * 取消旧版「α ≥ ω² 一刀切」，避免 base9/8/7 过早达标、链路被压缩。
 *
 * ⚠️ 基 3 的 ω^(ω^ω) 与它的 ε₀ 封顶点**重合**（用户 2026-10-03 定案保留）：
 *   V_3(n) 在 ω-深度 ≥ epsDepthFor(3)=3 时封顶 ε₀，而首个触发点恰是 n = 3²⁷
 *   —— 也正是 ω^(ω^ω) 的计数等价量。所以玩家在基 3 达标那一刻 α 会直接变成 ε₀。
 *   语义：**撞上 ε₀ = 这一轮撞到了不动点 ⇒ 立即可以换基**（不是终局，ε₀ 只在基 2 才是终局）。
 *   配套规则两处（缺一不可，否则死锁）：
 *     ① `canRebase` 不能再用 reachedEps0 挡门（见 logic.canRebase 注释）；
 *     ② `rebaseS0` 必须清掉 reachedEps0，否则换到基 2 后后继/极限全停，ε₀ 段直接没了。
 * （base7 原为 ω^ω = 7^7 = 117649，中间这档落差过大，2026-10-03 收窄到 ω⁵·2。）
 */
export const S0_REBASE_GATE: Record<number, Ordinal> = {
  10: W(2),
  // ω^k·c 的 CNF 写法：exponent 是**自然数 k**（fromNat(k)），系数 c ——
  // 若误用 W(k)（= ω^k）当指数，就变成了 ω^(ω^k)·c（大得多，且计数等价量溢出 ⇒ Infinity）
  9: cnf([{ exp: fromNat(3), coef: 3 }]),
  8: cnf([{ exp: fromNat(4), coef: 4 }]),
  7: cnf([{ exp: fromNat(5), coef: 2 }]),
  // ω^(ω+1)：指数是 **ω + 1**（不是 ω^(ω^1)+1 —— 后者是 ω^(ω^ω+1)，量级差很远）
  6: omegaPow(add(omegaPow(fromNat(1)), fromNat(1))),
  // ω^(ω·2)：指数是 **ω·2**，即 cnf 单项 {exp: ω^1, coef: 2}
  5: omegaPow(cnf([{ exp: fromNat(1), coef: 2 }])),
  // ω^(ω·3)：指数是 **ω·3**，即 cnf 单项 {exp: ω^1, coef: 3}
  4: omegaPow(cnf([{ exp: fromNat(1), coef: 3 }])),
  // ω^(ω^ω)：指数是 **ω^ω** —— outer 是 omegaPow(ω^ω)，内两层分别是 omegaPow(ω^1)、omegaPow(0-index-ω)
  3: omegaPow(OMEGA_OMEGA),
};

// ───────────────────────── 基 2 专属：双层对数经济 ─────────────────────────
// 用户定案（2026-10-04）：基 2 是终局段，要「尽可能长」。但升级若照旧用序数计价，
// 在基 2 下 ω^ω 就是 ε₀ ⇒ 一步到顶、毫无内容。故基 2 换一套**独立经济**：
//   · 内部真实计数 n 照旧 +1×倍率；**显示出来的计数取双层对数** D(n) = log₂(log₂ n)。
//   · 升级价格直接用**显示单位 D** 计价：1 / 1.5 / 2 / 2.5 / 3 / 3.5。
//   · **实际扣除**：D_new = D(n) − price，n = ⌊2^(2^D_new)⌋（扣除后对内部计数向下取整）。
//     ⇒ 每次购买都会把 n 打回 2（显示 0），「花光重来」—— 这就是锯齿感的来源。
//   · 倍率**累乘**：第 n 个升级给 ×MULT[n-1]，总倍率 = 累乘。
//
// ── 四圈循环（用户定案 2026-10-04 二次定案：延长 base2 阶段） ──
//   旧版：攒一次 65536 → 连按 4 次极限 → 涌升（单圈，节奏太短）。
//   现版：**每次极限后回到「后继」**——计数清零、6 个升级全部重置（要重新买一遍），
//         并发放一份**跨圈保留**的后继倍率 ×√2（累乘 ⇒ 第 k 次极限后 = (√2)^k）。
//         α 仍按脚本阶梯逐格推进（ω+2 → ω·2 → ω² → ω^ω），走满 4 格即涌升。
//   ⇒ 4 圈，每圈都要从零攒满 65536、重买 6 个升级；每圈比上圈快一点点（√2 补偿）。
//   实测（最优打法、一有钱就买）：单圈 = 1283 / 907 / 643 / 456 次后继，合计 **3289** 次
//   （旧版单圈 579 次 ⇒ 约 5.7 倍时长）。

/** 基 2 硬上限：n = 2^(2^4) = 65536，此时显示计数恰为 4 ⇒ 提示「已达硬上限」 */
export const S0_BASE2_CAP_N = 65536;
/** 显示计数的满分（D = 4） */
export const S0_BASE2_NEED = 4;
/** 基 2 升级个数 */
export const S0_BASE2_UP_COUNT = 6;
/**
 * 第 n 个升级给的倍率（累乘）。用户定案 2026-10-04：**下调**（旧 `[1,2,2,3,3,4]=144`）
 * —— 倍率越小，每圈要按的后继越多，配合四圈循环把 base2 拉长到 ~5.7 倍。
 * 满配 = 1·2·2·2·2.5·3 = **60**。第 1 个仍给 ×1（「按钮已损坏」的叙事留白）。
 */
export const S0_BASE2_UP_MULT = [1, 2, 2, 2, 2.5, 3] as const;
/** 第 n 个升级的价格（显示单位 D） */
export const S0_BASE2_UP_PRICE = [1, 1.5, 2, 2.5, 3, 3.5] as const;
/**
 * 每次极限后发放的**跨圈持久**后继倍率的底数：√2。
 *   第 k 次极限后，后继增益再乘 (√2)^k（升级会重置，这一份不会）。
 *   ⇒ 「每次重来都比上次强」，后一圈攒满 65536 所需的后继次数逐圈递减（1283→907→643→456）。
 */
export const S0_BASE2_ROOT2 = Math.SQRT2;

/** 显示计数 D(n) = log₂(log₂ n)；n < 2 一律 0 ⇒ n = 0 / 1 / 2 都显示 0 */
export function displayCountOf(n: number): number {
  if (!(n >= 2)) return 0;
  return Math.log2(Math.log2(n));
}
/** D 的反函数（购买扣除后还原内部计数）：n = 2^(2^D) */
export function countFromDisplay(d: number): number {
  return Math.pow(2, Math.pow(2, d));
}

/**
 * 基 2 的**脚本化** α 阶梯（4 次极限）。
 *
 * ⚠️ 刻意不走 V_2 派生：base2 下系数必须 < 2，而 ω+2、ω·2 的系数都是 2 ——
 *    它们**不在 V₂ 的像里**，严格双射下根本不存在。用户拍板「就按字面写」：
 *    基 2 是「按钮被损坏、效力被减弱」的故障态，双射破裂正是叙事的一部分，
 *    且这四个词的语义阶梯（有限加 → 乘法 → 幂 → 幂塔）最直观。
 *    末项 ω^ω 恰是 base2 的 ε₀ 触发点（epsDepthFor(2)=2），可无缝接上涌升。
 */
const OM1 = omegaPow(fromNat(1)); // ω
export const S0_BASE2_LADDER: readonly Ordinal[] = [
  add(OM1, fromNat(2)),                    // ω+2
  cnf([{ exp: fromNat(1), coef: 2 }]),     // ω·2
  cnf([{ exp: fromNat(2), coef: 1 }]),     // ω²
  OMEGA_OMEGA,                             // ω^ω（base2 的 ε₀）
];
/** 阶梯每步的纯文本兜底（乱码期间 KaTeX 会被绕开，用这串） */
export const S0_BASE2_LADDER_TEXT = ['ω+2', 'ω·2', 'ω²', 'ω^ω'] as const;

/**
 * 五条升级（`upgrades` 是单一来源：逻辑、UI、存档、测试都读它）。
 * 全部用本层 0阶货币 n 购买（用户 Q2：0阶货币买 0阶升级）；
 * 价格 = **序数**（阶梯按上），购买时按 ordinalToCount 折算的计数等价量扣减 n。
 * 效果**不做深度缩放**（平衡层重做）：
 *   - 后继增益 = 步伐 + 共鸣加成（底数 +0.5/级）
 *   - 自动后继 = 固定阶梯（步/刷新）
 *   - 极限深化 = 1 + lv 份 ω-内容（自然 1 份，无缩放）
 *   - 序数共鸣 = 把后继增益的底数 +0.5/级
 *   - 自动极限 = 触发开关
 */
export const S0_UPGRADES: readonly S0UpgradeDef[] = [
  {
    id: 'succGain',
    name: '后继增益 Gain',
    unlockBase: 9,
    max: 8, // 最低基（≤3）时的天花板；当前基的有效上限见 s0UpgradeMax
    ...mkPrice(1, 2), // 每级 ×ω² ⇒ E = 1,3,5,… ⇒ 计数 base^E
    // 实际值 = (底数 + 共鸣加成)^lv（底数会被共鸣抬高 ⇒ 这里只给未共鸣的基准值）
    baseEffect: (lv) => Math.pow(S0_SUCC_GAIN_BASE, lv),
    effectText: (lv) => `后继 n += ${S0_SUCC_GAIN_BASE}^${lv}（共鸣抬高底数）`,
  },
  {
    id: 'succStream',
    name: '后继流 Stream',
    unlockBase: 9,
    max: 7, // 最低基（≤3）时的天花板；当前基的有效上限见 s0UpgradeMax
    ...mkPrice(2, 2), // 初始价 ω²、每级 ×ω² ⇒ E = 2,4,6,… ⇒ 计数 base^E
    baseEffect: (lv) => pick(S0_SUCC_RATE_STEPS, lv),
    // 实际速度 v = 速率 × 步长（步长随共鸣/增益变动 ⇒ 真实数值由 UI 用 succVelocityOf 实时拼装）
    effectText: (lv) => `自动后继 ${pick(S0_SUCC_RATE_STEPS, lv)} 步/秒`,
  },
  {
    id: 'limitDeepen',
    name: '极限深化 Deepen',
    unlockBase: 8,
    max: 6, // 最低基（≤3）时的天花板；当前基的有效上限见 s0UpgradeMax
    ...mkPrice(2, 2), // E = 2,4,6,8,10,12 ⇒ 计数 base^E
    baseEffect: (lv) => 1 + lv,
    effectText: (lv) => `每次极限并入 ${1 + lv} 份 ω-内容`,
  },
  {
    id: 'resonance',
    name: '序数共鸣 Resonance',
    unlockBase: 6, // 用户定案 2026-10-03：从基 8 延后到基 6（价 ω⁶ 太贵，放到低基才买得起）
    max: 4, // 天花板：仅基 ≤3 可用（`s0UpgradeMax` 在其它基下仍返回 2）
    // 初始价 ω⁶、每级 ×ω² ⇒ E = 6, 8, 10, 12 ⇒ 计数 base^E
    ...mkPrice(6, 2),
    baseEffect: () => 0, // 效果 = 后继增益的**底数** +0.5/级（在指数上，不是加在结果上）
    effectText: (lv) => `后继增益底数 ${S0_SUCC_GAIN_BASE} → ${S0_SUCC_GAIN_BASE + S0_RESONANCE_BASE_STEP * lv}`,
  },
  {
    id: 'autoLimit',
    name: '自动极限 AutoLimit',
    unlockBase: 5, // 用户定案 2026-10-03：从基 7 延后到基 5
    max: 1,
    // 用户定案 2026-10-03：价由 ω⁴ 上调为 ω⁶（E = 6 ⇒ 计数 base⁶；base5 = 15625、base3 = 729）
    ...mkPrice(6, 0),
    baseEffect: () => 1,
    effectText: () => 'n ≥ base 时自动极限',
  },
  {
    id: 'limitBreak',
    name: '破限 Break',
    unlockBase: 3, // 用户定案 2026-10-04：基 3 专属（最深的那一轮才需要「打破上限」）
    max: 4,
    // ω^(ω²+2) / ω^(ω²+ω+2) / ω^(ω²+ω·2+2) / ω^(ω²+ω·3+2)（见 limitBreakPriceOrdinal）
    price: limitBreakPriceOrdinal,
    priceCount: (lv: number, base: number): number => ordinalToCount(limitBreakPriceOrdinal(lv), base),
    baseEffect: () => 0, // 不给直接加成 —— 效果 = 抬上限（见 s0UpgradeMax 的 limitBreak 参数）
    effectText: (lv) =>
      lv >= 4 ? `前两个升级上限 +${lv}，并对共鸣(第4个) +1` : `前两个升级上限 +${lv}`,
  },
];

export const S0_UPGRADE_BY_ID: Record<S0UpgradeId, S0UpgradeDef> = Object.fromEntries(
  S0_UPGRADES.map((u) => [u.id, u])
) as Record<S0UpgradeId, S0UpgradeDef>;

/**
 * 升级在当前基数下的**有效**等级上限（换基进度门控 + 破限加成）。
 * **前三条升级的上限随换基进度逐级抬高**（用户定案 2026-10-03）：
 *   - succGain  ：基 9 → 3，基 8 → 4，基 7 → 5，基 6/5 → 6，基 4 → 7，基 ≤ 3 → 8
 *   - succStream：基 9 → 2，基 8 → 3，基 7 → 4，基 6/5 → 5，基 4 → 6，基 ≤ 3 → 7
 *   - limitDeepen：基 8 → 1，基 7 → 2，基 6 → 3，基 5 → 4，基 4 → 5，基 ≤ 3 → 6
 *   - resonance：恒定 2（2026-10-04 二次定案：基 3 初始上限回到 2，不再一次性 +2）
 *   以上为**换基进度上限**；最终有效上限还会被函数内的「换基门槛约束」再压一层
 *   （见下方 gateCap）：若某级价格 ≥ 当前换基门槛，上限降到「价格 < 门槛」的那一级。
 *   例如 base9 实际 Gain/Stream = 2/1、base6 Resonance = 1。
 * autoLimit 只有 1 级，不随基变动。
 *
 * **破限 limitBreak（2026-10-04）**：加成由 `limitBreakBonusTo` 分配 ——
 *   第 1~3 级只抬前两个（succGain / succStream）各 +1/级；第 4 级额外抬第 4 个（resonance）+1。
 *   因此本函数必须拿到「当前破限等级」才能给出**有效**上限 —— 纯 (id, base) 的调用
 *   一律按「未破限」计。⚠️ 漏传会让「买了破限后买不动 eg. succGain 第 9 级」
 *   （upgradeCostOf 用的正是它，见 logic.upgradeCostOf）。
 *
 * ⚠️ 抬高上限时必须同步检查「阶梯数组长度 ≥ 上限 + 1」（下标 = 等级，含 lv=0 档），
 * 否则最高级会被 clamp 回上一档 ⇒ 买了没提升（2026-10-03 已修过一次，冒烟有断言守着）。
 */
export function s0UpgradeMax(id: S0UpgradeId, base: number, limitBreak = 0): number {
  // 换基进度上限（越往低基解锁越多 / 天花板越高）
  const baseCap =
    id === 'succGain'
      ? (base <= 3 ? 8 : base <= 4 ? 7 : base <= 6 ? 6 : base <= 7 ? 5 : base <= 8 ? 4 : 3)
      : id === 'succStream'
        ? (base <= 3 ? 7 : base <= 4 ? 6 : base <= 6 ? 5 : base <= 7 ? 4 : base <= 8 ? 3 : 2)
        : id === 'limitDeepen'
          ? (base <= 3 ? 6 : base <= 4 ? 5 : base <= 5 ? 4 : base <= 6 ? 3 : base <= 7 ? 2 : 1)
          : id === 'resonance'
            ? 2 // 恒定 2；破限第 4 级再由 limitBreakBonusTo 给 +1
            : (S0_UPGRADE_BY_ID[id]?.max ?? 0);
  const progCap = baseCap + limitBreakBonusTo(id, limitBreak);
  // 门槛约束（用户 2026-10-06）：某升级「最高级价格 ≥ 当前换基门槛」⇒ 最大等级降到
  // 「价格 < 门槛」的那一级。语义：攒到能买该级之前就已达标换基，该级实际买不到。
  // 门槛约束（用户 2026-10-06）：某升级「最高级价格 ≥ 当前换基门槛」⇒ 最大等级降到
  // 「价格 < 门槛」的那一级。语义：攒到能买该级之前就已达标换基，该级实际买不到。
  // ⚠️ **破限 limitBreak 豁免**：它是基 3 专属的「打破上限」机制，价格本就刻意定在
  //    base3 的深渊区（L1 = ω^(ω²+2) @base3 计数 = 3²⁹ ≈ 6.9e13，远大于换基门槛 ω^(ω^ω)=3²⁷≈7.6e12）。
  //    若对它施加门槛约束 ⇒ 有效上限被压到 0（完全买不到），整个破限机制失效。
  //    破限的「负担能力」由 base3 攒到 ε₀ 的漫长过程天然门控，不归换基门槛管，故跳过。
  const gate = S0_REBASE_GATE[base];
  if (gate && id !== 'limitBreak') {
    const gateCount = ordinalToCount(gate, base);
    const def = S0_UPGRADE_BY_ID[id];
    if (def) {
      let gateCap = 0;
      for (let L = 1; L <= progCap; L++) {
        if (def.priceCount(L, base) < gateCount) gateCap = L;
        else break;
      }
      return gateCap;
    }
  }
  return progCap;
}

/** 升级是否已随换基进度解锁（base ≤ unlockBase 时可见可买） */
export function isUpgradeUnlocked(id: S0UpgradeId, base: number): boolean {
  const def = S0_UPGRADE_BY_ID[id];
  return !!def && base <= def.unlockBase;
}

/**
 * S0 已不再使用 Θ/Φ 节奏引擎（用户定案：S0 要最简、可复用）。
 * 保留 targets 仅为满足 LayerModule 接口；其字段对 S0 无实际作用。
 */
export const S0_TARGETS: LayerTargets = { tStart: 60, tEnd: 60, runs: 8, tOps: 5 };
