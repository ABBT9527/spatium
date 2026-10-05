/**
 * base3 → base2 涌升演出（仅这一段；base2→S1 是另一段）。
 *
 * 设计要点（用户定案 2026-10-04）：
 *   - base3 全程：换基门槛伪装成「涌升门槛」，按钮叫涌升、进度叫涌升进度，藏住 base2。
 *   - 点涌升（计数条满）：进度条切到涌升进度条开始加载。
 *       · 0→50% 匀速（V0=3.57 %/s，原速一半）；>50% 指数逼近 99.9%，平滑减速。
 *       · p ≥ 50%：文字与按钮开始「抽」（见下面的跳动模型）。
 *       · p ≥ 80%：按钮**不跟文字转 A**，仍守 D，但偶发闪入字面「换基」及其形近字。
 *       · p ≥ 99.9%：按钮定值「换基」（D 跳动：既换位、也变形），进入「再换一次基」阶段。
 *   - 点「换基」：A 方案乱码爆发，之后退回 D 跳动；第 1/2/3 次爆发 0.5s/1s/3s，第 4 次真正换基进 base2。
 *   - 演出期间导航栏乱码且不可点（锁在序数页）；进 base2 后导航栏恢复可点但常驻乱码（故障态）。
 *
 * ── 跳动模型（用户定案 2026-10-04，取代旧的「全局重掷节拍」）──
 *   每个**文本块**在 正常 / 乱码 两态之间来回切；处于乱码态时字会不断跳动。
 *   **强度 = 正常段的长度**（乱码段固定 BURST），而不是增减跳动频次：
 *       · 轻：正常 1200ms → 乱码 140ms → 正常 1200ms（偶尔抽一下）
 *       · 重：正常 0ms   → 一直乱（140ms 一段一段）→ 一直跳
 *   正常段在 base3 里随进度从 GAP_CALM 收到 0（平方缓入 ⇒ 尾段平滑并入「恒乱」）。
 *   每个块各有**自己的相位**（由块名散列而来）⇒ 各块天然错开；乱码段内的跳动间隔每次
 *   在 ±40% 内重新随机 ⇒ 进一步打散同步感（用户定案：「每块错开 / 间隔在范围内随机」）。
 *
 *   两条「回程」（用户定案 2026-10-04）：
 *   - **进 base2**：不让 A 方案「啪」地切回 D —— 逐字淡回 D（SETTLE_SEC），
 *     同时跳动间隔从 70ms 放缓到 **800~1200ms** 随机一拍。
 *   - **base2 涌升**：不再二次乱码 —— 文字随进度**逐字恢复正常**（到 RECOVER_P 全部复原）。
 *
 *   A 爆发收尾（2026-10-04 二次修订）：从 A 回 D 走**逐位错峰退面**（每位只翻一次面、按位置
 *   错开），渐出时长与本次爆发时长挂钩（0.5s→300ms / 1s→450ms / 3s→800ms）。
 *   ⚠️ 旧的「逐位独立伯努利」在 2 字标签上只是频闪（探针实测 220ms 内横跳 7 次）。
 *
 *   ── base2 的**换词脉冲**（2026-10-04 三次修订，用户定案）──
 *   base2 只有一个按钮，词在「后继 / 极限 / 涌升」之间来回。旧版每次换词都叠了两段动画：
 *   先爆发（D→A→D），再走一段 2s morph（D→深D→D→A→D），于是点一次极限会看到
 *   「D→A→D，然后再来一遍 A，最后才落到新词」。现**整段删掉 morph**，改由爆发自己承担换词：
 *     · 上升 / 停在 A（`aBurst > 0`）→ D 侧读**旧词**；
 *     · A→D 下降（`aBurst = 0 && aRamp > 0`）→ D 侧改读**新词**。
 *   切换点恰在 `aRamp` 满档那一帧 —— 那时每一位都是生僻字、D 侧串被完全遮住，
 *   于是「换词」肉眼不可见（base3 的按钮换词也是这样蒙过去的：新词块一出生就处于乱码态）。
 *   起爆者有两个：点击（`base2LimitAttempt`）与撞满自动（`swapPulse`，见 OrdinalPage 的阶段派生）；
 *   两者共用同一套 ramp，故页面侧不必为两条来源各写一份动画。
 *   时长（用户定案 2026-10-05：在 0.5/1/3s 基础上**整体再长 1.5s、两段各加一半**）
 *   见下方的 `B2_HOLD` / `B2_FADE` / `B2_CAP_PULSE_MS`。
 *
 * ⚠️ 关键陷阱（沿用旧版教训）：garble 是**纯随机函数**，若在模板里裸调用，任何一次重渲染
 *    ——序数栏资源刷新（20ms）、rAF 进度推进（16ms）——都会带着新随机数重算一次，
 *    闪烁频率就被刷新率绑架了。故每个块把「已烘焙的乱码串」缓存在自己身上，只在它的
 *    世代号（gen）变化时才重掷 ⇒ 闪烁频率**只由跳动引擎决定**。
 *
 * 纯 UI 状态机：最终换基走 bridge 的 cinematicRebase（rebaseS0(3→2) + 置 base3CineDone）。
 */

import { reactive } from 'vue';
import { useGame } from '@/bridge/useGame';
import { scramble, rndCJK, garbleText } from './garble';

