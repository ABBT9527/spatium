// 数值显示：对齐「寻数之序」ordinal-game/src/utils/ordinal.ts 的 formatDecimal
// （2026-09-06 规格：≤7 字符，含小数点与 'e'）。
//
// ── 两档渲染（用户定案 2026-10-04） ──
//   · **fmtLive —— 7 位定宽**：会**逐帧变动**的数字走这档。补足到恰好 7 字符（不足用
//     等宽「不换行空格」补位），宽度恒定 ⇒ 数字快速跳动时**不会推挤邻格、不产生抖动**。
//     代价是整数也会显示成 `1234.00` / `100.000` 这种带小数点的定长。
//   · **fmtNum —— 去后导零**：长期不动 / 偶尔才变的数字走这档（价格、门槛、效果值…），
//     省字符、更好读（`2.5` / `4` / `1e7` / `1234567`）。
//   判断依据不是「是不是整数」，而是**这块数字会不会自己一直在动**。
//
// ── 小数一律**截断**（用户定案 2026-10-04） ──
//   两档都截断，不四舍五入。理由：进位会把 999999.6 变成 1000000（**多出一位**），
//   恰好破坏「宽度恒定」的初衷；截断从根上不会增加整数位。
//   ⚠️ 截断必须走**十进制字符串**切分，不能走 `Math.floor(v * 10^p)`：
//      2.3 * 10 = 22.999999999999996，会被 floor 成 2.2（少一位）。
//
// 目标形态：1.00000, 12.0000, 12345.0, 123456␣, 1234567,
//           1.345e7, 1.34e67, 1.3e567 / 去尾零档：2.5, 4, 1e7, 1.3e567
// 规则：
//  · 整数位 ≤7：小数按「7 字符预算」截断（多余位舍去）；静态档再剥掉尾零与孤立小数点；
//  · 整数位 ==7 → 无小数位 → 纯整数（去尾点，如 1234567）；
//  · 整数位 ≥8（≥10^7）转科学计数（1e7 / 2.96e12）；指数 ≥1e6 → 层叠 1ee…；更巨大 → '1e∞'。

const FMT_WIDTH = 7;

/**
 * 定宽补位符：U+00A0 不换行空格。
 *  · 等宽字体（JetBrains Mono / IBM Plex Mono）里与数字**同宽** ⇒ 补位即得定宽；
 *  · 普通空格会被 HTML **折叠掉**（`123456 ` 后面接 ` / ` 会被并成单个空格），补位等于白补，
 *    所以这里必须用不折叠的 U+00A0。
 */
const PAD = '\u00A0';

/**
 * 非负有限值的整数位位数（x ≥ 0）。
 * ⚠️ ≥1e21 时 `String(x)` 会变成 `1e+21` 这种指数形态，长度完全不可信
 *    （会让 1e234 被当成 6 位数，于是绕过科学计数分支、原样吐出 "1e+234"）——
 *    故这里改用 log10 求位数。
 */
function decimalDigitsOfInteger(x: number): number {
  if (x === 0) return 1;
  if (x < 1) return 0; // 0 < x < 1 → 0 个整数位
  if (x < 1e21) return String(Math.floor(x)).length;
  return Math.floor(Math.log10(x)) + 1;
}

/**
 * **截断**到 places 位小数，并补齐 places 位（定宽，不受进位影响）。
 * 走十进制字符串切分（见文件头注释：`v*10^p` 的浮点误差会吃掉最后一位）。
 */
function toFixedTrunc(value: number, places: number): string {
  const p = Math.max(0, Math.floor(places));
  if (p === 0) return String(Math.trunc(value));
  const s = String(value);
  let intPart: string;
  let fracPart: string;
  if (s.includes('e') || s.includes('E')) {
    // 指数形态（极小值）先展开成定点再由字符串切
    const t = value.toFixed(Math.min(100, p));
    const dot = t.indexOf('.');
    intPart = dot < 0 ? t : t.slice(0, dot);
    fracPart = dot < 0 ? '' : t.slice(dot + 1);
  } else {
    const dot = s.indexOf('.');
    intPart = dot < 0 ? s : s.slice(0, dot);
    fracPart = dot < 0 ? '' : s.slice(dot + 1);
  }
  return `${intPart}.${(fracPart + '0'.repeat(p)).slice(0, p)}`;
}

/**
 * 去掉小数**尾零**与孤立的点（静态档用）。
 * ⚠️ 只作用于「一段纯小数」（定长小数、科学计数的 mantissa、层叠的 inner），
 *    不能对整串做 —— `"1.000e7"` 的尾零在 `e` **前面**，整串去尾零够不着它。
 */
