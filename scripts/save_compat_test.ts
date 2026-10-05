/**
 * 存档兼容性回归测试（headless）。
 *
 * 戒律「禁止以重置玩家存档作为升级方案」⇒ 升版本后旧档必须仍能读入。
 * 覆盖（v5 语义：S0 极限改为遗传进位、α 为极限累积量、换基重置 n/α/upgrades、
 * 升级价格/效果随 α 深度缩放）：
 *   ① v2 → v5：S0 层形状重做（序数沙盒 → 计数+换基）⇒ 只重置 S0 层，meta 与 S1 保留。
 *   ② v3 → v5：经济切换 ⇒ meta.it 删除、meta.order1 补齐；S0 进度（n/base/round/α/里程碑）
 *      保留，α 直接信任存档（不再由 (n,base) 自愈），升级回落默认 0。
 *   ③ v4 → v5：迁移链删除 S0 旧字段 stage / charge（极限语义修正）。
 *   ④ v5 往返：S0 字段（含新升级 id、α）无损。
 *   ⑤ Base64 导出 / 导入往返（设置面板）：含非 ASCII 序数、宽容解析、垃圾输入拒收。
 *
 * 运行：esbuild 打包后 node。
 */

// 浏览器 API 垫片：serialize.load() 依赖 localStorage
const store: Record<string, string> = {};
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
};

import { load, save, exportSave, importSave } from '../src/game/save/serialize';
import { createGame } from '../src/game/core/engine';
import { Decimal } from '../src/game/core/decimal';
import { hereditaryToOrdinal, toString as ord, omegaPow, fromNat } from '../src/game/ordinal/cnf';

const KEY = 'spatium.save.v2';

/** v2 时代的 S1 结构：故意不含 hexUnlocked / milestones / autoPlaced */
const oldS1 = {
  lv: 42, round: 42,
  v: '0', eps: '1e30', theta: 1.5, c0: '731.48', tauEff: 60,
  attnLeft: 60, lastActionAt: 0, clockSinceAction: 0, roundStart: 0,
  lastRoundTime: 300, history: [300, 301, 302],
  phiCur: 0.9, bestPhi: 0.95, occ: [0, 5, 10], boardIndex: 2,
  lattice: 'square', auto: true, rngSeed: 20261002,
};

/** v2 时代的 S0 结构：序数沙盒（Succ/Sup/Fix + Θ/Φ），形状与 v3 完全不同 */
const oldS0 = {
  lv: 10, round: 10, v: '0', it: '1e20', theta: 1.0, c0: '12.5', tauEff: 30,
  attnLeft: 30, lastActionAt: 0, clockSinceAction: 0, roundStart: 0,
  lastRoundTime: 120, history: [118, 120], phiCur: 1.0, bestPhi: 1.0,
  opsThisRound: 0, alpha: { t: 'zero' }, scratch: { t: 'zero' },
  reachedEps0: false, ascended: true, auto: false, rngSeed: 20261002,
};

const v2Save = JSON.stringify({
  saveVersion: 2,
  clock: 3600,
  lastSeen: Date.now() - 5000,
  meta: { current: 's1', unlocked: ['s0', 's1'], dim: 0, it: '1e40', bank: '0',
    milestones: {}, challenges: {}, ascensions: 1,
    five: { essences: { metal: '0', wood: '0', water: '0', fire: '0', earth: '0' }, deployed: {} } },
  layers: { s0: oldS0, s1: oldS1 },
});

/** v3 时代的存档：经济切换前的「计数 + 换基」S0 + 旧的 meta.it + 显式 α=ω^ω */
const v3Save = JSON.stringify({
  saveVersion: 3,
  clock: 7200,
  lastSeen: Date.now() - 1000,
  meta: { current: 's1', unlocked: ['s0', 's1'], dim: 0, it: '3.5e12', bank: '0',
    milestones: {}, challenges: {}, ascensions: 1,
    five: { essences: { metal: '0', wood: '0', water: '0', fire: '0', earth: '0' }, deployed: {} } },
  layers: {
    s0: { n: 55, base: 6, alpha: { t: 'cnf', terms: [{ exp: { t: 'cnf', terms: [{ exp: { t: 'cnf', terms: [{ exp: { t: 'zero' }, coef: 1 }] }, coef: 1 }] }, coef: 1 }] },
      round: 4, milestones: ['s0.omega'], reachedEps0: false, ascended: true,
      lastActionAt: 0, clockSinceAction: 0, rngSeed: 20261002 },
    s1: oldS1,
  },
});