interface CineState {
  /**
   * 演出模式：
   *   'base3' —— base3→base2 的**失败**演出：卡在 99.9%，按钮变「换基」，点 4 次才成。
   *   'base2' —— base2→S1 的**成功**演出：同一条减速曲线，但**能真正抵达 100%** 并涌升。
   */
  mode: 'base3' | 'base2';
  /** 演出进行中（loading 或 rebase 阶段） */
  active: boolean;
  /** 演出期间锁导航（玩家被固定在序数页） */
  lock: boolean;
  /** 涌升进度 0..100 */
  p: number;
  /** p ≥ 99.9%：按钮变换基、进入再换基阶段 */
  showRebase: boolean;
  /** A 方案爆发剩余毫秒（>0 = 处于爆发窗口，此时按钮走 A 乱码的混合） */
  aBurst: number;
  /**
   * A 爆发的**混合档** 0..A_RAMP_STEPS（整数档 ⇒ 反应式只在跨档时触发）。
   * 0 = 全 D（常态）、满档 = 全 A（生僻字）。起爆时 0→满、爆完满→0 都是斜坡
   * ⇒ 进 A 有渐入、回 D 有渐出，不再「啪」地硬切（用户定案 2026-10-04）。
   */
  aRamp: number;
  /** 换基按钮点击次数 */
  clicks: number;
  /** 块跳动计数器：任一文本块换了乱码相就 ++（模板以此建立响应式依赖） */
  gtick: number;
  /** 快拍计数器：数字抖动 / A 爆发用（固定 FAST_MS 一拍） */
  ntick: number;
  /** 越过 50% 后的累计秒数（驱动指数尾段） */
  elapsed50: number;
  /** 是否进入末段线性爬行（指数段只爬到 P_CREEP，见 CREEP_* 注释） */
  creep: boolean;
  /**
   * 进 base2 后的「渐回进度」 0..1（1 = 已完成，稳定在 D 方案 + 800~1200ms 慢跳）。
   * 0 时整页仍是演出收尾的 A 方案；随 rAF 爬到 1 的过程中逐字淡回 D。
   */
  settle: number;
}

export const cine = reactive<CineState>({
  mode: 'base3',
  active: false,
  lock: false,
  p: 0,
  showRebase: false,
  aBurst: 0,
  aRamp: 0,
  clicks: 0,
  gtick: 0,
  ntick: 0,
  elapsed50: 0,
  creep: false,
  settle: 1, // 1 = 不在过渡中（默认「已稳定」）
});

// ── 进度曲线常量 ──
// ⚠️ 曾踩坑：指数段的**渐近上限必须严格高于 P_TARGET**，否则 `p >= P_TARGET` 永远不成立，
//    只能靠浮点把 (1-e^-Kt) 舍入到 1 才触发 —— 实测要等 527 秒才「到」99.9%。
//    故这里上限取满格 100，指数段只负责爬到 P_CREEP，最后 0.9% 由线性爬行补完，
//    既保证在有限时间**精确命中 99.9**，又保留末段「几乎不动」的悬念感。
const V0 = 3.57;              // %/s，0→50% 匀速段（= 演示原速 7.14 的一半，用户确认）
const CAP = 100;              // 指数段渐近上限（须 > P_TARGET）
const HALF = CAP / 2;         // 50：指数段的起始偏移
const K = V0 / HALF;          // 衰减系数：令 50% 处瞬时速度恰为 V0 ⇒ 过半后平滑变慢，无突变
const P_CREEP = 99.0;         // 指数段爬到此值为止，之后切线性爬行
const P_TARGET = 99.9;        // 终值：到此为止，按钮彻底变成「换基」
const CREEP_SEC = 8;          // 末端爬行秒数（视觉上近乎凝滞）；base2 的 99→100 同样走这段
const P_FLICKER = 80;         // 80% 起按钮间歇闪入字面「换基」及其形近字
/** base2 成功演出的终值：**真的到 100%**（与 base3 卡死在 99.9% 形成对照） */
const P_WIN = 100;

// ── 跳动三参数（见文件头「跳动模型」）──
const BURST = 140;            // 乱码段长度（ms）：每次「抽一下」持续多久
const GAP_CALM = 1200;        // p=50 时的正常段长度（ms）：乱码刚起时「一小会儿抽一下」
const JUMP_HOT = 70;          // 乱码段内的跳动间隔中枢（ms）
const JUMP_LOW = 0.6;         // 每次跳动的随机下限系数（⇒ 42ms @ 热端）
const JUMP_HIGH = 1.4;        // 上限系数（⇒ 98ms @ 热端）
const SLOW_MIN = 600;         // 慢拍（价格等数字）跳动间隔下限（ms）
const SLOW_MAX = 1200;        // 上限
const NEVER = 1e9;            // 「恒乱 / 永不动」用的哨兵周期（ms）：大到相位几乎冻结
const FAST_MS = 70;           // 数字抖动 / A 爆发的固定重掷间隔（ms）

// ── A 爆发的「渐入 / 渐出」斜坡（用户定案 2026-10-04；同日二次修订） ──
// 旧版 aBurst 由 setTimeout 直接置 0 ⇒ 按钮从「全 A」**瞬跳**回 D，两侧不对称
// （进 A 是渐变的、回 D 却是硬切）。现在加一条 0..A_RAMP_STEPS 的整数斜坡，
// 由既有的跳动 rAF 循环驱动，按钮文字按档位做 D↔A 的逐位错峰退面。
//
// 二次修订（用户定案，同日）：第一次修完仍「显生硬」，探针（逐帧还原 + 3 万次蒙特卡洛）查明——
//   ① 混合用的是「逐位独立伯努利」：2 字标签只有 4 种可见态、实际出现 3 种，
//      而重掷既发生在每 70ms（ntick）又发生在每跨一档（memo key 含 step）
//      ⇒ 220ms 内画面**横跳 7 次**（≈32Hz，卡在闪烁融合频率），观感是「频闪后急停」。
//      改为**逐位错峰退面**（每位只翻一次面、按位置错开）⇒ 切换次数 7 → 2。
//      ⚠️ 单纯拉长斜坡无效：状态空间不变 ⇒ 只是把频闪放慢（900ms 时横跳反而更多）。
//   ② 渐出时长固定 220ms，而第 3 次爆发长达 3000ms（≈1:14）⇒ 收尾短到读不出「渐」。
//      现改为与本次爆发时长挂钩（见 fadeFor）。
const A_RAMP_STEPS = 6;       // 混合档数（整数档 ⇒ 反应式只在跨档时触发重算）
const A_RAMP_IN_MS = 220;     // **渐入**（0→满）时长：短促、干脆，不随爆发时长变

