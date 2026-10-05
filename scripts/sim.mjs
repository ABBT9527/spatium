// bal-sim v9 — 「Governor + 双档时间 + 尺度轴」重构版      node scripts/sim.mjs
// v8 已归档为 scripts/sim_v8.mjs
//
// ─────────────────────────────────────────────────────────────────────────
// v8 的三个故障点 + 对应修复
//
// 【故障 1】自由度缺失：2 个自由度 (r,s) 被 1 个稳定约束吃掉 ⇒ 剩余 0
//   ⇒ t 只能由 c0 / R0 / A 三个外部平移常数决定，层与层之间只有"数字不同"没有"机制不同"
//   修复：把「等式约束 e_eff ≡ e*」降级为「Governor Θ」——负反馈控制器
//         Θ_{n+1} = Θ_n · (T_n / T_target(n))^(−λ)
//         任意偏差自动吸收 ⇒ 剩余自由度全部释放给内容系统（五行/挑战/研究）
//
// 【故障 2】时间是一维积分：t = V*/R，没有内容密度，没有操作耗时
//   修复：双档时间模型
//         在线手操档 φ_hand = 1.00 ／ 挂机离线档 φ_idle = 0.40（Phase 1 实测修正；与 src/constants.ts 同源）
//         单轮分段：T = τ（操作，高产档） + (V* − R·φ_hand·τ)/(R·φ_idle)（等待，挂机档）
//         且受「每日注意力上限」约束（硬核玩家日均实操 ~2 h）
//
// 【故障 3】数值量级与时长焊死在一根轴 (lv) 上 ⇒ 峰值只有 1e60
//   修复：引入「尺度轴 Ξ」——对称乘在产出侧与目标侧 ⇒ 在 t 的方程中完全约掉
//         证据：本脚本求 t 的代码里连 Ξ 这个符号都不出现
//         ⇒ 「数字多大」与「玩多久」成为两个正交旋钮
//         Ξ 取双指数增长 log10Ξ(n) = Λ₀·κ^n，终态目标见 TARGETS[].E
//
// 【单位口径（v8 踩过的坑）】
//   产出侧单位 = V（流量禀赋），流速 R
//   货币侧单位 = ε，由 ε = A·V^e_eff 换算
//   重置目标在 ε 单位：tgtEps = Θ · c0 · r^(lv+lead)
//   所需产出       ：V* = (tgtEps / A)^(1/e_eff)       ← 必须先做单位换算
// ─────────────────────────────────────────────────────────────────────────

const LN = Math.log, L10 = Math.log10;

const BASE = {
  r: 2.7, s: 2.0, lead: 1, R0: 1.2,
  // —— 时间 / 注意力模型 ——
  // 与 src/game/constants.ts **必须保持一致**（Q3 单一来源）
  phiHand: 1.0,      // 参考最优网格摆法可达的 Φ 上界
  phiIdle: 0.40,     // 求解器维持水平 ⇒ 倍率 2.50×
  phiDecay: 60,      // 熵衰时间常数（秒）——必须进入 solveT 的积分，否则模型与运行时不一致
  dailyAttn: 7200,   // 每日实际注意力上限 2 h
  dailyOnline: 14400,// 每日在线 4 h
  offlineCap: 14400, // 离线结算上限 4 h/日
  daySec: 86400,
  // —— Governor ——
  lam: 0.6,          // Θ 阻尼系数
  rateLim: 1.25,     // 单步修正限速：每轮 Θ 最多变化 25%（1.10→1.25 显著改善容错，>1.25 无收益）
  deadband: 0.05,    // 死区（ln 尺度）：跟踪得住就不动，避免稳态误差被积分器累积
  safety: 1200,
};
// 命令行可覆盖，便于扫容错窗口：  node scripts/sim.mjs rateLim=1.45
for (const a of process.argv.slice(2)) {
  const [k, v] = a.split('=');
  if (k in BASE) BASE[k] = Number(v);
}

