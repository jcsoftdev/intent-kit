import type { EventBus, IntentEvent } from '../contracts/index.js';

export const createEventBus = <TEvent extends { readonly type: string }>(): EventBus<TEvent> => {
  const listeners = new Set<(event: TEvent) => void>();
  return {
    emit(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          continue;
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export const noopEventBus: EventBus<IntentEvent> = {
  emit: () => undefined,
  subscribe: () => () => undefined,
};
