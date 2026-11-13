import type { SpeechSource } from '@jcsoftdev/intent-core';
import { type SpeechPrivacyMode, webSpeechAvailability } from './privacy-mode.js';
import {
  createDefaultRecognition,
  type RecognitionLike,
  type RecognitionResultEventLike,
} from './recognition-types.js';
import { SpeechCaptureError, speechErrorFromEngine } from './speech-errors.js';

export interface WebSpeechSourceOptions {
  readonly createRecognition?: () => RecognitionLike | undefined;
  readonly preferLocal: boolean;
  readonly availability?: (language: string) => Promise<SpeechPrivacyMode>;
}

export type WebSpeechSource = SpeechSource & {
  privacyMode(language: string, options: { signal: AbortSignal }): Promise<SpeechPrivacyMode>;
};

const readTranscripts = (event: RecognitionResultEventLike) => {
  const finals: string[] = [];
  const interims: string[] = [];
  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    const text = result?.[0]?.transcript ?? '';
    (result?.isFinal === true ? finals : interims).push(text);
  }
  return { final: finals.join(' ').trim(), running: [...finals, ...interims].join(' ').trim() };
};

const rejectWhenAborted = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

export function createWebSpeechSource(options: WebSpeechSourceOptions): WebSpeechSource {
  const createRecognition = options.createRecognition ?? createDefaultRecognition;
  const availability = options.availability ?? webSpeechAvailability;
  let active: RecognitionLike | undefined;

  const privacyMode = async (
    language: string,
    { signal }: { signal: AbortSignal },
  ): Promise<SpeechPrivacyMode> => {
    signal.throwIfAborted();
    if (createRecognition() === undefined) {
      return 'unsupported';
    }
    if (!options.preferLocal) {
      return 'cloud';
    }
    return Promise.race([availability(language), rejectWhenAborted(signal)]);
  };

  return {
    privacyMode,
    isSupported: () => createRecognition() !== undefined,
    stop: () => active?.stop(),
    async start({ language, signal, onPartial }) {
      signal.throwIfAborted();
      const recognition = createRecognition();
      if (recognition === undefined) {
        throw new SpeechCaptureError('unsupported');
      }
      const mode = await privacyMode(language, { signal });
      signal.throwIfAborted();
      recognition.lang = language;
      recognition.continuous = true;
      recognition.interimResults = true;
      if (mode === 'local') {
        recognition.processLocally = true;
      }
      return new Promise((resolve, reject) => {
        let finalTranscript = '';
        let settled = false;
        const settle = (finish: () => void): void => {
          if (settled) {
            return;
          }
          settled = true;
          signal.removeEventListener('abort', onAbort);
          recognition.onresult = null;
          recognition.onerror = null;
          recognition.onend = null;
          active = undefined;
          finish();
        };
        const onAbort = (): void => {
          const reason: unknown = signal.reason;
          settle(() => {
            recognition.abort();
            reject(reason);
          });
        };
        recognition.onresult = (event) => {
          const transcripts = readTranscripts(event);
          finalTranscript = transcripts.final;
          onPartial(transcripts.running);
        };
        recognition.onerror = (event) => settle(() => reject(speechErrorFromEngine(event.error)));
        recognition.onend = () => settle(() => resolve({ transcript: finalTranscript, language }));
        signal.addEventListener('abort', onAbort, { once: true });
        active = recognition;
        recognition.start();
      });
    },
  };
}
