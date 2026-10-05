/**
 * 主脊层注册表。引擎与桥接层只通过这里拿到层模块，不直接 import 具体层 ⇒
 * S2–S5 后续实装时只需在此登记，不动引擎。
 */

import type { LayerId } from './types';
import type { LayerModule } from './layers';
import { S0_MODULE } from '../layers/s0/module';
import { S1_MODULE } from '../layers/s1/module';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const LAYERS: Record<LayerId, LayerModule<any, any>> = {
  s0: S0_MODULE as LayerModule<any, any>,
  s1: S1_MODULE as LayerModule<any, any>,
};

export function getLayer(id: LayerId): LayerModule<any, any> {
  return LAYERS[id];
}
