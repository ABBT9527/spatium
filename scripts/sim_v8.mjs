// bal-sim v8 — 「维度阶梯」六层重置层数值模拟（纯 JS，无依赖）   node scripts/sim.mjs
//
// 目标且与 v7 不同：不再追求"短周目"，而是对齐 Fundamental / AD 量级的硬核体量：
//   主脊 6 层（S0 序数 → S1 点 → S2 线 → S3 面 → S4 体 → S5 胞）累计 ≈ 310 h 主动游玩
//   + 元层（五行 / 挑战 / 研究 / 复盘）≈ 50 h   ⇒  首周目 ≈ 360 h ≈ 3 个月 @4h/日
//
// 稳定性定理（数值第一戒律，不可违反）：
//   每轮重置耗时 t = V*/R，V* = (tgt/A)^(1/e_eff)，R = R0·s^lv
//   ⇒ d(ln t)/d(lv) = ln(r)/e_eff − ln(s)
//   ⇒ 不发散、不停留 ⟺ e_eff ≡ e* = ln(r)/ln(s)  精确成立（偏离 1% → 150 轮后耗时掉到 1/6）
//   ⇒ 阶段推进（章节/涌升）只能给「常数偏移 A」，绝不能改变弹性。

const LN = Math.log;
const eStar = (r, s) => LN(r) / LN(s);

// 本轮累计产出 V(t)：线性 + 有界累积项（长在线奖励，上限 ×2）
function vAt(t, Rb, dfRate, dfCap) {
  const tc = dfCap / dfRate;
  return t <= tc
    ? Rb * (t + 0.5 * dfRate * t * t)
    : Rb * (tc + 0.5 * dfRate * tc * tc) + Rb * (1 + dfCap) * (t - tc);
}

function simulate(p) {
  const eS = eStar(p.r, p.s);
  const A = (ph) => Math.pow(p.phaseBonus, ph);
  let ph = 0, lv = 0, earned = 0, entryEarned = 0;
  const runs = [];
  let totalTime = 0;
  const costOf = (n) => p.c0 * Math.pow(p.r, n);
  const gate = () => entryEarned * Math.pow(3, p.shiftPow);
  const vGate = Math.pow(10, p.kMin);

  for (let i = 0; i < p.safety; i++) {
    const Rb = p.manualRate * Math.pow(p.s, lv);
    const tgt = costOf(lv + p.lead);
    const kb = eS * (1 + (p.eDev || 0));
    const epsOf = (V) => A(ph) * Math.pow(10, kb * (LN(V) / LN(10)));

    const cond = (t) => {
      const V = vAt(t, Rb, p.dfRate, p.dfCap);
      return V >= vGate && epsOf(V) >= tgt;
    };
    let lo = 0, hi = p.maxRunSec;
    if (!cond(hi)) { runs.push({ i, ph, t: Infinity, stalled: true }); break; }
    for (let k = 0; k < 90; k++) { const m = (lo + hi) / 2; if (cond(m)) hi = m; else lo = m; }
    const t = hi;

    const V = vAt(t, Rb, p.dfRate, p.dfCap);
    const gain = epsOf(V);
    earned += gain; totalTime += t;
    let E = gain;
    while (costOf(lv) <= E) { E -= costOf(lv); lv++; }
    runs.push({ i, ph, t, lv });

    if (entryEarned <= 0) entryEarned = earned;
    if (ph < p.phases - 1 && earned >= gate()) { ph++; entryEarned = earned; }
    else if (ph >= p.phases - 1 && earned >= gate()) break; // 全部章节走完
  }
  return { runs, totalTime, eS };
}

