import { createEventBus, type EventBus, type IntentEvent } from '@jcsoftdev/intent-core';

export const createRecordingEventBus = (): EventBus<IntentEvent> & {
  events(): readonly IntentEvent[];
} => {
  const bus = createEventBus<IntentEvent>();
  const recorded: IntentEvent[] = [];
  return {
    events: () => [...recorded],
    emit(event) {
      recorded.push(event);
      bus.emit(event);
    },
    subscribe: (listener) => bus.subscribe(listener),
  };
};
