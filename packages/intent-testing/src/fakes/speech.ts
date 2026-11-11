import type { SpeechSource } from '@jcsoftdev/intent-core';

export const createFakeSpeechSource = (script: {
  readonly transcript: string;
  readonly partials?: readonly string[];
  readonly supported?: boolean;
}): SpeechSource => ({
  isSupported: () => script.supported ?? true,
  async start({ language, signal, onPartial }) {
    signal.throwIfAborted();
    script.partials?.forEach((partial) => onPartial(partial));
    signal.throwIfAborted();
    return { transcript: script.transcript, language };
  },
  stop: () => undefined,
});
