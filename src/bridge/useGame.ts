/**
 * 唯一接缝：逻辑 ↔ 渲染。
 *
 * 戒律（三层分离 · 接缝）：
 *   - state 是**非响应式** plain object（Decimal 进 Vue reactive 是灾难级性能陷阱）
 *   - 逻辑 tick 结束递增 version，这里用 shallowRef 暴露**快照**
 *   - UI 只读**格式化后的字符串**，禁止直接绑定 Decimal
 *
 * 主脊驱动：根据 meta.current 暴露当前激活层的视图与动作；S0 用序数操作，
 * S1 用棋盘操作。两层共用同一套 view 快照（meta + 当前层子对象）。
 *
 * 显示层定案（2026-10-03）：序数增长逻辑「每次刷新即变动」—— 引擎按 meta.tickMs
 * 动态步长推进，bridge 每帧 refresh（rAF ~60fps，远快于 20ms/50Hz），二者解耦。
 * 整数优先：计数/序数尽量整数，必须渲染小数时走 fmtNum（禁千分位、非整数 7 位有效数字）。
 *
 * 用法：const game = useGame();  game.view.value …
 */

import { shallowRef, onMounted, onUnmounted, type ShallowRef } from 'vue';
import { Engine, createGame, type GameState } from '../game/core/engine';
import type { GameRuntime } from '../game/core/engine';
import type { LayerId } from '../game/meta/types';
import { LAYERS } from '../game/meta/registry';
import { doAscension, canAscend, tryUnlockHex, HEX_COST_EPS } from '../game/meta/progression';
import { S0_MODULE } from '../game/layers/s0/module';
import {
  succS0, limitS0, rebaseS0, canRebase, canLimit, canBuyUpgrade, buyUpgrade,
  upgradeCostOf, rebaseGateAlpha, resonanceBonus, limitBreakLv,
  limitDeepenCopies, succGainOf, succVelocityOf, nFloor, hasAutoLimit,
  debugAddCount, debugAddOrdinalCount,
  canBuyBase2Upgrade, buyBase2Upgrade, atBase2Cap,
  mergeS0Milestones, type S0Runtime,
} from '../game/layers/s0/logic';
import {
  S0_UPGRADES, S0_REBASE_GATE, S0_BASE_MIN, S0_SUCC_GAIN_BASE,
  s0UpgradeMax, isUpgradeUnlocked, type S0UpgradeId,
  S0_BASE2_UP_COUNT, S0_BASE2_UP_MULT, S0_BASE2_UP_PRICE, S0_BASE2_NEED,
  S0_BASE2_CAP_N, S0_BASE2_LADDER, displayCountOf,
} from '../game/layers/s0/defs';
import type { S0State } from '../game/layers/s0/state';
import { cinematicVerb, cineLocked, base2LimitAttempt } from '@/ui/ascendCinematic';
import { toString as ordinalToString, ordinalToCount } from '../game/ordinal/cnf';
import { ordinalToLatex } from '../game/ordinal/latex';
import {
  createRuntime as createS1Runtime, placePoint, fillReference, fillRect, cycle,
  requiredPoints, ensureBoard, isAutoUnlocked, type S1Runtime,
} from '../game/layers/s1/logic';
import { phiOf, phiPreview } from '../game/board/scoring';
import { fmt, fmtTime } from '../game/core/decimal';
import { targetTime, vstarOf, targetEps } from '../game/economy/formulas';
import {
  save, load, clearSave,
  exportSave as exportSaveB64, importSave as importSaveB64,
} from '../game/save/serialize';
import { on } from '../game/core/events';

/** 整数优先的数字格式化：唯一实现见 src/ui/format.ts（禁千分位、非整数 7 位有效数字） */
import { fmtNum } from '../ui/format';

