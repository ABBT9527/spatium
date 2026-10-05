/**
 * 构形画布绘制（纯函数，只读 Board 的**快照数据**）。
 *
 * 戒律（三层分离 · 渲染层）：
 *   - 只读 state，不持有游戏状态副本
 *   - 不读逻辑对象，只读投影后的多边形/点快照
 */

export interface BoardSnapshot {
  size: number;
  count: number;
  pos: Float32Array;
  occ: Uint8Array;
  placed: number;
}

export interface DrawOptions {
  pad?: number;
  hover?: number;
  /** 悬停位点的 ΔΦ 符号（用于描边配色） */
  hoverGain?: boolean;
  gridColor?: string;
  pointColor?: string;
  bgColor?: string;
}

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  snap: BoardSnapshot,
  w: number,
  h: number,
  o: DrawOptions = {},
): void {
  const pad = o.pad ?? 24;
  const size = snap.size;
  const pitch = (Math.min(w, h) - pad * 2) / Math.max(1, size - 1);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = o.bgColor ?? '#14161A';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = o.gridColor ?? '#23262C';
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

  ctx.fillStyle = o.pointColor ?? '#4FD1C5';
  const r = Math.max(2.5, pitch * 0.22);
  for (let i = 0; i < snap.count; i++) {
    if (snap.occ[i] === 0) continue;
    const x = pad + (i % size) * pitch;
    const y = pad + Math.floor(i / size) * pitch;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (o.hover !== undefined && o.hover >= 0 && snap.occ[o.hover] === 0) {
    const x = pad + (o.hover % size) * pitch;
    const y = pad + Math.floor(o.hover / size) * pitch;
    ctx.strokeStyle = o.hoverGain === false ? '#E0A458' : '#4FD1C5';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** 屏幕坐标 → 位点索引（吸附到格，点击永远精确） */
export function hitTest(
  snap: BoardSnapshot,
  w: number,
  h: number,
  px: number,
  py: number,
  pad = 24,
): number {
  const size = snap.size;
  const pitch = (Math.min(w, h) - pad * 2) / Math.max(1, size - 1);
  let bestI = -1;
  let bestD = Infinity;
  for (let i = 0; i < snap.count; i++) {
    const x = pad + (i % size) * pitch;
    const y = pad + Math.floor(i / size) * pitch;
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  const tol = Math.max(pitch * 0.6, 10) ** 2;
  return bestD <= tol ? bestI : -1;
}
