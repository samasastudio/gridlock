import type { GeneratedIllustration } from "../interfaces/index.ts";
import { isGeneratedIllustrationActiveAt } from "./helpers/painter-helpers.ts";

interface BranchReservation {
  illustrationId: string | null;
}

interface TimelineSlotState {
  tail: Promise<void>;
  pendingOps: number;
  reservations: Map<symbol, BranchReservation>;
}

export interface BranchSlotHandle {
  markPersisting(illustrationId: string): void;
  release(): Promise<void>;
}

export interface TimelineBranchSlotTracker {
  countOccupiedBranchSlots(plates: readonly GeneratedIllustration[], timelineId: string, now: Date): number;
  withTimelineBranchAdmission<T>(timelineId: string, admit: (reserve: () => BranchSlotHandle) => Promise<T>): Promise<T>;
}

export function createTimelineBranchSlotTracker(): TimelineBranchSlotTracker {
  const timelineSlotStates = new Map<string, TimelineSlotState>();

  function getTimelineSlotState(timelineId: string): TimelineSlotState {
    const existing = timelineSlotStates.get(timelineId);
    if (existing) return existing;
    const created: TimelineSlotState = {
      tail: Promise.resolve(),
      pendingOps: 0,
      reservations: new Map<symbol, BranchReservation>(),
    };
    timelineSlotStates.set(timelineId, created);
    return created;
  }

  function pruneIdleSlotState(timelineId: string, state: TimelineSlotState): void {
    if (state.pendingOps === 0 && state.reservations.size === 0 && timelineSlotStates.get(timelineId) === state) {
      timelineSlotStates.delete(timelineId);
    }
  }

  async function withSlotLock<T>(timelineId: string, state: TimelineSlotState, run: () => Promise<T>): Promise<T> {
    state.pendingOps += 1;
    const prior = state.tail;
    const gate: { release?: () => void } = {};
    state.tail = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    await prior;
    try {
      return await run();
    } finally {
      state.pendingOps -= 1;
      pruneIdleSlotState(timelineId, state);
      gate.release?.();
    }
  }

  return {
    countOccupiedBranchSlots(plates, timelineId, now) {
      const activeBranchIds = new Set(
        plates
          .filter((plate) => plate.isBranch && isGeneratedIllustrationActiveAt(plate, now))
          .map((plate) => plate.illustrationId)
      );
      const reservations = timelineSlotStates.get(timelineId)?.reservations;
      if (!reservations) return activeBranchIds.size;
      const unpersistedCount = Array.from(reservations.values()).filter(
        (entry) => entry.illustrationId === null || !activeBranchIds.has(entry.illustrationId)
      ).length;
      return activeBranchIds.size + unpersistedCount;
    },

    withTimelineBranchAdmission(timelineId, admit) {
      const state = getTimelineSlotState(timelineId);
      return withSlotLock(timelineId, state, () =>
        admit(() => {
          const token = Symbol("branchSlot");
          const entry: BranchReservation = { illustrationId: null };
          state.reservations.set(token, entry);
          return {
            markPersisting: (illustrationId: string) => {
              entry.illustrationId = illustrationId;
            },
            release: async () => {
              if (!state.reservations.has(token)) return;
              await withSlotLock(timelineId, state, async () => {
                state.reservations.delete(token);
              });
            },
          };
        })
      );
    },
  };
}

export const DEFAULT_TIMELINE_BRANCH_SLOT_TRACKER = createTimelineBranchSlotTracker();