/** v4 时代的存档：含极限语义修正前的旧 S0 字段 stage / charge（v4→v5 应删除） */
const v4Save = JSON.stringify({
  saveVersion: 4,
  clock: 9000,
  lastSeen: Date.now() - 800,
  meta: { current: 's0', unlocked: ['s0', 's1'], dim: 0, order1: '0', bank: '0',
    milestones: {}, challenges: {}, ascensions: 1,
    five: { essences: { metal: '0', wood: '0', water: '0', fire: '0', earth: '0' }, deployed: {} } },
  layers: {
    s0: { n: 12, base: 8, alpha: { t: 'zero' }, stage: 3, charge: 11, round: 2,
      milestones: [], reachedEps0: false, ascended: false,
      lastActionAt: 0, clockSinceAction: 0, rngSeed: 20261002 },
    s1: oldS1,
  },
});

let pass = true;
function check(name: string, cond: boolean, got?: unknown): void {
  console.log(`  ${cond ? 'PASS' : '✗ FAIL'}  ${name}${got !== undefined ? `  (got=${JSON.stringify(got)})` : ''}`);
  if (!cond) pass = false;
}

console.log('═════════ 存档兼容性 ① v2 → v5（S0 层重做 + 经济切换） ═════════\n');

store[KEY] = v2Save;
const res = load();
check('load() 返回非 null', res !== null);
if (!res) { console.log('\n  ❌ 无法读入旧档'); process.exit(1); }

const { state } = res;
const s1 = state.layers.s1 as unknown as Record<string, unknown>;
const s0 = state.layers.s0 as unknown as Record<string, unknown>;

check('saveVersion 升到 5', state.saveVersion === 5, state.saveVersion);
check('meta.current 保留', state.meta.current === 's1', state.meta.current);
check('meta.it 已删除（经济切换）', !('it' in (state.meta as unknown as Record<string, unknown>)));
check('meta.order1 补齐为 Decimal 0', state.meta.order1 instanceof Decimal && state.meta.order1.eq(0), String(state.meta.order1));
// 新增持久化字段 tickMs：旧档缺失 ⇒ 回落默认 20ms（黑屏根因防线：绝不 undefined）
check('meta.tickMs 回落默认 20（旧档缺字段）', state.meta.tickMs === 20, state.meta.tickMs);

// S1 进度必须完整保留
check('s1.lv 保留', s1.lv === 42, s1.lv);
check('s1.round 保留', s1.round === 42, s1.round);
check('s1.bestPhi 保留', s1.bestPhi === 0.95, s1.bestPhi);
check('s1.eps 还原为 Decimal', s1.eps instanceof Decimal);

// S1 新增字段必须有默认值（黑屏根因防线）
check('s1.hexUnlocked 默认 false', s1.hexUnlocked === false, s1.hexUnlocked);
check('s1.milestones 默认 []', Array.isArray(s1.milestones) && (s1.milestones as unknown[]).length === 0, s1.milestones);
check('s1.autoPlaced 默认 0', s1.autoPlaced === 0, s1.autoPlaced);

// S0 层被重置为默认（形状不可迁移）
check('s0.n 默认 0', s0.n === 0, s0.n);
check('s0.base 默认 10', s0.base === 10, s0.base);
check('s0.round 默认 0', s0.round === 0, s0.round);
check('s0.milestones 默认 []', Array.isArray(s0.milestones) && (s0.milestones as unknown[]).length === 0, s0.milestones);
check('s0.α 默认 0', JSON.stringify(s0.alpha) === JSON.stringify({ t: 'zero' }), s0.alpha);
// 旧 S0 的字段不得残留
check('s0.it 已清除（不再是 Decimal）', !(s0.it instanceof Decimal), s0.it);
check('s0.lv 已清除', s0.lv === undefined, s0.lv);

