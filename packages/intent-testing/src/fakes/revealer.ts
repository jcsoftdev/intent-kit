import type { Revealer } from '@jcsoftdev/intent-core';
import type { FakeElement } from './targets.js';

export const createRecordingRevealer = (): Revealer<FakeElement> & {
  revealed(): readonly { readonly element: FakeElement; readonly mode: string }[];
} => {
  const calls: { readonly element: FakeElement; readonly mode: string }[] = [];
  return {
    revealed: () => [...calls],
    async reveal(element, mode, { signal }) {
      signal.throwIfAborted();
      calls.push({ element, mode });
    },
  };
};
