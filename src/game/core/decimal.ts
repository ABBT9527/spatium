/**
 * 大数唯一入口。
 *
 * 戒律（大数戒律）：经济计算**禁止原生 number**，一律 Decimal。
 * 需要 number 的地方必须显式转换并 clamp（见 toNum）。
 */

import Decimal from 'break_eternity.js';

export { Decimal };
export type DS = Decimal | number | string;

export const dZero = () => new Decimal(0);
export const dOne = () => new Decimal(1);
export const dec = (x: DS): Decimal => (x instanceof Decimal ? x : new Decimal(x));

/** 安全转 number：超出 double 范围时夹逼，避免 Infinity 污染逻辑 */
export function toNum(x: Decimal, fallback = Number.MAX_SAFE_INTEGER): number {
  const n = x.toNumber();
  return Number.isFinite(n) ? n : fallback;
}

const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/**
 * 显示格式化。
 *  < 1e6     ：整数 / 一位小数
 *  1e6–1e36  ：K/M/B/… 后缀
 *  ≥ 1e36    ：科学记数
 *  ≥ 10^1e6  ：10^(…) 双层（本作 S3 起会到这里，break_eternity 存在的理由）
 */
export function fmt(x: DS, sig = 3): string {
  const v = dec(x);
  if (v.isNan()) return 'NaN';
  if (v.lt(0)) return '-' + fmt(v.neg(), sig);
  if (v.lt(1e6)) {
    const n = v.toNumber();
    if (n < 10) return n.toFixed(Math.min(sig - 1, 2)).replace(/\.?0+$/, '');
    return Math.floor(n).toString();
  }
  const l10 = v.log10().toNumber();
  if (!isFinite(l10)) return '∞';
  if (l10 >= 1e6) return '10^(' + fmt(new Decimal(l10), sig) + ')';
  if (l10 >= 36) {
    const e = Math.floor(l10);
    const m = v.div(Decimal.pow(10, e)).toNumber();
    return m.toFixed(sig - 1) + 'e' + e;
  }
  const tier = Math.min(SUFFIX.length - 1, Math.floor(l10 / 3));
  const m = v.div(Decimal.pow(10, tier * 3)).toNumber();
  return m.toFixed(sig - 1) + SUFFIX[tier];
}

/** 时间格式化（秒 → 可读） */
export function fmtTime(sec: number): string {
  if (!isFinite(sec)) return '∞';
  if (sec < 60) return sec.toFixed(0) + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm' + Math.floor(sec % 60) + 's';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h + 'h' + (m > 0 ? m + 'm' : '');
}