console.log('\n═════════ 存档兼容性 ② v3 → v5（经济切换：it → order1 + S0 进度保留） ═════════\n');
{
  store[KEY] = v3Save;
  const r = load();
  check('load() 非 null', r !== null);
  if (r) {
    const m = r.state.meta as unknown as Record<string, unknown>;
    check('saveVersion = 5', r.state.saveVersion === 5, r.state.saveVersion);
    check('meta.it 已删除', !('it' in m));
    check('meta.order1 = Decimal 0', r.state.meta.order1 instanceof Decimal && r.state.meta.order1.eq(0));
    // 进度一律保留
    check('meta.current 保留', r.state.meta.current === 's1', r.state.meta.current);
    check('s1.lv 保留', r.state.layers.s1.lv === 42, r.state.layers.s1.lv);
    check('s0.n 保留（v3 计数层可迁移）', r.state.layers.s0.n === 55, r.state.layers.s0.n);
    check('s0.base 保留', r.state.layers.s0.base === 6, r.state.layers.s0.base);
    check('s0.round 保留', r.state.layers.s0.round === 4, r.state.layers.s0.round);
    check('s0.milestones 保留', (r.state.layers.s0.milestones as string[]).includes('s0.omega'));
    // 新升级字段（本层 6 条 id：succGain/succStream/limitDeepen/resonance/autoLimit/limitBreak）全部回落默认 0
    const ups = r.state.layers.s0.upgrades as Record<string, number>;
    check(
      's0.upgrades 全部为 0（6 条新 id）',
      Object.values(ups).every((v) => v === 0) && Object.keys(ups).length === 6,
      ups
    );
    // α 直接信任存档（不再由 (n,base) 自愈重算）：v3 存的是 ω^ω
    const expected = omegaPow(omegaPow(fromNat(1))); // ω^ω
    check('s0.α 由存档直接信任（v3 存 ω^ω）', ord(r.state.layers.s0.alpha) === ord(expected), ord(r.state.layers.s0.alpha));
    check('s0.α 不自愈为 V_6(55)', ord(r.state.layers.s0.alpha) !== ord(hereditaryToOrdinal(55, 6)));
  }
}

console.log('\n═════════ 存档兼容性 ③ v4 → v5（删除 S0 旧字段 stage / charge） ═════════\n');
{
  store[KEY] = v4Save;
  const r = load();
  check('load() 非 null', r !== null);
  if (r) {
    check('saveVersion = 5', r.state.saveVersion === 5, r.state.saveVersion);
    const s0r = r.state.layers.s0 as unknown as Record<string, unknown>;
    check('s0.stage 已删除', s0r.stage === undefined, s0r.stage);
    check('s0.charge 已删除', s0r.charge === undefined, s0r.charge);
    // 仍保留的字段不受影响
    check('s0.n 保留', s0r.n === 12, s0r.n);
    check('s0.base 保留', s0r.base === 8, s0r.base);
    check('s0.round 保留', s0r.round === 2, s0r.round);
    check('s0.α 默认 0（v4 存 zero）', JSON.stringify(s0r.alpha) === JSON.stringify({ t: 'zero' }), s0r.alpha);
    const ups = s0r.upgrades as Record<string, number>;
    check('s0.upgrades 全部为 0（6 条新 id）', Object.values(ups).every((v) => v === 0) && Object.keys(ups).length === 6, ups);
  }
}