// ── 进 base2 的「渐回」过渡（用户定案 2026-10-04） ──
// 演出收尾时整页停在 A 方案（生僻字全乱），若不处理会「啪」一下切回 D。
// 故定义一段过渡：A 占比逐字从 100% 淡到 0%（⇒ 全 D），同时跳动间隔从 70ms 放缓到 ~1000ms。
const SETTLE_SEC = 6;         // 过渡时长（秒）
const SETTLE_STEPS = 20;      // 过渡量化档数（连续量离散化，免得每帧都触发重渲染）
const SCAR_MIN = 800;         // 稳定后的故障态跳动间隔下限（ms）
const SCAR_MAX = 1200;        // 上限 —— 「约 800~1200ms 跳一次」
const TICK_CALM = 1800;       // base2 涌升期的最终节拍：文字已基本复原，刷新趋于静止

// ── base2 涌升的「恢复」曲线 ──
// 与 base3 那次相反：这次文字**不再二次乱码**，而是随进度逐个字退回原字形。
const RECOVER_P = 95;         // 进度到 95% 时完全恢复正常

let raf = 0;
let lastT = 0;
let settleRaf = 0;
let burstTimer: number | undefined;

function scarActive(): boolean {
  return !!useGame().view.value.s0?.scar;
}

/**
 * 进度三相：
 *   ① p < 50        —— 匀速 V0；
 *   ② P_CREEP 之前  —— 指数逼近 CAP（初速 = V0，越爬越慢，无突变）；
 *   ③ P_CREEP 之后  —— 线性爬行到 P_TARGET 后**（精确命中）**收尾，锁存按钮为「换基」。
 */
function loop(now: number): void {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  // base2 的成功演出：同一条减速曲线，但终值是 100（真的到得了）
  const target = cine.mode === 'base2' ? P_WIN : P_TARGET;
  if (cine.p < 50) {
    cine.p = Math.min(50, cine.p + V0 * dt);
  } else if (!cine.creep) {
    cine.elapsed50 += dt;
    cine.p = 50 + HALF * (1 - Math.exp(-K * cine.elapsed50));
    if (cine.p >= P_CREEP) cine.creep = true;
  } else {
    const rate = (target - P_CREEP) / CREEP_SEC;
    cine.p = Math.min(target, cine.p + rate * dt);
  }
  if (cine.p >= target) {
    cine.p = target;
    stopLoop();
    if (cine.mode === 'base2') finishBase2();
    else cine.showRebase = true;
    return;
  }
  raf = requestAnimationFrame(loop);
}

function startLoop(): void {
  lastT = performance.now();
  cine.elapsed50 = 0;
  raf = requestAnimationFrame(loop);
}
function stopLoop(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

/**
 * 进 base2：启动「A → D 渐回 + 跳动放缓」过渡（见 SETTLE_* 注释）。
 * ⚠️ 写入响应式值时**先量化到 SETTLE_STEPS 档**：rAF 每帧都跑，但值只在跨档时才真正变化
 *    ⇒ 每 6s/20 ≈ 300ms 触发一次重算，既不卡顿，也不会让缓存每帧失效。
 */
function startSettle(): void {
  stopSettle();
  cine.settle = 0;
  const t0 = performance.now();
  const span = SETTLE_SEC * 1000;
  const step = (): void => {
    const u = Math.min(1, (performance.now() - t0) / span);
    cine.settle = Math.round(u * SETTLE_STEPS) / SETTLE_STEPS;
    if (u < 1) settleRaf = requestAnimationFrame(step);
    else settleRaf = 0;
  };
  settleRaf = requestAnimationFrame(step);
}
function stopSettle(): void {
  if (settleRaf) cancelAnimationFrame(settleRaf);
  settleRaf = 0;
}

// ───────────────────────── 跳动引擎（按块独立） ─────────────────────────
// 与旧的「单一全局 gtick + 清空缓存」不同：每个文本块自带相位/状态，互不同步；
// 缓存挂在块自己身上（gen 变了才重掷），故 gtick 怎么涨都不会让乱码串变快。

type Channel = 't' | 's' | 'a' | 'b'; // 正文 / 慢拍(价格) / 名称(A) / 按钮

interface Blk {
  ch: Channel;
  /** 周期内相位 0..1（周期 = 正常段 + 乱码段）——初始值由块名散列而来 ⇒ 各块错开 */
  phase: number;
  /** 当前处于乱码态？ */
  garbled: boolean;
  /** 距离下一次跳动还剩多少 ms（仅乱码态有效） */
  jumpLeft: number;
  /** 世代号：与已烘焙串不符时，读取侧重掷一次 */
  gen: number;
  /** 已烘焙串对应的世代号 */
  rolledGen: number;
  /** 已烘焙的乱码串（正常段不使用） */
  str: string;
  /** 最后被读取的时间戳（回收用） */
  seen: number;
}

const blocks = new Map<string, Blk>();
let garbleRaf = 0;
let garbleLast = 0;
let fastAcc = 0;
let rampAcc = 0;
let rampTargetPrev = 0;
let lastPrune = 0;
/** 本次爆发的**渐出**时长（ms）：起爆时写入（base3 走 fadeFor 分档 / base2 取 B2_FADE 显式表） */
let fadeMs = 300;
/** 本次爆发的**错峰次序**种子：每次起爆重掷 ⇒ 哪一位先退去每轮都不同，不会看起来机械 */
let fadeSeed = 0;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const lint = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);
const randBetween = (a: number, b: number): number => a + Math.random() * (b - a);

/** 32 位 FNV-1a：既当块相位的散列，也当「错峰退面」的次序种子 */
function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 决定该块的初始相位（⇒ 各块错开，且刷新后保持同一相位） */
function hash01(s: string): number {
  return hashSeed(s) / 4294967296;
}

