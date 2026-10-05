/**
 * Headless 冒烟：在 Node 里跑完整 S0 / S1 逻辑。
 *
 * 存在意义：`src/game/` 是纯 TS、零 Vue 依赖 ⇒ 能直接跑完整模拟。
 * 这是「数据 / 逻辑 / 渲染分离」最大的实际收益——否则调一轮数值要人工玩一个月。
 *
 * S0（计数层）：后继 n += succGain（**只动计数，绝不改 α**）/ 极限把计数 ω-内容并入 α
 *               （遗传进位：n ← n mod base）/ 换基 base−1（重置 n/α/升级）；
 *               ε₀ = base↑↑base ⇒ base 2 时攒到 n = 4 再极限即达 ε₀。
 *               换基门槛 = α ≥ S0_REBASE_GATE[base]（门槛**随换基进度递增**：
 *               10→ω²、9→ω³·3、8→ω⁴·4、7→ω⁵·2、6→ω^(ω+1)、5→ω^(ω·2)、4→ω^(ω·3)）
 *               ⇒ 每基需**多次**极限才能达标（贵的基改走「一次性大极限」跳过实跑）。
 *               升级**随换基进度解锁**（基10无 / 基9 succGain / 基8 succStream /
 *               基7 limitDeepen / 基6 序数共鸣 / 基5 autoLimit / 基3 破限）；效果**无深度缩放**（线性）。
 *               前三条升级上限随基抬高（succGain 9→3、8→4、7→5、6/5→6、4→7、≤3→8；
 *               succStream 8→3、7→4、6/5→5、4→6、≤3→7；limitDeepen 7→2、6→3、5→4、4→5、≤3→6）；
 *               第四条 resonance 6..4→2、≤3→4（一次性 +2）。
 *               破限 limitBreak（2026-10-04，基 3 专属）：每级让**前三条**升级的等级上限 +1，
 *               上限 4 ⇒ 基 3 下三条上限 8/7/6 → 12/11/10；价 ω^(ω²+ω·(lv−1))；
 *               ⚠️ `s0UpgradeMax` / `upgradeCostOf` 必须传破限等级，否则「买了破限却买不动升级」。
 *               设置面板的调试模式可直接注入计数（debugAddCount / debugAddOrdinalCount）。
 *               价格序数 = **ω^(V_base(E))**（计数 = base^E）⇒ 严格递增、不会饱和；
 *               旧写法 ω^E 在 E ≥ base 时会坍缩成同价（甚至 Infinity）。
 *               自动后继 = **连续流 v·dt**（v = 速率(步/秒) × 步长 = 计数/秒）⇒
 *               「步长 2 / 速率 1」是每 0.5 秒 +1，不是每 1 秒 +2。
 *               计数 n 是**小数累加器**：显示 / 可极限判定 / 极限兑现一律走 ⌊n⌋，
 *               极限只并入整数部分，小数余量留作计数继续累积。
 * S1（点层）  ：沿用主动玩家模型（前 τ_eff 秒维持主动档，之后熵衰回挂机档）。
 *
 * 运行：npm run smoke
 */

import { createGame, Engine } from './core/engine';
import { Decimal, fmt, fmtTime } from './core/decimal';
import {
  succS0, limitS0, rebaseS0, canRebase, canLimit, canBuyUpgrade, buyUpgrade,
  computeRungs, createRuntime as createS0Runtime, tickS0,
  upgradeCostOf, succGainOf, autoSuccRateOf, limitDeepenCopies, hasAutoLimit,
  resonanceBonus, rebaseGateAlpha, succVelocityOf, nFloor,
  limitBreakLv, debugAddCount, debugAddOrdinalCount,
  canBuyBase2Upgrade, buyBase2Upgrade, atBase2Cap, base2MultOf,
} from './layers/s0/logic';
import { createS0State, type S0State } from './layers/s0/state';
import {
  S0_BASE_MIN, S0_UPGRADES, s0UpgradeMax, isUpgradeUnlocked,
  S0_SUCC_RATE_STEPS,
  S0_BASE2_CAP_N, S0_BASE2_LADDER, S0_BASE2_UP_COUNT, displayCountOf,
} from './layers/s0/defs';
import {
  isEps0, checkBijection, hereditaryToOrdinal, toString as ord,
  omegaPow, fromNat, cmp, ordinalToCount,
} from './ordinal/cnf';
import { canAscend, doAscension, tryUnlockHex, HEX_COST_EPS, HEX_UNLOCK_RUN } from './meta/progression';
import type { LayerId } from './meta/types';

import {
  tickS1, fillReference, effectivePhi, isAutoUnlocked, requiredPoints, PHI_AUTO_CAP, S1_AUTO_UNLOCK_RUN,
} from './layers/s1/logic';
import { phiOf } from './board/scoring';
import { S1_TARGETS } from './layers/s1/defs';
import { targetTime } from './economy/formulas';
import { IDLE_WINDOW_SEC } from './constants';

const DT = 0.5; // 冒烟步长（秒）；真实运行是 1/20

/** 把计数 n 推到 ≥ target（默认直到可极限），返回后继次数 */
function succUntil(st: S0State, target: number): number {
  let g = 0;
  while (st.n < target && !st.reachedEps0 && g < 10_000_000) {
    succS0(st, 0);
    g++;
  }
  return g;
}

/**
 * **裸跑**（不买升级）时本基达标所需的极限次数 = ⌈门槛计数 / base⌉ ——
 * 裸跑 succGain = 1，每次攒到 n = base 就极限 ⇒ 每次极限恰并入 base 个计数。
 */
function nakedLimitsFor(base: number): number {
  const need = ordinalToCount(rebaseGateAlpha(base), base);
  if (!Number.isFinite(need) || need <= 0) return Infinity;
  return Math.ceil(need / Math.max(2, Math.floor(base)));
}

/**
 * 超过此预算的基改走「一次性大极限」：真实玩法里玩家会**囤一大坨 n 再极限**
 * （极限深化也是这个语义），逐个极限去跑没有额外信息量，却要把冒烟拖到分钟级。
 * 便宜的基（10..6）仍然逐个极限实跑，由 `simulated` 与解析值对照校验。
 */
const BRUTE_LIMIT_BUDGET = 300_000;

/**
 * 跑完整条 S0：base 10 → 2。
 *
 * 换基门槛**随基递增**，所以每个基要「攒计数 → 极限」直到本基门槛达标。
 * base 2：攒到 4 再极限 ⇒ 并出 ε₀ ⇒ 涌升。
 * 返回：每基的解析极限次数（`perBase`）、实跑次数（`simulated`，走一次性大极限的基为 −1）、
 * 总极限数、总后继数（用于回归校验）。
 */
function runFullS0(): {
  st: S0State; perBase: number[]; simulated: number[];
  totalLimits: number; totalSucc: number;
} {
  const st = createS0State();
  const rt = createS0Runtime(st);
  const perBase: number[] = [];
  const simulated: number[] = [];
  let totalLimits = 0;
  let totalSucc = 0;
  let guard = 0;
  // base ≥ 3 段：把 α 推到本基门槛，再换基
  while (st.base > S0_BASE_MIN && guard < 100) {
    const naked = nakedLimitsFor(st.base);
    let limits = 0;
    if (naked <= BRUTE_LIMIT_BUDGET) {
      // 逐个极限跑到门槛（最接近真实操作序列的路径）
      let inner = 0;
      while (!canRebase(st, rt) && inner <= BRUTE_LIMIT_BUDGET) {
        totalSucc += succUntil(st, st.base); // 攒到可极限（n ≥ base）
        if (canLimit(st) && limitS0(st, rt, 0)) { totalLimits++; limits++; }
        inner++;
      }
      simulated.push(limits);
    } else {
      // 门槛过大 ⇒ 一次性攒够再极限（见 BRUTE_LIMIT_BUDGET 注释）
      const need = ordinalToCount(rebaseGateAlpha(st.base), st.base);
      st.n = need;
      if (canLimit(st) && limitS0(st, rt, 0)) { totalLimits++; limits++; }
      simulated.push(-1);
    }
    if (!canRebase(st, rt)) break; // 未达标 ⇒ 提前终止（由断言兜底）
    rebaseS0(st, rt, 0);
    perBase.push(naked);
    guard++;
  }
  // base 2 段（2026-10-04 二次改：**四圈循环**）——
  //   每圈：攒到 n = 65536（显示计数恰为 4 ⇒ 硬上限）→ 一次脚本极限
  //   （α 走 ω+2 → ω·2 → ω² → ω^ω）。⚠️ 每次极限后计数清零 + 升级重置 ⇒
  //   四圈都要**重新攒满**，不能连按（旧版是连按 4 次）。
  for (let i = 0; i < S0_BASE2_LADDER.length; i++) {
    totalSucc += succUntil(st, S0_BASE2_CAP_N);
    if (limitS0(st, rt, 0)) totalLimits++;
  }
  return { st, perBase, simulated, totalLimits, totalSucc };
}

// ───────────────────────────── S0 计数层 ─────────────────────────────

