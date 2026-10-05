// Web Worker entry for a hosted room: the host's browser tab runs the room authority off the
// render thread, so the 60 Hz simulation keeps its cadence while the tab renders the race.
import { initRapier } from '../physics/CrashWorld.js';
import type { FromWorker, ToWorker } from '../network/transports.js';
import { HostedRoom } from './HostedRoom.js';

/** The dedicated worker scope (the client project compiles against the DOM lib). */
const scope = self as unknown as { postMessage(m: FromWorker): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };

let room: HostedRoom | null = null;

scope.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.k === 'init') {
    try {
      await initRapier();
      room = new HostedRoom(m.origin, (o) => scope.postMessage(o), { room: m.room, secret: m.secret });
    } catch (err) {
      scope.postMessage({ k: 'error', message: `The room could not start: ${err instanceof Error ? err.message : String(err)}` });
    }
  } else if (m.k === 'c2s') {
    room?.fromLocal(m.ev, m.args, m.ack);
  } else if (m.k === 'close') {
    room?.close(m.reason);
  }
};
