import { IntentFailureError, type SpeechSource } from '@jcsoftdev/intent-core';

const SPEECH_UNSUPPORTED = new IntentFailureError({
  stage: 'interpretation',
  code: 'INTERPRETER_UNAVAILABLE',
  retryable: false,
});

export const createFakeSpeechSource = (script: {
  readonly transcript: string;
  readonly partials?: readonly string[];
  readonly supported?: boolean;
}): SpeechSource => ({
  isSupported: () => script.supported ?? true,
  async start({ language, signal, onPartial }) {
    signal.throwIfAborted();
    if (script.supported === false) {
      throw SPEECH_UNSUPPORTED;
    }
    script.partials?.forEach((partial) => onPartial(partial));
    signal.throwIfAborted();
    return { transcript: script.transcript, language };
  },
  stop: () => undefined,
});
