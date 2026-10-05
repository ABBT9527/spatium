<script setup lang="ts">
/**
 * S0 · 序数页。
 *
 * 布局定案（2026-10-03）：计数 n / 序数 α 已上提到外壳顶栏（全局状态，任何页面都看得见）。
 * 本页只承载 S0 序数层的操作：三动词 + 进度条。
 *
 * base3 期间（用户定案 2026-10-04）：整段「换基」伪装成「涌升」——按钮叫涌升、进度叫涌升进度，
 * 藏住 base2 的存在。计数条满后点「涌升」启动**失败演出**（见 ascendCinematic）；
 * 演出尾声按钮变「换基」，点 4 次才真正进 base2。
 *
 * base2（用户定案 2026-10-04；三次修订见下）：**只有一个按钮**，词在「后继 / 极限 / 涌升」间来回：
 *   · 计数撞满 65536（显示 4）⇒ 后继禁用、**青光渐暗**，一发 A 爆发把词换成「极限」；
 *   · 极限按 4 次（α 走脚本阶梯 ω+2 → ω·2 → ω² → ω^ω）⇒ 每次点击都是一发 A 爆发（0.5/1/3s），
 *     爆发本身把词换回「后继」；第 4 次（1s）指向「涌升」；
 *   · 涌升启动**成功演出**：同一条减速曲线，但这次能真正抵达 100% ⇒ 进 S1。
 *   演出期间文字**不再二次乱码**，而是随进度逐字恢复正常；刚进 base2 的那一刻则从 A 方案
 *   渐回 D、并把跳动节拍放缓到 800~1200ms（详见 ascendCinematic）。
 *
 * 三次修订（用户定案 2026-10-04）：换词不再另走一段 2s morph，而是**折叠进那一发 A 爆发** ——
 *   上升 / 停在 A 时 D 侧仍是旧词，A→D 下降时改读新词，切换点落在全 A 那一帧（那时每位都被
 *   生僻字遮住）⇒ 肉眼只看到「旧词D 炸开成 A，从 A 里落下新词D」**一发**脉冲，而不是
 *   「D→A→D，然后再来一遍 A」（详见 ascendCinematic 头部的「换词脉冲」）。
 *   另：base2 是**四圈循环** —— 每次极限后计数清零、升级重置，跨圈只保留 ×√2 后继倍率
 *   （见 logic.base2Root2Of）。阶段**由存档状态派生**（见 stageOf），不是一条单向 ref。
 *   第 4 次换基后按钮行会从「3 个按钮」变「1 个按钮」，用 out-in 过渡抹平（见 template）。
 * 进度条全程保留：文字显示「D(n) / 4」，填充按 n/65536（用户定案）。
 */
import { computed, ref, watch, onMounted } from 'vue';
import { useGame } from '@/bridge/useGame';
import KatexText from '../components/KatexText.vue';
import { fmtLive, fmtNum } from '../format';
import {
  cine, garble, garbleOn, rebaseBtnLabel, startCinematic, clickRebase, cineLocked,
  startBase2Ascend, mixBurst, swapPulse, pulseRunning, B2_CAP_PULSE_MS,
} from '../ascendCinematic';

const game = useGame();
const v = computed(() => game.view.value);
const s0 = computed(() => v.value.s0);

// 演出期间锁死后继 / 极限：玩家只能盯着进度条与那个「涌升 → 换基」按钮（用户定案 2026-10-04）。
// ⚠️ 热键 s / l 走同一判定（useGame 里引 cineLocked），否则按钮锁了热键还能按等于没锁。
const locked = computed(() => cineLocked());
const isB2 = computed(() => s0.value?.base === 2);

// ───────── base2 阶段切换：一次「A 爆发 + 在 A 里换词」（用户定案 2026-10-04） ─────────
// 旧版是「爆发 + 2s morph」两段叠加：点一次极限会看到 D→A→D，然后再走一遍 A 才落到「后继」。
// 现在 morph 整段删掉，让爆发的 A 自己承担换词 —— 切换点落在**全 A 那一帧**（那时每一位都被
// 生僻字遮住，D 侧串看不见），于是「换词」肉眼不可见，只剩一发脉冲。
const WORD = { succ: '后继', limit: '极限', ascend: '涌升' } as const;
type Stage = 'succ' | 'limit' | 'ascend';