/** 可复现 PRNG（数字抖动用：同一 ntick 内恒返回同一串，不受重渲染次数影响） */
function mulberry32(a: number): () => number {
  let x = a | 0;
  return () => {
    x = (x + 0x6d2b79f5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Profile {
  gap: number;   // 正常段长度（ms）
  burst: number; // 乱码段长度（ms）
  jMin: number; jMax: number; // 乱码段内跳动间隔的随机范围（正文/名称）
  sMin: number; sMax: number; // 同上，慢拍（价格等数字）
}

/**
 * 当前该用什么跳动参数 —— 每种状态一条曲线（「强度 = 正常段长度」的体现）：
 *   ① base3 演出    ：gap 从 GAP_CALM 收到 0（平方缓入）⇒ 从「偶尔抽」渐强到「一直在乱」
 *   ② base2 涌升    ：文字在逐字复原，只让内容低频刷新
 *   ③ base2 渐回期  ：跳动从 70ms 放缓到 800ms（配合 A→D 淡回）
 *   ④ base2 稳定态  ：恒乱，但每 800~1200ms 才跳一次
 */
function profile(): Profile {
  if (cine.active && cine.mode === 'base3') {
    const t = clamp01((cine.p - 50) / (P_FLICKER - 50));
    const gap = GAP_CALM * (1 - t) * (1 - t);
    return {
      gap, burst: BURST,
      jMin: JUMP_HOT * JUMP_LOW, jMax: JUMP_HOT * JUMP_HIGH,
      sMin: SLOW_MIN, sMax: SLOW_MAX,
    };
  }
  if (cine.active) {
    const j = lint(SCAR_MIN, TICK_CALM, cine.p / P_WIN);
    return { gap: 0, burst: NEVER, jMin: j * 0.75, jMax: j * 1.25, sMin: j * 0.75, sMax: j * 1.25 };
  }
  if (cine.settle < 1) {
    const j = lint(JUMP_HOT, SCAR_MIN, cine.settle);
    return { gap: 0, burst: NEVER, jMin: j * 0.75, jMax: j * 1.25, sMin: j * 0.75, sMax: j * 1.25 };
  }
  return { gap: 0, burst: NEVER, jMin: SCAR_MIN, jMax: SCAR_MAX, sMin: SCAR_MIN, sMax: SCAR_MAX };
}

function nextJump(ch: Channel, pr: Profile): number {
  const slow = ch === 's';
  return randBetween(slow ? pr.sMin : pr.jMin, slow ? pr.sMax : pr.jMax);
}

/**
 * 跳动主循环：按「正常段 / 乱码段」推进每个块自己的相位，并推进块内的跳动计时。
 * 只有当某个块真的换了乱码相时才 `gtick++`（模板依赖它；无关的块不会被牵连）。
 */
function garbleLoop(now: number): void {
  const dt = Math.min(100, Math.max(0, now - garbleLast));
  garbleLast = now;
  const pr = profile();
  const period = pr.gap + pr.burst;
  const on = pr.burst / period; // 乱码态占整周期的比例：1 = 恒乱
  let dirty = false;
  for (const b of blocks.values()) {
    // 推进相位。恒乱/恒静时 period 极大 ⇒ 相位几乎冻结（种子值得以保留）。
    b.phase += dt / period;
    if (b.phase >= 1) b.phase -= Math.floor(b.phase);
    const g = b.phase >= 1 - on;
    if (g !== b.garbled) {
      // ⚠️ 两个方向都必须置脏：乱码→正常若不置脏，模板不会重渲染，字会**卡在乱码上**。
      b.garbled = g;
      dirty = true;
      if (g) { b.gen++; b.jumpLeft = nextJump(b.ch, pr); }
    }
    if (b.garbled) {
      b.jumpLeft -= dt;
      if (b.jumpLeft <= 0) { b.gen++; b.jumpLeft = nextJump(b.ch, pr); dirty = true; }
    }
  }
  // 数字抖动 / A 爆发：固定 FAST_MS 一拍（与块的随机节拍彻底分开）
  fastAcc += dt;
  if (fastAcc >= FAST_MS) { fastAcc %= FAST_MS; cine.ntick++; }
  // A 爆发斜坡：起爆瞬间方向定为「升」，爆完改为「降」。
  // ⚠️ 两个方向时长不同（用户定案 2026-10-04）：进 A 用固定的 A_RAMP_IN_MS（短促干脆），
  //    回 D 用 fadeMs（按本次爆发时长拉长 ⇒ 3s 的爆发配 800ms 渐出，不再「啪」一下）。
  const rampTarget = cine.aBurst > 0 ? A_RAMP_STEPS : 0;
  if (rampTarget !== rampTargetPrev) { rampTargetPrev = rampTarget; rampAcc = 0; }
  if (cine.aRamp !== rampTarget) {
    const up = rampTarget > cine.aRamp;
    const perStep = (up ? A_RAMP_IN_MS : fadeMs) / A_RAMP_STEPS;
    rampAcc += dt;
    const steps = Math.floor(rampAcc / perStep);
    if (steps > 0) {
      rampAcc -= steps * perStep;
      cine.aRamp = Math.max(0, Math.min(A_RAMP_STEPS, cine.aRamp + (up ? steps : -steps)));
    }
  }
  if (dirty) cine.gtick++;

  // 回收：长时间没被渲染到的块（文本随进度变化的那些）不留在表里
  if (now - lastPrune > 10000) {
    lastPrune = now;
    for (const [k, b] of blocks) if (now - b.seen > 60000) blocks.delete(k);
  }

  if (cine.active || scarActive()) garbleRaf = requestAnimationFrame(garbleLoop);
  else garbleRaf = 0;
}
function startGarbleLoop(): void {
  if (garbleRaf) return;
  garbleLast = performance.now();
  fastAcc = 0;
  rampAcc = 0;
  garbleRaf = requestAnimationFrame(garbleLoop);
}

/** 取（必要时建）一个文本块；块名 = 通道 + 文本本身 */
function blockOf(key: string, ch: Channel): Blk {
  let b = blocks.get(key);
  if (!b) {
    const pr = profile();
    const on = pr.burst / (pr.gap + pr.burst);
    const phase = hash01(key);
    const garbled = phase >= 1 - on;
    b = {
      ch, phase, garbled,
      jumpLeft: nextJump(ch, pr),
      gen: 0, rolledGen: -1, str: '',
      seen: 0,
    };
    if (garbled) b.gen = 1;
    blocks.set(key, b);
  }
  b.seen = performance.now();
  if (cine.active || scarActive()) startGarbleLoop();
  return b;
}

// ───────────────────────── 两条「退回常态」的曲线 ─────────────────────────
// ① 进 base2：A 方案**逐字淡回** D 方案（u: 0=全 A，1=全 D）
// ② base2 涌升：D/A **逐字退回原字形**（r: 0=全坏，1=全好）
// 两者共用同一套「按位交叉替换」写法，保证**等长**（不抖版）且与相邻状态连续（不突跳）。
const isSpace = (ch: string): boolean => ch === ' ' || ch === '　';

/** D 侧的坏字列（保留 scramble 的重排结果，按位取用） */
function badD(t: string): string[] {
  return Array.from(scramble(t));
}
/** A 侧的坏字列（生僻 CJK；空格保留原位防抖版；**相邻两字不会相同**） */
function badA(t: string): string[] {
  const out: string[] = [];
  let prev = '';
  for (const ch of Array.from(t)) {
    if (isSpace(ch)) { out.push(ch); prev = ''; continue; }
    let c = rndCJK();
    for (let i = 0; i < 8 && c === prev; i++) c = rndCJK();
    prev = c;
    out.push(c);
  }
  return out;
}

// ───────────── 逐位错峰退面（A→D「渐出」的形状，用户定案 2026-10-04） ─────────────
// ⚠️ 为什么不用「逐位独立伯努利」：2 字标签只有 4 种可见态（全A / 单字翻回 ×2 / 全D），
//    而重掷既发生在每 70ms（ntick）、又发生在每跨一档（memo key 含 step）
//    ⇒ 探针 3 万次实测：220ms 窗口内画面**横跳 7 次**、层次数恒为 3。
//    观感是「频闪后急停」，不是渐出；拉长斜坡只把频闪放慢（900ms 时横跳更多）。
//    错峰退面让每位**只翻一次面**、按位置错开 ⇒ 2 字标签读成「一位先定、另一位后定」，
//    切换次数 7 → 2，且与斜坡长度解耦（拉长就是真的变慢，不是变密）。
const thrCache = new Map<string, number[]>();

/** 翻面阈值表（0..1）：第 i 位在退去进度 u 超过自己的阈值时由 A 翻成 D；次序随机打乱 */
function staggerThresholds(seed: number, n: number): number[] {
  const key = `${seed}|${n}`;
  const hit = thrCache.get(key);
  if (hit) return hit;
  const rnd = mulberry32(seed ^ 0x85ebca6b);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out = new Array<number>(n);
  order.forEach((pos, rank) => { out[pos] = (rank + 0.5) / n; });
  if (thrCache.size > 64) thrCache.clear();
  thrCache.set(key, out);
  return out;
}

/**
 * 逐位错峰退面：u 从 0（全 A）走到 1（全 D），每一位只在自己的阈值处翻一次面。
 * 已翻面的位取 **D 侧串对应位**的字（稳定不变）；尚未翻面的位是 A 侧字（读取侧每 70ms
 * 重掷字形，故爆发的颗粒感保留）。空格不参与翻面。
 * @param d    **D 侧**显示串（不是原词）：爆发传块缓存的乱码串，morph 传 `scramble(词)`
 * @param seed 决定翻面次序（爆发用本次爆发的随机种子 / morph 用文本散列）
 */
function staggerBlend(d: string, u: number, seed: number): string {
  const src = Array.from(d);
  const pos: number[] = [];
  for (let i = 0; i < src.length; i++) if (!isSpace(src[i] ?? '')) pos.push(i);
  if (pos.length === 0) return d;
  const aSide = badA(d);
  const thr = staggerThresholds(seed, pos.length);
  const out = src.slice();
  pos.forEach((p, k) => {
    if (u >= (thr[k] ?? 1)) out[p] = src[p] ?? '';
    else out[p] = aSide[p] ?? src[p] ?? '';
  });
  return out.join('');
}

/**
 * 逐位交叉替换：每一位在「原字」与「坏字」之间按概率二选一。
 * @param takeGood 每一位取**原字**的概率（0 = 全坏，1 = 全好）
 */
function crossfade(good: string, bad: string[], takeGood: number): string {
  const src = Array.from(good);
  const out: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] ?? '';
    if (isSpace(ch)) { out.push(ch); continue; }
    out.push(Math.random() < takeGood ? ch : bad[i] ?? ch);
  }
  return out.join('');
}

/** base2 涌升的恢复度 0..1：走到 RECOVER_P 进度时字全部复原 */
function recoverRatio(): number {
  return clamp01(cine.p / RECOVER_P);
}

/**
 * 进 base2 的过渡：**A 淡出、D 淡入**（逐位交叉，等长不抖版）。
 * @param u 0 = 全是 A 方案的生僻字（与演出收尾同态，接得上不突跳）；1 = 全是 D 方案（稳定态）
 */
function settleBlend(t: string, u: number): string {
  if (u >= 1) return scramble(t);
  const src = Array.from(t);
  const dSide = badD(t); // D 列：重排 + 形近字
  const aSide = badA(t); // A 列：生僻 CJK
  const out: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] ?? '';
    if (isSpace(ch)) { out.push(ch); continue; }
    out.push(Math.random() < u ? dSide[i] ?? ch : aSide[i] ?? ch);
  }
  return out.join('');
}