function smokeS0(): void {
  const { state, rt } = createGame();
  const st = state.layers.s0;
  const s0rt = rt.s0;

  console.log('═════════ S0 计数层 · headless 冒烟 ═════════\n');
  console.log(`起点：n = ${st.n}   base = ${st.base}   α = ${ord(st.alpha)}`);

  let pass = true;
  const check = (cond: boolean, msg: string): void => {
    console.log(`  ${cond ? 'PASS' : '✗ FAIL'}（${msg}）`);
    if (!cond) pass = false;
  };

  // ① base = 2 的台阶：V_2(n) 的参考曲线（1 → ω → ε₀）
  {
    console.log('\n① base = 2 的台阶（设计：1 → ω → ε₀；ε₀ ⟺ n = 4 = 2↑↑2）');
    const rungs = computeRungs(2);
    for (const r of rungs) console.log(`    n ≥ ${String(r.n).padStart(3)}   →   ${ord(r.alpha)}`);
    const labels = rungs.map((r) => ord(r.alpha));
    const ok =
      rungs.length === 3 &&
      labels[1] === 'ω^1' &&
      isEps0(rungs[2].alpha) &&
      rungs[2].n === 4;
    check(ok, `恰 3 台阶、末阶 n=4 且 α=ε₀（实得 ${rungs.length} 台阶：${labels.join(' → ')}）`);
  }

  // ② 后继：n += succGain（默认 1），**只动计数，绝不改 α**
  {
    console.log('\n② 后继（n += succGain；α 不变）');
    const a0 = ord(st.alpha);
    succS0(st, 0);
    check(st.n === 1, `n 0 → ${st.n}`);
    check(st.alpha.t === 'zero' && ord(st.alpha) === a0, `α 仍 = ${a0}（后继不改 α）`);
    check(ord(st.alpha) !== ord(hereditaryToOrdinal(st.n, st.base)), 'α ≠ V_base(n)（α 已是独立累积量，非派生）');
  }

  // ③ 换基门槛：α ≥ S0_REBASE_GATE[base]；后继改不了 α ⇒ 天然防绕过
  {
    console.log('\n③ 换基门槛（base10 → α ≥ ' + ord(rebaseGateAlpha(st.base)) + '；后继不推 α）');
    check(!canRebase(st, s0rt), `α=${ord(st.alpha)} 时拒绝换基`);
    check(rebaseS0(st, s0rt, 0) === false, '门槛未到时 rebaseS0 返回 false');
    let guard = 0;
    while (guard < 5000) { succS0(st, 0); guard++; }
    check(!canRebase(st, s0rt), `连推 ${guard} 次后继（α 仍=${ord(st.alpha)}）仍不能换基`);
    // 后继改不了 α ⇒ 必须做极限：攒到 base² 再极限，并出 ω²
    succUntil(st, st.base * st.base);
    check(canLimit(st), `攒到 n=${st.n}（≥ base²=${st.base * st.base}）可极限`);
    const did = limitS0(st, s0rt, 0);
    check(did && cmp(st.alpha, rebaseGateAlpha(st.base)) >= 0, `极限并入 ω-内容后 α=${ord(st.alpha)} ≥ 门槛`);
    check(canRebase(st, s0rt), 'α ≥ 门槛后达换基门槛');
  }

  // ④ 门槛边界：对每个基，α < 门槛 不能换基、α = 门槛 可以（门槛随基递增）
  {
    console.log('\n④ 门槛边界（每基：α < 门槛 拒 / α = 门槛 允；门槛随换基进度递增）');
    let ok = true;
    for (const b of [10, 9, 8, 7, 6, 5, 4, 3]) {
      const gate = rebaseGateAlpha(b);
      const lo = createS0State(); lo.base = b; lo.alpha = omegaPow(fromNat(1)); // ω < 各门槛
      const hi = createS0State(); hi.base = b; hi.alpha = gate;
      const loOk = !canRebase(lo, createS0Runtime(lo));
      const hiOk = canRebase(hi, createS0Runtime(hi));
      if (!(loOk && hiOk)) { ok = false; console.log(`    base ${b}：异常（lo=${loOk} hi=${hiOk}）`); }
      else console.log(`    base ${b}：α=ω 拒 / α=${ord(gate)} 允 ✓`);
    }
    check(ok, '对每个基：α 低于门槛拒绝、达到门槛允许');
    // 门槛的计数等价量（用户定案数值）
    check(ordinalToCount(rebaseGateAlpha(10), 10) === 100, `base10 门槛计数等价 = 100（实得 ${ordinalToCount(rebaseGateAlpha(10), 10)}）`);
    check(ordinalToCount(rebaseGateAlpha(9), 9) === 2187, `base9 门槛计数等价 = 2187（实得 ${ordinalToCount(rebaseGateAlpha(9), 9)}）`);
    // 用户定案 2026-10-03：基 8 门槛由 ω⁵·2（65536）下调为 ω⁴·4（4·8⁴ = 16384）
    check(ordinalToCount(rebaseGateAlpha(8), 8) === 16384, `base8 门槛（ω⁴·4）计数等价 = 16384（实得 ${ordinalToCount(rebaseGateAlpha(8), 8)}）`);
    // 用户定案 2026-10-03：基 7 门槛由 ω^ω（7^7 = 823543，落差过大）下调为 ω⁵·2（2·7⁵ = 33614）
    check(ordinalToCount(rebaseGateAlpha(7), 7) === 33614, `base7 门槛（ω⁵·2）计数等价 = 33614（实得 ${ordinalToCount(rebaseGateAlpha(7), 7)}）`);
    // 用户定案 2026-10-06：基 6 门槛由 ω^(ω+2)（6⁸ = 1679616）下调为 ω^(ω+1)（6⁷ = 279936）
    check(ordinalToCount(rebaseGateAlpha(6), 6) === 279936, `base6 门槛（ω^(ω+1)）计数等价 = 6⁷ = 279936（实得 ${ordinalToCount(rebaseGateAlpha(6), 6)}）`);
    // 基 5 门槛由 ω^ω（5^5 = 3125）上调为 ω^(ω·2)（5¹⁰ = 9765625）
    check(ordinalToCount(rebaseGateAlpha(5), 5) === 9765625, `base5 门槛（ω^(ω·2)）计数等价 = 5¹⁰ = 9765625（实得 ${ordinalToCount(rebaseGateAlpha(5), 5)}）`);
    // 用户定案 2026-10-03：基 4 门槛由 ω^ω（4^4 = 256）上调为 ω^(ω·3)（4¹² = 16777216）
    check(ordinalToCount(rebaseGateAlpha(4), 4) === 16777216, `base4 门槛（ω^(ω·3)）计数等价 = 4¹² = 16777216（实得 ${ordinalToCount(rebaseGateAlpha(4), 4)}）`);
    // 用户定案 2026-10-03：基 3 门槛由 ω^ω（3^3 = 27）上调为 ω^(ω^ω)（3²⁷ = 7625597484987）。
    // ⚠️ 这个门槛**恰是基 3 的 ε₀ 封顶点**（V_3 在 ω-深度 ≥ epsDepthFor(3)=3 时封顶，
    //   首个触发点就是 3²⁷）⇒ 达标那一刻 α = ε₀、reachedEps0 = true。
    //   配套两条规则才能不自锁：canRebase 不再用 reachedEps0 挡门 + rebaseS0 清零 reachedEps0。
    check(
      ordinalToCount(rebaseGateAlpha(3), 3) === 7625597484987,
      `base3 门槛（ω^(ω^ω)）计数等价 = 3²⁷ = 7625597484987（实得 ${ordinalToCount(rebaseGateAlpha(3), 3)}）`,
    );
    {
      const probe = createS0State();
      probe.base = 3;
      probe.ordinalCount = Math.pow(3, 27);
      probe.alpha = hereditaryToOrdinal(Math.pow(3, 27), 3);
      check(isEps0(probe.alpha), `base3 达标 ⇒ α 封顶为 ε₀（α=${ord(probe.alpha)}）`);
      const prt = createS0Runtime(probe);
      check(canRebase(probe, prt), 'α=ε₀ 时仍能换基（canRebase 不再被 reachedEps0 挡门）');
      check(rebaseS0(probe, prt, 0), '从 ε₀ 换到基 2 成功');
      check(probe.base === 2 && !probe.reachedEps0, `换基后 reachedEps0 清零（reachedEps0=${probe.reachedEps0}）`);
      // 换到基 2 后整段仍走得动（2026-10-04 新规则）：
      //   每圈「攒满 65536 → 一次极限」，共 4 圈 → α = ω^ω（base2 的 ε₀）
      let b2steps = 0;
      for (let i = 0; i < S0_BASE2_LADDER.length; i++) {
        succUntil(probe, S0_BASE2_CAP_N);
        if (limitS0(probe, prt, 0)) b2steps++;
      }
      check(
        b2steps === S0_BASE2_LADDER.length && probe.reachedEps0 && ord(probe.alpha) === 'ω^(ω^1)',
        `基 2 段未被 ε₀ 标记污染：4 圈（每圈 ${S0_BASE2_CAP_N} 次后继 + 1 次极限）⇒ α=${ord(probe.alpha)}`,
      );
    }
    // 门槛必须**可达**（计数等价量落在安全整数域内），否则该基永远换不了基
    for (const b of [10, 9, 8, 7, 6, 5, 4, 3]) {
      const c = ordinalToCount(rebaseGateAlpha(b), b);
      check(Number.isFinite(c) && c > 0, `base${b} 门槛可达（计数 ${c}）`);
    }
    // ⚠️ **死锁护栏**：在「刚好达到门槛」的那个状态上，玩家必须还有出路（能换基）。
    //   若达标的那一刻 α 已封顶 ε₀（reachedEps0=true），而后继/极限都被它停掉，
    //   换基再若是被挡 ⇒ 该基**永久死锁**。这类死锁以前会以「只差一点点」的形式藏在表里，
    //   所以直接对每个基做「达标 ⇒ 可换基」的实测，而不是只看 α 是不是 ε₀。
    for (const b of [10, 9, 8, 7, 6, 5, 4, 3]) {
      const c = ordinalToCount(rebaseGateAlpha(b), b);
      const probe = createS0State();
      probe.base = b;
      probe.ordinalCount = c;
      probe.alpha = hereditaryToOrdinal(c, b);
      check(
        canRebase(probe, createS0Runtime(probe)),
        `base${b}：达标那一刻 α=${ord(probe.alpha)}${isEps0(probe.alpha) ? '（已封顶 ε₀）' : ''} ⇒ 仍可换基，不会死锁`,
      );
    }
  }

  // ⑤ 极限（遗传进位）：n≥base 可用，把 ω-内容并入 α，n ← n mod base
  {
    console.log('\n⑤ 极限（n≥base 时：ω-内容并入 α，n ← n mod base）');
    const f = createS0State();
    const frt = createS0Runtime(f);
    check(f.alpha.t === 'zero', 'α 初始 ZERO');
    check(!canLimit(f), 'n=0 不能极限');
    check(limitS0(f, frt, 0) === false, 'n=0 极限返回 false');
    succUntil(f, f.base); // 攒到 base
    check(canLimit(f), `攒到 n=${f.n} ≥ base 可极限`);
    const did = limitS0(f, frt, 0);
    check(did && ord(f.alpha) === ord(omegaPow(fromNat(1))), `极限成功，α 并出 ω（α=${ord(f.alpha)}）`);
    check(f.n < f.base, `n 回落到 < base（n=${f.n}）`);
    check(!canRebase(f, frt), 'α=ω < ω² 仍不能换基');
    // 攒到 base² 再极限 → ω² → 达门槛
    succUntil(f, f.base * f.base);
    limitS0(f, frt, 0);
    check(cmp(f.alpha, rebaseGateAlpha(f.base)) >= 0, `再攒到 n=${f.n} 极限并出 ≥ω²（α=${ord(f.alpha)}）`);
    check(canRebase(f, frt), '达换基门槛');
  }

  // ⑥ 换基链 10 → 2：每基循环极限直到本基门槛达标后换基（门槛随基递增 ⇒ 每基不止 1 次）
  {
    console.log('\n⑥ 换基链（10 → 2，每基循环极限直到 S0_REBASE_GATE[base] 达标后换基）');
    const full = runFullS0();
    for (let i = 0; i < full.perBase.length; i++) {
      const b = 10 - i;
      const how = full.simulated[i]! < 0 ? '一次性大极限' : `逐个极限实跑 ${full.simulated[i]} 次`;
      console.log(`    base ${b} → ${b - 1}   裸极限 ${full.perBase[i]} 次   （${how}）`);
    }
    check(full.perBase.length === 8, `换基 8 次（10 → … → 2；实得 ${full.perBase.length}）`);
    check(full.perBase.every((x) => x >= 1), `每基至少 1 次极限（实得 ${full.perBase.join(',')}）`);
    check(full.perBase[0] === 10, `base10 恰 10 次极限达 ω²（100/10；实得 ${full.perBase[0]}）`);
    // 实跑过的基：实际极限次数必须与解析值一致（⌈门槛计数 / base⌉）
    let simOk = true;
    for (let i = 0; i < full.simulated.length; i++) {
      if (full.simulated[i]! >= 0 && full.simulated[i] !== full.perBase[i]) {
        simOk = false;
        console.log(`    base ${10 - i}：实跑 ${full.simulated[i]} ≠ 解析 ${full.perBase[i]}`);
      }
    }
    check(simOk, '实跑过的基：逐个极限的次数 = ⌈门槛计数 / base⌉');
    check(full.totalLimits >= 9, `S0 全程极限 ≥ 9 次（实得 ${full.totalLimits}）`);
    check(full.st.base === 2, `全程结束停在 base 2（实得 ${full.st.base}）`);
  }

  // ⑦ base 2 段（2026-10-04 定案：**双层对数经济**）：
  //    显示计数 D(n)=log₂(log₂ n)；n=65536 ⇒ D=4 ⇒ 硬上限 ⇒ 4 次脚本极限到 ω^ω（base2 的 ε₀）⇒ 涌升 S1
  {
    console.log('\n⑦ base 2 段（双层对数：n=65536 ⇒ 显示 4 ⇒ 4 次极限 → ω^ω）+ 涌升');
    const full = runFullS0();
    const f = full.st;
    console.log(`    跑完整链 → base=${f.base}  α=${ord(f.alpha)}  脚本极限=${f.base2LimitStep} 步`);
    check(
      f.base === 2 && f.reachedEps0 && ord(f.alpha) === 'ω^(ω^1)',
      `跑完整链后停在 base 2 且 α = ω^ω（实得 ${ord(f.alpha)}）`,
    );
    check(f.base2LimitStep === S0_BASE2_LADDER.length, `脚本极限走满 4 步（实得 ${f.base2LimitStep}）`);

    // ① 裸后继（一个升级都不买）：65536 次撞满硬上限，之后后继被禁用
    const g = createGame();
    const gs = g.state.layers.s0;
    gs.base = 2;
    let clicks = 0;
    while (!atBase2Cap(gs) && clicks < 200_000) { succS0(gs, 0); clicks++; }
    check(clicks === S0_BASE2_CAP_N, `裸后继 ${S0_BASE2_CAP_N} 次撞满硬上限（实得 ${clicks}）`);
    check(displayCountOf(nFloor(gs)) === 4, `显示计数恰为 4（实得 ${displayCountOf(nFloor(gs))}）`);
    check(canLimit(gs), '撞满硬上限后「极限」解锁');
    check(succS0(gs, 0) === false, '撞满硬上限后后继被禁用');

    // ② 四圈脚本极限：α 逐格走 ω+2 → ω·2 → ω² → ω^ω；**每次极限后回到「后继」**
    //    （计数清零 + 6 个升级重置），跨圈只保留 ×√2 的持久后继倍率（用户定案 2026-10-04）。
    //    ⚠️ 前两格在 base2 下系数 = 2 ≥ 基数 2，不在 V₂ 的像里 —— 故障态的双射破裂（用户定案「就按字面写」）
    const want = ['ω^1 + 2', 'ω^1·2', 'ω^2', 'ω^(ω^1)'];
    for (let i = 0; i < want.length; i++) {
      succUntil(gs, S0_BASE2_CAP_N); // 上一圈已把计数清零 ⇒ 必须重新攒满才能再极限
      limitS0(gs, createS0Runtime(gs), 0);
      check(ord(gs.alpha) === want[i], `第 ${i + 1} 次极限 ⇒ α = ${want[i]}（实得 ${ord(gs.alpha)}）`);
      if (i < want.length - 1) {
        check(
          gs.n === 0 && gs.base2Up.every((x) => x === 0) && gs.base2LimitStep === i + 1,
          `第 ${i + 1} 次极限后回到「后继」：计数清零、6 个升级重置、步数 = ${i + 1}`,
        );
        check(
          Math.abs(succGainOf(gs) - Math.pow(Math.SQRT2, i + 1)) < 1e-9,
          `跨圈持久后继增益 = (√2)^${i + 1} = ${Math.pow(Math.SQRT2, i + 1).toFixed(4)}（实得 ${succGainOf(gs).toFixed(4)}）`,
        );
      }
    }
    check(gs.reachedEps0, '第 4 次极限后 reachedEps0 = true（ω^ω 在 base2 即 ε₀）');
    check(gs.base2LimitStep === S0_BASE2_LADDER.length, `四圈走满（实得 ${gs.base2LimitStep}）`);
    check(!canLimit(gs), '4 圈走完后「极限」再次禁用');

    // ③ 升级经济：最优打法（一有钱就买）实测 1283 次后继走完**第 1 圈**（四圈合计约 3289）
    const h = createGame();
    const hs = h.state.layers.s0;
    hs.base = 2;
    let c2 = 0;
    let guard = 0;
    while (!atBase2Cap(hs) && guard++ < 200_000) {
      let bought = false;
      for (let k = 0; k < S0_BASE2_UP_COUNT; k++) {
        if (canBuyBase2Upgrade(hs, k)) { buyBase2Upgrade(hs, k, 0); bought = true; break; }
      }
      if (atBase2Cap(hs)) break;
      if (!bought) { succS0(hs, 0); c2++; }
    }
    check(atBase2Cap(hs) && c2 === 1283, `最优打法 1283 次后继撞满硬上限（第 1 圈；实得 ${c2}）`);
    check(base2MultOf(hs) === 60, `满配倍率 = 1·2·2·2·2.5·3 = 60（实得 ${base2MultOf(hs)}）`);

    // ④ 实际扣除：买完价格后内部计数向下取整（D(n) − price ⇒ n = ⌊2^(2^D)⌋）
    const d0 = displayCountOf(nFloor(hs));
    const k0 = S0_BASE2_UP_COUNT - 1;
    hs.base2Up[k0] = 0; // 重置最后一条，重演一次扣除
    while (!canBuyBase2Upgrade(hs, k0)) { succS0(hs, 0); }
    const before = nFloor(hs);
    const price = 3.5;
    buyBase2Upgrade(hs, k0, 0);
    const expect = Math.floor(Math.pow(2, Math.pow(2, displayCountOf(before) - price)));
    check(nFloor(hs) === expect, `扣除后 n = ⌊2^(2^(D−price))⌋ = ${expect}（实得 ${nFloor(hs)}）`);
    check(displayCountOf(nFloor(hs)) < d0 + 1, '扣除后显示计数确实被打下来');

    const canAsc = canAscend(g.state.meta, g.state.layers);
    const did = canAsc ? doAscension(g.state.meta, g.state.layers) : false;
    console.log(`    canAscend=${canAsc}  doAscension=${did}  →  current=${g.state.meta.current}  S0.ascended=${gs.ascended}`);
    check(canAsc && did && g.state.meta.current === 's1' && gs.ascended, '涌升链：可涌升 → 已涌升 → 切到 S1');
  }

  // ⑧ 升级系统（序数价格；花费序数计数 a，低基更便宜；随换基进度解锁）
  {
    console.log('\n⑧ 升级（价格 P；canBuy = 已解锁 ∧ ordinalCount ≥ ordinalToCount(P, base)；花费扣 a）');
    const W = (k: number) => omegaPow(fromNat(k));
    // 序数 → 计数等价量（低基更便宜）
    check(ordinalToCount(W(2), 10) === 100, 'ω²@base10 计数等价 = 100');
    check(ordinalToCount(W(2), 9) === 81, 'ω²@base9 计数等价 = 81');
    check(ordinalToCount(W(3), 10) === 1000, 'ω³@base10 计数等价 = 1000');
    check(ordinalToCount(W(4), 10) === 10000, 'ω⁴@base10 计数等价 = 10000');

    // 注意：升级**随换基进度解锁** ⇒ 基 10 一条都买不了，购买用例须在对应基下跑
    const u = createS0State();
    u.base = 9; // succGain 自基 9 起解锁
    check(succGainOf(u) === 1, '默认 succGain=1');
    check(autoSuccRateOf(u) === 0, '默认无自动后继');
    check(limitDeepenCopies(u) === 1, '默认极限 1 份 ω-内容');
    check(!hasAutoLimit(u), '默认无自动极限');

    // 换基进度门控：基 10 时无升级 ⇒ 即便有钱也买不了
    const locked = createS0State();
    locked.base = 10;
    locked.ordinalCount = 1_000_000;
    check(!canBuyUpgrade(locked, 'succGain'), '基 10 时后继增益未解锁 ⇒ 买不了');
    check(buyUpgrade(locked, 'succGain', 0) === false, '基 10 时 buyUpgrade 返回 false');

    // 钱不够 → 拒绝（基 9 已解锁）
    check(!canBuyUpgrade(u, 'succGain'), 'ordinalCount=0 时买不起后继增益');
    check(buyUpgrade(u, 'succGain', 0) === false, '买不起时 buyUpgrade 返回 false');

    // 后继增益第一级价 = ω → base9 需序数计数 9
    const c = upgradeCostOf('succGain', 0, u.base)!;
    check(ord(c.ordinal) === 'ω^1', `后继增益 L1 序数价 = ω（实得 ${ord(c.ordinal)}）`);
    check(c.count === 9, `后继增益 L1@base9 计数等价 = 9（实得 ${c.count}）`);
    u.ordinalCount = c.count;
    check(canBuyUpgrade(u, 'succGain'), `ordinalCount=${c.count} 时买得起`);
    buyUpgrade(u, 'succGain', 0);
    check(u.upgrades.succGain === 1 && u.ordinalCount === 0, '等级 1、花光序计数 a');
    check(succGainOf(u) === 2, `后继增益 1 → ${succGainOf(u)}（基数步长 2）`);

    // 低基更便宜：同一 ω 在 base 8 只需 8
    const c8 = upgradeCostOf('succGain', 0, 8)!;
    check(c8.count === 8, `后继增益 L1@base8 计数等价 = 8（实得 ${c8.count}）`);

    // 回归（2026-10-03 修的 bug）：阶梯数组**下标 = 等级**（含 lv=0 档），
    // 故「上限 N」要求数组 ≥ N+1 项。旧版上限抬到 4 而数组只有 4 项 ⇒ lv4 被 clamp 回 8、买了没提升。
    // 一律跑在**最高档基 4**（上限最大，最能暴露数组不够长 / clamp 回退）
    const gm = createS0State();
    gm.base = 4; // 基 ≤4 时 succGain 上限 7
    const gains: number[] = [succGainOf(gm)];
    for (let lv = 1; lv <= 7; lv++) { gm.upgrades.succGain = lv; gains.push(succGainOf(gm)); }
    console.log(`    后继增益阶梯（基4，lv0..7）：${gains.join(' → ')}`);
    check(gains.join(',') === '1,2,4,8,16,32,64,128', `后继增益 lv0..7 = 1..128（实得 ${gains.join(',')}）`);
    check(new Set(gains).size === 8, '后继增益每一级都有提升（无 clamp 回退）');

    const sm = createS0State();
    sm.base = 4; // 基 ≤4 时 succStream 上限 6
    const rates: number[] = [autoSuccRateOf(sm)];
    for (let lv = 1; lv <= 6; lv++) { sm.upgrades.succStream = lv; rates.push(autoSuccRateOf(sm)); }
    console.log(`    后继流速率阶梯（基4，lv0..6）：${rates.join(' → ')}`);
    check(rates.join(',') === '0,1,2,4,8,16,32', `后继流 lv0..6 = 0,1,2,4,8,16,32（实得 ${rates.join(',')}）`);
    check(new Set(rates).size === 7, '后继流每一级都有提升（无 clamp 回退）');

    // 极限深化（基 ≤4 起上限 5）：并入份数 = 1 + lv，最高 6 份
    const dm = createS0State();
    dm.base = 4;
    const copies: number[] = [limitDeepenCopies(dm)];
    for (let lv = 1; lv <= 5; lv++) { dm.upgrades.limitDeepen = lv; copies.push(limitDeepenCopies(dm)); }
    console.log(`    极限深化份数阶梯（基4，lv0..5）：${copies.join(' → ')}`);
    check(copies.join(',') === '1,2,3,4,5,6', `极限深化 lv0..5 = 1..6 份（实得 ${copies.join(',')}）`);

    // 深度缩放已取消：即便 α 已深（ω²），已购升级也不再被放大
    const r0 = createS0State();
    r0.base = 9;
    r0.ordinalCount = 100; r0.alpha = hereditaryToOrdinal(100, 9); // α = ω² + 2ω + 1（深度 2）
    r0.upgrades.succGain = 1;
    check(succGainOf(r0) === 2, `已购后继增益 @ω²：仍为基础步长 2（深度缩放已取消；实得 ${succGainOf(r0)}）`);

    // 序数共鸣：抬高后继增益的**指数底数**（用户定案 2026-10-03）
    //   后继增益 = (2 + 0.5×共鸣lv) ^ 增益lv —— 加成在**底数**上，不是加在结果上。
    //   旧实现是 `2^lv + 0.5·resLv`（共鸣 2 级在 lv3 只把 8 变成 9，几乎无感），已改。
    const r = createS0State();
    r.base = 9;
    r.upgrades.resonance = 0;
    r.upgrades.succGain = 3;
    check(Math.abs(succGainOf(r) - 8) < 1e-9, `无共鸣 lv3：2³ = 8（实得 ${succGainOf(r)}）`);
    r.upgrades.resonance = 1; // 底数 2 → 2.5
    check(Math.abs(succGainOf(r) - 15.625) < 1e-9, `共鸣1级 lv3：2.5³ = 15.625（实得 ${succGainOf(r)}）`);
    r.upgrades.resonance = 2; // 底数 2 → 3
    check(Math.abs(succGainOf(r) - 27) < 1e-9, `共鸣2级 lv3：3³ = 27（实得 ${succGainOf(r)}）`);
    check(Math.abs(resonanceBonus(r) - 1) < 1e-9, `共鸣加成 = 0.5 × 2 = ${resonanceBonus(r)}（加在底数上）`);
    // lv=0 时底数变化不影响（底数⁰ = 1）
    r.upgrades.succGain = 0;
    check(succGainOf(r) === 1, `共鸣2级但 succGain lv0：底数⁰ = 1（实得 ${succGainOf(r)}）`);
    // 共鸣随等级复利：lv1 → lv6 在共鸣 2 级下应是 3^lv
    r.upgrades.succGain = 6;
    check(Math.abs(succGainOf(r) - 729) < 1e-9, `共鸣2级 lv6：3⁶ = 729（实得 ${succGainOf(r)}）`);

    // 共鸣已延后到基 6 解锁：基 8 买不了（即便钱够）
    const rb8 = createS0State();
    rb8.base = 8;
    rb8.ordinalCount = 1_000_000;
    check(!canBuyUpgrade(rb8, 'resonance'), '基 8 时共鸣未解锁 ⇒ 买不了（已延后到基 6）');
    check(buyUpgrade(rb8, 'resonance', 0) === false, '基 8 时 buyUpgrade(共鸣) 返回 false');

    // 共鸣的购买（基 6 解锁；E=6 ⇒ 计数 6⁶ = 46656）
    // ⚠️ 价格序数是 **ω^(V_base(E))**，在 base6 下 ω⁶ 不可表示 ⇒ 显示为 ω^ω（计数同为 46656）
    const rb = createS0State();
    rb.base = 6;
    rb.ordinalCount = 46656;
    const cR = upgradeCostOf('resonance', 0, 6)!;
    check(ord(cR.ordinal) === 'ω^(ω^1)', `序数共鸣 L1@base6 序数价 = ω^ω（实得 ${ord(cR.ordinal)}）`);
    check(cR.count === 46656, `序数共鸣 L1@base6 计数等价 = 6⁶ = 46656（实得 ${cR.count}）`);
    // L2：E=8 ⇒ ω^(ω+2)，计数 6⁸ = 1679616 —— **旧实现这里也是 46656（白送一级）**
    // ⚠️ C 项门槛约束：base6 换基门槛 = ω^(ω+1) = 6⁷ = 279936，而 L2 价 1679616 > 门槛
    //   ⇒ resonance 在 base6 的有效上限被压到 L1（L2 不可买）。这正是指令 C 的预期行为，
    //   故这里不再断言 L2 可买，改为校验「base6 下 L2 确实被门槛挡住」。
    check(upgradeCostOf('resonance', 1, 6) === null, 'base6 共鸣受门槛约束 ⇒ L2 不可买（有效上限压到 L1）');
    // 「L2 严格贵于 L1」的递增校验改到 base5（门槛 ω^(ω·2)=5¹⁰=9765625，L2 仍买得起）
    const cR2 = upgradeCostOf('resonance', 1, 5)!;
    check(cR2.count === 390625, `序数共鸣 L2@base5 计数等价 = 5⁸ = 390625（实得 ${cR2.count}）`);
    check(cR2.count > upgradeCostOf('resonance', 0, 5)!.count, '共鸣 L2 严格贵于 L1（旧实现两档同价 ⇒ BUG）');
    check(canBuyUpgrade(rb, 'resonance'), 'ordinalCount=46656 买得起共鸣');
    check(buyUpgrade(rb, 'resonance', 0), '买下共鸣 L1');
    check(rb.upgrades.resonance === 1 && rb.ordinalCount === 0, '共鸣等级 1、花光序计数 a');

    // ★ 价格严格递增回归（2026-10-03 修的 BUG）：每基、每条**已解锁**升级的**计数**价必须逐级变大，
    //   且不得为 Infinity。旧实现在 k ≥ base 时饱和（同价），在 base8~10 甚至溢出成 Infinity。
    //   只扫已解锁的 (升级, 基) 组合：破限只在基 3 存在，在高基下它的价位本就不可表示
    //   （ω^(ω²+ω·k) 在基 10 的计数等价量是 10^(10²+…) ⇒ 超出安全整数 ⇒ Infinity，属预期）。
    let priceOk = true;
    let priceCombos = 0;
    for (const b of [10, 9, 8, 7, 6, 5, 4, 3]) {
      for (const u of S0_UPGRADES) {
        if (!isUpgradeUnlocked(u.id, b)) continue;
        let prev = -1;
        for (let lv = 0; lv < 12; lv++) {
          const c = upgradeCostOf(u.id, lv, b);
          if (!c) break;
          if (!(c.count > prev) || !Number.isFinite(c.count)) {
            priceOk = false;
            console.log(`    价格异常：${u.id}@base${b} lv${lv} → ${c.count}（上一级 ${prev}）`);
          }
          prev = c.count;
          priceCombos++;
        }
      }
    }
    check(priceOk, '每条升级在每个可买基下：价格计数严格递增且有限（无饱和 / 无 Infinity）');
    check(priceCombos > 20, `已扫 ${priceCombos} 个（升级, 基, 等级）价位组合`);

    // 极限深化（基 7 解锁）：一次极限并入 1 + lv 份 ω-内容
    const d = createS0State();
    d.base = 7;
    d.ordinalCount = upgradeCostOf('limitDeepen', 0, 7)!.count; // ω² → 49
    check(buyUpgrade(d, 'limitDeepen', 0), '基 7 买下极限深化 L1');
    check(limitDeepenCopies(d) === 2, `极限深化1级：并入份数 1 → ${limitDeepenCopies(d)}`);

    // 后继流（基 8 解锁）：连续流 v·dt —— 「步长 2 / 速率 1」要表现为每 0.5 秒 +1
    const a = createS0State();
    a.base = 8;
    a.ordinalCount = upgradeCostOf('succStream', 0, 8)!.count; // ω → 8
    check(buyUpgrade(a, 'succStream', 0), '基 8 买下后继流 L1');
    const art = createS0Runtime(a);
    const nBefore = a.n;
    tickS0(a, art, 1.0, 1.0);
    check(a.n > nBefore, `后继流 1/s：1 秒后 n ${nBefore} → ${a.n}`);
    check(Math.abs(a.n - 1) < 1e-9, `速率1 × 步长1 ⇒ v=1/s，1 秒后 n=${a.n}`);

    // 核心回归：步长 2 + 速率 1 ⇒ v = 2/s ⇒ 每 0.5 秒 +1（**不是**每 1 秒 +2）
    const fl = createS0State();
    fl.base = 8;
    fl.ordinalCount = upgradeCostOf('succGain', 0, 8)!.count;
    check(buyUpgrade(fl, 'succGain', 0), '基 8 买下后继增益 L1（步长 2）');
    fl.ordinalCount = upgradeCostOf('succStream', 0, 8)!.count;
    check(buyUpgrade(fl, 'succStream', 0), '基 8 买下后继流 L1（速率 1 步/秒）');
    check(succGainOf(fl) === 2 && autoSuccRateOf(fl) === 1, '步长 2 / 速率 1');
    check(succVelocityOf(fl) === 2, `速度 v = 1 步/秒 × 2 = 2 计数/秒（实得 ${succVelocityOf(fl)}）`);
    const flrt = createS0Runtime(fl);
    tickS0(fl, flrt, 0.5, 0);
    check(Math.abs(fl.n - 1) < 1e-9, `0.5 秒后 n=${fl.n}（应为 1）`);
    check(nFloor(fl) === 1, `取整显示 ⌊${fl.n}⌋ = 1`);
    tickS0(fl, flrt, 0.5, 0);
    check(Math.abs(fl.n - 2) < 1e-9, `再 0.5 秒后 n=${fl.n}（应为 2 ⇒ 每 0.5 秒 +1）`);
    // 细步长等价性：拆成 25 个 20ms tick，产量与一个 0.5s tick 一致（tickMs 只改细度）
    const f2 = createS0State();
    f2.base = 8;
    f2.upgrades.succGain = 1;
    f2.upgrades.succStream = 1;
    const f2rt = createS0Runtime(f2);
    for (let i = 0; i < 25; i++) tickS0(f2, f2rt, 0.02, 0);
    check(Math.abs(f2.n - 1) < 1e-9, `25 × 20ms（合计 0.5s）⇒ n=${f2.n}（与单步 0.5s 等价）`);

    // 自动极限（用户定案 2026-10-03：从基 7 延后到**基 5** 解锁）
    // ⚠️ C 项门槛约束：autoLimit 价恒为 ω⁶（E=6），而各基换基门槛不随基单调——
    //   base5 门槛 5¹⁰=9765625 > 5⁶=15625 ⇒ 可买；base6 门槛 6⁷=279936 > 6⁶=46656 ⇒ 可买；
    //   base7 门槛 7⁵·2=33614 < 7⁶=117649 ⇒ 受门槛约束压到 0 级（买不到）。
    //   故「base7 买不到」现在由门槛约束解释（而非 unlockBase），断言仍成立。
    const alEarly = createS0State();
    alEarly.base = 7;
    alEarly.ordinalCount = 1_000_000;
    check(upgradeCostOf('autoLimit', 0, 7) === null, 'base7 自动极限受门槛约束：价 7⁶=117649 > 门槛 33614 ⇒ 不可买');
    check(!canBuyUpgrade(alEarly, 'autoLimit'), '基 7 时自动极限不可买（门槛约束，有钱也买不了）');
    check(buyUpgrade(alEarly, 'autoLimit', 0) === false, '基 7 买自动极限 → 返回 false');
    // 可买区间：base5 / base6（验证窗口仍成立）
    check(upgradeCostOf('autoLimit', 0, 6)!.count === 46656, `base6 自动极限可买：价 6⁶ = 46656（实得 ${upgradeCostOf('autoLimit', 0, 6)!.count}）`);
    check(upgradeCostOf('autoLimit', 0, 5)!.count === 15625, `base5 自动极限可买：价 5⁶ = 15625（实得 ${upgradeCostOf('autoLimit', 0, 5)!.count}）`);

    const al = createS0State();
    al.base = 5;
    // 用户定案 2026-10-03：价由 ω⁴ 上调为 ω⁶ ⇒ E=6 ⇒ 计数 base⁶（base5 = 15625）
    al.ordinalCount = upgradeCostOf('autoLimit', 0, 5)!.count;
    check(al.ordinalCount === 15625, `自动极限价 ω⁶ @base5 = 5⁶ = 15625（实得 ${al.ordinalCount}）`);
    check(buyUpgrade(al, 'autoLimit', 0), '基 5 买下自动极限');
    const alrt = createS0Runtime(al);
    al.n = al.base; // 置到可极限
    tickS0(al, alrt, 0.1, 5.0);
    check(al.alpha.t !== 'zero', `自动极限：n≥base 自动极限 → α=${ord(al.alpha)}`);
    check(al.n === 0, `极限后 n 清零（n=${al.n}）`);

    // 小数累加器 + 取整显示（用户定案：n 内部连续、页面只见整数）
    const fr = createS0State();
    fr.base = 8;
    fr.n = 2.7;
    check(nFloor(fr) === 2, `取整显示：⌊2.7⌋ = ${nFloor(fr)}（页面只见整数）`);
    fr.n = 8.5;
    check(canLimit(fr), 'n=8.5 时 ⌊n⌋=8 ≥ base 8 ⇒ 可极限');
    const a0 = fr.ordinalCount;
    check(limitS0(fr, createS0Runtime(fr), 0), '小数计数可极限');
    check(fr.ordinalCount - a0 === 8, `极限只兑现整数部分：a += ⌊8.5⌋ = 8（实得 ${fr.ordinalCount - a0}）`);
    check(Math.abs(fr.n - 0.5) < 1e-9, `小数余量 0.5 留作计数继续累积（n=${fr.n}）`);
    check(Number.isInteger(fr.ordinalCount), '序数计数 a 恒为整数（hereditaryToOrdinal 的前提）');
  }

  // ⑨ 里程碑
  {
    const ms = runFullS0().st.milestones;
    console.log(`\n⑨ 里程碑：${ms.join(' ') || '（空）'}`);
    check(
      ms.includes('s0.omega') && ms.includes('s0.omegaomega') && ms.includes('s0.eps0') && ms.includes('s0.base2'),
      'ω / ω^ω / ε₀ / base2 均记录'
    );
    void st;
  }

  // ⑩ 双射不变量：整张 base×n 网格上的 V_b(n) 都必须是合法 Cantor 范式
  {
    let allOk = true;
    for (const b of [10, 9, 8, 7, 6, 5, 4, 3, 2]) {
      for (const n of [0, 1, 2, 3, 4, 9, 16, 27, 100, 1000]) {
        const a = hereditaryToOrdinal(n, b);
        if (a.t === 'cnf' && !checkBijection(a)) allOk = false;
      }
    }
    console.log(`\n⑩ 双射不变量：base×n 网格全部 ${allOk ? 'OK' : '✗'}`);
    check(allOk, '所有 V_b(n) 都是合法 CNF 或 ε₀');
  }

  // ⑪ 升级解锁进度门控（随换基进度）+ 刷新步长 tickMs 驱动引擎步长
  {
    console.log('\n⑪ 升级解锁进度（基10 无 / 基9 首现 succGain+succStream / 基8 首现 limitDeepen / 基6 首现 resonance / 基5 首现 autoLimit / 基3 首现 limitBreak）');
    const at = (b: number): string[] =>
      S0_UPGRADES.filter((u) => isUpgradeUnlocked(u.id, b)).map((u) => u.id);
    check(at(10).length === 0, `基 10：无升级（实得 [${at(10).join(',')}]）`);
    // ⚠️ 前次改动（2026-10-06）：基 9 同时解锁前两个升级（succGain + succStream）；基 8 额外解锁 limitDeepen。
    check(at(9).join(',') === 'succGain,succStream', `基 9：succGain + succStream（实得 [${at(9).join(',')}]）`);
    check(
      at(8).join(',') === 'succGain,succStream,limitDeepen',
      `基 8：+limitDeepen（共鸣已延后到基 6；实得 [${at(8).join(',')}]）`,
    );
    check(
      at(7).join(',') === 'succGain,succStream,limitDeepen',
      `基 7：+limitDeepen（自动极限已延后到基 5；实得 [${at(7).join(',')}]）`,
    );
    check(
      at(6).join(',') === 'succGain,succStream,limitDeepen,resonance',
      `基 6：+resonance，仍无自动极限（实得 [${at(6).join(',')}]）`,
    );
    check(
      at(5).join(',') === 'succGain,succStream,limitDeepen,resonance,autoLimit',
      `基 5：+autoLimit（破限要到基 3；实得 [${at(5).join(',')}]）`,
    );
    check(at(3).length === S0_UPGRADES.length, `基 3：全部解锁（+破限；实得 [${at(3).join(',')}]）`);
    check(!isUpgradeUnlocked('limitBreak', 4), '破限是基 3 专属：基 4 尚未解锁');
    // 前三条升级的上限随换基进度逐级抬高（succGain/succStream 基7 起 +1；limitDeepen 基6 起 +1）；
    // ⚠️ 各值已被「换基门槛约束（C 项）」再压一层 —— 例：base9 succGain L3 价 9⁵=59049 ≥ 门槛 2187 ⇒ 压到 2。
    check(s0UpgradeMax('succGain', 9) === 2, `succGain 上限 @基9 = 2（门槛约束后；实得 ${s0UpgradeMax('succGain', 9)}）`);
    check(s0UpgradeMax('succGain', 8) === 2, `succGain 上限 @基8 = 2（门槛约束后；实得 ${s0UpgradeMax('succGain', 8)}）`);
    check(s0UpgradeMax('succGain', 7) === 3, `succGain 上限 @基7 = 3（门槛约束后；实得 ${s0UpgradeMax('succGain', 7)}）`);
    check(s0UpgradeMax('succGain', 6) === 3, `succGain 上限 @基6 = 3（门槛约束后；实得 ${s0UpgradeMax('succGain', 6)}）`);
    check(s0UpgradeMax('succGain', 5) === 5, `succGain 上限 @基5 = 5（门槛约束后；实得 ${s0UpgradeMax('succGain', 5)}）`);
    check(s0UpgradeMax('succGain', 4) === 6, `succGain 上限 @基4 = 6（门槛约束后；实得 ${s0UpgradeMax('succGain', 4)}）`);
    check(s0UpgradeMax('succGain', 3) === 8, `succGain 上限 @基3 = 8（实得 ${s0UpgradeMax('succGain', 3)}）`);
    check(s0UpgradeMax('succStream', 8) === 2, `succStream 上限 @基8 = 2（门槛约束后；实得 ${s0UpgradeMax('succStream', 8)}）`);
    check(s0UpgradeMax('succStream', 7) === 2, `succStream 上限 @基7 = 2（门槛约束后；实得 ${s0UpgradeMax('succStream', 7)}）`);
    check(s0UpgradeMax('succStream', 6) === 3, `succStream 上限 @基6 = 3（门槛约束后；实得 ${s0UpgradeMax('succStream', 6)}）`);
    check(s0UpgradeMax('succStream', 4) === 5, `succStream 上限 @基4 = 5（门槛约束后；实得 ${s0UpgradeMax('succStream', 4)}）`);
    check(s0UpgradeMax('succStream', 3) === 7, `succStream 上限 @基3 = 7（实得 ${s0UpgradeMax('succStream', 3)}）`);
    check(s0UpgradeMax('limitDeepen', 7) === 2, `limitDeepen 上限 @基7 = 2（实得 ${s0UpgradeMax('limitDeepen', 7)}）`);
    check(s0UpgradeMax('limitDeepen', 6) === 3, `limitDeepen 上限 @基6 = 3（实得 ${s0UpgradeMax('limitDeepen', 6)}）`);
    check(s0UpgradeMax('limitDeepen', 5) === 4, `limitDeepen 上限 @基5 = 4（实得 ${s0UpgradeMax('limitDeepen', 5)}）`);
    check(s0UpgradeMax('limitDeepen', 4) === 5, `limitDeepen 上限 @基4 = 5（实得 ${s0UpgradeMax('limitDeepen', 4)}）`);
    check(s0UpgradeMax('limitDeepen', 3) === 6, `limitDeepen 上限 @基3 = 6（实得 ${s0UpgradeMax('limitDeepen', 3)}）`);
    // resonance：恒定 2 级（2026-10-04 二次定案：基 3 初始上限回到 2；破限第 4 级才 +1）
    // ⚠️ C 项门槛约束：base6 门槛 ω^(ω+1)=279936，而 resonance L2 价 6⁸=1679616 > 门槛 ⇒ 压到 L1。
    check(s0UpgradeMax('resonance', 6) === 1, `resonance 上限 @基6 = 1（门槛约束后；实得 ${s0UpgradeMax('resonance', 6)}）`);
    check(s0UpgradeMax('resonance', 4) === 2, `resonance 上限 @基4 = 2（实得 ${s0UpgradeMax('resonance', 4)}）`);
    check(s0UpgradeMax('resonance', 3) === 2, `resonance 上限 @基3 = 2（实得 ${s0UpgradeMax('resonance', 3)}）`);
    // 上限抬到 N ⇒ 仍是阶梯数组的升级必须「项数 ≥ N+1」（下标 = 等级，含 lv=0 档），
    // 否则满级会被 clamp 回上一档 ⇒ 买了没提升。
    // 后继增益已改为幂运算（S0_SUCC_GAIN_BASE^lv），**结构上不再受数组长度制约**，
    // 故这里只守后继流；并额外断言「增益在最高级仍有提升」（幂运算不可能，但防止改回数组）。
    check(
      S0_SUCC_RATE_STEPS.length >= s0UpgradeMax('succStream', S0_BASE_MIN) + 1,
      `后继流阶梯项数 ${S0_SUCC_RATE_STEPS.length} ≥ 上限+1（${s0UpgradeMax('succStream', S0_BASE_MIN) + 1}）`,
    );
    {
      const top = createS0State();
      top.base = S0_BASE_MIN + 1; // 任意基；只看 succGain 最高级是否仍高于次高级
      const maxLv = s0UpgradeMax('succGain', top.base);
      top.upgrades.succGain = maxLv - 1;
      const prev = succGainOf(top);
      top.upgrades.succGain = maxLv;
      const last = succGainOf(top);
      check(last > prev, `succGain 最高级（lv${maxLv}）仍高于次高级（${prev} → ${last}）`);
    }

    // 刷新步长：引擎按 meta.tickMs 动态推进（默认 20ms ⇒ 步长 0.02s）
    const g2 = createGame();
    check(g2.state.meta.tickMs === 20, `默认刷新步长 = 20ms（实得 ${g2.state.meta.tickMs}）`);
    const eng = new Engine(g2.state, g2.rt);
    eng.advance(0.05); // 20ms 步长 ⇒ 2 步（0.04s），余 0.01
    const clockFast = g2.state.clock;
    check(Math.abs(clockFast - 0.04) < 1e-9, `tickMs=20：advance(0.05) ⇒ 2 步、clock=${clockFast.toFixed(3)}`);

    const g3 = createGame();
    g3.state.meta.tickMs = 100; // 步长 0.1s
    const eng3 = new Engine(g3.state, g3.rt);
    eng3.advance(0.05); // 不足一步 ⇒ 不推进
    check(g3.state.clock === 0, `tickMs=100：advance(0.05) ⇒ 尚未满一步、clock=${g3.state.clock}`);
    eng3.advance(0.05); // 补足 ⇒ 1 步
    check(Math.abs(g3.state.clock - 0.1) < 1e-9, `tickMs=100：再 advance(0.05) ⇒ 1 步、clock=${g3.state.clock.toFixed(3)}`);
  }

  // ⑫ 破限 LimitBreak（用户定案 2026-10-04：基 3 专属）+ 设置面板的调试注入
  {
    console.log('\n⑫ 破限 limitBreak（基 3 解锁；前三条升级上限 +1/级）+ 调试注入');

    // 价位：ω^(ω² + ω·(lv−1) + 2)（初始价恒带常数 +2）⇒ @基3 计数 = 3¹¹ / 3¹⁴ / 3¹⁷ / 3¹⁸
    const prices: number[] = [];
    for (let lv = 1; lv <= 4; lv++) {
      const c = upgradeCostOf('limitBreak', lv - 1, 3)!;
      prices.push(c.count);
    }
    console.log(`    破限四档价（@基3 序计数）：${prices.join(' → ')}`);
    check(prices.join(',') === '177147,4782969,129140163,387420489', `破限价（初始 ω^(ω²+2)、倍率 ω^(ω+2)，实得 ${prices.join(',')}）`);
    check(new Set(prices).size === 4, '破限四档严格递增（ω^(ω+2) 倍率 ⇒ 无饱和同价）');
    check(ord(upgradeCostOf('limitBreak', 0, 3)!.ordinal) === 'ω^(ω^2 + 2)', `破限 L1 序数价 = ω^(ω²+2)（实得 ${ord(upgradeCostOf('limitBreak', 0, 3)!.ordinal)}）`);
    check(upgradeCostOf('limitBreak', 4, 3) === null, '破限满级（4 级）后无价 ⇒ 不可再买');
    // 最后一级 ω^(ω² + 3ω + 2)：CNF 规范化后为 ω^(ω² + ω¹·3 + 2)，计数等价量 = 3¹⁸
    check(ord(upgradeCostOf('limitBreak', 3, 3)!.ordinal) === 'ω^(ω^2 + ω^1·3 + 2)', `破限 L4 序数价 = ω^(ω²+3ω+2)（实得 ${ord(upgradeCostOf('limitBreak', 3, 3)!.ordinal)}）`);
    check(prices[3] === Math.pow(3, 18), `破限 L4 计数等价量 = 3¹⁸（实得 ${prices[3]}）`);

    // 解锁门控：基 4 有钱也买不了
    const early = createS0State();
    early.base = 4;
    early.ordinalCount = 1e9;
    check(!canBuyUpgrade(early, 'limitBreak'), '基 4 时破限未解锁 ⇒ 买不了');
    check(buyUpgrade(early, 'limitBreak', 0) === false, '基 4 买破限 → false');

    // 效果：把前三条升级的上限抬高（resonance / autoLimit 不受影响）
    check(limitBreakLv(early) === 0, '未买破限时 limitBreakLv = 0');
    check(s0UpgradeMax('succGain', 3, 0) === 8, `未破限：succGain 上限 @基3 = 8（实得 ${s0UpgradeMax('succGain', 3, 0)}）`);
    check(s0UpgradeMax('succGain', 3, 1) === 9, `破限1级：succGain 上限 8 → ${s0UpgradeMax('succGain', 3, 1)}`);
    check(s0UpgradeMax('succGain', 3, 4) === 12, `破限4级：succGain 上限 → ${s0UpgradeMax('succGain', 3, 4)}`);
    check(s0UpgradeMax('succStream', 3, 4) === 11, `破限4级：succStream 上限 → ${s0UpgradeMax('succStream', 3, 4)}`);
    check(s0UpgradeMax('limitDeepen', 3, 4) === 6, `破限4级：limitDeepen 仍 6（破限只抬前两个，实得 ${s0UpgradeMax('limitDeepen', 3, 4)}）`);
    check(s0UpgradeMax('resonance', 3, 4) === 3, `破限4级：resonance 到 3（基3 初值 2 + 破限4级 +1，实得 ${s0UpgradeMax('resonance', 3, 4)}）`);
    check(s0UpgradeMax('autoLimit', 3, 4) === 1, '破限不动自动极限（仍 1 级）');
    // 上限抬到 11 ⇒ 后继流阶梯必须有 ≥12 项（下标 = 等级，含 lv=0 档）
    check(
      S0_SUCC_RATE_STEPS.length >= s0UpgradeMax('succStream', 3, 4) + 1,
      `破限4级后：后继流阶梯项数 ${S0_SUCC_RATE_STEPS.length} ≥ 上限+1（${s0UpgradeMax('succStream', 3, 4) + 1}）`,
    );
    // 端到端：买下破限后，前三条真的能买到被抬高的那一级（漏传 limitBreak 会在这里现形）
    const lb = createS0State();
    lb.base = 3;
    lb.ordinalCount = 2e9; // 够买满 succGain 10 级（L10 价 3¹⁹≈1.16e9，累计≈1.31e9）
    check(buyUpgrade(lb, 'limitBreak', 0), '基 3 买下破限 L1（价 3¹¹ = 177147）');
    check(limitBreakLv(lb) === 1, `破限等级 = ${limitBreakLv(lb)}`);
    check(buyUpgrade(lb, 'limitBreak', 0) && lb.upgrades.limitBreak === 2, '再买一级 ⇒ 破限 2 级');
    let bought = 0;
    while (buyUpgrade(lb, 'succGain', 0) && bought < 30) bought++;
    check(lb.upgrades.succGain === 10, `破限2级：succGain 买到 ${lb.upgrades.succGain} 级（上限 8+2 = 10）`);
    check(upgradeCostOf('succGain', lb.upgrades.succGain, 3, limitBreakLv(lb)) === null, '到破限后的新上限 ⇒ 无价（已满级）');

    // 调试注入（设置面板）：直接加计数 n / 序数计数 a
    const dj = createS0State();
    dj.base = 5;
    const n0 = dj.n;
    check(debugAddCount(dj, 1234), '调试注入：计数 n += 1234');
    check(dj.n - n0 === 1234, `注入后 n = ${dj.n}`);
    check(!debugAddCount(dj, -1) && !debugAddCount(dj, NaN), '非法注入（负数 / NaN）一律拒绝');
    check(debugAddOrdinalCount(dj, 100), '调试注入：序数计数 a += 100');
    check(dj.ordinalCount === 100, `注入后 a = ${dj.ordinalCount}`);
    check(
      ord(dj.alpha) === ord(hereditaryToOrdinal(100, 5)),
      `注入后 α 立即重算 = ${ord(dj.alpha)}（V_5(100)）`,
    );
    check(Number.isInteger(dj.ordinalCount), '注入后 a 仍是整数（hereditaryToOrdinal 的前提）');
    // 「补满换基门槛」的语义：注入到门槛 ⇒ 立即可以换基（顺带再验一次基 3 的 ε₀ 转折）
    const gate = createS0State();
    gate.base = 3;
    const need = ordinalToCount(rebaseGateAlpha(3), 3);
    debugAddOrdinalCount(gate, need);
    check(need === 7625597484987, `基 3 门槛 ω^(ω^ω) 的计数等价量 = 3²⁷ = ${need}`);
    check(canRebase(gate, createS0Runtime(gate)), '注入满门槛 ⇒ 基 3 立即可以换基（撞 ε₀ ⇒ 允许换基）');
    check(rebaseS0(gate, createS0Runtime(gate), 0) && gate.base === 2, '换到基 2 成功');
  }

  if (!pass) process.exitCode = 1;
  console.log(pass ? '\n  ✅ S0 冒烟全绿' : '\n  ❌ S0 冒烟存在失败项');
}