export interface S0UpgradeView {
  id: S0UpgradeId;
  name: string;
  level: number;
  /** 当前基下的有效等级上限（succGain 在基 ≤ 8 时为 4，否则 3） */
  max: number;
  /** 下一级价格：需花费的序数计数 a 等价量（满级为 null） */
  cost: number | null;
  /** 价格文案（序数字符串 + 当前基所需计数） */
  costText: string;
  /** 序数价格的 LaTeX（UI 可用 KaTeX 渲染） */
  costTex: string;
  /** 当前等级**实际**效果数值（精简一行） */
  effect: string;
  affordable: boolean;
}

/** 基 2 专属升级视图（双层对数经济） */
export interface S0Base2UpView {
  /** 第几个（0..5） */
  idx: number;
  /** 这个升级给的倍率（累乘到总倍率上） */
  mult: number;
  /** 价格（显示单位 D） */
  price: number;
  bought: boolean;
  affordable: boolean;
}

export interface S0RungView {
  n: number;
  alphaTex: string;
}

export interface S0View {
  /**
   * 计数 n（**已取整** = ⌊n⌋）。
   * 内部 n 是连续量（自动后继 v·dt + 半整数步长），这里暴露给 UI 的恒为整数
   * ⇒ 页面上只见整数，小数余量继续在内部累积、不丢产量（见 logic.nFloor）。
   */
  n: number;
  /** 序数计数 a（S0 真实货币；升级消耗它，α = V_base(a)） */
  ordinalCount: number;
  /** 当前基数 b（10 → 2） */
  base: number;
  /** 序数 α：纯文本（测试/兜底） */
  alpha: string;
  /** 序数 α 的 LaTeX（KaTeX 主展示；外层可横向滚动） */
  alphaTex: string;
  /** α 后面的标注（「已达硬上限」）；空串时不渲染。单独成段是为了能走乱码而不进 KaTeX */
  alphaNote: string;
  /** 每次后继的增量 = (底数 + 共鸣加成)^lv（整数优先、最多 7 位小数） */
  succGainText: string;
  /** 自动后继速度 v（计数 / 秒）= 速率(步/秒) × 步长；0 = 无自动后继 */
  succVelocity: number;
  /** 自动后继速度文案（「+v / 秒」；v=0 时空串，UI 不渲染） */
  succVelocityText: string;
  /** 极限是否可用：未达 ε₀ 且计数溢出基数（n ≥ base） */
  canLimit: boolean;
  /** 是否满足换基门槛（α ≥ 当前基门槛序数） */
  canRebase: boolean;
  /** 换基门槛序数的 LaTeX */
  rebaseGateTex: string;
  /** 换基达标所需序数计数 a */
  rebaseNeed: number;
  /** 换基进度 ordinalCount / rebaseNeed（0..1，封顶 1） */
  rebaseProgress: number;
  /**
   * **显示出来的计数**：基 2 取双层对数 D(n) = log₂(log₂ n)（n<2 为 0），其余就是 ⌊n⌋。
   * 内部真实计数仍是 n（见上面的 n），只有展示走这个。
   */
  nShown: number;
  /** 进度条分子（显示口径）：基 2 = D(n)，其余 = 序数计数 a */
  barNow: number;
  /** 进度条分母（显示口径）：基 2 = 4，其余 = 换基所需序数计数 */
  barNeed: number;
  /** 进度条填充百分比（基 2 按 n/65536 计，其余按 a/rebaseNeed） */
  barPct: number;
  /** 基 2 是否已撞满硬上限（n ≥ 65536 ⇔ 显示计数 = 4） */
  base2Cap: boolean;
  /** 基 2 已完成的脚本化极限次数（0..4；到 4 即 ω^ω ⇒ ε₀ ⇒ 可涌升） */
  base2Step: number;
  /** 涌升就绪：base=2 且 4 次极限走完（α = ω^ω = base2 的 ε₀） */
  ascendReady: boolean;
  /** 升级（仅含已随换基进度解锁者；花费序数计数 a；价格=序数）；基 2 时为空 */
  upgrades: S0UpgradeView[];
  /** 基 2 专属升级（双层对数经济：价格按显示单位 D 计、实际扣除） */
  base2Ups: S0Base2UpView[];
  reachedEps0: boolean;
  ascended: boolean;
  /** base3 → base2 涌升演出已播完（base2 永久故障态标记） */
  base3CineDone: boolean;
  /** base3 期间：换基按钮/进度改名为「涌升」（藏住 base2 存在） */
  base3Ascend: boolean;
  /** base2 永久故障态：文字/成就前三条常驻乱码（升级照常可买，只是文案全乱码） */
  scar: boolean;
  /** 本层已达成里程碑 id 列表（成就页展示，纯记录、不发数值奖励） */
  milestones: string[];
  /** 参考阶梯：当前基下「α = V_base(n) 随 n 递增」的临界表（横向滚动展示） */
  rungs: S0RungView[];
}