/** 基 2 当前**该**处于哪一段 —— 由存档状态派生（撞满 ⇒ 极限；走满 4 格 ⇒ 涌升；否则后继） */
function stageOf(s: { base2Cap: boolean; ascendReady: boolean } | undefined): Stage {
  if (!s) return 'succ';
  if (s.ascendReady) return 'ascend';
  if (s.base2Cap) return 'limit';
  return 'succ';
}

/** 已定形的词（一次脉冲**收尾后**才提交）；刷新页面直接落到这里 */
const stage = ref<Stage>('succ');
/** true = 一次换词脉冲正在跑（收尾时要提交新词） */
const pulseOpen = ref(false);
const wantStage = computed(() => stageOf(s0.value));
/** 换词脉冲是否在进行中（爆发 + 收尾渐出）—— 判定唯一来源见 ascendCinematic.pulseRunning */
const pulseActive = computed(pulseRunning);

/**
 * 撞满（后继 → 极限）是**自动**触发、没有点击，故由页面起一发脉冲。
 * 点击触发的那些（极限 → 后继、第 4 次 → 涌升）由桥接层 `limit()` 起爆（按钮与 l 热键
 * 共用同一入口），页面只负责在 `aBurst` 的 0 → >0 边沿记下「脉冲开始了」。
 * ⚠️ 时长不写在这里 —— 统一来自 `ascendCinematic.B2_CAP_PULSE_MS`，避免两处数值漂移。
 */

watch(
  () => [wantStage.value, cine.aBurst, cine.aRamp] as const,
  () => {
    if (!isB2.value) return;
    if (pulseActive.value) return;      // 脉冲进行中：不插手
    if (pulseOpen.value) {              // 脉冲刚收尾 ⇒ 提交新词
      pulseOpen.value = false;
      stage.value = wantStage.value;
      return;
    }
    if (wantStage.value !== stage.value) {
      pulseOpen.value = true;
      swapPulse(B2_CAP_PULSE_MS.hold, B2_CAP_PULSE_MS.fade);
    }
  },
);
/** 起爆（无论点击还是自动）⇒ 记下脉冲已开始；收尾由上面的 watch 提交新词。
 *  ⚠️ 两条来源都必须经过这里：点击的爆发由桥接层的 `limit()` 起，页面拿不到调用时机，
 *     只能盯 `aBurst` 的边沿。 */
watch(() => cine.aBurst, (b) => {
  if (!isB2.value) return;              // base3 尾声的换基爆发不属于 base2 的换词
  if (b > 0 && !pulseOpen.value) pulseOpen.value = true;
});

// 刷新页面时按存档状态直接落到对应词（不重放脉冲）
onMounted(() => {
  const s = s0.value;
  if (s && s.base === 2) stage.value = stageOf(s);
});

/**
 * 按钮**当前显示**的那个词（脉冲期间会先旧后新）。
 *   上升 / 停在 A（`aBurst > 0`）→ **旧词**（= 已定形的 `stage`）；
 *   A→D 下降（`aBurst = 0` 且 `aRamp > 0`）→ **新词**（= 派生出的 `wantStage`）。
 * 切换点正好是 aRamp 满档那一帧（u = 0 ⇒ 全 A），所以「换词」本身看不见。
 * ⚠️ 按钮的可用性 / 高光 / kbd 提示**全部**跟着它走 —— 否则会出现「标签已是新词、
 *    但还得等那 300~800ms 渐出才可点」的空窗（按键提示与标签也会对不上）。
 */
const b2Word = computed<Stage>(() => {
  if (!pulseActive.value) return stage.value;
  return cine.aBurst > 0 ? stage.value : wantStage.value;
});