// ───────────────────────────── S1 点层 ─────────────────────────────

function smokeS1(): void {
  const { state, rt } = createGame();
  const st = state.layers.s1;
  const s1rt = rt.s1;
  console.log('\n═════════ S1 点层 · headless 冒烟 ═════════\n');
  console.log(`标定：c0 = ${st.c0.toExponential(4)}   τ_eff = ${st.tauEff.toFixed(1)} s`);
  console.log(`目标曲线：${fmtTime(S1_TARGETS.tStart)} → ${fmtTime(S1_TARGETS.tEnd)}，${S1_TARGETS.runs} 轮\n`);
  console.log('轮   实际      目标      偏差     Φ(摆法)  Φ(有效)  Θ         lv');

  let clock = 0;
  const rows: Array<{ t: number; tg: number }> = [];
  let epsAtHex = new Decimal(0);

  for (let n = 0; n < S1_TARGETS.runs; n++) {
    // 主动玩家：开局立刻用参考最优摆法摆满
    st.auto = false;
    fillReference(st, s1rt);
    const boardPhi = phiOf(s1rt.board);
    st.lastActionAt = clock;
    st.attnLeft = st.tauEff;

    const t0 = clock;
    let guard = 0;
    while (st.round === n && guard < 2_000_000) {
      // 专注窗口内持续"操作"（维持 lastActionAt），注意力耗尽后停止 → 自然转入挂机档
      if (st.attnLeft > 0 && clock - st.lastActionAt >= IDLE_WINDOW_SEC * 0.5) {
        st.lastActionAt = clock;
      }
      clock += DT;
      tickS1(st, s1rt, DT, clock);
      guard++;
    }
    if (guard >= 2_000_000) {
      console.log(`  ⚠ 第 ${n} 轮停留（未能在合理步数内完成）`);
      break;
    }
    if (st.round === HEX_UNLOCK_RUN) epsAtHex = st.eps;
    const t = clock - t0;
    const tg = targetTime(S1_TARGETS, n);
    rows.push({ t, tg });
    if (n < 5 || n % 20 === 0 || n === S1_TARGETS.runs - 1) {
      const dev = Math.abs(Math.log(t / tg)) * 100;
      console.log(
        `${String(n).padStart(3)}  ${fmtTime(t).padEnd(9)}  ${fmtTime(tg).padEnd(9)}  ` +
          `${dev.toFixed(1).padStart(5)}%   ${boardPhi.toFixed(3)}    ${st.phiCur.toFixed(3)}    ` +
          `${st.theta.toExponential(2)}  ${st.lv}`
      );
    }
  }

  if (rows.length) {
    const devs = rows.map((r) => Math.abs(Math.log(r.t / r.tg)));
    const maxDev = Math.max(...devs);
    const meanDev = devs.reduce((a, b) => a + b, 0) / devs.length;
    const ts = rows.map((r) => r.t);
    console.log(`\n结果：`);
    console.log(`  完成轮数 ${rows.length} / ${S1_TARGETS.runs}`);
    console.log(`  耗时范围 ${fmtTime(Math.min(...ts))} – ${fmtTime(Math.max(...ts))}`);
    console.log(`  对目标曲线的偏差：均值 ${(meanDev * 100).toFixed(1)}%  最大 ${(maxDev * 100).toFixed(1)}%`);
    console.log(`  累计 ε ${fmt(st.eps)}   末态 Θ ${st.theta.toExponential(2)}   lv ${st.lv}`);
    const ok = rows.length === S1_TARGETS.runs && maxDev < 0.25;
    console.log(`\n  ${ok ? 'PASS' : '✗ FAIL'}（判据：跑满全部轮次 且 最大偏差 < 25%）`);
    if (!ok) process.exitCode = 1;
  }

  // 三角格的 ε 价格必须「走到那一轮就买得起」（0阶货币买 0阶升级）
  {
    const okPrice = epsAtHex.gte(HEX_COST_EPS);
    console.log(
      `\n三角格定价：第 ${HEX_UNLOCK_RUN} 轮的 ε = ${fmt(epsAtHex)}  vs 价格 ${fmt(HEX_COST_EPS)}` +
        `  ⇒ ${okPrice ? '买得起' : '✗ 买不起（价格标高了）'}`
    );
    console.log(`  ${okPrice ? 'PASS' : '✗ FAIL'}（判据：第 ${HEX_UNLOCK_RUN} 轮时 ε ≥ HEX_COST_EPS）`);
    if (!okPrice) process.exitCode = 1;
  }

  // 存档往返：Decimal ↔ string、occ ↔ number[] 必须无损
  {
    const snap = JSON.stringify({
      v: st.v.toString(),
      eps: st.eps.toString(),
      c0: st.c0.toString(),
      occ: st.occ,
      lv: st.lv,
    });
    const back = JSON.parse(snap);
    const okV = new Decimal(back.v).eq(st.v);
    const okE = new Decimal(back.eps).eq(st.eps);
    const okC = new Decimal(back.c0).eq(st.c0);
    const okOcc = Array.isArray(back.occ) && back.occ.every((x: unknown) => typeof x === 'number');
    console.log(
      `\n存档往返：v ${okV ? 'OK' : '✗'}  eps ${okE ? 'OK' : '✗'}  c0 ${okC ? 'OK' : '✗'}  ` +
        `occ[${back.occ.length}] ${okOcc ? 'OK' : '✗'}  lv ${back.lv === st.lv ? 'OK' : '✗'}`
    );
    if (!(okV && okE && okC && okOcc)) process.exitCode = 1;
  }

  // 有效 Φ 的档位检验：确认主动/挂机倍率落在 2.0–2.5×
  st.auto = false;
  fillReference(st, s1rt);
  st.attnLeft = st.tauEff;
  st.lastActionAt = 0;
  st.clockSinceAction = 0;
  const phiHand = effectivePhi(st, s1rt, DT);
  st.attnLeft = 0;
  st.clockSinceAction = 999;
  let phiIdle = phiHand;
  for (let i = 0; i < 4000; i++) phiIdle = effectivePhi(st, s1rt, DT); // 熵衰到底
  console.log(`\n档位检验：Φ_hand = ${phiHand.toFixed(3)}  Φ_idle = ${phiIdle.toFixed(3)}  倍率 ${(phiHand / phiIdle).toFixed(2)}×`);
  console.log(`  （Q3 目标 2.0–2.5×；均由 constants.PHI_HAND / PHI_IDLE 单一来源决定）`);

  // 里程碑：参考最优摆法（Φ≈1.0）应触发 s1.phi90 / s1.phi99
  {
    const has90 = st.milestones.includes('s1.phi90');
    const has99 = st.milestones.includes('s1.phi99');
    console.log(`\n里程碑：s1.phi90=${has90}  s1.phi99=${has99}  bestPhi=${st.bestPhi.toFixed(3)}`);
    const okMs = has90 && has99;
    console.log(`  ${okMs ? 'PASS' : '✗ FAIL'}（判据：参考最优摆法触发高 Φ 里程碑）`);
    if (!okMs) process.exitCode = 1;
  }
}