function trimTail(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * 原始 7 字符预算文本（可能短于 7，由 formatFixedWidth 统一补位）。
 * @param trim true = 静态档（每段小数去尾零）、false = 定宽档（每段小数补足位数）
 */
function rawFixedWidth(nonNeg: number, trim: boolean): string {
  /** 按档位处理一段小数 */
  const dec = (v: number, p: number): string => {
    const t = toFixedTrunc(v, p);
    return trim ? trimTail(t) : t;
  };
  const intDigits = decimalDigitsOfInteger(nonNeg);

  if (intDigits <= FMT_WIDTH) {
    if (intDigits === 0) {
      // 0 < x < 1：给 5 位小数；极小（< 1e-4）转科学计数
      if (nonNeg > 0 && nonNeg < 1e-4) {
        const exp = Math.floor(Math.log10(nonNeg)); // < 0
        const mant = Math.trunc(nonNeg * Math.pow(10, -exp));
        const txt = `${mant}e${exp}`;
        return txt.length <= FMT_WIDTH ? txt : '1e-∞';
      }
      return dec(nonNeg, FMT_WIDTH - 2);
    }
    const decimals = FMT_WIDTH - 1 - intDigits;
    if (decimals <= 0) {
      return String(Math.trunc(nonNeg)); // intDigits==7：纯整数（去尾点）
    }
    return dec(nonNeg, decimals);
  }

  // 科学计数：E = 底 10 指数（≥7 因整数位 >7）
  const E = Math.floor(Math.log10(nonNeg));
  if (!Number.isFinite(E) || E < 0) return '1e∞';
  if (E < 1e6) {
    const expText = String(E);
    const decimals = Math.max(0, 4 - expText.length); // exp 1..5 位 → mantissa 3..0 位小数
    const mantissa = nonNeg / Math.pow(10, E);
    const mantissaText = decimals > 0 ? dec(mantissa, decimals) : String(Math.trunc(mantissa));
    const out = `${mantissaText}e${expText}`;
    return out.length <= FMT_WIDTH ? out : `${Math.trunc(mantissa)}e${expText}`;
  }

  // 层叠（指数 ≥1e6）：'m' + 'ee' + inner，inner = log10(E)，总长 ≤7
  const first = Math.floor(nonNeg / Math.pow(10, E)); // 1..9
  const logE = Math.log10(E);
  if (!Number.isFinite(logE) || logE < 0) return '1e∞';
  const innerInt = Math.floor(logE);
  const innerDigits = String(innerInt).length;
  if (innerDigits > 4) return '1e∞'; // E ≥ 10^10000：超规格安全截断
  const innerDecimals = Math.max(0, 3 - innerDigits); // 预算 4 字符：'6.12'/'12.3'/'123'
  const inner = innerDecimals > 0 ? dec(logE, innerDecimals) : String(innerInt);
  const layered = `${first}ee${inner}`;
  return layered.length <= FMT_WIDTH ? layered : '1e∞';
}

/** 核心：非负有限值 → **恰好 7 字符**的定宽文本（不足用 U+00A0 补位） */
function formatFixedWidth(nonNeg: number, trim: boolean): string {
  const raw = rawFixedWidth(nonNeg, trim);
  return raw.length >= FMT_WIDTH ? raw : raw + PAD.repeat(FMT_WIDTH - raw.length);
}

/**
 * **静态档**：去后导零（用户定案 2026-10-04）。给「长期不动 / 偶尔才变」的数字用
 * （升级价格、换基门槛、效果数值…）。整数且 < 10^7 按原样整数显示。
 */
export function fmtNum(x: number): string {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '-∞';
  if (x === 0) return '0';
  if (x < 0) return `-${fmtNum(-x)}`;
  if (Number.isInteger(x) && Math.abs(x) < 1e7) return String(Math.trunc(x));
  return rawFixedWidth(x, true);
}

/**
 * **动态档**：7 字符定宽（补尾零 / 补位符），**一律不省**。
 * 用户定案 2026-10-04：凡会**逐帧变动**的数字（顶栏计数 n、序数计数 a、进度条分子、
 * base2 的 D(n)）都必须走这档 —— 宽度恒定，快速跳动时邻格不会被推来推去。
 */
export function fmtLive(x: number): string {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '-∞';
  if (x < 0) return `-${fmtLive(-x)}`;
  return formatFixedWidth(x, false);
}
