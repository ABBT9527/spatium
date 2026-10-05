/**
 * S1 点层 · LayerModule 适配器。
 * 复用既有 S1 逻辑（state/logic/defs/calibrate），仅收敛成统一接口。
 * S1 的构形引擎实现不动 —— 这是「骨架只接 S0/S1、不动已验证内容」的体现。
 */

import { calibrate } from '../../economy/calibrate';
import type { LayerModule } from '../../meta/layers';
import type { MetaState } from '../../meta/types';
import { S1_TARGETS } from './defs';
import { createS1State, type S1State } from './state';
import {
  createRuntime, ensureBoard, tickS1, cycle, type S1Runtime,
} from './logic';
import { precalibrateTheta, simulateFirstRound } from './calibrate';

export const S1_MODULE: LayerModule<S1State, S1Runtime> = {
  id: 's1',
  name: 'PUNCTUM · 点',
  kind: 'board',
  targets: S1_TARGETS,

  createState() {
    const cal = calibrate(S1_TARGETS);
    const st = createS1State(cal.c0, cal.tauEff);
    st.theta = precalibrateTheta(cal.c0, cal.tauEff, S1_TARGETS.tStart);
    return st;
  },
  createRuntime(st) {
    const rt = createRuntime(st);
    ensureBoard(st, rt);
    return rt;
  },
  tick(st, rt, dt, clock) {
    tickS1(st, rt, dt, clock);
    return null;
  },
  cycle(st, rt, clock) {
    cycle(st, rt, clock);
    return { ascended: false };
  },
  entryPredicate(_meta: MetaState) {
    // S1 由 S0 涌升解锁（见 meta/progression）；此处仅声明已在 unlocked 中即满足
    return true;
  },
  next() {
    return null; // S2 尚未实装
  },
  precalibrateTheta(c0, tauEff, tStart) {
    return precalibrateTheta(c0, tauEff, tStart);
  },
  simulateFirstRound(c0, tauEff, theta0) {
    return simulateFirstRound(c0, tauEff, theta0);
  },
};