// ρ：一天里真正有推进的时间占比（v9 与 v8 的最大分歧点）
//   H（日均在线 4h）：4h 在线 + 4h 离线结算 = 8h  ⇒ ρ = 0.333
//   L（纯挂机）     ：4h 离线结算               ⇒ ρ = 0.167
//   v8 隐含 ρ = 4/24 = 0.167（"只有在线才产出"）但它同时又给
//   准 zaten iz "长在线 ×2 奖励"，口径是矛盾的。v9 把两者显式拆开。
const PROFILE = { H: (BASE.dailyOnline + BASE.offlineCap) / BASE.daySec, L: BASE.offlineCap / BASE.daySec };

// 单轮墙钟求解（**含熵衰积分**，与 src/game/economy/formulas.ts 的 solveT 同一模型）
//   V(T) = R·[φ_hand·τ + φ_idle·(T−τ) + (φ_hand−φ_idle)·τ_d·(1−e^(−(T−τ)/τ_d))]
// 旧版是阶跃的（τ 后立刻 idle），会低估等待期产能 ⇒ 实测比模型快 ~5%，
// 控制器只能把 Θ 一路推高去"假装"追赶。现在显式积分，模型与运行时对齐。
function vAt(T, R, tau, b) {
  if (T <= tau) return R * b.phiHand * T;
  const w = T - tau;
  const decay = (b.phiHand - b.phiIdle) * b.phiDecay * (1 - Math.exp(-w / b.phiDecay));
  return R * (b.phiHand * tau + b.phiIdle * w + decay);
}
function solveT(Vstar, R, tau, b) {
  if (Vstar <= vAt(tau, R, tau, b)) {
    const T = Vstar / (R * b.phiHand);
    return { T, ops: T, wait: 0 };
  }
  let lo = tau, hi = tau + 12000;
  while (vAt(hi, R, tau, b) < Vstar && hi < 1e12) hi *= 2;
  for (let k = 0; k < 80; k++) {
    const m = (lo + hi) / 2;
    if (vAt(m, R, tau, b) < Vstar) lo = m; else hi = m;
  }
  const T = (lo + hi) / 2;
  return { T, ops: tau, wait: T - tau };
}

function vstarOf(b, tgtEps) {
  const eEff = (LN(b.r) / LN(b.s)) * (1 + (b.kDev || 0));
  return Math.pow(tgtEps, 1 / eEff);
}
function costOf(b, n) { return b.c0 * Math.pow(b.r, n); }

function firstRunTime(p, tStart, tau) {
  const tgt = costOf(p, p.lead);
  return solveT(vstarOf(p, tgt), p.R0, tau, p).T;
}
function solveC0(p, tStart, tau) {
  let lo = 1, hi = 1e14;
  for (let k = 0; k < 160; k++) {
    const m = Math.sqrt(lo * hi);
    if (firstRunTime({ ...p, c0: m }, tStart, tau) > tStart) hi = m; else lo = m;
  }
  return (lo + hi) / 2;
}