// ---------- 标定：由「目标首轮耗时」反解 c0，由「目标末轮耗时」反解 phaseBonus ----------
function firstRunTime(p) {
  const Rb = p.manualRate;
  const tgt = p.c0 * Math.pow(p.r, p.lead);
  const epsOf = (V) => Math.pow(10, eStar(p.r, p.s) * (LN(V) / LN(10)));
  const cond = (t) => vAt(t, Rb, p.dfRate, p.dfCap) >= Math.pow(10, p.kMin) && epsOf(vAt(t, Rb, p.dfRate, p.dfCap)) >= tgt;
  if (!cond(p.maxRunSec)) return Infinity;
  let lo = 0, hi = p.maxRunSec;
  for (let k = 0; k < 90; k++) { const m = (lo + hi) / 2; if (cond(m)) hi = m; else lo = m; }
  return hi;
}
function solveC0(p, tFirst) {
  let lo = 1, hi = 1e9;
  for (let k = 0; k < 120; k++) {
    const m = Math.sqrt(lo * hi);
    if (firstRunTime({ ...p, c0: m }) > tFirst) hi = m; else lo = m;
  }
  return (lo + hi) / 2;
}
function lastRunTime(p) {
  const { runs } = simulate(p);
  const ts = runs.filter((r) => !r.stalled).map((r) => r.t);
  return ts.length ? ts[ts.length - 1] : Infinity;
}
function actualRuns(p) {
  const { runs } = simulate(p);
  const ts = runs.filter((r) => !r.stalled);
  return { n: ts.length, stalled: runs.some((r) => r.stalled) };
}

// ---------------- 六层目标（seed，全部带 rationale） ----------------
// tStart / tEnd 单位秒。rationale：
//   tStart ≈ 上层 tEnd ×(0.6~0.8)：进新层要靠构形重开局面，先给一个明显更短的"热身轮"
//   tEnd   ≈ 上层 tEnd ×(2.0~2.6)：后期层器局更大、eta;⑦(同步)чий更慢，但活跃密度由"构形"补上，不靠重置频率
//   runs   ：每层的重置次数。累计 = Σ runs·mean ≈ 310 h
const TARGETS = [
  { key: 'S0', name: 'S0 序数', tStart: 120,  tEnd: 540,   runs: 110, phases: 6 },
  { key: 'S1', name: 'S1 点',   tStart: 240,  tEnd: 1200,  runs: 130, phases: 7 },
  { key: 'S2', name: 'S2 线',   tStart: 480,  tEnd: 2100,  runs: 130, phases: 7 },
  { key: 'S3', name: 'S3 面',   tStart: 900,  tEnd: 3300,  runs: 120, phases: 6 },
  { key: 'S4', name: 'S4 体',   tStart: 1500, tEnd: 4500,  runs: 110, phases: 6 },
  { key: 'S5', name: 'S5 胞',   tStart: 2400, tEnd: 5400,  runs: 110, phases: 5 },
];
const BASE = {
  // kMin=1 ⇒ 重置的最低产出门槛 V ≥ 10（约 8 s），不再像 v7 那样把最短轮次钉死在 base^3 上
  r: 2.7, s: 2.0, lead: 1, kMin: 1, manualRate: 1.2,
  dfRate: 0.002, dfCap: 1.0, maxRunSec: 200000, safety: 600,
};
const eS = eStar(BASE.r, BASE.s);
console.log('e* = ln(2.7)/ln(2.0) = ' + eS.toFixed(4));
console.log('目标：主脊 6 层 Σ ≈ 310 h；+ 元层 ≈ 50 h ⇒ 首周目 ≈ 360 h ≈ 3 个月 @4h/日\n');

