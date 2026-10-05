<script setup lang="ts">
/**
 * KaTeX 行内/行间数学渲染（D4 = 做，本地依赖 katex）。
 *
 * 用法：<KatexText :tex="s0.alphaTex" />
 *   - `tex` 是 LaTeX 源（由 `game/ordinal/latex.ts` 产出）
 *   - `fallback` 是 KaTeX 不可用时的纯文本退路（一般传 `toString` 的结果）
 *
 * 戒律（三层分离 · 渲染层）：本组件只做「字符串 → HTML」，不持有游戏状态。
 * 用**本地依赖**而非 CDN：`start-game.cmd` 的冻结快照要能离线跑。
 */
import { computed } from 'vue';
import katex from 'katex';
import 'katex/dist/katex.min.css';

const props = withDefaults(
  defineProps<{
    tex: string;
    /** KaTeX 渲染失败 / 未装时的纯文本退路 */
    fallback?: string;
    /** 行间公式（displayMode） */
    block?: boolean;
    /** 字号缩放（大号主展示用） */
    size?: number;
  }>(),
  { fallback: '', block: false, size: 0 }
);

const html = computed<string>(() => {
  const src = props.tex ?? '';
  if (!src) return '';
  try {
    return katex.renderToString(src, {
      throwOnError: false,
      displayMode: props.block,
      output: 'html',
    });
  } catch {
    return '';
  }
});

const style = computed(() =>
  props.size > 0 ? { fontSize: `${props.size}px` } : undefined
);
</script>

<template>
  <span v-if="html" class="katex-wrap" :style="style" v-html="html" />
  <span v-else class="katex-wrap mono" :style="style">{{ fallback || tex }}</span>
</template>

<style scoped>
.katex-wrap {
  display: inline-block;
  line-height: 1.3;
  word-break: break-word;
}
.mono {
  font-family: var(--font-mono);
}
</style>