/** 基 2 只有一个按钮，标签随脉冲变化（base2 涌升期会随进度慢慢恢复正常文字） */
const b2VerbLabel = computed(() => {
  if (!garbleOn()) return WORD[b2Word.value];
  // A 爆发：在 D 之上按 aRamp 混入 A 方案 ⇒ 进 A 是渐入、回 D 是渐出（aRamp = 0 时原样返回）。
  return mixBurst(garble(WORD[b2Word.value]));
});

/** 基 2 那个唯一按钮的可用性与点击。
 *  ⚠️ 脉冲期间（含收尾那 300~800ms 渐出）一律禁用：按钮此刻正在变形，词还没定形。
 *     若只在「上升」时禁，收尾期会出现「标签已是新词、点击也真的生效」的窗口 ——
 *     而那时 aRamp 还没归零，再点一下会从半 A 状态重新起爆、把 D 侧串当场换掉（闪一下）。 */
const b2Disabled = computed(() => {
  if (pulseActive.value) return true;
  const s = s0.value;
  if (!s) return true;
  if (b2Word.value === 'succ') return locked.value || !!s.base2Cap;
  if (b2Word.value === 'limit') return locked.value || !s.canLimit;
  return cine.active || !s.ascendReady;
});
function onB2Verb(): void {
  if (pulseActive.value) return; // 变形中不接点击（与 b2Disabled 同源，按钮与热键一致）
  const s = s0.value;
  if (!s) return;
  if (b2Word.value === 'succ') { if (!locked.value) game.succ(); }
  else if (b2Word.value === 'limit') {
    // A 爆发（与 base3 尾声的换基尝试同款）在桥接层的 limit() 里统一触发
    // ⇒ 按钮与 l 热键共用同一入口，不会出现「按钮有演出、热键没有」。
    if (!locked.value) game.limit();
  } else startBase2Ascend();
}

/** 后继报废时青光**渐暗**（2s 过渡由 .fade 提供） */
const b2Dim = computed(() => b2Word.value === 'succ' && !!s0.value?.base2Cap);
/** 脉冲期（爆发 + 收尾渐出）：按钮文字走 A 混合、边框整体褪灰（连 hover 一起压住，见 .grayout）。
 *  ⚠️ 用 `pulseActive`（含渐出）而不是 `aBurstOn()`：否则渐出刚开始边框就先回到青色，
 *     与仍在下落的文字不同步；这样边框会一直灰到词定形，再 400ms 渐回青色。 */
const b2Burst = computed(() => pulseActive.value);
/** 新的动作出现时青光**渐入**（400ms，提示玩家该按它了）；脉冲期摘掉 */
const b2Climax = computed(() => {
  const s = s0.value;
  if (!s) return false;
  if (b2Burst.value) return false;
  if (b2Word.value === 'limit') return s.canLimit;
  if (b2Word.value === 'ascend') return s.ascendReady && !cine.active;
  return false;
});

// ───────────────────── base ≥ 3：换基/涌升（伪装） ─────────────────────
const mainVerb = computed(() => {
  if (isB2.value) return b2VerbLabel.value;
  if (cine.active) return rebaseBtnLabel();
  const s = s0.value;
  if (!s) return '';
  if (s.base3Ascend) return '涌升';
  if (s.base > 2) return '换基 Rebase';
  return '';
});
const verbDisabled = computed(() => {
  const s = s0.value;
  if (cine.active) return !cine.showRebase;
  if (!s) return true;
  return !s.canRebase;
});
function onSucc(): void { if (locked.value) return; game.succ(); }
function onLimit(): void { if (locked.value || !s0.value?.canLimit) return; game.limit(); }
function onVerb(): void {
  if (cine.active) {
    if (cine.showRebase) clickRebase();
    return;
  }
  const s = s0.value;
  if (!s) return;
  if (s.base3Ascend) startCinematic();
  else if (s.base > 2) game.rebase();
}
/**
 * 99.9% 时「换基」按钮渐入青色包边（400ms）提示玩家；
 * A 方案爆发期间高光**消失**、**连边框也褪灰**（见 .grayout），回落 D 方案时一起渐回青色
 * —— 天然形成「还要再按」的提示。
 * ⚠️ 旧版只摘掉 `.climax`，边框被 `.verbs button:hover:not(:disabled)`（特异性更高）压住
 *    仍是青色 ⇒ 视觉上「只没了发光」。故新增独立的 `.grayout` 态显式压住 hover。
 */