const results = [];
for (const T of TARGETS) {
  let p = { ...BASE, ...T };
  // 1) c0 ← 目标首轮耗时
  p.c0 = solveC0(p, T.tStart);
  // 2) shiftPow ← 目标「每层总轮数」(每章 runs/phases 轮；runs/phase ≈ 1.106·shiftPow)
  let sp = Math.max(1, Math.round((T.runs / T.phases) / (LN(3) / LN(BASE.r))));
  for (let it = 0; it < 25; it++) {
    const { n } = actualRuns({ ...p, phaseBonus: p.c0 ? 1.0 : 1.0, shiftPow: sp });
    if (Math.abs(n - T.runs) <= 3) break;
    if (n > T.runs) sp = Math.max(1, sp - 1); else sp = sp + 1;
  }
  p.shiftPow = sp;
  // 3) phaseBonus ← 目标末轮耗时。层内耗时按 章节常数偏移 A=bonus^ph 单调变化，
  //    t ∝ A^(−1/e*) ⇒ bonus = (tStart/tEnd)^(e*/(phases−1))；tEnd>tStart 时 bonus<1（偏移递减 = 目标变深）
  let blo = 0.15, bhi = 3.0;
  for (let k = 0; k < 60; k++) {
    const m = 0.5 * (blo + bhi);
    const t = lastRunTime({ ...p, phaseBonus: m });
    if (t > T.tEnd) blo = m; else bhi = m;   // bonus 越大 → 轮越快
  }
  p.phaseBonus = 0.5 * (blo + bhi);

  const { runs, totalTime } = simulate(p);
  const ts = runs.filter((r) => !r.stalled).map((r) => r.t);
  const stalled = runs.some((r) => r.stalled);
  const mn = Math.min(...ts), mx = Math.max(...ts);
  const mean = totalTime / ts.length;
  // 带内判定：全程必须落在 [0.85·tStart, 1.15·tEnd]
  const lo = T.tStart * 0.85, hi = T.tEnd * 1.15;
  const inBand = ts.filter((x) => x >= lo && x <= hi).length;
  const ok = !stalled && mn >= lo && mx <= hi;
  console.log(T.name.padEnd(9) +
    ' 章' + T.phases + '  shiftPow=' + String(sp).padStart(2) +
    '  c0=' + p.c0.toExponential(2) + '  A=' + p.phaseBonus.toFixed(3));
  console.log('   轮数 ' + String(ts.length).padStart(3) + '/' + T.runs +
    '   首轮 ' + (ts[0] / 60).toFixed(1) + 'min   末轮 ' + (mx / 60).toFixed(1) + 'min' +
    '   均值 ' + (mean / 60).toFixed(1) + 'min   层时长 ' + (totalTime / 3600).toFixed(1) + 'h' +
    '   带内 ' + (100 * inBand / ts.length).toFixed(0) + '%   ' +
    (ok ? 'PASS' : 'FAIL' + (stalled ? '（停留）' : mn < lo ? '（发散）' : '（超时）')));
  results.push({ name: T.name, hours: totalTime / 3600, ok, ts, mean, mn, mx, p });
}

const spineH = results.reduce((a, b) => a + b.hours, 0);
const metaH = 50;
console.log('\n主脊累计 ' + spineH.toFixed(1) + 'h  + 元层/挑战/复盘 ' + metaH + 'h  ≈ ' +
  (spineH + metaH).toFixed(0) + 'h ≈ ' + ((spineH + metaH) / 4).toFixed(0) + ' 天 @4h/日');

// ---------------- 敏感性：弹性偏离的指数放大（以 S5 为例，最深层） ----------------
console.log('\n===== 敏感性：e_eff 偏离 e* 的指数放大（用标定好的 S5 参数） =====');
console.log('      S5 设计意图：首轮 40min → 末轮 90min（层内 ×2.25，由章节常数偏移 A=0.74^ph 产生）');
const p5 = { ...BASE, ...TARGETS[5] };
const cal = results[results.length - 1].p;
for (const dev of [0, 0.005, 0.01, 0.02, 0.03, -0.01]) {
  const { runs } = simulate({ ...p5, c0: cal.c0, phaseBonus: cal.phaseBonus, shiftPow: cal.shiftPow, eDev: dev });
  const ts = runs.filter((r) => !r.stalled).map((r) => r.t);
  if (ts.length < 10) { console.log('  e_eff = e*×' + (1 + dev).toFixed(3) + '  → 中止（停在 ' + ts.length + ' 轮）'); continue; }
  const a = ts[1], b = ts[ts.length - 1], n = ts.length;
  console.log('  e_eff = e*×' + (1 + dev).toFixed(3) + '  第1轮 ' + (a / 60).toFixed(1) + 'min → 第' + n +
    '轮 ' + (b / 60).toFixed(1) + 'min   相对设计值漂移 ×' + (b / (90 * 60)).toExponential(1));
}