function runLayer(T, opts = {}) {
  const b = { ...BASE, ...T, tOpsMax: T.tOps, governor: true, ...opts };

  const N = T.runs;
  const tTarget = (n) => T.tStart * Math.pow(T.tEnd / T.tStart, N > 1 ? n / (N - 1) : 0);
  const step = (Th, Tn, n) => {
    const dev = Math.log(Tn / tTarget(n));
    if (Math.abs(dev) < b.deadband) return 1;                    // 死区
    const raw = Math.pow(Tn / tTarget(n), -b.lam);
    return Math.max(1 / b.rateLim, Math.min(b.rateLim, raw));   // 限速
  };

  // τ 依赖 c0（经 mmm崩 roundsPerDay），c0 又依赖 τ ⇒ 外层做 4 次不动点迭代
  let tauEff = b.tOpsMax, roundsPerDay = 0;
  for (let outer = 0; outer < 4; outer++) {
    b.c0 = solveC0(b, T.tStart, tauEff);
    let meanT0 = 0, lv = 0, Th = 1;
    for (let n = 0; n < N; n++) {
      const R = b.R0 * Math.pow(b.s, lv);
      const Tn = solveT(vstarOf(b, Th * costOf(b, lv + b.lead)), R, tauEff, b).T;
      meanT0 += Tn / N;
      Th = b.governor ? Th * step(Th, Tn, n) : 1;
      lv += 1 + (b.extraLv || 0);
      // ★ 硬规则（N2 执行口径）：每次周期重置对 lv 的推进恒定为 1 级。
      //   绝不能用 while 循环"能买几级买几级" —— Θ>1 时那会变成 2 级/轮、11 级/轮，
      //   进而 R 暴涨 → 需要更大 Θ → 更大购买量 ⇒ 正反馈失控。
      //   余量改走「五行精华」等旁支账本，不在产能轨道上复利。
    }
    roundsPerDay = (b.daySec * PROFILE.H) / Math.max(meanT0, 1);
    tauEff = Math.min(b.tOpsMax, b.dailyAttn / Math.max(roundsPerDay, 1e-9));
  }

  // 正式跑（τ 已收敛）
  let lv = 0, Th = 1, totT = 0, totOps = 0, maxTh = 1, minTh = 1, maxDev = 0;
  const rows = [];
  for (let n = 0; n < N; n++) {
    // omega：模拟「违反 N2」的真实情形 —— 某内容系统给了随轮数复利的产能乘数
    //         （五行 ×(1+k·精华)、 parece 挑战叠加之类）。这是最危险的一类添加。
    const R = b.R0 * Math.pow(b.s, lv) * Math.pow(1 + (b.omega || 0), n);
    const tgt = Th * costOf(b, lv + b.lead);
    const sol = solveT(vstarOf(b, tgt), R, tauEff, b);
    if (!isFinite(sol.T)) { rows.push({ n, T: Infinity, stalled: true }); break; }
    rows.push({ n, T: sol.T, ops: sol.ops, wait: sol.wait, lv, R, Th, tgt });
    totT += sol.T; totOps += sol.ops; maxTh = Math.max(maxTh, Th); minTh = Math.min(minTh, Th);
    maxDev = Math.max(maxDev, Math.abs(LN(sol.T / tTarget(n))));
    if (b.governor) Th = Th * step(Th, sol.T, n);
    lv += 1 + (b.extraLv || 0);   // N2 执行口径：恒定 1 级，不得多买
  }
  const rec = { rows, tauEff, roundsPerDay, meanT: totT / Math.max(rows.length, 1), totT, totOps, c0: b.c0, maxTh, minTh, maxDev };
  return rec;
}

// ─────────────────────────────────────────────────────────────────────────
// 尺度轴 Ξ（v10）：不再是"纯表象"，它由「升维换算」这条显式规则生成
//
//   跨层：M_k^start = γ_k · M_{k-1}^end        γ_k = 新层维数 + 1
//         叙述：上一层的全部积累被当作新空间的「单位尺度」；
//               在 (k+1) 维，总量 = 尺度^(k+1) ⇒ 读数取 (k+1) 次幂。
//   层内：M(n) = M^start · κ^n                 κ 由目标末态反解（不是拍的）
//
// ⇒ log10(ε) 本身在层内指数增长、跨层再乘 γ ⇒ 双指数（tetrational）。
// ⇒ 这正是用户指出的那条要求：不能让每层只是「比上一层多几十个数量级」，
//   那在对数视角下只是加法。必须让「对数的对数」线性增长。
// ─────────────────────────────────────────────────────────────────────────
function gauge(T, rows, c0, prevE) {
  const natural = (Th, lv) => L10(Th) + L10(c0) + (lv + 1) * L10(BASE.r);
  const first = rows[0], last = rows[rows.length - 1];
  const startTarget = (T.gamma || 1) * (prevE || 0);        // 升维换算
  const L0 = Math.max(1e-9, startTarget - natural(first.Th, first.lv));
  const LamEnd = Math.max(L0 * 1.0001, T.E - natural(last.Th, last.lv));
  const kap = Math.pow(LamEnd / L0, 1 / Math.max(1, rows.length - 1));
  return rows.map((rw, n) => {
    const Lam = L0 * Math.pow(kap, n);
    return { n, Lam, logEps: Lam + natural(rw.Th, rw.lv) };
  });
}

