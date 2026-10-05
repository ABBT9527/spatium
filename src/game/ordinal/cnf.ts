/**
 * Cantor 范式（ω 基）序数，严格 < ε₀。
 *
 * 双射约束（保留的两条普适约束之一，数学正确性前提）：
 *   每个系数 coef 是自然数（整数，1 ≤ coef < ω）。
 *   每个指数 exp 递归地也是一个 < ε₀ 的序数（故 exp 永不为 ε₀ 自身）。
 *
 * ε₀ = 第一个不动点 ω^ε₀ = ε₀，用独立的 'eps0' 标签表示，
 * 避免在有限树里表达无限递归结构。任何 cnf 序数的指数都 < 它自身 < ε₀，
 * 所以 cnf 项内不会出现 'eps0'。
 *
 * 数学正确性：CNF 给出 ε₀ 与其标准形之间的一一对应（双射），
 * 因此任何 < ε₀ 的序数有唯一 CNF —— 这正是「双射」的精确含义。
 */

export type Ordinal =
  | { t: 'zero' }
  | { t: 'cnf'; terms: OrdTerm[] } // 规范降序、coef≥1、exp 为 Ordinal（非 'eps0'）
  | { t: 'eps0' };

export interface OrdTerm {
  exp: Ordinal;
  /** 自然数（整数 ≥ 1，< ω）。双射约束要求此处绝不能 ≥ ω。 */
  coef: number;
}

export const ZERO: Ordinal = { t: 'zero' };
export const EPS0: Ordinal = { t: 'eps0' };

export function isEps0(a: Ordinal): boolean {
  return a.t === 'eps0';
}
export function isZero(a: Ordinal): boolean {
  return a.t === 'zero';
}

/** 自然数 → 序数（n = ω^0·n）。n ≤ 0 返回 0。 */
export function fromNat(n: number): Ordinal {
  if (n <= 0) return ZERO;
  return { t: 'cnf', terms: [{ exp: ZERO, coef: Math.floor(n) }] };
}

/**
 * 规范化：剔除零系数、剔除 ε₀ 指数（保险）、按 exp 严格降序、
 * 合并同幂项，最终若为空则为 0。
 */
export function normalize(termsIn: OrdTerm[]): Ordinal {
  const terms = termsIn
    .map((t) => ({ exp: t.exp, coef: Math.floor(t.coef) }))
    .filter((t) => t.coef >= 1)
    .filter((t) => t.exp.t !== 'eps0')
    .sort((a, b) => -cmp(a.exp, b.exp));
  const merged: OrdTerm[] = [];
  for (const t of terms) {
    const last = merged[merged.length - 1];
    if (last && cmp(last.exp, t.exp) === 0) last.coef += t.coef;
    else merged.push({ exp: t.exp, coef: t.coef });
  }
  const cleaned = merged.filter((t) => t.coef >= 1);
  return cleaned.length === 0 ? ZERO : { t: 'cnf', terms: cleaned };
}

/** 从项构造规范序数。 */
export function cnf(terms: OrdTerm[]): Ordinal {
  return normalize(terms);
}

/** 序数比较：< 返回 -1，= 返回 0，> 返回 1。 */
export function cmp(a: Ordinal, b: Ordinal): number {
  if (a.t === 'eps0' && b.t === 'eps0') return 0;
  if (a.t === 'eps0') return 1;
  if (b.t === 'eps0') return -1;
  if (a.t === 'zero' && b.t === 'zero') return 0;
  if (a.t === 'zero') return -1;
  if (b.t === 'zero') return 1;
  const A = a.terms;
  const B = b.terms;
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const ta = A[i];
    const tb = B[i];
    if (!ta && !tb) return 0;
    if (!ta) return -1;
    if (!tb) return 1;
    const c = cmp(ta.exp, tb.exp);
    if (c !== 0) return c;
    if (ta.coef !== tb.coef) return ta.coef < tb.coef ? -1 : 1;
  }
  return 0;
}