console.log('\n═════════ 存档兼容性 ④ v5 往返（S0 新字段无损） ═════════\n');
{
  const g = createGame();
  g.state.meta.current = 's0';
  g.state.layers.s0.n = 42;
  g.state.layers.s0.base = 7;
  g.state.layers.s0.succAcc = 0.5;
  g.state.layers.s0.upgrades.succGain = 2;
  g.state.layers.s0.upgrades.limitDeepen = 1;
  // 显式设 α（极限累积量，不再自愈）
  g.state.layers.s0.alpha = omegaPow(fromNat(2)); // ω²
  g.state.meta.order1 = new Decimal('7');
  g.state.meta.tickMs = 50; // 非默认值，验证确实被持久化（不是每次都回落默认）
  save(g.state);
  const back = load();
  check('往返 load() 非 null', back !== null);
  if (back) {
    const b0 = back.state.layers.s0;
    check('s0.n 往返 = 42', b0.n === 42, b0.n);
    check('s0.base 往返 = 7', b0.base === 7, b0.base);
    check('s0.succAcc 往返 = 0.5', Math.abs(b0.succAcc - 0.5) < 1e-9, b0.succAcc);
    check('s0.upgrades.succGain 往返 = 2', b0.upgrades.succGain === 2, b0.upgrades.succGain);
    check('s0.upgrades.limitDeepen 往返 = 1', b0.upgrades.limitDeepen === 1, b0.upgrades.limitDeepen);
    check('s0.upgrades.autoLimit 未买 = 0', b0.upgrades.autoLimit === 0, b0.upgrades.autoLimit);
    check('meta.order1 往返 = 7', back.state.meta.order1.eq(7), String(back.state.meta.order1));
    check('meta.tickMs 往返 = 50', back.state.meta.tickMs === 50, back.state.meta.tickMs);
    check('s0.α 往返 = ω²', ord(b0.alpha) === ord(omegaPow(fromNat(2))), ord(b0.alpha));
    check('s0.reachedEps0 往返 = false', b0.reachedEps0 === false);
  }
}

console.log('\n═════════ 存档兼容性 ⑤ Base64 导出 / 导入往返 ═════════\n');
{
  const g = createGame();
  g.state.meta.current = 's0';
  g.state.layers.s0.n = 5;
  g.state.layers.s0.base = 3;
  g.state.layers.s0.alpha = omegaPow(fromNat(1)); // ω
  g.state.meta.order1 = new Decimal('1e5');

  const b64 = exportSave(g.state);
  check('导出串带前缀 SPATIUM:', b64.startsWith('SPATIUM:'));
  check('导出串为合法 base64（+ 前缀）', /^SPATIUM:[A-Za-z0-9+/=]+$/.test(b64));

  const r = importSave(b64);
  check('导入成功', r.ok === true, r.error);
  if (r.state) {
    check('导入 n 一致 = 5', r.state.layers.s0.n === 5, r.state.layers.s0.n);
    check('导入 base 一致 = 3', r.state.layers.s0.base === 3, r.state.layers.s0.base);
    check('导入 meta.order1 还原为 Decimal', r.state.meta.order1 instanceof Decimal, String(r.state.meta.order1));
    check('导入 α 一致 = ω', ord(r.state.layers.s0.alpha) === ord(omegaPow(fromNat(1))), ord(r.state.layers.s0.alpha));
  }

  // 非 ASCII 序数（ω / ε₀）必须能编码：直接 btoa 会抛 InvalidCharacterError
  const g2 = createGame();
  g2.state.layers.s0.n = 2;
  g2.state.layers.s0.base = 2;
  g2.state.layers.s0.alpha = omegaPow(fromNat(1)); // α = ω（显式；α 不再由 n/base 自愈）
  const r2 = importSave(exportSave(g2.state));
  check('非 ASCII（ω）往返成功', r2.ok === true, r2.error);
  if (r2.state) {
    const a2 = ord(r2.state.layers.s0.alpha);
    check('非 ASCII 往返保留 ω', a2.includes('ω'), a2);
  }

  // 宽容解析：缺前缀 / 夹带换行
  const body = b64.slice('SPATIUM:'.length);
  check('缺前缀可导入', importSave(body).ok === true);
  check('夹带换行可导入', importSave(body.slice(0, 24) + '\n' + body.slice(24)).ok === true);

  // 垃圾输入必须被拒（而非静默产出坏档）
  check('垃圾输入被拒', importSave('这不是存档').ok === false);
  check('空输入被拒', importSave('   ').ok === false);
}

if (!pass) process.exitCode = 1;
console.log(pass ? '\n  ✅ 存档兼容性全绿' : '\n  ❌ 存档兼容性存在失败项');