// ───────────────────── 内容填充：自动化戒律9 / 格子升阶(ε sink) / 里程碑 ─────────────────────

function smokeContent(): void {
  let pass = true;
  console.log('\n═════════ 内容填充 · 自动化戒律9 / 格子升阶(ε sink) / 里程碑 ═════════\n');

  // ① 自动化戒律9：本轮只要有一枚点由自动求解器放置，Φ 即封顶 ≤ 0.65
  {
    const { state, rt } = createGame();
    const st = state.layers.s1;
    const s1rt = rt.s1;
    st.auto = true;
    st.round = 100; // 已过 50% ⇒ 自动解锁
    st.attnLeft = st.tauEff;
    st.clockSinceAction = 0;
    fillReference(st, s1rt); // 铺满最优盘（Φ 潜力 = 1.0）
    st.autoPlaced = requiredPoints(st); // 语义：本轮全部由自动放置
    const phiCapped = effectivePhi(st, s1rt, DT);

    st.autoPlaced = 0; // 同盘面、纯手动 ⇒ 应可达高 Φ
    const phiUncapped = effectivePhi(st, s1rt, DT);

    // 反绕过：自动铺满后玩家"手动补最后一枚"，autoPlaced 仍 ≥1 ⇒ 必须继续封顶
    st.autoPlaced = 1;
    const phiBypass = effectivePhi(st, s1rt, DT);

    console.log(`自动化戒律9：自动铺满 Φ=${phiCapped.toFixed(3)}  同盘纯手动 Φ=${phiUncapped.toFixed(3)}  手动补最后一枚 Φ=${phiBypass.toFixed(3)}`);
    const ok = phiCapped <= PHI_AUTO_CAP + 1e-6 && phiUncapped > 0.9 && phiBypass <= PHI_AUTO_CAP + 1e-6;
    console.log(`  ${ok ? 'PASS' : '✗ FAIL'}（判据：自动封顶 ≤ 0.65 且 手动可达高 Φ 且 补最后一枚不能绕过）`);
    if (!ok) pass = false;

    // 真实路径：跑 tickS1，自动求解器应自行置点并计入 autoPlaced
    const g = createGame();
    const gs = g.state.layers.s1;
    gs.auto = true;
    gs.round = 100;
    gs.attnLeft = gs.tauEff;
    let c = 0;
    for (let k = 0; k < 40; k++) {
      c += DT;
      tickS1(gs, g.rt.s1, DT, c);
    }
    const phiTicked = effectivePhi(gs, g.rt.s1, DT);
    const okTick = gs.autoPlaced > 0 && phiTicked <= PHI_AUTO_CAP + 1e-6;
    console.log(`  真实 tick 路径：autoPlaced=${gs.autoPlaced}  Φ=${phiTicked.toFixed(3)}`);
    console.log(`  ${okTick ? 'PASS' : '✗ FAIL'}（判据：tickS1 自动置点且 Φ 受封顶）`);
    if (!okTick) pass = false;
  }

  // ② 格子升阶 + S1 的 sink：第 40 轮后花本层 0阶货币 ε 解锁三角格
  {
    const { state, rt } = createGame();
    const s1 = state.layers.s1;
    s1.round = HEX_UNLOCK_RUN;
    s1.eps = HEX_COST_EPS.add(new Decimal('1'));
    const epsBefore = s1.eps;
    const ok = tryUnlockHex(state.meta, state.layers as Record<LayerId, unknown>, rt);
    const okUnlock = ok && s1.hexUnlocked && s1.lattice === 'hex' && rt.s1.board.kind === 'hex';
    const okEps = s1.eps.eq(epsBefore.sub(HEX_COST_EPS)) && s1.eps.lt(epsBefore);
    const okMs = 's1.hex' in state.meta.milestones && s1.milestones.includes('s1.hex');
    console.log(`格子升阶：解锁=${ok} 盘面=${s1.lattice} ε ${fmt(epsBefore)} → ${fmt(s1.eps)}`);
    const okAll = okUnlock && okEps && okMs;
    console.log(`  ${okAll ? 'PASS' : '✗ FAIL'}（判据：切三角格 + 扣 ε + 记里程碑）`);
    if (!okAll) pass = false;

    // 反向守卫：轮次不足 / ε 不足必须拒绝
    const a = createGame();
    a.state.layers.s1.round = 10;
    a.state.layers.s1.eps = HEX_COST_EPS.add(new Decimal('1'));
    const failRound = !tryUnlockHex(a.state.meta, a.state.layers as Record<LayerId, unknown>, a.rt);
    const b = createGame();
    b.state.layers.s1.round = HEX_UNLOCK_RUN;
    b.state.layers.s1.eps = new Decimal('0');
    const failEps = !tryUnlockHex(b.state.meta, b.state.layers as Record<LayerId, unknown>, b.rt);
    console.log(`  反向守卫：轮次不足拒绝=${failRound}  ε不足拒绝=${failEps}`);
    if (!(failRound && failEps)) pass = false;
  }

  // ③ 自动解锁门控：round < 50% 时未解锁
  {
    const { state } = createGame();
    state.layers.s1.round = 10;
    const locked = !isAutoUnlocked(state.layers.s1);
    state.layers.s1.round = S1_AUTO_UNLOCK_RUN;
    const unlocked = isAutoUnlocked(state.layers.s1);
    console.log(`自动门控：round=10 解锁=${!locked}  round=${S1_AUTO_UNLOCK_RUN} 解锁=${unlocked}`);
    const okGate = locked && unlocked;
    console.log(`  ${okGate ? 'PASS' : '✗ FAIL'}`);
    if (!okGate) pass = false;
  }

  // ④ 经济切换守卫：meta 上不得再有跨层货币「迭代 It」
  {
    const { state } = createGame();
    const hasIt = 'it' in (state.meta as unknown as Record<string, unknown>);
    const hasOrder = 'order1' in (state.meta as unknown as Record<string, unknown>);
    console.log(`经济切换：meta.it 已移除=${!hasIt}  meta.order1 存在=${hasOrder}  初始序=${fmt(state.meta.order1)}`);
    const okEco = !hasIt && hasOrder && state.meta.order1.eq(0);
    console.log(`  ${okEco ? 'PASS' : '✗ FAIL'}（判据：无 meta.it、有 meta.order1 且初始为 0）`);
    if (!okEco) pass = false;
  }

  if (!pass) process.exitCode = 1;
  console.log(pass ? '\n  ✅ 内容填充冒烟全绿' : '\n  ❌ 内容填充冒烟存在失败项');
}

async function main(): Promise<void> {
  smokeS0();
  smokeS1();
  smokeContent();
}

main();