/** 后继 α → α+1。 */
export function succ(a: Ordinal): Ordinal {
  if (a.t === 'zero') return fromNat(1);
  if (a.t === 'eps0') return EPS0; // 封顶于 ε₀
  const terms = a.terms.slice();
  const last = terms[terms.length - 1];
  if (last.exp.t === 'zero') {
    terms[terms.length - 1] = { exp: ZERO, coef: last.coef + 1 };
    return normalize(terms);
  }
  return normalize([...terms, { exp: ZERO, coef: 1 }]);
}

/**
 * 序数加法 a + b（CNF，严格 < ε₀）。
 *
 * 用途：S0 计数层「极限」把计数的 ω-内容并入已实现序数 α —— 这是
 * 遗传进位（10→ω、ω+10→ω·2）的数学内核，α 只在极限时按此式变更，
 * 后继只动计数 n、绝不直接改 α（否则 α 又变回 V_b(n) 的装饰）。
 *
 * 算法（β = b，f = β 的领先指数）：
 *   α = α_high + α_low，其中 α_high 的指数均 > f，α_low 的指数均 ≤ f。
 *   α + β = α_high + (α_low + β)。
 *   α_low（指数 ≤ f）+ β（= b0·ω^f + β_tail）：
 *     - 若 α_low 含指数 = f 的项（系数 c），合并为 (c + b0)·ω^f；
 *     - 否则 α_low 整体被 ω^f·b0 吸收（α_low < ω^f ⇒ α_low + ω^f·b0 = ω^f·b0）；
 *   再把 β_tail（指数 < f）接在后面。最后 normalize 按 exp 降序重排合并。
 * 封顶：任一侧为 ε₀ ⇒ 结果 ε₀。
 */
export function add(a: Ordinal, b: Ordinal): Ordinal {
  if (a.t === 'zero') return b;
  if (b.t === 'zero') return a;
  if (a.t === 'eps0' || b.t === 'eps0') return EPS0;
  const f = leadingExp(b); // β 的领先指数
  const high: OrdTerm[] = [];
  const low: OrdTerm[] = [];
  for (const t of a.terms) {
    if (cmp(t.exp, f) > 0) high.push(t);
    else low.push(t);
  }
  const b0 = b.terms[0].coef;
  const bTail = b.terms.slice(1); // 指数均 < f
  const idxF = low.findIndex((t) => cmp(t.exp, f) === 0);
  let lowPart: OrdTerm[];
  if (idxF >= 0) {
    const merged = low.slice();
    merged[idxF] = { exp: f, coef: low[idxF].coef + b0 };
    lowPart = [...merged, ...bTail];
  } else {
    // α_low 指数均 < f，整体被 ω^f·b0 吸收，仅留 β 的尾部
    lowPart = [{ exp: f, coef: b0 }, ...bTail];
  }
  return normalize([...high, ...lowPart]);
}

/** 指数运算 ω^a。 */
export function omegaPow(a: Ordinal): Ordinal {
  if (a.t === 'zero') return fromNat(1); // ω^0 = 1
  if (a.t === 'eps0') return EPS0; // ω^ε₀ = ε₀
  return cnf([{ exp: a, coef: 1 }]);
}

/** 主指数（leading exponent）：zero→0；cnf→首项 exp；eps0→ε₀。 */
export function leadingExp(a: Ordinal): Ordinal {
  if (a.t === 'cnf' && a.terms.length > 0) return a.terms[0].exp;
  return a;
}

/** Sup（取极限）：跳到下一个主序数 ω^{leadingExp+1}。 */
export function sup(a: Ordinal): Ordinal {
  if (a.t === 'eps0') return EPS0;
  const e1 = succ(leadingExp(a));
  return omegaPow(e1);
}

/**
 * 幂塔高度：纯幂 ω^{e}（单项、系数 1、e 非 0）记为 1 + height(e)；
 * 其余（多项 / ω^k 基底幂 / 0）记为 1。ε₀ 记为 ∞。
 * 用途：游戏内"抵达对角不动点"的封顶判定。
 */
function towerHeight(a: Ordinal): number {
  if (a.t === 'eps0') return Infinity;
  if (a.t !== 'cnf' || a.terms.length !== 1) return 1;
  const t = a.terms[0];
  if (t.coef !== 1 || t.exp.t === 'zero') return 1; // ω^1, ω^2 等基底幂
  return 1 + towerHeight(t.exp);
}