/** base2 涌升的文字恢复：从当前坏字列逐位退回原字形 */
function recover(t: string, bad: () => string[]): string {
  const r = recoverRatio();
  if (r >= 1) return t;
  if (r <= 0) return bad().join('');
  return crossfade(t, bad(), r);
}

/**
 * 一个文本块**处于乱码态时**该显示什么 —— 三种局面：
 *   · base3 演出     ：正文走 garbleText（D 错位率随进度渐升 + 80→90 逐字转 A）；
 *                      名称直接给 A 方案（生僻 CJK）；按钮不走这里（见 rebaseBtnLabel）。
 *   · base2 涌升     ：逐字复原（名称用 A 列，其余用 D 列）。
 *   · base2 故障态   ：名称恒 A，其余走 A→D 渐回。
 */
function content(ch: Channel, t: string): string {
  if (cine.active && cine.mode === 'base2') {
    return recover(t, () => (ch === 'a' ? badA(t) : badD(t)));
  }
  if (cine.active) {
    return ch === 'a' ? badA(t).join('') : garbleText(t, cine.p);
  }
  return ch === 'a' ? badA(t).join('') : settleBlend(t, cine.settle);
}

/**
 * 读取一个文本块的当前显示串：
 *   · 正常态 → 原样（块级二态，不是按字概率）；
 *   · 乱码态 → 已烘焙的乱码串（只在 gen 变化时重掷 ⇒ 与刷新率解耦）。
 */
