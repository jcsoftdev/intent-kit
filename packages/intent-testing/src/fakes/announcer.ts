import type { Announcer } from '@jcsoftdev/intent-core';

export const createRecordingAnnouncer = (): Announcer & {
  messages(): readonly { readonly message: string; readonly politeness: 'polite' | 'assertive' }[];
} => {
  const recorded: { readonly message: string; readonly politeness: 'polite' | 'assertive' }[] = [];
  return {
    messages: () => [...recorded],
    announce(message, politeness) {
      recorded.push({ message, politeness });
    },
  };
};