const climaxRebase = computed(
  () => cine.active && cine.mode === 'base3' && cine.showRebase && cine.aBurst === 0,
);
/** base3 尾声：点「换基」后的 A 爆发期（按钮褪灰，与发光一起 400ms 灰出/渐回） */
const base3Burst = computed(() => cine.active && cine.mode === 'base3' && cine.aBurst > 0);

// ───────────────────── 进度条（基 2 也保留） ─────────────────────
// 演出期间走 cine.p；基 2 显示「D(n) / 4」但**填充按 n/65536**；其余基按 a / rebaseNeed。
const progPct = computed(() => (cine.active ? cine.p : (s0.value?.barPct ?? 0)).toFixed(2));
const barLabel = computed(() => {
  const s = s0.value;
  if (!s) return '';
  if (s.base === 2) return garble('计数 · 基 2');
  const head = s.base3Ascend ? '涌升' : '换基';
  const tail = s.base3Ascend ? ` · 基 ${s.base}` : ` · 基 ${s.base} → ${s.base - 1}`;
  return garble(head + tail);
});
/**
 * 进度条下方的门槛说明。
 * ⚠️ base3 期间整段「换基」伪装成「涌升」（藏住 base2 的存在）：
 *    这里也必须跟着改叫**涌升门槛**，否则「涌升进度条」下面却写着换基，伪装就露馅了。
 */
const barSub = computed(() => {
  const s = s0.value;
  if (!s) return '';
  if (s.base === 2) return garble('计数进度：需显示计数 ≥ 4');
  const head = s.base3Ascend ? '涌升' : '换基';
  return garble(`${head}进度：${head}门槛 α ≥`);
});
</script>

<template>
  <section class="pg" v-if="s0">
    <!-- 三动词（资源栏在外壳顶栏，不随切页移动）；快捷键 s / l / r -->
    <!-- ⚠️ 第 4 次换基后按钮行会从「3 个按钮」变「1 个按钮」（base3 → base2）。
         用 out-in 过渡抹平这次布局瞬切：旧行淡出 → 新行淡入（用户 2026-10-04 追加）。 -->
    <div class="verbs">
      <Transition name="swap" mode="out-in">
        <div class="vg" :key="isB2 ? 'b2' : 'b3'">
          <template v-if="!isB2">
            <button class="primary" :class="{ fade: locked }" :disabled="locked" @click="onSucc()">
              {{ garble('后继') }} <kbd>s</kbd>
            </button>
            <button :disabled="!s0.canLimit || locked" @click="onLimit()">
              {{ garble('极限') }} <kbd>l</kbd>
            </button>
            <button
              v-if="s0.base > 2 || cine.active"
              :class="{ climax: climaxRebase, grayout: base3Burst }"
              :disabled="verbDisabled"
              @click="onVerb()"
            >{{ mainVerb }} <kbd>r</kbd></button>
          </template>

          <!-- 基 2：全程只有一个按钮，词在「后继 ⇄ 极限 → 涌升」间来回（换词折叠进那一发 A 爆发） -->
          <button
            v-else
            class="primary"
            :class="{ fade: b2Dim, climax: b2Climax, grayout: b2Burst }"
            :disabled="b2Disabled"
            @click="onB2Verb()"
          >{{ mainVerb }} <kbd>{{ b2Word === 'succ' ? 's' : b2Word === 'limit' ? 'l' : 'r' }}</kbd></button>
        </div>
      </Transition>
    </div>

    <!-- 进度条：基 ≥ 3 是换基/涌升门槛；基 2 是「D(n)/4」计数（填充按 n/65536） -->
    <div class="rebase">
      <div class="row">
        <span class="k">{{ barLabel }}</span>
        <span class="v mono">{{ fmtLive(s0.barNow) }} / {{ fmtNum(s0.barNeed) }} {{ garble('计数') }}<template
          v-if="s0.base2Cap">{{ garble(' (已达硬上限)') }}</template></span>
      </div>
      <div class="bar"><i :style="{ width: progPct + '%' }"></i></div>
      <span class="sub">
        {{ barSub }}<template v-if="s0.base > 2">
          <KatexText class="inline" :tex="s0.rebaseGateTex" /></template>
      </span>
    </div>
  </section>