function read(ch: Channel, t: string): string {
  if (!garbleOn()) return t;
  void cine.gtick; // 响应式依赖：任一块跳动时重算
  const key = ch + '|' + t;
  const b = blockOf(key, ch);
  if (!b.garbled) return t;
  if (b.rolledGen !== b.gen) {
    b.str = content(ch, t);
    b.rolledGen = b.gen;
  }
  return b.str;
}

/** 页面文字（按钮以外的「其余文字」）：见文件头「跳动模型」 */
export function garble(t: string): string {
  return read('t', t);
}

/**
 * 慢拍乱码：**价格等数字**走这条（base3 里 600~1200ms 一拍），与主拍分开。
 * 用户定案：升级价格（含数字）跳动频率要低得多，名称/描述仍按主拍。
 */
export function garbleSlow(t: string): string {
  return read('s', t);
}

/**
 * 升级**名称**：A 方案（生僻 CJK 逐字替换，完全不可读）。
 * 与描述（D 方案，保留字形）分开 —— 名称彻底坏掉、描述还能猜，层次更清楚。
 * ⚠️ base2 涌升期同样要**恢复**（否则整页复原了唯独名字还在炸），坏字源用 A 列。
 */
export function garbleName(t: string): string {
  return read('a', t);
}

/**
 * 当前是否处于「乱码生效」状态（= 块引擎是否在跑）。
 * ⚠️ base2 涌升期全程为真 —— 即时 p 还没到 50，页面也处在「正从乱码里爬回来」的过程中。
 */
export function garbleOn(): boolean {
  if (cine.active) return cine.mode === 'base2' || cine.p >= 50;
  return scarActive();
}

// ───────────────────────── 顶栏数字抖动 ─────────────────────────
// 只在 base3→base2 演出期间跳（含尾声那 4 次点击）；真正进 base2 后立刻停 —— 与文字疤痕相反。
// ⚠️ 数字本身每次刷新都在变，不能按块缓存（键会无限增长）⇒ 用「ntick 播种的 PRNG」，
//    同一拍内恒返回同一串，既不受刷新率影响，也不留任何缓存。
const NUM_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * 数字/字母位随机重掷，标点与符号保留原位（等长替换 + 顶栏本就是等宽字体 ⇒ 不抖版）。
 */
export function garbleNum(v: string): string {
  if (cine.mode !== 'base3' || !cine.active || cine.p < 50) return v;
  void cine.ntick;
  const rnd = mulberry32((cine.ntick * 2654435761) ^ 0x9e3779b9);
  // ⚠️ 用户定案 2026-10-04：改为**不放回抽样**。
  //    旧版每位都独立从 62 字符池里抽，7 位中出现「两个相同字符」的概率约 **21.7%**
  //    （5 帧里就有 1 帧）—— 看起来不像随机，而像某种重复规律。改为抽走已用字符
  //    ⇒ 同一串内必无重复（池 62 > 7，绰绰有余）。
  let pool = NUM_CHARS.split('');
  let out = '';
  for (const ch of v) {
    const isAlnum = (ch >= '0' && ch <= '9')
      || (ch >= 'A' && ch <= 'Z')
      || (ch >= 'a' && ch <= 'z');
    if (!isAlnum) { out += ch; continue; }
    if (pool.length === 0) pool = NUM_CHARS.split(''); // 超长串兜底（正常数字远用不到）
    const i = (rnd() * pool.length) | 0;
    out += pool[i];
    pool.splice(i, 1);
  }
  return out;
}

// ───────────────────────── 换基按钮 ─────────────────────────
/** 「换基」及其形近字：真出路被藏在这个词的变形里 */
const REBASE_H = ['换', '換', '挽', '涣'];
const REBASE_J = ['基', '其', '甚', '碁'];

/**
 * 换位 + 形变：先让每个字各自「可能」变成形近字（约 45%），再随机换位。
 * ⚠️ 之前只调 scramble('换基') —— SIMILAR 表里没有「换 / 基」，结果**只会换位、字形永远不变**。
 */
function morphRebase(): string {
  const h = Math.random() < 0.45 ? REBASE_H[(Math.random() * REBASE_H.length) | 0] : REBASE_H[0];
  const j = Math.random() < 0.45 ? REBASE_J[(Math.random() * REBASE_J.length) | 0] : REBASE_J[0];
  return Math.random() < 0.5 ? h + j : j + h;
}

// ───────────────────────── A 爆发的渐入 / 渐出混合 ─────────────────────────
let burstMemoKey = '';
let burstMemoVal = '';

/**
 * A 爆发的**逐位错峰退面**（用户定案 2026-10-04，同日二次修订）。
 *   cine.aRamp = 0    → 原样返回 d（与常态完全一致 ⇒ 可以无脑地用同一个入口）；
 *   cine.aRamp = 满档 → 每一位都是生僻 CJK（全 A，即旧版 `rndCJK()+rndCJK()`）。
 * 中间档按「退去进度 u = 1 − aRamp/满档」逐位错峰翻面 ⇒ 进 A 渐入、回 D 渐出，两侧对称；
 * **每位只翻一次面**，不会来回横跳（这正是旧版「频闪」的来源，见 staggerBlend 注释）。
 * ⚠️ 结果按 (D 串, 档位, ntick, 种子) 记忆化：本函数会被 20ms 的资源刷新反复调用，
 *    不记忆化的话闪烁频率就被刷新率绑架了（本项目的老陷阱）。
 */