export interface S1View {
  placed: number;
  need: number;
  phiBoard: string;
  attnLeft: string;
  eps: string;
  boardSize: number;
  lattice: string;
  auto: boolean;
  hexUnlocked: boolean;
  autoUnlocked: boolean;
  hexCost: string;
  canHex: boolean;
  milestones: string[];
}

export interface GameView {
  clock: number;
  current: LayerId;
  layerName: string;
  dim: number;
  /** 当前层的 0阶货币名（S0 → 序数 α；S1 → ε） */
  resourceLabel: string;
  /** 当前层 0阶货币的纯文本值 */
  resourceText: string;
  /** 当前层 0阶货币的 LaTeX（KaTeX 展示；非序数资源时为空串） */
  resourceTex: string;
  /** 1阶货币「序 Order」（首次完成 S4 后解锁；现在恒为 0） */
  order1: string;
  order1Unlocked: boolean;
  canAscend: boolean;
  ascensions: number;
  lv: number;
  round: number;
  runs: number;
  v: string;
  target: string;
  theta: string;
  phi: string;
  bestPhi: string;
  roundTime: string;
  targetRoundTime: string;
  stalled: boolean;
  lastRoundTime: number;
  lastRoundTarget: number;
  version: number;
  /** 存档结构版本（设置面板展示） */
  saveVersion: number;
  /** 累计游戏时间（格式化） */
  playTime: string;
  /** 刷新频率（ms）；设置页可调，最小 20 */
  tickMs: number;
  /** v0.1 终局标记：base2 涌升完成、S1 未实装 */
  endgame: boolean;
  /** 终局后是否已解锁调试模式（持久） */
  debugUnlocked: boolean;
  s0?: S0View;
  s1?: S1View;
}

export interface GameApi {
  view: ShallowRef<GameView>;
  engine: Engine;
  rt: GameRuntime;
  state: GameState;
  // 元层动作
  ascend: () => void;
  /** 花本层 0阶货币 ε 解锁三角格（S1 内容节拍 + S1 的 sink） */
  unlockHex: () => void;
  // S0 计数层动作
  /** 后继：n += succGain（只动计数，α 不变） */
  succ: () => void;
  /** 极限：计数溢出基数(n≥base)时，把 ω-内容并入 α、n ← n mod base */
  limit: () => void;
  /** 换基：base → base-1（门槛 α ≥ 当前基门槛序数），并重置 n/α/upgrades */
  rebase: () => void;
  /** base3 涌升演出尾声：仅 base3 有效，执行 rebaseS0(3→2) 并置 base3CineDone（进 base2 故障态） */
  cinematicRebase: () => void;
  /** 买一级 S0 升级（花 0阶货币 w；价格=序数，花费序数计数 a） */
  buyUpgrade: (id: S0UpgradeId) => void;
  /** 买基 2 专属升级（双层对数经济：价格按显示单位 D 计，实际扣除后内部计数向下取整） */
  buyBase2Upgrade: (idx: number) => void;
  /** 设置刷新频率（ms），最小 20 */
  setTickMs: (ms: number) => void;
  /** 调试：直接加**计数 n**（绕过步长/速度；仅设置面板的调试模式调用） */
  debugAddCount: (x: number) => void;
  /** 调试：直接加**序数计数 a**（等价于凭空极限一次，α = V_base(a) 随之重算） */
  debugAddOrdinalCount: (x: number) => void;
  /** 终局后解锁调试模式：持久开启调试注入（设置面板调试区默认展开） */
  unlockDebug: () => void;
  // S1 棋盘动作
  place: (i: number) => void;
  toggleAuto: () => void;
  doReference: () => void;
  doQuickFill: () => void;
  clearBoard: () => void;
  forceCycle: () => void;
  hoverPhi: (i: number) => number;
  // 通用
  saveNow: () => void;
  /** 把当前存档导出为 Base64 文本 */
  exportSave: () => string;
  /** 导入 Base64 存档；成功则覆盖当前进度并落盘 */
  importSave: (text: string) => { ok: boolean; error?: string };
  hardReset: () => void;
}

