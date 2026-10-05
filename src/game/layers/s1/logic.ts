/**
 * S1 点层 · 逻辑。
 *
 * 戒律（三层分离 · 逻辑层）：
 *   - 唯一可以改 state 的地方
 *   - **禁止 import 任何 Vue / DOM API**
 *
 * 这里承载 Phase 1 必须移植的六项中的四项：
 *   ① Governor Θ        ② φ_hand/φ_idle 双档 tick      ③ 每轮恒定 +1 级（N7）
 *   ④ Φ* 归一化 + Θ 挂钩（N14）
 */

import { Decimal, dZero } from '../../core/decimal';
import {
  createBoard, clearBoard, place, remove, type Board,
} from '../../board/lattice';
import { phiOf, deltaStar } from '../../board/scoring';
import { greedyStep, makeRng } from '../../board/solver';
import {
  prodRate, vstarOf, targetEps, targetTime, thetaStep,
} from '../../economy/formulas';
import { IDLE_WINDOW_SEC, PHI_IDLE } from '../../constants';
import { S1_BOARD_STEPS, S1_TARGETS } from './defs';
import type { S1State } from './state';

/** 熵衰时间常数（秒）：无操作时 Φ 衰减回挂机档的速度 */
export const PHI_DECAY_TAU = 60;

export interface S1Runtime {
  board: Board;
  rng: () => number;
}

/** 自动化戒律9：自动求解器仅在进度过半（≥50% 轮次）后解锁 */
export const S1_AUTO_UNLOCK_RUN = Math.floor(S1_TARGETS.runs * 0.5);
/** 自动化戒律9：自动求解器强度封顶 Φ≈0.65，保证挂机 ≤ 主动的约 1/2（2.5× 上限下） */
export const PHI_AUTO_CAP = 0.65;

/** 自动求解器是否已解锁（戒律9：进度过半才可用） */
export function isAutoUnlocked(st: S1State): boolean {
  return st.round >= S1_AUTO_UNLOCK_RUN;
}

export function createRuntime(st: S1State): S1Runtime {
  const size = S1_BOARD_STEPS[st.boardIndex];
  const board = createBoard(st.lattice, size);
  for (const i of st.occ) place(board, i);
  return { board, rng: makeRng(st.rngSeed) };
}

/** 本轮必须摆下的点数 = 产能等级（产能轨与构形深度同源，戒律 N2/N5） */
export function requiredPoints(st: S1State): number {
  return Math.max(1, st.lv);
}

/** 盘面是否足以容纳本轮点数；不足则升档（基础设施，非可选升级） */
export function ensureBoard(st: S1State, rt: S1Runtime): void {
  const need = requiredPoints(st) * 4; // 留出足够空间，否则最优摆法无处可放
  while (st.boardIndex < S1_BOARD_STEPS.length - 1) {
    const size = S1_BOARD_STEPS[st.boardIndex];
    if (size * size >= need) break;
    st.boardIndex++;
  }
  const size = S1_BOARD_STEPS[st.boardIndex];
  if (rt.board.size !== size || rt.board.kind !== st.lattice) {
    rt.board = createBoard(st.lattice, size);
    st.occ = [];
  }
}

/** 当前有效 Φ：摆满才计入，否则按挂机档（防"少摆点骗高 Φ"的漏洞） */
export function effectivePhi(st: S1State, rt: S1Runtime, dt: number): number {
  const complete = rt.board.placed >= requiredPoints(st);
  const target = complete ? phiOf(rt.board) : 0;
  const attentive = st.attnLeft > 0 && st.clockSinceAction < IDLE_WINDOW_SEC;
  if (!complete) {
    st.phiCur = PHI_IDLE;
  } else if (attentive) {
    // 摆满且在专注窗口内 ⇒ 拿玩家真实摆出的 Φ（下限保护：不低于挂机档）
    // 自动化戒律9：本轮只要有一枚点由自动求解器放置，强度即封顶 PHI_AUTO_CAP
    //（用计数而非"最后一次"布尔，杜绝「自动铺满 + 手动补最后一枚」的绕过）
    let phiTarget = target;
    if (st.autoPlaced > 0) phiTarget = Math.min(phiTarget, PHI_AUTO_CAP);
    st.phiCur = Math.max(phiTarget, PHI_IDLE);
  } else {
    // 熵衰：无人维护，构形退化回求解器能维持的水平
    const k = 1 - Math.exp(-dt / PHI_DECAY_TAU);
    st.phiCur += (PHI_IDLE - st.phiCur) * k;
  }
  if (st.phiCur > st.bestPhi) st.bestPhi = st.phiCur;
  return st.phiCur;
}

/**
 * 单个逻辑步（dt 秒）。由 core/engine 以固定 20 Hz 调用。
 */