export function mixBurst(d: string): string {
  const step = cine.aRamp;
  if (step <= 0) return d;
  void cine.ntick;
  const key = `${d}#${step}#${cine.ntick}#${fadeSeed}`;
  if (key !== burstMemoKey) {
    burstMemoKey = key;
    burstMemoVal = staggerBlend(d, 1 - step / A_RAMP_STEPS, fadeSeed);
  }
  return burstMemoVal;
}

/**
 * 演出尾声按钮标签（走块引擎的 'b' 通道，故也带自己的相位与跳动节拍）：
 *   · 正常段          → 「涌升」（50% 前恒为此）
 *   · 50→80%         → 「涌升」的 D 乱码
 *   · 80→99.9%       → 仍以「涌升」的 D 乱码为主，但**偶发**闪入「换基」及其形近字
 *   · ≥99.9%         → 定值「换基」（D 跳动：既换位、也变形），此时按钮才是真正可点的再换基
 *   · 点击后         → 在 D 之上按 aRamp 混入 A（渐入 A → 渐出回 D，见 mixBurst）
 */
export function rebaseBtnLabel(): string {
  if (!cine.active || cine.mode !== 'base3') return '';
  const word = cine.showRebase ? '换基' : '涌升';
  // ⚠️ 50% 之前按钮与其余文字一样**保持原样**，乱码从 50% 才起
  if (cine.p < 50) return word;
  const key = 'b|' + word;
  const b = blockOf(key, 'b');
  void cine.gtick;
  let d = word;
  if (b.garbled) {
    if (b.rolledGen !== b.gen) {
      if (cine.showRebase) b.str = morphRebase();               // 换位 **且** 变形
      else if (cine.p >= P_FLICKER && Math.random() < 0.18) {   // 偶发闪入字面「换基」
        const h = REBASE_H[(Math.random() * REBASE_H.length) | 0];
        const j = REBASE_J[(Math.random() * REBASE_J.length) | 0];
        b.str = h + j;
      } else b.str = scramble(word);
      b.rolledGen = b.gen;
    }
    d = b.str;
  }
  return mixBurst(d);
}

/**
 * 点「涌升」（base3 且计数条满）启动演出。
 * ⚠️ 必须校验 canRebase：r 热键与按钮共用此入口，计数条未满时不该起演出。
 */
export function startCinematic(): boolean {
  const s0 = useGame().view.value.s0;
  if (!s0 || s0.base !== 3 || !s0.canRebase || cine.active) return false;
  cine.mode = 'base3';
  cine.active = true;
  cine.lock = true;
  cine.p = 0;
  cine.showRebase = false;
  cine.creep = false;
  cine.clicks = 0;
  cine.aBurst = 0;
  cine.aRamp = 0;
  cine.elapsed50 = 0;
  stopSettle();
  cine.settle = 1; // 演出期间不做 base2 过渡
  startLoop();
  startGarbleLoop();
  return true;
}

/**
 * 基 2 → S1 的涌升演出：**同一条减速曲线，但这次能真正抵达 100%**。
 * 与 base3 那次卡死在 99.9% 形成对照 —— 玩家此刻已经知道「这次是真的」。
 */
export function startBase2Ascend(): boolean {
  const s0 = useGame().view.value.s0;
  if (!s0 || s0.base !== 2 || !s0.ascendReady || cine.active) return false;
  cine.mode = 'base2';
  cine.active = true;
  cine.lock = true;
  cine.p = 0;
  cine.showRebase = false;
  cine.creep = false;
  cine.clicks = 0;
  cine.aBurst = 0;
  cine.aRamp = 0;
  cine.elapsed50 = 0;
  stopSettle();
  cine.settle = 1; // base2 早已定型，这次是「恢复」而不是「渐回」
  startLoop();
  startGarbleLoop();
  return true;
}

function finishBase2(): void {
  stopLoop();
  cine.active = false;
  cine.lock = false;
  cine.aBurst = 0;
  cine.aRamp = 0;
  cine.settle = 1;
  useGame().ascend();
}

/**
 * 演出期间是否锁死其它动词。
 * ⚠️ 按钮与热键必须共用这一个判定 —— 只禁用按钮而放过 s / l 热键等于没锁。
 */
export function cineLocked(): boolean {
  return cine.lock;
}

/**
 * 「r」热键统一入口：base3 未起演出 → 启动涌升演出；演出尾声（按钮已变「换基」）→ 视作点击该按钮。
 * 这样热键与按钮语义始终一致，不会出现「按钮锁着但热键能跳过」或反之。
 */
export function cinematicVerb(): boolean {
  const s0 = useGame().view.value.s0;
  if (cine.active) {
    if (cine.mode === 'base3' && cine.showRebase) clickRebase();
    return true;
  }
  if (!s0) return false;
  if (s0.base === 3) {
    // ⚠️ 即便门槛未满（startCinematic 静默返回 false）也必须吞掉这次按键：
    //    一旦退化成真 rebase，玩家会在没看演出的情况下直接掉进 base2，伪装彻底失效。
    startCinematic();
    return true;
  }
  // 基 2：4 次极限走完后 r = 涌升（启动成功演出）
  if (s0.base === 2 && s0.ascendReady) {
    startBase2Ascend();
    return true;
  }
  return false;
}

/**
 * ── base2 换词脉冲的时长表（用户定案 2026-10-05）──
 * 用户要求 base2 按钮的乱码切换动画「整体再长 1~2 秒」，并选择**两段各加一半**
 * ⇒ 取 1.5s 对半：「停在乱码」+750ms、「渐出」+750ms。三段全长 = 渐入 220（固定，
 * 不参与加长）+ hold + fade。
 *
 * ⚠️ 两条约束：
 *   ① base3 尾声的换基爆发**不动**（用户只点名 base2），故 base2 不再复用 `fadeFor` 的分档，
 *      改为**显式成对表**；
 *   ② 顺带避开一个坑：原值 500+750=1250 会跨过 `fadeFor` 的 1000 档，把最短那发的渐出
 *      从 300 悄悄抬到 450、阶梯就乱了 —— 显式表没有这个问题。
 */