</template>

<style scoped>
.pg {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.sub {
  font-size: 11px;
  color: var(--dim);
}
.verbs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
/* 按钮行的内容容器：flex 规则与原来的 .verbs 等价；存在的意义是给 base3 ⇄ base2
   的 out-in 过渡提供一个**单根**节点（Transition 要求单子元素） */
.vg {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
/* 3 按钮 → 1 按钮（第 4 次换基后）的布局过渡：旧行淡出 → 新行淡入，抹平瞬切 */
.swap-enter-active,
.swap-leave-active { transition: opacity 240ms ease; }
.swap-enter-from,
.swap-leave-to { opacity: 0; }
.verbs button {
  font-size: 12px;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 10px 16px;
  cursor: pointer;
  /* ⚠️ 过渡时长必须挂在**基础规则**上（用户定案 2026-10-04）。
     旧版把 400ms 只写在 `.climax` / `.grayout` 里 ⇒ **摘掉那个类的那一瞬间**过渡属性回落到
     这里的 120ms ⇒ 灰出 400ms、回青只有 120ms，于是「base2 的按钮从 A 回 D 时看着是硬切」。
     base3 尾声看不出这毛病，是因为它摘 `.grayout` 的同时又挂回 `.climax`（恰好仍是 400ms）。 */
  transition: border-color 400ms ease, color 400ms ease, box-shadow 400ms ease;
}
.verbs button:hover:not(:disabled) { border-color: var(--accent); }
.verbs button.primary { border-color: var(--accent); }
/* 青光**渐暗**：后继报废 / 演出期间锁死时，2s 内从 accent 褪回 line（唯一例外的时长） */
.verbs button.fade {
  border-color: var(--line);
  color: var(--dim);
  box-shadow: none;
  transition: border-color 2000ms linear, color 2000ms linear, box-shadow 2000ms linear;
}
/* 青光**渐入**：新的动作出现时亮起包边，提示玩家按它（时长继承基础规则的 400ms） */
.verbs button.climax {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 0 12px -2px var(--accent);
}
/* A 爆发期：按钮整体**褪灰**（青边与发光一起去掉，之后再一起渐回青色）。
   ⚠️ 必须显式连同 `:hover` 一起压住 —— 玩家点完按钮后鼠标就停在它上面，
   `.verbs button:hover:not(:disabled)`（特异性 0,3,1）高于 `.climax`（0,2,1），
   不压的话就会表现为「发光没了、青边还在」。
   ⚠️ 这里**不写** transition：过渡时长由基础规则给，两侧（灰出 / 回青）才会同长。 */
.verbs button.grayout,
.verbs button.grayout:hover:not(:disabled) {
  border-color: var(--line);
  color: var(--dim);
  box-shadow: none;
}
.verbs kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--dim);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 1px 5px;
  margin-left: 4px;
}
.verbs button:disabled {
  border-color: var(--line);
  color: var(--dim);
  cursor: default;
}
.rebase {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 12px;
  background: var(--panel);
}
.rebase .row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.rebase .k { font-size: 12px; color: var(--dim); }
.rebase .v { font-size: 13px; }
.bar {
  height: 4px;
  background: var(--bg);
  border-radius: 2px;
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 120ms linear;
}
.inline { font-size: 11px; color: inherit; }
.mono { font-family: var(--font-mono); }
</style>
