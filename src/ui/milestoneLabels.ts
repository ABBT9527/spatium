/**
 * 里程碑 id → 玩家可见标签（渲染层，纯函数，零状态）。
 *
 * 戒律：**原始 id 不得直接暴露给玩家**（命名戒律：用数学/几何术语）。
 * 里程碑 id 是存档键（跨版本必须稳定），标签是展示文案（可随时改）。
 * 新增里程碑时两处一起改：`layers/<layer>/logic.ts` 的 check*Milestones 与这里。
 *
 * ⚠️ 未知 id 原样返回，便于新里程碑上线时快速定位缺失标签（不会静默丢失）。
 */

const LABELS: Record<string, string> = {
  // S0 序数层
  's0.omega': 'α ≥ ω',
  's0.omegaomega': 'α ≥ ω^ω',
  's0.cap3': 'α = ω^(ω^ω)',
  's0.base2': '换基至 2',
  's0.eps0': 'α = ε₀',
  // S1 点层
  's1.hex': '三角格解锁',
  's1.phi90': 'Φ ≥ 0.90',
  's1.phi99': 'Φ ≥ 0.99',
};

/** S0 序数层的全部里程碑 id（成就页据此列出「已达成 / 未达成」清单） */
export const S0_MILESTONE_IDS: readonly string[] = [
  's0.omega', 's0.omegaomega', 's0.cap3', 's0.base2', 's0.eps0',
];

export function milestoneLabel(id: string): string {
  return LABELS[id] ?? id;
}