/**
 * Fix（不动点）：ω^a。
 * 数学事实：ε₀ = sup{ω, ω^ω, ω^ω^ω, …} 是极限，有限步内 ω^a 永远 > a。
 * 游戏内封顶：当结果幂塔高度 ≥ 4（即已爬上对角 ω↑↑n）时直接返回 ε₀——
 * 这是玩家"抵达不动点"的确定性瞬间，对应设计里 Fix 即通关动作。
 */
export function fix(a: Ordinal): Ordinal {
  const t = omegaPow(a);
  if (t.t === 'cnf' && towerHeight(t) >= 4) return EPS0;
  return t;
}

/**
 * 领先塔的 ω-嵌套深度（"离 ε₀ 还有几步"的度量）：
 *   有限数 → 0；ω → 1；ω^ω → 2；ω^{ω^ω} → 3；ω^{ω^{ω^ω}} → 4 …
 * 与 hereditaryToOrdinal 的封顶口径一致（深度 ≥ base 即抵达 ε₀）。
 */
export function omegaDepth(a: Ordinal): number {
  if (a.t !== 'cnf' || a.terms.length === 0) return 0;
  const lead = a.terms[0].exp;
  if (lead.t === 'zero') return 0;
  return 1 + omegaDepth(lead);
}

/**
 * 序数**最大项的指数**的数值高度（用于「序数共鸣」的对数增益曲线）。
 *   - 0 → 0
 *   - 有限指数 ω^k（k 为自然数）→ k（如 ω^2 → 2、ω^10 → 10）
 *   - 超越指数（≥ ω，如 ω^ω）→ 大常数 + ω-深度，封顶避免溢出
 * S0 全程 α 多为有限指数（ω^k），故 h 平滑增长；仅到 ε₀ 封顶时跳到大值。
 */
export function leadingExpHeight(a: Ordinal): number {
  if (a.t === 'zero') return 0;
  if (a.t === 'eps0') return 1e6;
  return expHeight(a.terms[0].exp);
}

function expHeight(e: Ordinal): number {
  if (e.t === 'zero') return 0;
  if (e.t === 'eps0') return 1e6;
  // ω^k（单顶、系数 1、指数 0）：返回 k
  if (
    e.terms.length === 1 &&
    e.terms[0].coef === 1 &&
    e.terms[0].exp.t === 'zero'
  ) {
    return e.terms[0].coef;
  }
  return 1e3 + omegaDepth(e);
}

/**
 * 抵达 ε₀ 封顶的 ω-深度门槛 —— **不是常量，而是当前底数**。
 *
 * 设计定案（2026-10-02，用户拍板；权威出处 `testFile/序数渲染测试.html:36`）：
 *   「底数 b 决定 ω = b 与 ε₀ = b↑↑b。例如 b = 2 时 ω = 2、ε₀ = 4；
 *     b = 3 时 ω = 3、ε₀ = 3^27；b = 4 时 ε₀ = 4↑↑4。」
 * 即 `ε₀ ⟺ 领先幂塔高度 ≥ base ⟺ n ≥ base↑↑base`：
 *   base = 2 → n ≥ 4      （恰好 4 次后继；旧常量实现错记为 16）
 *   base = 3 → n ≥ 3^27   （= 3↑↑3；同辈项目「寻数之序」的 ε₀ 下标）
 *   base ≥ 4 → 天文数，Number 域不可达 ⇒ 只能靠**换基**把门槛降下来。
 *
 * 这条修正是「换基即跃升」的数学根据：低基让幂塔提前塌陷，玩家用同一计数
 * 换到更低的基就白得一大截序数。
 */
export function epsDepthFor(base: number): number {
  return Math.max(2, Math.floor(base));
}

/**
 * base↑↑base 的自然数下标（ε₀ 的计数阈值）；超出 Number 安全域时返回 null。
 * 用途：S0 在低基下把计数**夹在 ε₀ 阈值**上，使「4 次后继」读作 n = 4 而非溢出。
 */
