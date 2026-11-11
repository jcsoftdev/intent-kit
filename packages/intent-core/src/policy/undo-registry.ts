import type {
  Clock,
  EffectResult,
  EventBus,
  IntentEvent,
  UndoEntry,
  UndoOffer,
  UndoRegistry,
} from '../contracts/index.js';
import { noopEventBus, systemClock } from '../primitives/index.js';

interface Slot {
  readonly offer: UndoOffer;
  inflight?: Promise<EffectResult<unknown>>;
}

const stalePlan: EffectResult<unknown> = {
  ok: false,
  failure: { stage: 'execution', code: 'STALE_PLAN', retryable: false },
};

const toEntry = ({ planId, capabilityId, kind, expiresAt }: UndoOffer): UndoEntry => ({
  planId,
  capabilityId,
  kind,
  expiresAt,
});

export const createUndoRegistry = (
  options: { readonly clock?: Clock; readonly events?: EventBus<IntentEvent> } = {},
): UndoRegistry => {
  const clock = options.clock ?? systemClock;
  const events = options.events ?? noopEventBus;
  const slots = new Map<string, Slot>();

  const emit = (
    type: 'undo.offered' | 'undo.executed' | 'undo.expired',
    offer: UndoOffer,
  ): void => {
    events.emit({ type, planId: offer.planId, capabilityId: offer.capabilityId });
  };

  const dropExpired = (): void => {
    const now = clock.now();
    for (const [planId, slot] of [...slots]) {
      if (slot.offer.expiresAt <= now && !slot.inflight) {
        slots.delete(planId);
        emit('undo.expired', slot.offer);
      }
    }
  };

  const execute = async (slot: Slot, signal: AbortSignal): Promise<EffectResult<unknown>> => {
    try {
      const result = await slot.offer.undo({ signal });
      if (result.ok && slots.get(slot.offer.planId) === slot) {
        slots.delete(slot.offer.planId);
        emit('undo.executed', slot.offer);
      }
      return result;
    } finally {
      slot.inflight = undefined;
    }
  };

  return {
    offer(offer) {
      const slot: Slot = { offer };
      slots.set(offer.planId, slot);
      emit('undo.offered', offer);
      return () => {
        if (slots.get(offer.planId) === slot) {
          slots.delete(offer.planId);
        }
      };
    },
    active() {
      dropExpired();
      return [...slots.values()].map((slot) => toEntry(slot.offer));
    },
    async undo(planId, { signal }) {
      dropExpired();
      const slot = slots.get(planId);
      if (!slot) {
        return stalePlan;
      }
      slot.inflight ??= execute(slot, signal);
      return slot.inflight;
    },
  };
};