export function tickS1(st: S1State, rt: S1Runtime, dt: number, clock: number): void {
  st.clockSinceAction = clock - st.lastActionAt;

  // 注意力预算：只在"专注档"消耗
  const phi = effectivePhi(st, rt, dt);
  const attentive = st.attnLeft > 0 && st.clockSinceAction < IDLE_WINDOW_SEC && phi > PHI_IDLE;
  if (attentive) st.attnLeft = Math.max(0, st.attnLeft - dt);

  // 产出：R = R₀·s^lv·Φ
  const R = prodRate(st.lv).mul(phi);
  st.v = st.v.add(R.mul(dt));

  // 自动求解器（挂机侧）：进度过半才解锁（戒律9）；只做单枚贪心，不参与全局重排
  if (st.auto && isAutoUnlocked(st) && rt.board.placed < requiredPoints(st)) {
    const i = greedyStep(rt.board, rt.rng);
    if (i >= 0) {
      st.occ.push(i);
      st.autoPlaced += 1;
    }
  }

  // 周期重置判定：V ≥ V*(Θ·c0·r^(lv+lead))
  const vstar = vstarOf(targetEps(st.c0, st.lv, st.theta));
  if (st.v.gte(vstar)) cycle(st, rt, clock);
}

/**
 * 周期重置 Cycle。
 * 戒律 N7：lv **恒定为 +1**，禁止"能买几级买几级"的 while 循环。
 */
export function cycle(st: S1State, rt: S1Runtime, clock: number): void {
  const tActual = Math.max(1, clock - st.roundStart);
  const tTarget = targetTime(S1_TARGETS, st.round);

  // ① 结算收益：必须用**本轮**的 Θ（即更新前的 Θ），与 bal-sim 口径一致
  st.eps = st.eps.add(targetEps(st.c0, st.lv, st.theta));

  // ② Governor：把一切未预测偏差吸收进 Θ（放在结算之后，避免污染本轮收益）
  st.theta = st.theta * thetaStep(tActual, tTarget);
  st.lastRoundTime = tActual;
  st.history.push(tActual);
  if (st.history.length > 400) st.history.shift();

  // ③ 恒定 +1 级（N7）
  st.lv += 1;
  st.round += 1;

  // ④ 清零本层运行态
  st.v = dZero();
  st.roundStart = clock;
  st.attnLeft = st.tauEff;
  clearBoard(rt.board);
  st.occ = [];
  st.autoPlaced = 0;
  ensureBoard(st, rt);
  checkS1Milestones(st);
}

/** S1 里程碑：纯成就记录（不发放数值奖励，戒律12），供后续层作序数索引解锁门槛 */
function checkS1Milestones(st: S1State): void {
  const add = (id: string) => {
    if (!st.milestones.includes(id)) st.milestones.push(id);
  };
  if (st.hexUnlocked) add('s1.hex');
  if (st.bestPhi >= 0.90) add('s1.phi90');
  if (st.bestPhi >= 0.99) add('s1.phi99');
}

/** 玩家放一枚点 */
export function placePoint(st: S1State, rt: S1Runtime, i: number, clock: number): boolean {
  if (rt.board.placed >= requiredPoints(st)) return false;
  if (!place(rt.board, i)) return false;
  st.occ.push(i);
  st.lastActionAt = clock;
  return true;
}

export function removePoint(st: S1State, rt: S1Runtime, i: number): boolean {
  if (!remove(rt.board, i)) return false;
  const idx = st.occ.lastIndexOf(i);
  if (idx >= 0) st.occ.splice(idx, 1);
  return true;
}

/** 批量 QoL：矩形填充（戒律：>4096 格没有它根本没法玩，必做项） */
export function fillRect(st: S1State, rt: S1Runtime, x0: number, y0: number, x1: number, y1: number): number {
  const size = rt.board.size;
  let n = 0;
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1), by = Math.max(y0, y1);
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      const i = y * size + x;
      if (i < 0 || i >= rt.board.count) continue;
      if (n >= requiredPoints(st)) return n;
      if (place(rt.board, i)) {
        st.occ.push(i);
        n++;
      }
    }
  }
  return n;
}

/**
 * 参考最优摆法：均匀网格（k×k 取前 N 个）。
 * 用途：① 标定 Φ=1 是否可达 ② sandbox 的"参考最优"按钮 ③ headless 冒烟里的"完美玩家"
 */
export function fillReference(st: S1State, rt: S1Runtime): number {
  const b = rt.board;
  const size = b.size;
  const need = requiredPoints(st);
  // 间距取精确离散最优 δ*（见 scoring.deltaStar），位置 = i·g ⇒ 最小距离恒为 g
  const g = deltaStar(need, b.span, b.kind);
  const per = Math.floor(b.span / g) + 1;
  let n = 0;
  for (let r = 0; r < per && n < need; r++) {
    for (let c = 0; c < per && n < need; c++) {
      const x = c * g;
      const y = r * g;
      if (x >= size || y >= size) continue;
      const i = y * size + x;
      if (b.occ[i] === 0 && place(b, i)) {
        st.occ.push(i);
        n++;
      }
    }
  }
  return n;
}

/** 探针：本轮目标 / 进度，供 UI 只读展示 */
export function roundTarget(st: S1State): Decimal {
  return targetEps(st.c0, st.lv, st.theta);
}

export function roundTargetTime(st: S1State): number {
  return targetTime(S1_TARGETS, st.round);
}