export function eps0NatIndex(base: number): number | null {
  const b = base < 2 ? 2 : Math.floor(base);
  let v = 1;
  for (let i = 0; i < b; i++) {
    v = Math.pow(b, v);
    if (!Number.isSafeInteger(v)) return null;
  }
  return v;
}

/**
 * 遗传基数映射 V_b —— S0 计数层的唯一序数构造。
 *
 * 把自然数 n 写成 base 进制的**遗传表示**（指数递归地也用 base 进制），
 * 再把 base 替换成 ω，得到 < ε₀ 的序数。关键性质：
 *   - 同一个 n，base 越小 ⇒ 序数越大（低位更早"膨胀"成幂塔）
 *     ⇒ 「换基」= 同一计数下序数免费跃升，这正是 S0 的进度杠杆。
 *   - base = 2 时门槛最低：1 → ω → ε₀（**n = 4，恰 4 次后继**）。
 *   - 封顶：领先塔 ω-深度 ≥ epsDepthFor(base)（= base）时返回 ε₀（游戏内"抵达不动点"）。
 *
 * 递归深度 = log_base(n)，对 n ≤ 2^53 很小；封顶只在最外层判定，
 * 保证不会把 ε₀ 当作指数塞进 CNF（双射约束：指数不得为 ε₀）。
 */
export function hereditaryToOrdinal(n: number, base: number): Ordinal {
  return heredWalk(n, base, 0);
}

function heredWalk(n: number, base: number, depth: number): Ordinal {
  if (!(n > 0)) return ZERO;
  const b = base < 2 ? 2 : Math.floor(base);
  const terms: OrdTerm[] = [];
  let m = Math.floor(n);
  let place = 0;
  while (m > 0) {
    const d = m % b;
    if (d > 0) terms.push({ exp: heredWalk(place, b, depth + 1), coef: d });
    m = Math.floor(m / b);
    place += 1;
  }
  const o = cnf(terms);
  if (depth === 0 && omegaDepth(o) >= epsDepthFor(b)) return EPS0;
  return o;
}

/**
 * `hereditaryToOrdinal` 的反函数（计数侧）：返回**最小自然数 n** 使得
 * `V_base(n) ≥ target`（序数比较，cmp ≥ 0）。用于把「序数价格」翻译成
 * 当前基数下的「计数阈值」与花费扣减量。
 *
 * 例（ω² = omegaPow(fromNat(2))）：
 *   base 10 → 100（10²）；base 9 → 81（9²）；base 2 → 4（封顶 ε₀ ≥ ω²）。
 * 低基下序数封顶会让阈值坍缩（base 2：n=4 即 ε₀，覆盖所有 ω^k 价）。
 *
 * 实现（2026-10-03 重写）：**指数探测上界 + 二分下界**。
 *   旧实现是「从 1 线性扫到 5e6」—— 门槛提到 ω^(ω·2)（base5 ⇒ 5¹⁰ ≈ 9.77e6）后
 *   单次调用实测 **41 秒**且因超出 5e6 返回 Infinity（升级永远买不起）。改为二分后
 *   是 O(log n) 次 V_b 求值，且不再有 5e6 的人为上限。
 *
 * 二分的前提：**V_b(n) 对 n 单调不减**（已实测：9 个基 × n ≤ 2e5，0 反例）。
 * 注意是「不减」而非「严格增」——ε₀ 封顶后一大段 n 会给出同一个序数，
 * 所以这里找的是**下界**（最小满足者），用标准的 lower-bound 二分。
 *
 * 结果按 `base:序数串` 缓存（S0 价目/门槛固定、基数只在换基时变，命中率极高）。
 */
