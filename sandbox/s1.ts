/**
 * S1 点层构形引擎 sandbox。
 *
 * 目的：在合入主项目前验证手感（用户既定工作流：sandbox → 集成 → bal-sim → debug）。
 * 这里 import 的是**真实模块**，不是原型副本——验证通过即可直接复用。
 *
 * 验证清单：
 *   ✓ 能摆点、能算 Φ
 *   ✓ 悬停 ΔΦ 预览
 *   ✓ 摆满 N 枚才计入产能（防"少摆骗高 Φ"）
 *   ✓ 熵衰 → 挂机档
 *   ✓ 周期重置 + Governor 把耗时拉回目标曲线
 *   ✓ 批量 QoL（矩形填充）
 */

import { createGame } from '@/game/core/engine';
import { fmt, fmtTime } from '@/game/core/decimal';
import {
  tickS1, cycle, placePoint, fillRect, fillReference, requiredPoints,
  isAutoUnlocked, S1_AUTO_UNLOCK_RUN,
} from '@/game/layers/s1/logic';
import { phiOf, phiPreview, deltaStar } from '@/game/board/scoring';
import { S1_TARGETS } from '@/game/layers/s1/defs';
import { targetTime, targetEps, vstarOf } from '@/game/economy/formulas';
import { tryUnlockHex, HEX_COST_EPS, HEX_UNLOCK_RUN } from '@/game/meta/progression';
import type { Board } from '@/game/board/lattice';

const { state, rt } = createGame();
const st = state.layers.s1;
const s1rt = rt.s1;

const canvas = document.getElementById('board') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const metrics = document.getElementById('metrics')!;
const logEl = document.getElementById('log')!;

let speed = 1;
let hover = -1;
let clock = 0;
let logs: string[] = [];

const metricRows: Array<[string, () => string, string]> = [
  ['轮次 n', () => `${st.round} / ${S1_TARGETS.runs}`, ''],
  ['产能等级 lv', () => String(st.lv), 'accent'],
  ['本轮需摆 N', () => `${s1rt.board.placed} / ${requiredPoints(st)}`, ''],
  ['Φ 当前', () => st.phiCur.toFixed(4), 'accent'],
  ['Φ 盘面', () => phiOf(s1rt.board).toFixed(4), ''],
  ['Φ 历史最佳', () => st.bestPhi.toFixed(4), ''],
  ['参考 δ*', () => deltaStar(requiredPoints(st), s1rt.board.span, s1rt.board.kind).toFixed(3), ''],
  ['ΔΦ 预览', () => (hover >= 0 ? (phiPreview(s1rt.board, hover) - phiOf(s1rt.board)).toFixed(4) : '—'), 'warn'],
  ['注意力剩余', () => `${st.attnLeft.toFixed(0)}s / ${st.tauEff.toFixed(0)}s`, ''],
  ['产出 V', () => fmt(st.v), ''],
  ['目标 V*', () => fmt(vstarOf(targetEps(st.c0, st.lv, st.theta))), ''],
  ['累计 ε', () => fmt(st.eps), 'accent'],
  ['ε（0阶货币）', () => fmt(state.layers.s1.eps), 'accent'],
  ['三角格', () => (st.hexUnlocked ? '已解锁' : `第 ${HEX_UNLOCK_RUN} 轮后花 ${fmt(HEX_COST_EPS)} ε 解锁`), ''],
  ['自动求解器', () => (isAutoUnlocked(st) ? (st.auto ? '开' : '关') : `第 ${S1_AUTO_UNLOCK_RUN} 轮解锁`), ''],
  ['Θ (Governor)', () => st.theta.toExponential(2), ''],
  ['本轮耗时', () => fmtTime(clock - st.roundStart), ''],
  ['目标耗时', () => fmtTime(targetTime(S1_TARGETS, st.round)), ''],
  ['盘面', () => `${s1rt.board.size}×${s1rt.board.size} · ${s1rt.board.kind}`, ''],
];

function pushLog(s: string) {
  logs.unshift(s);
  if (logs.length > 60) logs.pop();
  logEl.innerHTML = logs.map((l) => `<div>${l}</div>`).join('');
}

// —— 渲染 ——
function cellOf(ev: MouseEvent): number {
  const rect = canvas.getBoundingClientRect();
  const size = s1rt.board.size;
  const pad = 24;
  const pitch = (canvas.width - pad * 2) / Math.max(1, size - 1);
  const x = ((ev.clientX - rect.left) * canvas.width) / rect.width;
  const y = ((ev.clientY - rect.top) * canvas.height) / rect.height;
  const c = Math.round((x - pad) / pitch);
  const r = Math.round((y - pad) / pitch);
  if (c < 0 || c >= size || r < 0 || r >= size) return -1;
  const best = { i: -1, d: Infinity };
  for (let i = 0; i < s1rt.board.count; i++) {
    const px = pad + (i % size) * pitch;
    const py = pad + Math.floor(i / size) * pitch;
    const dd = (px - x) ** 2 + (py - y) ** 2;
    if (dd < best.d) {
      best.d = dd;
      best.i = i;
    }
  }
  return best.d <= (pitch * 0.6) ** 2 ? best.i : -1;
}

