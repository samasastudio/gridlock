import type { Buffer } from "node:buffer";
import type { GeneratedIllustration, GridlockRepository } from "../interfaces/index.ts";
import { isGeneratedIllustrationActiveAt } from "./helpers/painter-helpers.ts";

interface BranchReservation {
  plateId: string | null;
}

interface LineageSlotState {
  tail: Promise<void>;
  reservations: Map<symbol, BranchReservation>;
}

export interface BranchSlotHandle {
  markPersisting(plateId: string): void;
  release(): Promise<void>;
}

const slotStatesByRepo = new WeakMap<
  GridlockRepository,
  Map<string, LineageSlotState>
>();

function getLineageSlotState(
  repo: GridlockRepository,
  lineageId: string
): LineageSlotState {
  const byLineage =
    slotStatesByRepo.get(repo) ?? new Map<string, LineageSlotState>();
  if (!slotStatesByRepo.has(repo)) {
    slotStatesByRepo.set(repo, byLineage);
  }
  const existing = byLineage.get(lineageId);
  if (existing) {
    return existing;
  }
  const created: LineageSlotState = {
    tail: Promise.resolve(),
    reservations: new Map<symbol, BranchReservation>(),
  };
  byLineage.set(lineageId, created);
  return created;
}

async function withSlotLock<T>(
  state: LineageSlotState,
  run: () => Promise<T>
): Promise<T> {
  const prior = state.tail;
  const gate: { release?: () => void } = {};
  state.tail = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  await prior;
  try {
    return await run();
  } finally {
    gate.release?.();
  }
}

export function countOccupiedBranchSlots(
  plates: readonly GeneratedIllustration[],
  repo: GridlockRepository,
  lineageId: string,
  now: Date
): number {
  const activeBranchIds = new Set(
    plates
      .filter((plate) => plate.isBranch && isGeneratedIllustrationActiveAt(plate, now))
      .map((plate) => plate.plateId)
  );
  const reservations =
    slotStatesByRepo.get(repo)?.get(lineageId)?.reservations;
  if (!reservations) {
    return activeBranchIds.size;
  }
  const unpersistedCount = Array.from(reservations.values()).filter(
    (entry) => entry.plateId === null || !activeBranchIds.has(entry.plateId)
  ).length;
  return activeBranchIds.size + unpersistedCount;
}

export function withLineageBranchAdmission<T>(
  repo: GridlockRepository,
  lineageId: string,
  admit: (reserve: () => BranchSlotHandle) => Promise<T>
): Promise<T> {
  const state = getLineageSlotState(repo, lineageId);
  return withSlotLock(state, () =>
    admit(() => {
      const token = Symbol("branchSlot");
      const entry: BranchReservation = { plateId: null };
      state.reservations.set(token, entry);
      return {
        markPersisting: (plateId: string) => {
          entry.plateId = plateId;
        },
        release: async () => {
          if (!state.reservations.has(token)) {
            return;
          }
          await withSlotLock(state, async () => {
            state.reservations.delete(token);
          });
        },
      };
    })
  );
}

export function wrapRepositoryWithBranchSlot(
  repo: GridlockRepository,
  slot: BranchSlotHandle
): GridlockRepository {
  return new Proxy(repo, {
    get(target, prop, receiver: unknown): unknown {
      if (prop === "saveGeneratedIllustration") {
        return async (plate: GeneratedIllustration, webpBuffer: Buffer) => {
          slot.markPersisting(plate.plateId);
          try {
            await target.saveGeneratedIllustration(plate, webpBuffer);
          } finally {
            await slot.release();
          }
        };
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...args: readonly unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
