/**
 * 遗传基数映射 V_b 的快速自检（开发期）。
 *
 * 断言（2026-10-02 修正 A 后）：
 *   - **ε₀ ⟺ n = base↑↑base**：base 2 → n = 4；base 3 → n = 3^27 = 3↑↑3。
 *     （旧实现把封顶写成常量 EPS_DEPTH = 3，导致 base 2 的 ε₀ 错落在 n = 16。）
 *   - base 2 阶梯：1 → 1、2 → ω、3 → ω+1、4 → ε₀。
 *   - 同一 n，base 越小序数越大。
 *
 * 权威出处：`testFile/序数渲染测试.html:36`
 *   「底数 b 决定 ω = b 与 ε₀ = b↑↑b。例如 b = 2 时 ω = 2、ε₀ = 4；
 *     b = 3 时 ω = 3、ε₀ = 3^27；b = 4 时 ε₀ = 4↑↑4。」
 */
import {
  hereditaryToOrdinal, toString, isEps0, omegaDepth, cmp, epsDepthFor, eps0NatIndex, ZERO,
  add, omegaPow, fromNat, EPS0, ordinalToCount,
} from '../src/game/ordinal/cnf';
import { ordinalToLatex } from '../src/game/ordinal/latex';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ FAIL: ${msg}`); }
}

console.log('=== V_2（base = 2）阶梯：ε₀ ⟺ n = 4 = 2↑↑2 ===');
for (const n of [1, 2, 3, 4, 5, 8, 15, 16, 17]) {
  const a = hereditaryToOrdinal(n, 2);
  console.log(`  V_2(${n}) = ${toString(a)}   latex=${ordinalToLatex(a)}   depth=${omegaDepth(a)}`);
}
ok(toString(hereditaryToOrdinal(1, 2)) === '1', 'V_2(1)=1');
ok(toString(hereditaryToOrdinal(2, 2)) === 'ω^1', 'V_2(2)=ω');
ok(toString(hereditaryToOrdinal(3, 2)) === 'ω^1 + 1', 'V_2(3)=ω+1');
ok(isEps0(hereditaryToOrdinal(4, 2)), 'V_2(4)=ε₀（修正 A：旧实现错记为 ω^ω）');
ok(isEps0(hereditaryToOrdinal(16, 2)), 'V_2(16)=ε₀（封顶饱和）');
ok(omegaDepth(hereditaryToOrdinal(1, 2)) === 0, 'depth(V_2(1))=0');
ok(omegaDepth(hereditaryToOrdinal(2, 2)) === 1, 'depth(V_2(2))=1');
ok(omegaDepth(hereditaryToOrdinal(3, 2)) === 1, 'depth(V_2(3))=1');
ok(!isEps0(hereditaryToOrdinal(3, 2)), 'V_2(3) 未封顶');

console.log('\n=== ε₀ 的自然数下标 = base↑↑base ===');
ok(epsDepthFor(2) === 2 && epsDepthFor(3) === 3 && epsDepthFor(4) === 4, 'epsDepthFor(base) = base（下限 2）');
ok(eps0NatIndex(2) === 4, `2↑↑2 = ${eps0NatIndex(2)}`);
ok(eps0NatIndex(3) === 3 ** 27, `3↑↑3 = 3^27 = ${eps0NatIndex(3)}`);
ok(eps0NatIndex(4) === null, '4↑↑4 超出 Number 安全域 ⇒ null（只能靠换基降门槛）');
{
  const a = hereditaryToOrdinal(3 ** 27, 3);
  console.log(`  V_3(3^27) = ${toString(a)}`);
  ok(isEps0(a), 'V_3(3^27) = ε₀（与同辈项目「寻数之序」的 ε₀ 下标一致）');
  ok(toString(hereditaryToOrdinal(27, 3)) === 'ω^(ω^1)', 'V_3(27)=ω^ω（= 3↑↑2，未到顶）');
}

console.log('\n=== 同一 n，换基 ⇒ 序数跃升 ===');
for (const b of [10, 9, 8, 7, 6, 5, 4, 3, 2]) {
  const a = hereditaryToOrdinal(100, b);
  console.log(`  V_${b}(100) = ${toString(a)}   depth=${omegaDepth(a)}`);
}
{
  let mono = true;
  let prev = hereditaryToOrdinal(100, 10);
  for (const b of [9, 8, 7, 6, 5, 4, 3, 2]) {
    const cur = hereditaryToOrdinal(100, b);
    if (cmp(cur, prev) < 0) mono = false;
    prev = cur;
  }
  ok(mono, '同一 n=100：base 单调下降 ⇒ 序数单调不减');
}

console.log('\n=== 边界 ===');
ok(toString(hereditaryToOrdinal(0, 2)) === '0', 'V_b(0)=0');
ok(cmp(hereditaryToOrdinal(0, 2), ZERO) === 0, 'V_b(0) ≡ ZERO');

console.log('\n=== LaTeX 渲染 ===');
ok(ordinalToLatex({ t: 'zero' }) === '0', 'latex(0) = 0');
ok(ordinalToLatex({ t: 'eps0' }) === '\\varepsilon_{0}', 'latex(ε₀) = \\varepsilon_{0}');
ok(
  ordinalToLatex(hereditaryToOrdinal(3, 2)) === '\\omega + 1',
  `latex(V_2(3)) = \\omega + 1（实得 ${ordinalToLatex(hereditaryToOrdinal(3, 2))}）`
);
ok(
  ordinalToLatex(hereditaryToOrdinal(8, 4)) === '\\omega \\cdot 2',
  `latex(V_4(8)) = \\omega \\cdot 2（实得 ${ordinalToLatex(hereditaryToOrdinal(8, 4))}）`
);

console.log('\n=== 序数加法 add()（极限的遗传进位内核）===');
{
  const omega = omegaPow(fromNat(1));
  const omega2 = omegaPow(fromNat(2));
  ok(toString(add(ZERO, omega)) === 'ω^1', `add(0, ω) = ${toString(add(ZERO, omega))}`);
  ok(toString(add(omega, ZERO)) === 'ω^1', `add(ω, 0) = ${toString(add(omega, ZERO))}`);
  // ω + ω = ω·2
  ok(toString(add(omega, omega)) === 'ω^1·2', `add(ω, ω) = ω·2（实得 ${toString(add(omega, omega))}）`);
  // 遗传进位：α=ω 后再极限（n=10 的 ω-内容 = ω）→ ω·2；即 10→ω、ω+10→ω·2
  ok(
    toString(add(omega, hereditaryToOrdinal(10, 10))) === 'ω^1·2',
    `α=ω 再极限(10)→ω·2（10→ω；实得 ${toString(add(omega, hereditaryToOrdinal(10, 10)))}）`
  );
  // ω² + ω：ω 低于首项，作为低位保留
  ok(toString(add(omega2, omega)) === 'ω^2 + ω^1', `ω²+ω = ${toString(add(omega2, omega))}`);
  // ω + ω²：ω < ω² 被首项吸收 ⇒ ω + ω² = ω²（序数加法不交换，低位被主导项吸收）
  ok(toString(add(omega, omega2)) === 'ω^2', `ω+ω² = ${toString(add(omega, omega2))}`);
  // ε₀ 封顶
  ok(isEps0(add(EPS0, omega)), 'add(ε₀, ω) = ε₀（封顶）');
}

console.log('\n=== ordinalToCount：序数价 → 计数等价量（升级花费）===');
{
  const W = (k: number) => omegaPow(fromNat(k));
  ok(ordinalToCount(W(2), 10) === 100, 'ω²@base10 = 100（10²）');
  ok(ordinalToCount(W(2), 9) === 81, 'ω²@base9 = 81（9²）');
  ok(ordinalToCount(W(3), 10) === 1000, 'ω³@base10 = 1000（10³）');
  ok(ordinalToCount(W(4), 10) === 10000, 'ω⁴@base10 = 10000（10⁴）');
  // 低基封顶坍缩：base 2 时 n=4 即 ε₀，覆盖一切 ω^k 价
  ok(ordinalToCount(W(2), 2) === 4, 'ω²@base2 = 4（封顶 ε₀ 覆盖）');
  ok(ordinalToCount(W(5), 2) === 4, 'ω⁵@base2 = 4（封顶 ε₀ ≥ ω⁵）');
  // 往返一致性：V_base(ordinalToCount(P,b)) ≥ P
  for (const [k, b] of [[2, 10], [3, 10], [2, 9], [5, 10], [2, 3]] as const) {
    const P = W(k);
    const n = ordinalToCount(P, b);
    ok(cmp(hereditaryToOrdinal(n, b), P) >= 0, `往返：V_${b}(ordinalToCount(ω^${k},${b})) ≥ ω^${k}`);
  }
}

console.log(`\nV_b 自检：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
