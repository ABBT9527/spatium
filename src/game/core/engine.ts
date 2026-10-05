/**
 * 引擎：逻辑 tick 与渲染 rAF 解耦。
 *
 * 戒律（三层分离 · 接缝）：
 *   - state 是**非响应式** plain object（Decimal 进 Vue reactive 是灾难级性能陷阱）
 *   - 逻辑 tick 结束递增 `version`，bridge 用 shallowRef 暴露快照
 *   - UI 只读格式化后的字符串
 *
 * 主脊驱动：只运行「当前激活层」的 LayerModule。层产出的资源**留在层内**
 * （0阶货币，离散阶段不上缴）；引擎不再有统一入账的跨层货币
 * （旧「迭代 It」已随经济切换整体取消）。软重置戒律：元进度永不删除。
 *
 * 离线结算：上限 4 h，自适应粗步长，复用同一套 tick 逻辑，禁止第二套公式。
 */

import { OFFLINE_CAP_SEC } from '../constants';
import { LAYERS } from '../meta/registry';
import { createMeta } from '../meta/progression';
import { CURRENT_SAVE_VERSION } from '../save/migrations';
import { S0_MODULE } from '../layers/s0/module';
import { S1_MODULE } from '../layers/s1/module';
import type { S0State } from '../layers/s0/state';
import type { S1State } from '../layers/s1/state';
import type { S0Runtime } from '../layers/s0/logic';
import type { S1Runtime } from '../layers/s1/logic';
import type { MetaState, LayerId } from '../meta/types';
import { emit } from './events';

export interface GameState {
  saveVersion: number;
  /** 游戏内累计秒 */
  clock: number;
  /** 元状态：当前层、维度、五行、累计资源 */
  meta: MetaState;
  /** 各层序列化状态（S0 / S1；后续层在此扩展） */
  layers: { s0: S0State; s1: S1State };
}

export type GameRuntime = { s0: S0Runtime; s1: S1Runtime };

export function createGame(): { state: GameState; rt: GameRuntime } {
  const meta = createMeta();
  const s0 = S0_MODULE.createState();
  const s1 = S1_MODULE.createState();
  const rt: GameRuntime = {
    s0: S0_MODULE.createRuntime(s0),
    s1: S1_MODULE.createRuntime(s1),
  };
  const state: GameState = {
    saveVersion: CURRENT_SAVE_VERSION,
    clock: 0,
    meta,
    layers: { s0, s1 },
  };
  return { state, rt };
}

export class Engine {
  state: GameState;
  rt: GameRuntime;
  version = 0;
  private acc = 0;
  private lastMs = 0;
  private rafId = 0;
  private running = false;

  constructor(state: GameState, rt: GameRuntime) {
    this.state = state;
    this.rt = rt;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastMs = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const dtMs = Math.min(now - this.lastMs, 250); // 切后台回来时防止补帧爆炸
      this.lastMs = now;
      this.advance(dtMs / 1000);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** 推进 dt 秒（按动态步长 = meta.tickMs/1000 消化；显示层定案默认 20ms/步） */
  advance(dt: number): void {
    this.acc += dt;
    const step = (this.state.meta.tickMs ?? 20) / 1000;
    let guard = 0;
    while (this.acc >= step && guard < 200) {
      this.state.clock += step;
      const id = this.state.meta.current;
      const mod = LAYERS[id];
      const before = this.state.layers[id].round;
      mod.tick(this.state.layers[id], this.rt[id], step, this.state.clock);
      if (this.state.layers[id].round !== before) {
        // lastRoundTime 仅构形层（S1）有；S0 无节奏引擎 ⇒ 用 0 兜底
        const lst = this.state.layers[id] as { round: number; lastRoundTime?: number };
        emit({ type: 'cycle', round: lst.round, time: lst.lastRoundTime ?? 0 });
        this.mergeMilestones(id);
      }
      this.acc -= step;
      guard++;
    }
    if (guard >= 200) this.acc = 0;
    this.version++;
  }

  /**
   * 离线结算：上限 OFFLINE_CAP_SEC，自适应粗步长。
   * 复用 advance 的同一条路径，不存在"离线专用公式"。
   */
  offline(elapsedSec: number): number {
    const t = Math.max(0, Math.min(elapsedSec, OFFLINE_CAP_SEC));
    if (t <= 0) return 0;
    const steps = Math.max(1, Math.min(2000, Math.ceil(t)));
    const dt = t / steps;
    for (let i = 0; i < steps; i++) {
      this.state.clock += dt;
      const id = this.state.meta.current;
      const mod = LAYERS[id];
      const before = this.state.layers[id].round;
      mod.tick(this.state.layers[id], this.rt[id], dt, this.state.clock);
      if (this.state.layers[id].round !== before) this.mergeMilestones(id);
      void before;
    }
    this.version++;
    return t;
  }

  /**
   * 将本层已达成里程碑并入元状态（meta.milestones 为 Record<string, number>）。
   * 在每轮周期重置后调用，保证成就跨层持久、且不被软重置清除。
   */
  private mergeMilestones(id: LayerId): void {
    const st = this.state.layers[id];
    if (!st.milestones) return;
    for (const m of st.milestones) {
      if (!(m in this.state.meta.milestones)) this.state.meta.milestones[m] = st.round;
    }
  }
}
