/**
 * bal-sim · S0 微模拟 —— 逐基模拟真实换基循环，输出各阶段用时。
 *
 * 与 `scripts/sim.mjs` 的分工：
 *   · `sim.mjs`（v9）是**宏观** bal-sim —— 用 tStart/tEnd/runs 等抽象参数标定
 *     跨 S0~S5 的轮次与节奏，不模拟 S0 的真实换基循环。
 *   · 本脚本是**微观** bal-sim —— 直接调用 `src/game/layers/s0/**` 的真实逻辑
 *     （后继 / 极限 / 换基 / 升级购买），把 base10→base2 每一段跑出来。
 *   ⇒ 调 `S0_REBASE_GATE` / `S0_UPGRADES` / `S0_BASE2_*` 后重跑本脚本即可看新曲线。
 *
 * 口径（用户定案 2026-10-05）：
 *   · 起点 base10、n = a = 0、升级全 0。
 *   · 手动后继 **20 次/秒**（MANUAL_RATE 可调）。
 *   · **自动后继叠加**：a 的每秒增量 = (手动 + 自动步/秒) × 后继步长 × 极限深化份数。
 *     （极限产出是线性的，且小数余量保留 ⇒ 极限点多少次不影响总产量，只影响升级到账时刻。）
 *   · 购买策略：**从前到后、一能买就买**（能连买多级就连买）。
 *   · **换基优先**：a 一到门槛立即换基，不买那种「会把 a 打回门槛以下」的升级
 *     （⇒ base6 的共鸣 L2 价格恰等于该基门槛 6⁸，按此口径**不买**）。
 *   · `--no-cine` 可关闭两段涌升演出的计时（默认计入 base3 ~82s / base2 ~77s）。
 *
 * 运行：npm run balsim:s0
 */

import { createS0State } from '../src/game/layers/s0/state';
import {
  succS0, limitS0, canLimit, canRebase, createRuntime,
  canBuyUpgrade, buyUpgrade, succGainOf, autoSuccRateOf, limitDeepenCopies,
  canBuyBase2Upgrade, buyBase2Upgrade, atBase2Cap,
} from '../src/game/layers/s0/logic';
import {
  S0_UPGRADES, S0_REBASE_GATE, S0_BASE2_UP_COUNT, s0UpgradeMax, S0_BASE_START, S0_BASE_MIN,
} from '../src/game/layers/s0/defs';
import { ordinalToCount, toString as ord } from '../src/game/ordinal/cnf';

/** 手动后继速率（次/秒）—— 调参旋钮 */
const MANUAL_RATE = 20;
/** 两段涌升演出时长（秒）：base3→base2 停在 99.9% 后 4 次点击；base2→S1 走到 100% */
const CINE_B3 = 82;
const CINE_B2 = 77;

const DT = 1 / MANUAL_RATE; // 一个模拟步 = 一次手动后继
const withCine = !process.argv.includes('--no-cine');

interface BaseRow {
  base: number;
  gateTex: string;
  gateCount: number;
  time: number;
  manualSucc: number;
  limits: number;
  aEarned: number;
  gain: number;
  autoRate: number;
  copies: number;
  ups: string;
}

/** 模拟单个基：从 n=a=0、升级全清 开始，跑到 a 达门槛（换基优先）为止 */
function simBase(b: number): BaseRow {
  const st = createS0State();
  st.base = b;
  const rt = createRuntime(st);
  const gate = S0_REBASE_GATE[b]!;
  const gateCount = ordinalToCount(gate, b);
  let t = 0;
  let manualSucc = 0;
  let limits = 0;
  let aEarned = 0;
  for (;;) {
    const gain = succGainOf(st);
    const rate = autoSuccRateOf(st);
    // 一个步长内：自动后继连续流（rate × gain × DT）+ 一次手动后继（gain）
    st.n += rate * gain * DT + gain;
    manualSucc += 1;
    t += DT;
    if (canLimit(st)) {
      const a0 = st.ordinalCount;
      if (limitS0(st, rt, 0)) { limits++; aEarned += st.ordinalCount - a0; }
    }
    if (st.ordinalCount >= gateCount || canRebase(st, rt)) break;
    // 渐进购买：从前到后、一能买就买、能连买就连买
    let bought = true;
    while (bought) {
      bought = false;
      for (const def of S0_UPGRADES) {
        if (canBuyUpgrade(st, def.id)) { buyUpgrade(st, def.id, 0); bought = true; break; }
      }
    }
  }
  const ups = S0_UPGRADES
    .filter((d) => (st.upgrades[d.id] ?? 0) > 0)
    .map((d) => `${d.id} ${st.upgrades[d.id]}/${s0UpgradeMax(d.id, b, st.upgrades.limitBreak ?? 0)}`)
    .join('  ');
  return {
    base: b, gateTex: ord(gate), gateCount, time: t, manualSucc, limits, aEarned,
    gain: succGainOf(st), autoRate: autoSuccRateOf(st), copies: limitDeepenCopies(st),
    ups: ups || '—',
  };
}