const B2_HOLD = [1250, 1750, 3750, 1750] as const; // 第 1/2/3/4 次极限（原 500 / 1000 / 3000 / 1000）
const B2_FADE = [1050, 1200, 1550, 1200] as const; // 对应渐出（原 300 / 450 / 800 / 450）
/** 撞满自动（后继 → 极限）那一发（原 hold 500 / fade 300）；导出给 OrdinalPage 起爆用 */
export const B2_CAP_PULSE_MS = { hold: 1250, fade: 1050 } as const;

/**
 * 渐出时长与**本次爆发时长**挂钩（用户定案 2026-10-04）：
 * 0.5s→300ms / 1s→450ms / 3s→800ms。
 * ⚠️ 现仅 base3 尾声的换基爆发在用（base2 已改为显式表 `B2_FADE`）。
 * ⚠️ 旧版固定 220ms：第 3 次爆发 3000ms 只配 220ms 收尾（≈1:14），人眼读不出「渐」；
 *    而 500ms 的短爆发里那 220ms 又全被**渐入**占掉，真正「全 A 停住」只剩约 60ms。
 */
function fadeFor(dur: number): number {
  if (dur >= 3000) return 800;
  if (dur >= 1000) return 450;
  return 300;
}

/**
 * 起爆：置 aBurst 倒计时 + 定本次的渐出时长（`fadeMs`）与错峰次序种子（`fadeSeed`）。
 * ⚠️ 清空 mixBurst 的记忆化，否则新爆发的头一帧可能沿用上一次的串。
 * @param fade 渐出时长（ms）；不传则按 base3 的分档 `fadeFor(dur)`，base2 传 `B2_FADE`
 */
function startBurst(dur: number, fade: number = fadeFor(dur)): void {
  cine.aBurst = dur;
  fadeMs = fade;
  fadeSeed = (Math.random() * 4294967296) >>> 0;
  burstMemoKey = '';
  if (burstTimer) clearTimeout(burstTimer);
  burstTimer = window.setTimeout(() => { cine.aBurst = 0; }, dur);
}

/** 演出尾声点「换基」：A 爆发 → 回 D；第 4 次真正换基 */
export function clickRebase(): void {
  if (!cine.active || !cine.showRebase) return;
  if (cine.aBurst > 0) return; // 爆发期间忽略重复点击
  cine.clicks++;
  if (cine.clicks < 4) startBurst([500, 1000, 3000][cine.clicks - 1]);
  else finish();
}

function finish(): void {
  stopLoop();
  if (burstTimer) clearTimeout(burstTimer);
  cine.active = false;
  cine.lock = false;
  cine.aBurst = 0;
  cine.aRamp = 0;
  useGame().cinematicRebase();
  // 进 base2 后 scar 为真，跳动引擎继续（故障态常驻乱码）；
  // 但从 A 方案「啪」地切到 D 太生硬 ⇒ 启动过渡：逐字渐回 D + 跳动放缓到 800~1200ms。
  startSettle();
  startGarbleLoop();
}

// ───────────────────────── base2 极限尝试（与 base3 换基尝试同款） ─────────────────────────
/**
 * base2「极限」按钮的 A 爆发（用户定案 2026-10-04：与 base3 尾声的换基尝试**同款**；
 * 2026-10-05 加长：在 base3 那套 0.5/1/3s 基础上整体再长 1.5s，停 A 与渐出各加一半）。
 * 复用同一份 `cine.aBurst` / `burstTimer`，故按钮文字、边框的灰出/渐回语义完全一致：
 *   · 第 1/2/3 次（step 0/1/2）→ 停 A 1.25s / 1.75s / 3.75s，随后回落到 D 跳动；
 *   · 第 4 次（step 3）→ 停 A 1.75s（这次换的词是「涌升」，靠这发 A 把换词蒙过去）。
 * 时长表见 `B2_HOLD` / `B2_FADE`（不再走 `fadeFor` 的分档）。
 * 爆发期间重复点击一律忽略（`pulseRunning()` 守卫，含收尾渐出）。
 * @param step 本次极限**之前**的 base2LimitStep（0..3）
 * @returns 是否接受本次点击（false = 变形中，调用方应跳过本次极限）
 */
export function base2LimitAttempt(step: number): boolean {
  if (pulseRunning()) return false; // 变形中（含收尾渐出）忽略点击
  const i = Math.min(Math.max(step, 0), B2_HOLD.length - 1);
  startBurst(B2_HOLD[i], B2_FADE[i]);
  return true;
}

/**
 * base2 的**自动**换词脉冲（无点击，如「计数撞满 ⇒ 后继变极限」）。
 * 与点击触发的爆发走同一套 `aBurst` / `aRamp` / `fadeMs`，只是起爆者不同 ⇒
 * 页面侧不需要为两条来源各写一份动画（见 OrdinalPage 的 pulseOpen 注释）。
 * @param holdMs 停在「全 A」的时长（含上升的 A_RAMP_IN_MS）
 * @param fadeMs 渐出（A → D）时长
 */
export function swapPulse(holdMs: number, fadeMs: number): void {
  if (pulseRunning()) return; // 已经在脉冲里就不叠第二发
  startBurst(holdMs, fadeMs);
}

/**
 * base2 的**换词脉冲**是否在进行中（含收尾渐出）—— 页面判定「按钮正在变形，别插手」用。
 * ⚠️ 别再退回只看 `aBurst > 0`：收尾的 300~800ms 里 `aBurst` 已归零、`aRamp` 还在下落，
 *    只看得一个的话边框会比文字先回到青色，也会在收尾期放行点击（从半 A 状态重新起爆）。
 */
export function pulseRunning(): boolean {
  return cine.aBurst > 0 || cine.aRamp > 0;
}
