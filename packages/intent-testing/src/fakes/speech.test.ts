import { describe, expect, it } from 'vitest';
import { createFakeSpeechSource } from './speech.js';

const signal = new AbortController().signal;

describe('fake speech source', () => {
  it('streams partials then resolves the transcript', async () => {
    const partials: string[] = [];
    const source = createFakeSpeechSource({ transcript: 'hola', partials: ['ho', 'hol'] });
    await expect(
      source.start({ language: 'es-PE', signal, onPartial: (text) => partials.push(text) }),
    ).resolves.toEqual({ transcript: 'hola', language: 'es-PE' });
    expect(partials).toEqual(['ho', 'hol']);
  });

  it('supported=false reports unsupported and start rejects', async () => {
    const source = createFakeSpeechSource({ transcript: 'hola', supported: false });
    expect(source.isSupported()).toBe(false);
    await expect(
      source.start({ language: 'es-PE', signal, onPartial: () => undefined }),
    ).rejects.toMatchObject({ failure: { code: 'INTERPRETER_UNAVAILABLE' } });
  });
});
