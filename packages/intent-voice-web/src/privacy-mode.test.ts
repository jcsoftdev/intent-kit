import { describe, expect, it } from 'vitest';
import { webSpeechAvailability } from './privacy-mode.js';
import { ScriptedRecognition } from './scripted-recognition.js';
import { createWebSpeechSource } from './web-speech-source.js';
import type { SpeechPrivacyMode } from './privacy-mode.js';

const startWith = async (availability: (language: string) => Promise<SpeechPrivacyMode>) => {
  const recognition = new ScriptedRecognition((started) => setTimeout(() => started.onend?.(), 0));
  const source = createWebSpeechSource({
    createRecognition: () => recognition,
    preferLocal: true,
    availability,
  });
  await source.start({
    language: 'es-PE',
    signal: new AbortController().signal,
    onPartial: () => undefined,
  });
  return recognition;
};

const withGlobalRecognition = async (
  Constructor: unknown,
  run: () => Promise<SpeechPrivacyMode>,
): Promise<SpeechPrivacyMode> => {
  const scope = globalThis as { SpeechRecognition?: unknown };
  const previous = scope.SpeechRecognition;
  scope.SpeechRecognition = Constructor;
  try {
    return await run();
  } finally {
    scope.SpeechRecognition = previous;
  }
};

describe('privacy mode', () => {
  it('available resolves local and processLocally is set', async () => {
    const recognition = await startWith(async () => 'local');
    expect(recognition.processLocally).toBe(true);
  });

  it.each<SpeechPrivacyMode>(['cloud', 'unsupported'])(
    '%s leaves processLocally unset',
    async (mode) => {
      const recognition = await startWith(async () => mode);
      expect(recognition.processLocally).toBeUndefined();
    },
  );

  it('preferLocal false never asks for availability', async () => {
    let asked = false;
    const source = createWebSpeechSource({
      createRecognition: () => new ScriptedRecognition(),
      preferLocal: false,
      availability: async () => {
        asked = true;
        return 'local';
      },
    });
    const mode = await source.privacyMode('es-PE', { signal: new AbortController().signal });
    expect(mode).toBe('cloud');
    expect(asked).toBe(false);
  });

  it.each([
    ['available', 'local'],
    ['downloadable', 'cloud'],
    ['downloading', 'cloud'],
    ['unavailable', 'cloud'],
  ] as const)('available() returning %s resolves %s', async (status, expected) => {
    class Engine {
      static available = async () => status;
    }
    const mode = await withGlobalRecognition(Engine, () => webSpeechAvailability('es-PE'));
    expect(mode).toBe(expected);
  });

  it('no available() resolves cloud', async () => {
    class Engine {}
    const mode = await withGlobalRecognition(Engine, () => webSpeechAvailability('es-PE'));
    expect(mode).toBe('cloud');
  });

  it('a throwing available() resolves cloud', async () => {
    class Engine {
      static available = async () => {
        throw new Error('policy');
      };
    }
    const mode = await withGlobalRecognition(Engine, () => webSpeechAvailability('es-PE'));
    expect(mode).toBe('cloud');
  });

  it('no constructor resolves unsupported', async () => {
    const mode = await withGlobalRecognition(undefined, () => webSpeechAvailability('es-PE'));
    expect(mode).toBe('unsupported');
  });
});