const _countCache = new Map<string, number>();
export function ordinalToCount(target: Ordinal, base: number): number {
  const b = base < 2 ? 2 : Math.floor(base);
  const key = `${b}:${toString(target)}`;
  const hit = _countCache.get(key);
  if (hit !== undefined) return hit;

  const reaches = (n: number): boolean => cmp(hereditaryToOrdinal(n, b), target) >= 0;

  // ① 指数探测：1, 2, 4, 8 … 找到首个满足的 hi，同时记下「已确认不满足」的区间上界 lo-1
  let lo = 1;
  let hi = -1;
  let probe = 1;
  for (;;) {
    if (reaches(probe)) { hi = probe; break; }
    lo = probe + 1;
    if (probe >= Number.MAX_SAFE_INTEGER) break;
    probe = Math.min(probe * 2, Number.MAX_SAFE_INTEGER);
  }
  if (hi < 0) {
    _countCache.set(key, Infinity);
    return Infinity;
  }

  // ② 在 [lo, hi] 内二分出最小满足者（V_b 单调不减 ⇒ 可行）
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (reaches(mid)) hi = mid; else lo = mid + 1;
  }
  _countCache.set(key, hi);
  return hi;
}

function renderExp(e: Ordinal): string {
  if (e.t === 'zero') return '0';
  if (e.t === 'eps0') return 'ε₀';
  // 有限指数不加括号（保持既有惯例：ω^1）；非有限指数加括号，
  // 消除 "ω^ω^1" 这类歧义（ω^(ω^1) 还是 (ω^ω)^1）。
  const finite = e.t === 'cnf' && e.terms.length === 1 && e.terms[0].exp.t === 'zero';
  return finite ? toString(e) : `(${toString(e)})`;
}

/** 序数 → 可读字符串（CNF 形式，如 "ω^ω·2 + 3"）。 */
export function toString(a: Ordinal): string {
  if (a.t === 'zero') return '0';
  if (a.t === 'eps0') return 'ε₀';
  const parts = a.terms.map((t) => {
    if (t.exp.t === 'zero') return String(t.coef); // ω^0·c = c
    const base = `ω^${renderExp(t.exp)}`;
    return t.coef === 1 ? base : `${base}·${t.coef}`;
  });
  return parts.join(' + ');
}

/**
 * 里程碑阶梯：返回长度 len 的序数数组，从 0 单调递增到 ε₀。
 * 用途：教学/沙盒里展示"一段真正在爬的序数阶梯"，末项恒为 ε₀。
 * 间隔用「有限段 + ω 幂塔（fix 迭代）+ 主序数跳（sup 填充）」铺成。
 * 注：S0 已改为「计数 + 换基」，游戏内不再用本函数；保留供 sandbox/测试。
 */
export function buildLadder(len: number): Ordinal[] {
  const out: Ordinal[] = [ZERO];
  for (let n = 1; n <= 12 && out.length < len - 1; n++) out.push(fromNat(n));
  const omega = omegaPow(fromNat(1));
  out.push(omega);
  // 幂塔：ω → ω^ω → ω^{ω^ω} → … 接近 ε₀
  let chain = omega;
  const room = len - out.length - 1;
  const towerSteps = Math.max(1, Math.floor(room * 0.6));
  for (let i = 0; i < towerSteps; i++) {
    chain = fix(chain);
    if (chain.t === 'eps0') break;
    out.push(chain);
  }
  // 用 sup 在主序数之间填充，丰富阶梯但不改变终点是 ε₀
  while (out.length < len - 1) {
    const last = out[out.length - 1];
    const nx = sup(last);
    if (nx.t === 'eps0') break;
    out.push(nx);
  }
  out.push(EPS0);
  return out.slice(0, len);
}

/** 沿阶梯取第 round 项（round 越界则取末项 ε₀）。 */
export function milestone(ladder: Ordinal[], round: number, runs: number): Ordinal {
  if (ladder.length === 0) return ZERO;
  const idx = Math.min(round, runs, ladder.length - 1);
  return ladder[idx];
}

/**
 * 双射不变量检查（开发期断言 / sandbox 展示用）。
 * 返回 true 当且仅当：所有 coef 为自然数、项严格降序、指数递归合法。
 */
export function checkBijection(a: Ordinal): boolean {
  if (a.t !== 'cnf') return true;
  let prevExp: Ordinal | null = null;
  for (const t of a.terms) {
    if (!Number.isInteger(t.coef) || t.coef < 1) return false;
    if (t.exp.t === 'eps0') return false;
    if (prevExp !== null && cmp(t.exp, prevExp) >= 0) return false;
    if (!checkBijection(t.exp)) return false;
    prevExp = t.exp;
  }
  return true;
}
