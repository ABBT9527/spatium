/**
 * S0 计数层 sandbox。
 *
 * 真实模块、新语义（2026-10-02 修正）：
 *   - 后继 Succ：n += succGain（只动计数，绝不改 α）。
 *   - 极限 Limit：计数溢出基数（n ≥ base）时，把计数的 ω-内容并入已实现序数 α
 *     （遗传进位：10→ω、ω+10→ω·2），n ← n mod base（有限余数留作货币）。
 *   - 换基 Rebase：base−1，并重置 n / α / upgrades（S0 周期重置）。
 *   - 换基门槛：α ≥ ω²（等价某次极限并出 ω²）。
 *   - base = 2 时攒到 n = 4 再极限 ⇒ 并出 ε₀ ⇒ 涌升。
 *
 * 验证清单：
 *   ✓ 后继只动 n，α 不变
 *   ✓ 极限把 ω-内容并入 α，n 回落到 < base
 *   ✓ 换基门槛 α ≥ ω²；换基重置 n/α/upgrades
 *   ✓ base = 2 时攒到 n=4 极限即达 ε₀
 *   ✓ 双射不变量：任意操作后 α 仍是合法 Cantor 范式
 */

import { S0_MODULE } from '@/game/layers/s0/module';
import {
  succS0, limitS0, rebaseS0, canRebase, canLimit,
  alphaDepthOf, autoSuccRateOf, limitDeepenCopies, succGainOf, rebaseGateAlpha,
} from '@/game/layers/s0/logic';
import { S0_BASE_MIN } from '@/game/layers/s0/defs';
import { toString, checkBijection } from '@/game/ordinal/cnf';
import { ordinalToLatex } from '@/game/ordinal/latex';
import type { S0State } from '@/game/layers/s0/state';
import type { S0Runtime } from '@/game/layers/s0/logic';

let st: S0State = S0_MODULE.createState();
let rt: S0Runtime = S0_MODULE.createRuntime(st);
let clock = 0;
let logs: string[] = [];

const $ = (id: string) => document.getElementById(id)!;

function pushLog(s: string): void {
  logs.unshift(s);
  if (logs.length > 80) logs.pop();
  $('log').innerHTML = logs.map((l) => `<div>${l}</div>`).join('');
}

function render(): void {
  const depth = alphaDepthOf(st);
  $('alpha').textContent = toString(st.alpha);
  $('nb').textContent = `${st.n} / ${st.base}`;
  $('charge').textContent = `d=${depth} / +${succGainOf(st)}`;

  const bij = st.alpha.t !== 'cnf' || checkBijection(st.alpha);
  const can = canRebase(st, rt);
  const rows: Array<[string, string, string]> = [
    ['计数 n（0阶货币）', String(st.n), 'accent'],
    ['基数 base', String(st.base), ''],
    ['α 深度 d = ω-depth', String(depth), can ? 'ok' : ''],
    ['换基门槛', `α ≥ ${ordinalToLatex(rebaseGateAlpha(st.base))}`, can ? 'ok' : ''],
    ['已换基', `${st.round}`, ''],
    ['后继增益 / 自动', `${succGainOf(st)} / ${autoSuccRateOf(st)}/s`, ''],
    ['极限深化份数', String(limitDeepenCopies(st)), ''],
    ['可极限', canLimit(st) ? 'YES' : '—', canLimit(st) ? 'ok' : ''],
    ['可换基', can ? 'YES' : '—', can ? 'ok' : ''],
    ['双射不变量', bij ? 'OK' : '✗', bij ? 'ok' : 'warn'],
    ['抵达 ε₀', st.reachedEps0 ? 'YES' : '—', st.reachedEps0 ? 'ok' : ''],
  ];
  $('metrics').innerHTML = rows
    .map(([k, v, c]) => `<div class="k">${k}</div><div class="v mono ${c}">${v}</div>`)
    .join('');

  $('rungs').innerHTML = rt.rungs
    .map((r) => {
      const cls = r.n <= st.n ? 'ok' : '';
      return `<div class="${cls}">n ≥ ${String(r.n).padStart(6)}   →   ${toString(r.alpha)}</div>`;
    })
    .join('');
}

function succ(k: number): void {
  const n0 = st.n;
  for (let i = 0; i < k; i++) succS0(st, clock);
  clock += 0.1;
  if (k > 1) pushLog(`后继 ×${k}：n ${n0} → ${st.n}   α=${toString(st.alpha)}`);
  render();
}

function limit(): void {
  if (!canLimit(st)) {
    pushLog(`极限被拒：n=${st.n} < base=${st.base}（计数未溢出基数）`);
    render();
    return;
  }
  const a0 = toString(st.alpha);
  limitS0(st, rt, clock);
  pushLog(`极限：α ${a0} → ${toString(st.alpha)}（并入 ω-内容），n=${st.n}`);
  render();
}

/** 攒到 base² 再极限（一次并出 ω²），到达换基门槛 */
function toGate(): void {
  let limits = 0;
  let guard = 0;
  while (!canRebase(st, rt) && guard < 1_000_000 && !st.reachedEps0) {
    const target = st.base * st.base;
    if (st.n < target) succS0(st, clock);
    else if (canLimit(st)) { limitS0(st, rt, clock); limits++; }
    else succS0(st, clock);
    guard++;
  }
  pushLog(`推到门槛：极限 ${limits} 次 → α=${toString(st.alpha)}（≥ ω²）`);
  render();
}

function rebase(): void {
  const before = st.base;
  if (!rebaseS0(st, rt, clock)) {
    pushLog(`换基被拒：需 α ≥ ${ordinalToLatex(rebaseGateAlpha(st.base))}（当前 α=${toString(st.alpha)}）`);
    render();
    return;
  }
  pushLog(`换基：base ${before} → ${st.base}，n/α/升级重置；α=${toString(st.alpha)}`);
  render();
}

function runToEps0(): void {
  let guard = 0;
  while (!st.reachedEps0 && guard < 3_000_000) {
    const target = st.base > S0_BASE_MIN ? st.base * st.base : 4;
    if (st.n < target) succS0(st, clock);
    else if (canLimit(st)) limitS0(st, rt, clock);
    else if (canRebase(st, rt)) rebaseS0(st, rt, clock);
    else succS0(st, clock);
    guard++;
  }
  pushLog(`抵达 ε₀：base=${st.base}  n=${st.n}  α=${toString(st.alpha)}  里程碑 ${st.milestones.join(' ')}`);
  render();
}

function restart(): void {
  st = S0_MODULE.createState();
  rt = S0_MODULE.createRuntime(st);
  clock = 0;
  logs = [];
  $('log').innerHTML = '';
  pushLog('sandbox 就绪。后继只改 n；极限把计数 ω-内容并入 α；换基需 α ≥ ω² 且重置 n/α/升级；base = 2 时攒到 n=4 极限即达 ε₀。');
  render();
}

// —— 绑定 ——
$('btn-succ').addEventListener('click', () => succ(1));
$('btn-succ10').addEventListener('click', () => succ(10));
$('btn-succ100').addEventListener('click', () => succ(100));
$('btn-limit').addEventListener('click', limit);
$('btn-gate').addEventListener('click', toGate);
$('btn-rebase').addEventListener('click', rebase);
$('btn-run').addEventListener('click', runToEps0);
$('btn-restart').addEventListener('click', restart);

restart();