function draw(b: Board) {
  const size = b.size;
  const pad = 24;
  const pitch = (canvas.width - pad * 2) / Math.max(1, size - 1);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#14161A';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 网格
  ctx.strokeStyle = '#23262C';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < size; i++) {
    const p = pad + i * pitch;
    ctx.moveTo(pad, p);
    ctx.lineTo(pad + (size - 1) * pitch, p);
    ctx.moveTo(p, pad);
    ctx.lineTo(p, pad + (size - 1) * pitch);
  }
  ctx.stroke();

  // 已放点
  for (let i = 0; i < b.count; i++) {
    if (b.occ[i] === 0) continue;
    const x = pad + (i % size) * pitch;
    const y = pad + Math.floor(i / size) * pitch;
    ctx.fillStyle = '#4FD1C5';
    ctx.beginPath();
    ctx.arc(x, y, Math.max(3, pitch * 0.22), 0, Math.PI * 2);
    ctx.fill();
  }

  // 悬停预览
  if (hover >= 0 && b.occ[hover] === 0) {
    const x = pad + (hover % size) * pitch;
    const y = pad + Math.floor(hover / size) * pitch;
    const d = phiPreview(b, hover) - phiOf(b);
    ctx.strokeStyle = d >= -1e-9 ? '#4FD1C5' : '#E0A458';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(3, pitch * 0.22), 0, Math.PI * 2);
    ctx.stroke();
  }
}

function renderMetrics() {
  metrics.innerHTML = metricRows
    .map(([k, f, cls]) => `<div class="k">${k}</div><div class="v ${cls}">${f()}</div>`)
    .join('');
}

function renderMilestones() {
  const el = document.getElementById('milestones');
  if (!el) return;
  el.innerHTML = st.milestones.length
    ? st.milestones.map((m) => `<span class="sb-chip">${m}</span>`).join('')
    : '<span class="off">—</span>';
}

// —— 主循环 ——
let last = performance.now();
function frame(now: number) {
  const dtWall = Math.min((now - last) / 1000, 0.25);
  last = now;
  const dt = dtWall * speed;
  const steps = Math.min(60, Math.max(1, Math.ceil(dt / 0.05)));
  const sub = dt / steps;
  for (let i = 0; i < steps; i++) {
    clock += sub;
    const before = st.round;
    tickS1(st, s1rt, sub, clock);
    if (st.round !== before) {
      const t = st.lastRoundTime;
      const tg = targetTime(S1_TARGETS, st.round - 1);
      const dev = Math.abs(Math.log(t / tg));
      pushLog(
        `<span class="${dev < 0.12 ? 'ok' : 'off'}">#${st.round - 1} 实际 ${fmtTime(t)} / 目标 ${fmtTime(tg)} ` +
          `偏差 ${(dev * 100).toFixed(1)}%  Θ=${st.theta.toExponential(2)}  lv=${st.lv}  Φ=${st.bestPhi.toFixed(3)}</span>`
      );
    }
  }
  draw(s1rt.board);
  renderMetrics();
  renderMilestones();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// —— 交互 ——
canvas.addEventListener('mousemove', (e) => {
  hover = cellOf(e);
});
canvas.addEventListener('mouseleave', () => {
  hover = -1;
});
canvas.addEventListener('click', (e) => {
  const i = cellOf(e);
  if (i < 0) return;
  if (!placePoint(st, s1rt, i, clock)) return;
  st.lastActionAt = clock;
});

document.getElementById('btn-auto')!.addEventListener('click', (e) => {
  if (!isAutoUnlocked(st)) {
    pushLog('<span class="off">自动求解器尚未解锁（第 ' + S1_AUTO_UNLOCK_RUN + ' 轮后）</span>');
    return;
  }
  st.auto = !st.auto;
  (e.target as HTMLButtonElement).textContent = `自动求解器：${st.auto ? '开' : '关'}`;
});
document.getElementById('btn-hex')!.addEventListener('click', () => {
  if (st.hexUnlocked) return;
  const ok = tryUnlockHex(state.meta, state.layers as never, rt);
  if (ok) {
    pushLog('<span class="ok">已解锁三角格：盘面密度更高，更易摆出高 Φ</span>');
  } else if (st.round < HEX_UNLOCK_RUN) {
    pushLog('<span class="off">三角格需第 ' + HEX_UNLOCK_RUN + ' 轮后解锁</span>');
  } else {
    pushLog('<span class="off">ε 不足（需 ' + fmt(HEX_COST_EPS) + '）</span>');
  }
});
document.getElementById('btn-fill')!.addEventListener('click', () => {
  const need = requiredPoints(st) - s1rt.board.placed;
  if (need <= 0) return;
  const size = s1rt.board.size;
  const per = Math.ceil(Math.sqrt(need));
  fillRect(st, s1rt, 0, 0, Math.min(size - 1, per - 1), Math.min(size - 1, per - 1));
  st.lastActionAt = clock;
});
document.getElementById('btn-optim')!.addEventListener('click', () => {
  // 参考最优：间距取精确离散最优 δ*（scoring.deltaStar）的均匀网格 ⇒ Φ 应达 1.000
  fillReference(st, s1rt);
  st.lastActionAt = clock;
});
document.getElementById('btn-clear')!.addEventListener('click', () => {
  s1rt.board.occ.fill(0);
  s1rt.board.placed = 0;
  s1rt.board.minDist = -1;
  st.occ = [];
  st.lastActionAt = clock;
});
document.getElementById('btn-cycle')!.addEventListener('click', () => {
  cycle(st, s1rt, clock);
});
const spd = document.getElementById('spd') as HTMLInputElement;
spd.addEventListener('input', () => {
  speed = Number(spd.value);
  document.getElementById('spd-val')!.textContent = `×${speed}`;
});

pushLog('sandbox 就绪。目标：验证 Φ 手感 + Governor 是否把耗时拉回目标曲线。');