// ───────── 六层目标（轮数/首末轮同 v8；新增：操作预算 tOps、终态量级 E） ─────────
// 轮数/单轮时长的取值同时由「体感上限」与「内容预算」夹逼：
//   · 单轮 tEnd 上限 ≈ 200 min（超此就变成纯等待，违反"每轮都要有决策"）
//   · 轮数上限 ≈ 内容条目数（每层需 ~1.2× 条目的轮数才能"每轮都有东西可买"）
// 目标：Σ 推进 ≈ 760 h ⇒ 日历 ≈ 95 天 @ρ=0.333
// E     = 该层末态 log10(主资源收益 ε)。目标是「对数的对数」线性增长：
//         log10 E ≈ 1.89, 2.49, 3.33, 4.24, 5.19, 6.19  ⇒ 每层 log 至少 ×4，后段 ×8~10
// gamma = 升维系数 = 新层维数 + 1（点0→1 / 线1→2 / 面2→3 / 体3→4 / 胞4→5）
const TARGETS = [
  { key: 'S0', name: 'S0 序数', tStart: 120,  tEnd: 540,   runs: 110, tOps: 30,   E: 77,      items: 130, gamma: 1 },
  { key: 'S1', name: 'S1 点',   tStart: 240,  tEnd: 1200,  runs: 130, tOps: 90,   E: 308,     items: 150, gamma: 1 },
  { key: 'S2', name: 'S2 线',   tStart: 600,  tEnd: 2400,  runs: 140, tOps: 200,  E: 2160,    items: 170, gamma: 2 },
  { key: 'S3', name: 'S3 面',   tStart: 1500, tEnd: 4800,  runs: 150, tOps: 420,  E: 17300,   items: 180, gamma: 3 },
  { key: 'S4', name: 'S4 体',   tStart: 3000, tEnd: 7800,  runs: 150, tOps: 780,  E: 155700,  items: 180, gamma: 4 },
  { key: 'S5', name: 'S5 胞',   tStart: 6000, tEnd: 12000, runs: 160, tOps: 1400, E: 1556000, items: 190, gamma: 5 },
];

console.log('═════════ bal-sim v9：Governor + 双档时间 + 尺度轴 ═════════\n');
console.log('e* = ln(2.7)/ln(2.0) = ' + (LN(2.7) / LN(2.0)).toFixed(4) + '   （首道防线，不再是唯一防线）');
console.log('玩家模型：φ_hand=' + BASE.phiHand + ' / φ_idle=' + BASE.phiIdle +
  '，日注意力上限 ' + BASE.dailyAttn / 3600 + ' h\n');

const out = [];
let prevE = 0;
for (const T of TARGETS) {
  const r = runLayer(T, { governor: true });
  const g = gauge(T, r.rows, r.c0, prevE);
  out.push({ T, r, g });
  prevE = g[g.length - 1].logEps;   // 跨层连续：下一层的起点由本层末态 × γ 决定
}

console.log('【表 1】单轮的时间构成：有多少分钟是在「操作」，有多少是在「等」');
console.log('层        目标(min)   τ操作(s)   首轮(min)  末轮(min)  均值(min)  操作占比   日轮数');
for (const { T, r } of out) {
  const fin = r.rows.filter((x) => !x.stalled);
  const opsPct = (100 * r.totOps) / Math.max(r.totT, 1);
  console.log(T.name.padEnd(9) +
    ((T.tStart / 60).toFixed(0) + '–' + (T.tEnd / 60).toFixed(0)).padStart(10) +
    r.tauEff.toFixed(0).padStart(10) +
    (fin[0].T / 60).toFixed(1).padStart(11) +
    (fin[fin.length - 1].T / 60).toFixed(1).padStart(11) +
    (r.meanT / 60).toFixed(1).padStart(11) +
    (opsPct.toFixed(1) + '%').padStart(10) +
    r.roundsPerDay.toFixed(1).padStart(9));
}

