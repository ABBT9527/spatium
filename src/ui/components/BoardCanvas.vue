<script setup lang="ts">
/**
 * 构形画布：只读快照，emit intent。
 * 戒律：禁止直接写 state；禁止持有游戏状态副本。
 */
import { ref, onMounted, watch } from 'vue';
import { drawBoard, hitTest, type BoardSnapshot } from '../board/draw';

const props = defineProps<{
  board: BoardSnapshot;
  /** 当前 Φ（由父组件给出，UI 不直接依赖逻辑模块） */
  phiCurrent: number;
  hoverPhi: (i: number) => number;
  version: number;
}>();
const emit = defineEmits<{ (e: 'pick', i: number): void }>();

const canvas = ref<HTMLCanvasElement | null>(null);
const hover = ref(-1);
const W = 560;
const H = 560;

function render(): void {
  const c = canvas.value;
  if (!c) return;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const gain = hover.value >= 0 ? props.hoverPhi(hover.value) >= props.phiCurrent : true;
  drawBoard(ctx, props.board, W, H, { hover: hover.value, hoverGain: gain });
}

function toIndex(ev: MouseEvent): number {
  const c = canvas.value;
  if (!c) return -1;
  const rect = c.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) * W) / rect.width;
  const y = ((ev.clientY - rect.top) * H) / rect.height;
  return hitTest(props.board, W, H, x, y);
}

function onMove(ev: MouseEvent): void {
  const i = toIndex(ev);
  if (i !== hover.value) {
    hover.value = i;
    render();
  }
}
function onLeave(): void {
  hover.value = -1;
  render();
}
function onClick(ev: MouseEvent): void {
  const i = toIndex(ev);
  if (i >= 0) emit('pick', i);
}

const delta = ref('—');
watch([hover, () => props.version], () => {
  if (hover.value >= 0 && props.board.occ[hover.value] === 0) {
    const d = props.hoverPhi(hover.value) - props.phiCurrent;
    delta.value = (d >= 0 ? '+' : '') + d.toFixed(4);
  } else {
    delta.value = '—';
  }
  render();
});

onMounted(render);
</script>

<template>
  <div class="canvas-wrap">
    <canvas
      ref="canvas"
      :width="W"
      :height="H"
      class="board-canvas"
      @mousemove="onMove"
      @mouseleave="onLeave"
      @click="onClick"
    />
    <div class="canvas-foot">
      <span>悬停 ΔΦ <b class="mono">{{ delta }}</b></span>
      <span class="dim">点击摆点 · 摆满 N 枚才计入产能</span>
    </div>
  </div>
</template>

<style scoped>
.canvas-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--grid);
}
.board-canvas {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  cursor: crosshair;
  width: 100%;
  max-width: 560px;
}
.canvas-foot {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--dim);
}
.mono {
  font-family: var(--font-mono);
  color: var(--accent);
  font-weight: 500;
}
</style>