let singleton: GameApi | null = null;

function blankView(): GameView {
  return {
    clock: 0, current: 's0', layerName: 'ORDINAL · 序数', dim: 0,
    resourceLabel: '序数 α', resourceText: '0', resourceTex: '0',
    order1: '0', order1Unlocked: false,
    canAscend: false, ascensions: 0, lv: 0, round: 0, runs: 0,
    v: '0', target: '0', theta: '1.00e+0', phi: '0.0000', bestPhi: '0.0000',
    roundTime: '0s', targetRoundTime: '0s', stalled: false, lastRoundTime: 0, lastRoundTarget: 0,
    version: 0, saveVersion: 0, playTime: '0s',
    tickMs: 20,
    endgame: false, debugUnlocked: false,
  };
}

/** 单个升级的「当前效果数值」精简描述 */
function upgradeEffectText(id: S0UpgradeId, s0: S0State): string {
  switch (id) {
    case 'succGain': return `后继 +${fmtNum(succGainOf(s0))} / 次`;
    // 实际速度 v = 速率 × 步长（步长随增益/共鸣变动 ⇒ 用 v 而非裸速率）
    case 'succStream': return `自动 +${fmtNum(succVelocityOf(s0))} 计数 / 秒`;
    case 'limitDeepen': return `极限 +${fmtNum(limitDeepenCopies(s0))} 份 ω-内容`;
    // 共鸣作用在**底数**上：显示「底数 2 → 2.5」比「+0.5」更能说明它抬的是指数底
    case 'resonance': return `后继底数 ${fmtNum(S0_SUCC_GAIN_BASE + resonanceBonus(s0))}`;
    case 'autoLimit': return hasAutoLimit(s0) ? '已启用' : '未启用';
    // 破限不给直接加成 —— 只抬前两个（第4级额外含共鸣）的等级上限，故显示当前加成档数
    case 'limitBreak': {
      const lb = limitBreakLv(s0);
      return lb >= 4 ? `前两个升级上限 +${lb}，并对共鸣 +1` : `前两个升级上限 +${lb}`;
    }
  }
}