console.log('\n【表 2】日历时长 — v9 第一次把「重活跃」与「纯挂机」分开算');
let sumH = 0, sumL = 0, pushH = 0;
for (const { T, r } of out) {
  if (!isFinite(r.totT)) { console.log(T.name + '  ✗ 停留'); continue; }
  const h = r.totT / 3600 / PROFILE.H, l = r.totT / 3600 / PROFILE.L;
  sumH += h; sumL += l; pushH += r.totT / 3600;
  console.log(T.name.padEnd(9) + '推进 ' + (r.totT / 3600).toFixed(1).padStart(6) + ' h' +
    '   →  重活跃 ' + (h / 24).toFixed(1).padStart(5) + ' 天' +
    '   纯挂机 ' + (l / 24).toFixed(1).padStart(5) + ' 天');
}
console.log('─'.repeat(70));
console.log('主脊 Σ：推进 ' + pushH.toFixed(1) + ' h  ⇒  重活跃 ' + (sumH / 24).toFixed(1) +
  ' 天 / 纯挂机 ' + (sumL / 24).toFixed(1) + ' 天');
console.log('  （元层：五行 / 挑战 / 复盘与主脊并行穿插，不额外加时间）');
console.log('  ⇒ 首周目 ≈ ' + (sumH / 24).toFixed(0) + ' 天 @重活跃 / ' + (sumL / 24).toFixed(0) +
  ' 天 @纯挂机        目标 ~95 天 @重活跃');

console.log('\n【表 3】数值量级阶梯 — 关键：log10(ε) 本身必须指数增长，不能只做加法');
console.log('层        起点 log10(ε)   末态 log10(ε)   层内倍数   相对上层    终态 ε 表达');
let prevZ = null;
for (const { T, r, g } of out) {
  if (r.rows.some((x) => x.stalled)) { console.log(T.name + ' ✗'); continue; }
  const a = g[0].logEps, z = g[g.length - 1].logEps;
  const big = z >= 1e6 ? '10^(10^' + L10(z).toFixed(2) + ')' : '1e' + z.toFixed(0);
  console.log(T.name.padEnd(10) +
    fmtNum(a).padStart(14) + fmtNum(z).padStart(15) +
    ('×' + (z / a).toFixed(2)).padStart(11) +
    (prevZ === null ? '   —  ' : ('×' + (z / prevZ).toFixed(1)).padStart(7)) +
    '   ' + big.padEnd(16) +
    (z > 308 ? '需大数库' : 'double 内'));
  prevZ = z;
}
function fmtNum(x) { return x >= 1e4 ? x.toExponential(2) : x.toFixed(1); }
console.log('  参照：double 上限 1.8e308（log10=2.26 的对数）⇒ S1 末就到顶，S2 起必须 break_eternity。');

console.log('\n【表 3b】膨胀速度 —— 「数值张力」的直接量化（每重置一轮，数字涨多少）');
console.log('层        轮数   首轮 Δlog10   末轮 Δlog10   层内加速   每轮平均数字涨   体感');
for (const { T, r, g } of out) {
  if (r.rows.some((x) => x.stalled)) { console.log(T.name + ' ✗'); continue; }
  const d1 = g[1].logEps - g[0].logEps;
  const dN = g[g.length - 1].logEps - g[g.length - 2].logEps;
  const dAvg = (g[g.length - 1].logEps - g[0].logEps) / (g.length - 1);
  const feel = dAvg < 2 ? '逐格爬升，看得清每一位' : dAvg < 20 ? '指数段在滚' :
    dAvg < 200 ? '指数段狂滚' : '指数段飞掠，只剩量级有意义';
  console.log(T.name.padEnd(10) + String(g.length).padStart(5) +
    d1.toFixed(2).padStart(13) + dN.toFixed(2).padStart(13) +
    ('×' + (dN / Math.max(d1, 1e-9)).toFixed(2)).padStart(11) +
    ('×10^' + dAvg.toFixed(1)).padStart(17) + '   ' + feel);
}
console.log('  ↑ 用户批评的核心：若每层只比上层多「几十个数量级」，在对数视角下乘法退化为加法，');
console.log('    失去张力。本表要求「每轮涨的倍数」本身逐层放大：×5 → ×60 → ×10^11 → ×10^72 → ×10^4890。');

