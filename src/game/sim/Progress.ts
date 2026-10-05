// Ordered checkpoint progress (HANDOFF/02_TRACK_BLUEPRINT.md "Checkpoints"), over 1-5 laps.
// Race progress = laps completed + ordered checkpoint index + projected spline progress; never
// Euclidean distance.
import type { Track } from '../track/Track.js';

export interface ProgressState {
  /** Next checkpoint index to pass in the current lap (1..N). N+1 means the line is next. */
  next: number;
  /** Laps completed (each only after every checkpoint of that lap, in order). */
  lap: number;
  /** Laps in this race (fixed when the race starts). */
  laps: number;
  finished: boolean;
  finishTime: number | null;
  /** Race distance of the last valid safe recovery node passed while riding. */
  lastSafeNodeS: number;
  dnf: boolean;
}

export function newProgress(track: Track, gridS: number, laps = 1): ProgressState {
  return { next: 1, lap: 0, laps: Math.max(1, Math.floor(laps)), finished: false, finishTime: null, lastSafeNodeS: track.recoveryNodeBefore(gridS).s, dnf: false };
}

export interface ProgressEvent {
  checkpoint: number | null;
  /** A lap that is not the final one was completed (the new count). */
  lap: number | null;
  finished: boolean;
  wrongGate: boolean;
}

/**
 * Updates ordered progress after a movement from `prevLapDist` to `lapDist` (unwrapped race
 * distance: the start line is 0 and lap k's line is at k x track.length). A lap only counts when
 * every checkpoint of that lap was passed in order through its gate, so the line cannot be farmed.
 */
export function updateProgress(ps: ProgressState, track: Track, prevLapDist: number, lapDist: number, lateral: number): ProgressEvent {
  const ev: ProgressEvent = { checkpoint: null, lap: null, finished: false, wrongGate: false };
  if (ps.finished || lapDist <= prevLapDist) return ev;
  const N = track.checkpoints.length;
  const base = ps.lap * track.length;
  if (ps.next <= N) {
    const cp = track.checkpoints[ps.next - 1]!;
    const at = base + cp.s;
    if (prevLapDist < at && lapDist >= at) {
      if (Math.abs(lateral) <= track.checkpointGateHalfWidth(cp.s)) {
        ev.checkpoint = cp.index;
        ps.next++;
      } else ev.wrongGate = true;
    }
  } else {
    const line = base + track.length;
    if (prevLapDist < line && lapDist >= line) {
      ps.lap++;
      if (ps.lap >= ps.laps) {
        ev.finished = true;
        ps.finished = true;
      } else {
        ps.next = 1;
        ev.lap = ps.lap;
      }
    }
  }
  return ev;
}

/** Current lap for display (1-based, capped at the race length). */
export function displayLap(ps: Pick<ProgressState, 'lap' | 'laps'>): number {
  return Math.min(ps.laps, ps.lap + 1);
}

/** Records the last safe recovery node when riding validly on the road. */
export function updateSafeNode(ps: ProgressState, track: Track, s: number, lapDist: number): void {
  if (lapDist < 0) return;
  const node = track.recoveryNodeBefore(s);
  ps.lastSafeNodeS = node.s;
}

/** Monotone progress score for ranking (higher = further ahead). */
export function progressScore(ps: ProgressState, lapDist: number): number {
  return (ps.lap * 100 + ps.next) * 1e6 + lapDist;
}

export interface RankEntry {
  id: number;
  finished: boolean;
  finishTime: number | null;
  dnf: boolean;
  score: number;
}

export function rankEntries(entries: RankEntry[]): RankEntry[] {
  return [...entries].sort((a, b) => {
    if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
    if (a.finished && b.finished) return (a.finishTime ?? 0) - (b.finishTime ?? 0);
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.score - a.score;
  });
}