export function useGame(): GameApi {
  if (singleton) return singleton;

  const loaded = load();
  const fresh = createGame();
  let state: GameState = loaded ? loaded.state : fresh.state;
  const rt: GameRuntime = loaded
    ? { s0: S0_MODULE.createRuntime(state.layers.s0), s1: createS1Runtime(state.layers.s1) }
    : fresh.rt;
  // 旧档缺 tickMs ⇒ 回落默认 20ms（黑屏根因防线：绝不出现 undefined）
  if (typeof state.meta.tickMs !== 'number') state.meta.tickMs = 20;
  // 读档后盘面随 lv 扩容
  ensureBoard(state.layers.s1, rt.s1 as S1Runtime);
  const engine = new Engine(state, rt);
  if (loaded && loaded.offlineSec > 1) engine.offline(loaded.offlineSec);

  const view = shallowRef<GameView>(blankView());

  function refresh(): void {
    const cur = state.meta.current;
    const mod = LAYERS[cur];
    const head = {
      clock: state.clock,
      current: cur,
      layerName: mod.name,
      dim: state.meta.dim,
      // 1阶货币「序」：唯一产出 = 离散阶段 S4 → S0 折返 +1（S4 未实装 ⇒ 恒 0）
      order1: fmt(state.meta.order1),
      order1Unlocked: state.meta.unlocked.includes('s4' as LayerId),
      canAscend: canAscend(state.meta, state.layers as Record<LayerId, unknown>),
      ascensions: state.meta.ascensions,
      version: engine.version,
      saveVersion: state.saveVersion,
      playTime: fmtTime(state.clock),
      tickMs: state.meta.tickMs,
      endgame: state.meta.endgame,
      debugUnlocked: state.meta.debugUnlocked,
    };

    if (cur === 's0') {
      const s0 = state.layers.s0;
      const s0rt = rt.s0 as S0Runtime;
      const gate = S0_REBASE_GATE[s0.base];
      const rebaseNeed = gate ? ordinalToCount(gate, s0.base) : 0;
      const rebaseProgress = rebaseNeed > 0 ? Math.min(1, s0.ordinalCount / rebaseNeed) : 0;
      const gateTex = ordinalToLatex(rebaseGateAlpha(s0.base));
      // 基 2 有自己的一套升级（双层对数经济），base ≥ 3 的序数计价升级在基 2 不出现
      const isB2 = s0.base === 2;
      const b2ups: S0Base2UpView[] = isB2
        ? Array.from({ length: S0_BASE2_UP_COUNT }, (_, idx) => ({
            idx,
            mult: S0_BASE2_UP_MULT[idx] ?? 1,
            price: S0_BASE2_UP_PRICE[idx] ?? 0,
            bought: s0.base2Up[idx] === 1,
            affordable: canBuyBase2Upgrade(s0, idx),
          }))
        : [];
      // 仅展示已解锁的升级；效果数值由逻辑函数实时拼装（精简一行）
      const ups: S0UpgradeView[] = isB2 ? [] : S0_UPGRADES
        .filter((def) => isUpgradeUnlocked(def.id, s0.base))
        .map((def) => {
          const lv = s0.upgrades[def.id] ?? 0;
          const lb = limitBreakLv(s0); // ⚠️ 必须传：破限抬高三条升级的有效上限（漏传会误判满级）
          const max = s0UpgradeMax(def.id, s0.base, lb);
          const cost = upgradeCostOf(def.id, lv, s0.base, lb);
          return {
            id: def.id,
            name: def.name,
            level: lv,
            max,
            cost: cost ? cost.count : null,
            costText: cost === null ? '已满级' : `花费 ${fmtNum(cost.count)} 序计数`,
            costTex: cost === null ? '' : ordinalToLatex(cost.ordinal),
            effect: upgradeEffectText(def.id, s0),
            affordable: canBuyUpgrade(s0, def.id),
          };
        });
      // base3 抵达硬上限（ω^(ω^ω) = V_3 的 ε₀ 封顶点）时，α 会塌缩成 ε₀；
      // 但此刻「还没涌升」（要先换基到基 2 才能涌升）—— 故显示门槛序数 + 标注，而非孤零零的 ε₀。
      const atHardCap = s0.base === 3 && s0.reachedEps0;
      // ⚠️ 「已达硬上限」不再塞进 LaTeX 的 \text{}：那串字要跟其余描述文本一起走乱码，
      //    而乱码进 KaTeX 会报缺字形。故公式部分保持干净，标注单独作为一个可乱码字段。
      const alphaStr = atHardCap ? 'ω^(ω^ω)' : ordinalToString(s0.alpha);
      const alphaNote = atHardCap ? '已达硬上限' : '';
      const alphaTex = atHardCap
        ? '\\omega^{\\omega^{\\omega}}'
        : ordinalToLatex(s0.alpha, { maxTerms: 8 });
      // 进度条：基 2 显示「D(n) / 4」但**填充按 n/65536**；其余基显示「a / rebaseNeed」
      const b2Cap = atBase2Cap(s0);
      // 基 2 的计数显示：内部 n **钳到硬上限 65536**（调试注水也不会越过）⇒ D 恰好为整数 4
      //   ⇒ fmtNum 只显示 "4"（小数尾数清零）；其余基就是 ⌊n⌋。
      const nShown = isB2 ? displayCountOf(Math.min(nFloor(s0), S0_BASE2_CAP_N)) : nFloor(s0);
      const barNow = isB2 ? nShown : s0.ordinalCount;
      const barNeed = isB2 ? S0_BASE2_NEED : rebaseNeed;
      const barPct = isB2
        ? Math.min(100, (nFloor(s0) / S0_BASE2_CAP_N) * 100)
        : rebaseProgress * 100;
      view.value = {
        ...head,
        resourceLabel: '序数 α',
        resourceText: alphaStr,
        resourceTex: alphaTex,
        // S0 已无节奏引擎：以下字段为中性占位（UI 不读）
        lv: s0.round,
        round: s0.round,
        runs: 0,
        v: '—', target: '—', theta: '—', phi: '—', bestPhi: '—',
        roundTime: '—', targetRoundTime: '—', stalled: false,
        lastRoundTime: 0, lastRoundTarget: 0,
        s0: {
          // 计数取整显示：内部是连续累加器，UI 只见 ⌊n⌋（小数余量留内部继续累积）
          n: nFloor(s0),
          // 基 2 显示的是**双层对数**后的计数；其余基就是 ⌊n⌋
          nShown,
          barNow,
          barNeed,
          barPct,
          base2Cap: b2Cap,
          base2Step: s0.base2LimitStep,
          ordinalCount: s0.ordinalCount,
          base: s0.base,
          alpha: alphaStr,
          alphaTex,
          alphaNote,
          succGainText: fmtNum(succGainOf(s0)),
          succVelocity: succVelocityOf(s0),
          succVelocityText: succVelocityOf(s0) > 0 ? `自动 +${fmtNum(succVelocityOf(s0))} / 秒` : '',
          canLimit: canLimit(s0),
          canRebase: canRebase(s0, s0rt),
          rebaseGateTex: gateTex,
          rebaseNeed,
          rebaseProgress,
          // 涌升就绪：基 2 且 4 次脚本极限走完（α = ω^ω = base2 的 ε₀）
          ascendReady: s0.base === S0_BASE_MIN && s0.base2LimitStep >= S0_BASE2_LADDER.length,
          // base3 期间把「换基」整体伪装成「涌升」，隐藏 base2 的存在
          base3Ascend: s0.base === 3,
          // base2 故障态：base3 涌升演出已播完（文字/成就前三条常驻乱码；升级照常可买）
          scar: s0.base === 2 && s0.base3CineDone,
          upgrades: ups,
          base2Ups: b2ups,
          reachedEps0: s0.reachedEps0,
          ascended: s0.ascended,
          base3CineDone: s0.base3CineDone,
          milestones: s0.milestones,
          rungs: s0rt.rungs.map((r) => ({ n: r.n, alphaTex: ordinalToLatex(r.alpha) })),
        },
      };
      return;
    }

    const s1 = state.layers.s1;
    const board = (rt.s1 as S1Runtime).board;
    const elapsed = state.clock - s1.roundStart;
    view.value = {
      ...head,
      resourceLabel: 'ε',
      resourceText: fmt(s1.eps),
      resourceTex: '',
      lv: s1.lv,
      round: s1.round,
      runs: mod.targets.runs,
      v: fmt(s1.v),
      target: fmt(vstarOf(targetEps(s1.c0, s1.lv, s1.theta))),
      theta: s1.theta.toExponential(2),
      phi: s1.phiCur.toFixed(4),
      bestPhi: s1.bestPhi.toFixed(4),
      roundTime: fmtTime(elapsed),
      targetRoundTime: fmtTime(targetTime(mod.targets, s1.round)),
      stalled: elapsed > 200 * 60,
      lastRoundTime: s1.lastRoundTime,
      lastRoundTarget: targetTime(mod.targets, Math.max(0, s1.round - 1)),
      s1: {
        placed: board.placed,
        need: requiredPoints(s1),
        phiBoard: phiOf(board).toFixed(4),
        attnLeft: `${s1.attnLeft.toFixed(0)}s / ${s1.tauEff.toFixed(0)}s`,
        eps: fmt(s1.eps),
        boardSize: board.size,
        lattice: board.kind === 'square' ? '方格' : '三角格',
        auto: s1.auto,
        hexUnlocked: s1.hexUnlocked,
        autoUnlocked: isAutoUnlocked(s1),
        hexCost: fmt(HEX_COST_EPS),
        canHex: s1.eps.gte(HEX_COST_EPS),
        milestones: s1.milestones,
      },
    };
  }

  /**
   * 用一份新状态整体替换运行态（导入存档用）。
   * rt 对象本身保持不变、只换其字段 —— 因为 UI（BoardCanvas）持有 rt.s1.board 引用。
   */
  function applyState(next: GameState): void {
    state = next;
    const nextRt: GameRuntime = {
      s0: S0_MODULE.createRuntime(next.layers.s0),
      s1: createS1Runtime(next.layers.s1),
    };
    ensureBoard(next.layers.s1, nextRt.s1 as S1Runtime);
    rt.s0 = nextRt.s0;
    rt.s1 = nextRt.s1;
    engine.state = state;
    if (singleton) singleton.state = state;
    refresh();
  }

  let saveAcc = 0;
  let raf = 0;
  let last = 0;

  // 每帧刷新：序数增长「每次刷新即变动」，刷新频率由 tickMs 控制（引擎步长）
  function frame(now: number): void {
    if (!last) last = now;
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    engine.advance(dt);
    refresh();
    saveAcc += dt;
    if (saveAcc >= 10) {
      saveAcc = 0;
      save(state);
    }
    raf = requestAnimationFrame(frame);
  }

  // 后继/极限/换基 快捷键（取首字母 s / l / r）：仅在 S0 且焦点不在输入框时生效
  function onS0Hotkey(e: KeyboardEvent): void {
    if (state.meta.current !== 's0') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    switch (e.key.toLowerCase()) {
      // 演出期间连 s / l 一起锁：只禁按钮而放过热键等于没锁（与 OrdinalPage 共用 cineLocked）
      case 's': if (!cineLocked()) singleton?.succ(); break;
      case 'l': if (!cineLocked()) singleton?.limit(); break;
      // base3 期间「换基」伪装成「涌升」：r 走与按钮完全相同的语义
      // （未起演出→启动涌升；演出尾声按钮已变「换基」→等同点击该按钮），
      // 避免热键绕过计数条门槛或直接跳过演出。base2 则回归普通换基/涌升。
      case 'r':
        if (!cinematicVerb()) singleton?.rebase();
        break;
    }
  }

  onMounted(() => {
    refresh();
    last = 0;
    raf = requestAnimationFrame(frame);
    window.addEventListener('keydown', onS0Hotkey);
  });
  onUnmounted(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onS0Hotkey);
    save(state);
  });

  on('cycle', () => {
    refresh();
    save(state);
  });

  singleton = {
    view,
    engine,
    rt,
    state,
    ascend() {
      const s0 = state.layers.s0;
      // v0.1 终局：base2 涌升完成、S1 尚未实装 ⇒ 不进入 S1，改弹「已达 v0.1 版本终局」提示
      if (state.meta.current === 's0' && s0.base === S0_BASE_MIN && s0.reachedEps0) {
        state.meta.endgame = true;
        s0.ascended = true; // 标记已涌升，避免按钮重复触发
        refresh();
        save(state);
        return;
      }
      if (doAscension(state.meta, state.layers as Record<LayerId, unknown>)) {
        refresh();
        save(state);
      }
    },
    unlockDebug() {
      state.meta.debugUnlocked = true;
      save(state);
      refresh();
    },
    succ() {
      succS0(state.layers.s0, state.clock);
      mergeS0Milestones(state.meta, state.layers.s0, state.clock);
      refresh();
    },
    limit() {
      const st = state.layers.s0;
      // base2：极限尝试与 base3 尾声的换基尝试**同款** —— 先放 A 爆发再真极限
      // （停 A 1.25/1.75/3.75/1.75s，渐出 1.05/1.2/1.55/1.2s；变形期间忽略本次点击）。
      // ⚠️ 放在桥接层，按钮与 l 热键才会**共用同一入口**（只改按钮、放过热键等于没改，
      //    与 base3 的 cinematicVerb 同一原则）。
      if (st.base === 2 && canLimit(st) && !base2LimitAttempt(st.base2LimitStep)) return;
      if (limitS0(st, rt.s0 as S0Runtime, state.clock)) {
        mergeS0Milestones(state.meta, st, state.clock);
        refresh();
      }
    },
    rebase() {
      if (!rebaseS0(state.layers.s0, rt.s0 as S0Runtime, state.clock)) return;
      mergeS0Milestones(state.meta, state.layers.s0, state.clock);
      refresh();
      save(state);
    },
    cinematicRebase() {
      const st = state.layers.s0;
      if (st.base !== 3) return; // 仅在 base3 演出尾声有效
      if (!rebaseS0(st, rt.s0 as S0Runtime, state.clock)) return;
      st.base3CineDone = true;
      mergeS0Milestones(state.meta, st, state.clock);
      refresh();
      save(state);
    },
    buyUpgrade(id: S0UpgradeId) {
      if (buyUpgrade(state.layers.s0, id, state.clock)) {
        refresh();
        save(state);
      }
    },
    buyBase2Upgrade(idx: number) {
      if (buyBase2Upgrade(state.layers.s0, idx, state.clock)) {
        mergeS0Milestones(state.meta, state.layers.s0, state.clock);
        refresh();
        save(state);
      }
    },
    setTickMs(ms: number) {
      const v = Math.max(20, Math.min(1000, Math.round(ms)));
      state.meta.tickMs = v;
      save(state);
      refresh();
    },
    debugAddCount(x: number) {
      debugAddCount(state.layers.s0, x);
      refresh();
    },
    debugAddOrdinalCount(x: number) {
      debugAddOrdinalCount(state.layers.s0, x);
      mergeS0Milestones(state.meta, state.layers.s0, state.clock);
      refresh();
    },
    place(i: number) {
      placePoint(state.layers.s1, rt.s1 as S1Runtime, i, state.clock);
      refresh();
    },
    toggleAuto() {
      const s1 = state.layers.s1;
      if (!isAutoUnlocked(s1)) return; // 戒律9：进度过半才解锁
      s1.auto = !s1.auto;
      refresh();
    },
    unlockHex() {
      if (tryUnlockHex(state.meta, state.layers as Record<LayerId, unknown>, rt)) {
        refresh();
        save(state);
      }
    },
    doReference() {
      fillReference(state.layers.s1, rt.s1 as S1Runtime);
      state.layers.s1.lastActionAt = state.clock;
      refresh();
    },
    doQuickFill() {
      const b = (rt.s1 as S1Runtime).board;
      const need = requiredPoints(state.layers.s1) - b.placed;
      if (need <= 0) return;
      const per = Math.max(1, Math.ceil(Math.sqrt(need)));
      fillRect(state.layers.s1, rt.s1 as S1Runtime, 0, 0, Math.min(b.size - 1, per - 1), Math.min(b.size - 1, per - 1));
      state.layers.s1.lastActionAt = state.clock;
      refresh();
    },
    clearBoard() {
      const b = (rt.s1 as S1Runtime).board;
      b.occ.fill(0);
      b.placed = 0;
      b.minDist = -1;
      state.layers.s1.occ = [];
      state.layers.s1.lastActionAt = state.clock;
      refresh();
    },
    forceCycle() {
      cycle(state.layers.s1, rt.s1 as S1Runtime, state.clock);
      refresh();
      save(state);
    },
    hoverPhi(i: number) {
      return phiPreview((rt.s1 as S1Runtime).board, i);
    },
    saveNow() {
      save(state);
    },
    exportSave() {
      return exportSaveB64(state);
    },
    importSave(text: string) {
      const res = importSaveB64(text);
      if (!res.ok || !res.state) return { ok: false, error: res.error ?? '解析失败' };
      applyState(res.state);
      save(state);
      return { ok: true };
    },
    hardReset() {
      clearSave();
      location.reload();
    },
  };

  return singleton;
}