/** 基 2：四圈循环（每圈攒满 65536 内部计数 → 一次脚本极限）；无自动后继 */
function simBase2(): { circles: number[]; total: number; time: number } {
  const st = createS0State();
  st.base = 2;
  const rt = createRuntime(st);
  const circles: number[] = [];
  for (let c = 0; c < 4; c++) {
    let succs = 0;
    let guard = 0;
    while (!atBase2Cap(st) && guard++ < 5_000_000) {
      let bought = false;
      for (let k = 0; k < S0_BASE2_UP_COUNT; k++) {
        if (canBuyBase2Upgrade(st, k)) { buyBase2Upgrade(st, k, 0); bought = true; break; }
      }
      if (atBase2Cap(st)) break;
      if (!bought) { succS0(st, 0); succs++; }
    }
    circles.push(succs);
    limitS0(st, rt, 0);
  }
  const total = circles.reduce((a, b) => a + b, 0);
  return { circles, total, time: total / MANUAL_RATE };
}

const fmtT = (s: number): string => {
  if (s < 60) return `${s.toFixed(1)}s`;
  if (s < 3600) return `${(s / 60).toFixed(2)}min`;
  if (s < 86400) return `${(s / 3600).toFixed(2)}h`;
  return `${(s / 86400).toFixed(2)}d`;
};

console.log('════════ S0 阶段用时 · 微模拟（bal-sim）════════');
console.log(`口径：手动后继 ${MANUAL_RATE}/秒；自动后继叠加；购买从前到后一能买就买；换基优先`);
console.log(`演出：${withCine ? `计入（base3 ${CINE_B3}s + base2 ${CINE_B2}s）` : '不计入（--no-cine）'}\n`);

const rows: BaseRow[] = [];
let numeric = 0;
console.log(' base │ 门槛         │ 门槛 a     │ 用时       │ 手动后继 │  极限 │ 总 a 产出  │ 步长 / 自动 / 份数');
console.log('──────┼──────────────┼────────────┼────────────┼──────────┼───────┼────────────┼─────────────────────');
for (let b = S0_BASE_START; b > S0_BASE_MIN; b--) {
  const r = simBase(b);
  rows.push(r);
  numeric += r.time;
  console.log(
    `${String(r.base).padStart(5)} │ ${r.gateTex.padEnd(12)} │ ${r.gateCount.toExponential(3).padStart(10)} │ ` +
    `${(r.time.toFixed(1) + 's').padStart(10)} │ ${String(r.manualSucc).padStart(8)} │ ${String(r.limits).padStart(5)} │ ` +
    `${r.aEarned.toExponential(3).padStart(10)} │ ${r.gain.toExponential(3)} / ${r.autoRate} / ${r.copies}`
  );
}

console.log('\n 各基升级末态（换基前一刻）：');
for (const r of rows) console.log(`  base${String(r.base).padStart(2)}：${r.ups}`);

const b2 = simBase2();
console.log(`\n base 2 │ 四圈循环（每圈攒满 65536 内部计数 → 一次脚本极限）`);
console.log(`   每圈后继次数：${b2.circles.join(' / ')}   合计 ${b2.total}（无自动后继 ⇒ 全手动）`);
console.log(`   用时：${fmtT(b2.time)}`);

const cine = withCine ? CINE_B3 + CINE_B2 : 0;
const grand = numeric + b2.time + cine;
console.log('\n──────── 汇总 ────────');
console.log(`base10→base3（8 个基）    ：${fmtT(numeric)}`);
console.log(`base2（四圈）             ：${fmtT(b2.time)}`);
if (withCine) console.log(`两段涌升演出              ：${fmtT(cine)}`);
console.log(`S0 总计                   ：${fmtT(grand)}（${grand.toFixed(0)}s）`);
console.log(`占总时长最大的基          ：base${rows.reduce((a, b) => (b.time > a.time ? b : a)).base}`);