console.log('\n【表 3c】与参照游戏的量级对照（末态 log10 主资源）');
console.log('  本作 S0 ' + '77'.padEnd(8) + '  S2 ' + '2160'.padEnd(8) + '  S4 ' + '155700'.padEnd(8) + '  S5 ' + '1556000');
console.log('  Fundamental 终局 inflation      ≈ 1e(1e5) 量级   → 本作 S5 与之同档偏上');
console.log('  Antimatter Dimensions Reality   ≈ 1e(1e7) 量级   → 本作终局（无限维段）可触及');
console.log('  ★ 反面教材 v8 峰值              ≈ 1e60          → 只相当于本作 S0 都没走完');

console.log('\n【表 4】鲁棒性：注入扰动后，S5 末轮耗时偏离设计值 200 min 多远');
console.log('扰动                                   无 Governor(v8式)   开 Governor(v9)');
const S5 = TARGETS[5];
for (const inj of [
  { label: '无扰动 baseline', o: {} },
  { label: '弹性偏差 +1%', o: { kDev: 0.01 } },
  { label: '弹性偏差 +3%', o: { kDev: 0.03 } },
  { label: '弹性偏差 +10%', o: { kDev: 0.10 } },
  { label: '产能侧多 +1 级/轮（中性，无害）', o: { extraLv: 1 } },
  { label: '五行给复利产能 ×1.02/轮（违反N2）', o: { omega: 0.02 } },
  { label: '五行给复利产能 ×1.05/轮（违反N2）', o: { omega: 0.05 } },
  { label: '最坏：+10% 弹性 且 ×1.05/轮', o: { kDev: 0.10, omega: 0.05 } },
]) {
  const a = runLayer(S5, { governor: false, ...inj.o });
  const c = runLayer(S5, { governor: true, ...inj.o });
  const fa = a.rows.filter((x) => !x.stalled), fc = c.rows.filter((x) => !x.stalled);
  const ta = fa.length ? fa[fa.length - 1].T / 60 : NaN;
  const tc = fc.length ? fc[fc.length - 1].T / 60 : NaN;
  console.log(inj.label.padEnd(39) + fmtT(ta).padStart(18) + fmtT(tc).padStart(19));
}
function fmtT(x) { return !isFinite(x) ? '停留' : x < 0.05 ? '发散(<3s)' : x.toFixed(1) + ' min'; }
console.log('  设计目标 200.0 min。关 Governor → 偏差被逐轮积分放大；开 → 拉回目标轨道。');

console.log('\n【表 5】Governor 的跟踪精度与代价');
console.log('层        全程偏离设计曲线      Θ 摆动幅度     判定');
for (const { T, r } of out) {
  if (r.rows.some((x) => x.stalled)) { console.log(T.name + ' ✗ 停留'); continue; }
  console.log(T.name.padEnd(9) +
    ('±' + (100 * (Math.exp(r.maxDev) - 1)).toFixed(1) + '%').padStart(16) +
    (r.maxTh / r.minTh).toExponential(1).padStart(15) +
    (r.maxDev < 0.12 ? '       PASS' : '       ✗ 跟踪不足').padEnd(14));
}

console.log('\n【表 6】内容预算 —— 时长不能被"拧旋钮"拧出来，必须内容跟着');
console.log('层        轮数   需内容条目   条目/轮   若只拧旋钮（不补内容）会怎样');
for (const { T, r } of out) {
  const ratio = T.items / T.runs;
  console.log(T.name.padEnd(9) + String(T.runs).padStart(5) + String(T.items).padStart(12) +
    ratio.toFixed(2).padStart(10) + '   ' +
    (ratio >= 1 ? '健康：每轮都有新目标' : '空转：第 ' + Math.round(T.items) + ' 轮后无内容可买'));
}
console.log('  ↑ 这是回答「靠改数值调时长是否说明架构有问题」的验收表：');
console.log('    时长 = Σ轮数 × 单轮时长；轮数必须 ≤ 内容条目数，否则多出来的全是空转。');
