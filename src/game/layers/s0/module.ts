/**
 * S0 计数层 · LayerModule 适配器。
 * 把 state/logic 收敛成 meta/layers.ts 要求的统一接口。
 *
 * 注：S0 不再使用 Θ/Φ 节奏引擎（用户定案：S0 要最简），
 * precalibrateTheta / simulateFirstRound 为接口占位，返回中性值。
 */

import type { LayerModule } from '../../meta/layers';
import type { MetaState } from '../../meta/types';
import { S0_TARGETS } from './defs';
import { createS0State, type S0State } from './state';
import {
  createRuntime, tickS0, cycleS0, type S0Runtime,
} from './logic';

export const S0_MODULE: LayerModule<S0State, S0Runtime> = {
  id: 's0',
  name: 'ORDINAL · 序数',
  kind: 'ordinal',
  targets: S0_TARGETS,

  createState() {
    return createS0State();
  },
  createRuntime(st) {
    return createRuntime(st);
  },
  tick(st, rt, dt, clock) {
    return tickS0(st, rt, dt, clock);
  },
  cycle(st, rt, clock) {
    return cycleS0(st, rt, clock);
  },
  entryPredicate(meta: MetaState) {
    return meta.unlocked.includes('s0');
  },
  next() {
    return 's1';
  },
  precalibrateTheta() {
    return 1;
  },
  simulateFirstRound() {
    return 0;
  },
  onEnter(st, _meta) {
    void st;
  },
};
