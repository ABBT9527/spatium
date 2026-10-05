/**
 * 序数 CNF 内核独立验证（sandbox-first：先确认数学正确，再合入主项目）。
 * 运行：用 esbuild 打包后 node 执行（同 smoke 流程）。
 */
import {
  ZERO, EPS0, fromNat, succ, omegaPow, sup, fix, cmp, toString,
  buildLadder, milestone, checkBijection, isEps0, type Ordinal,
} from '../src/game/ordinal/cnf';

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${msg}`);
  }
}

function eq(a: Ordinal, b: Ordinal): boolean {
  return cmp(a, b) === 0;
}

console.log('═══════ 序数 CNF 内核验证 ═══════\n');

// 1. 后继运算
assert(eq(succ(ZERO), fromNat(1)), 'succ(0)=1');
assert(eq(succ(fromNat(1)), fromNat(2)), 'succ(1)=2');
assert(eq(succ(fromNat(5)), fromNat(6)), 'succ(5)=6');
assert(eq(omegaPow(fromNat(0)), fromNat(1)), 'ω^0=1');

// 2. ω 与倍数
const omega = omegaPow(fromNat(1));
assert(toString(omega) === 'ω^1', `ω 的字符串 = "${toString(omega)}"（期望 ω^1）`);
const omega2 = omegaPow(fromNat(2));
assert(toString(omega2) === 'ω^2', `ω^2 = "${toString(omega2)}"`);
// ω + 1
const omegaPlus1 = succ(omega);
assert(toString(omegaPlus1) === 'ω^1 + 1', `ω+1 = "${toString(omegaPlus1)}"`);
// ω·2 = ω + ω
const omega2mul = { t: 'cnf' as const, terms: [{ exp: omega, coef: 1 }] };
const omegaTimes2 = (() => {
  // 构造 ω·2 = ω^1·2
  return { t: 'cnf' as const, terms: [{ exp: fromNat(1), coef: 2 }] };
})();
assert(toString(omegaTimes2) === 'ω^1·2', `ω·2 = "${toString(omegaTimes2)}"`);

// 3. Sup（取下一个主序数）
assert(eq(sup(fromNat(5)), omega), 'Sup(5)=ω');
assert(eq(sup(omegaTimes2), omega2), 'Sup(ω·2)=ω^2');
const omega2plus = succ(omega2);
assert(eq(sup(omega2plus), omegaPow(fromNat(3))), 'Sup(ω^2+1)=ω^3');

// 4. Fix（不动点迭代 → ε₀）
let a: Ordinal = omega;
const trace: string[] = [toString(a)];
let reached = false;
for (let i = 0; i < 10; i++) {
  a = fix(a);
  trace.push(toString(a));
  if (isEps0(a)) {
    reached = true;
    break;
  }
}
console.log('  Fix 迭代轨迹：', trace.join('  →  '));
assert(reached, '反复 Fix(ω) 最终封顶到 ε₀（游戏内抵达对角不动点）');

// 5. ε₀ 检测与封顶
assert(isEps0(EPS0), 'EPS0 是 ε₀');
assert(eq(fix(EPS0), EPS0), 'Fix(ε₀)=ε₀（不动点）');
assert(eq(sup(EPS0), EPS0), 'Sup(ε₀)=ε₀（封顶）');

// 6. 双射不变量：所有生成序数都满足
const samples: Ordinal[] = [
  ZERO, fromNat(1), fromNat(100), omega, omegaPlus1, omegaTimes2,
  omega2, omega2plus, fix(omega), fix(fix(omega)),
];
for (const s of samples) {
  assert(checkBijection(s), `双射不变量：${toString(s)}`);
}

// 7. 阶梯：从 0 到 ε₀，严格递增，末项 = ε₀
const ladder = buildLadder(111);
assert(ladder.length === 111, `阶梯长度 111（实际 ${ladder.length}）`);
assert(eq(ladder[0], ZERO), '阶梯首项 = 0');
assert(isEps0(ladder[110]), '阶梯末项 = ε₀');
let mono = true;
for (let i = 1; i < ladder.length; i++) {
  if (cmp(ladder[i], ladder[i - 1]) <= 0) {
    mono = false;
    console.log(`    非单调：第 ${i} 项 ${toString(ladder[i])} ≤ 第 ${i - 1} 项 ${toString(ladder[i - 1])}`);
    break;
  }
}
assert(mono, '阶梯严格单调递增');
assert(eq(milestone(ladder, 110, 110), EPS0), 'milestone(110)=ε₀');
assert(eq(milestone(ladder, 50, 110), ladder[50]), 'milestone(50)=ladder[50]');

// 8. 阶梯上每个序数都满足双射不变量
let allBiject = true;
for (const o of ladder) {
  if (o.t === 'cnf' && !checkBijection(o)) {
    allBiject = false;
    console.log(`    阶梯上双射违反：${toString(o)}`);
    break;
  }
}
assert(allBiject, '阶梯全部满足双射不变量');

console.log(`\n结果：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exitCode = 1;
