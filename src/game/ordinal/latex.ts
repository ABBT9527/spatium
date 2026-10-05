/**
 * 序数 → LaTeX（渲染用）。与 `cnf.toString` 是**同一批序数**的两套渲染：
 *   - `toString`：纯文本，headless / 测试断言用（保持 `ω^1` / `ω^(ω^1)` 惯例）
 *   - `ordinalToLatex`：数学排版，交给 KaTeX（`ui/components/KatexText.vue`）
 *
 * 与 testFile/序数渲染测试.html 的渲染口径一致的部分：
 *   - 指数为 1 时写作 `\omega`（不写 `\omega^{1}`）
 *   - 指数 / 系数递归展开
 * 不采用的部分：它的 `lift`（把 ω-幂塔折叠成 ε₀^…）——本作内核在
 *   ω-深度 ≥ base 时**直接饱和为 ε₀**（ε₀ = base↑↑base，见 cnf.epsDepthFor），
 *   所以永远不会渲染出 `ε₀^{...}`；R2（ζ₀ 阶段）扩展 ε_n 时再补 lift。
 *
 * 纯字符串函数、零依赖 ⇒ 可在 headless 测试里直接断言。
 */

import type { Ordinal } from './cnf';

/** LaTeX 中的序数转移字符：加 `{}` 让下标/上标作为独立组。 */
const EPS0_TEX = '\\varepsilon_{0}';
const OMEGA_TEX = '\\omega';

/** ε₀ 的 LaTeX 文本（UI 也会用它做静态文案）。 */
export const EPS0_LATEX = EPS0_TEX;

function isOne(a: Ordinal): boolean {
  return (
    a.t === 'cnf' &&
    a.terms.length === 1 &&
    a.terms[0].coef === 1 &&
    a.terms[0].exp.t === 'zero'
  );
}

/** `ω^E`（E = 1 时退化为 `ω`）。 */
function omegaPowTex(e: Ordinal): string {
  if (isOne(e)) return OMEGA_TEX;
  return `${OMEGA_TEX}^{${ordinalToLatex(e)}}`;
}

/**
 * 序数 → LaTeX。
 *   0        → `0`
 *   ε₀       → `\varepsilon_{0}`
 *   ω^b · c  → `\omega^{b} \cdot c`（c = 1 时省略）
 *   多项     → `A + B + …`（CNF 降序，与 `toString` 同序）
 *
 * `opts.maxTerms`（默认不限）超过时截断并补 `+\cdots` —— 沿用
 * testFile 渲染器的口径：低基大数会产生几十个项，排版会溢出容器。
 * 测试断言用不限的默认值（要精确字符串），只有 UI 传 8。
 */
export function ordinalToLatex(a: Ordinal, opts: { maxTerms?: number } = {}): string {
  if (a.t === 'zero') return '0';
  if (a.t === 'eps0') return EPS0_TEX;
  const max = opts.maxTerms ?? Infinity;
  const shown = a.terms.slice(0, max);
  const parts = shown.map((t) => {
    if (t.exp.t === 'zero') return String(t.coef); // ω^0·c = c
    const base = omegaPowTex(t.exp);
    return t.coef === 1 ? base : `${base} \\cdot ${t.coef}`;
  });
  if (shown.length < a.terms.length) parts.push('\\cdots');
  return parts.join(' + ');
}
