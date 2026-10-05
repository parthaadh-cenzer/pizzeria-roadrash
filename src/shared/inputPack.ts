// Compact input packing for the 30 Hz client -> host input stream.
import type { ControlInput } from '../game/sim/types.js';
import { INPUT_FLAG, type PackedInput } from './protocol.js';

export function packInput(i: ControlInput): PackedInput {
  let f = 0;
  if (i.analog) f |= INPUT_FLAG.ANALOG;
  if (i.autoAccel) f |= INPUT_FLAG.AUTO;
  if (i.kick) f |= INPUT_FLAG.KICK;
  if (i.attack) f |= INPUT_FLAG.ATTACK;
  if (i.boost) f |= INPUT_FLAG.BOOST;
  return [i.seq, Math.round(i.throttle * 255), Math.round(i.brake * 255), Math.round(i.steer * 127), f];
}

export function unpackInput(p: unknown): ControlInput | null {
  if (!Array.isArray(p) || p.length !== 5 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const [seq, t, b, s, f] = p as PackedInput;
  return {
    seq,
    throttle: Math.max(0, Math.min(1, t / 255)),
    brake: Math.max(0, Math.min(1, b / 255)),
    steer: Math.max(-1, Math.min(1, s / 127)),
    analog: (f & INPUT_FLAG.ANALOG) !== 0,
    autoAccel: (f & INPUT_FLAG.AUTO) !== 0,
    kick: (f & INPUT_FLAG.KICK) !== 0,
    attack: (f & INPUT_FLAG.ATTACK) !== 0,
    boost: (f & INPUT_FLAG.BOOST) !== 0,
  };
}
