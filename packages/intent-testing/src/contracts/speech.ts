import type { SpeechSource } from '@jcsoftdev/intent-core';
import { describe, expect, it } from 'vitest';
import { expectAbortHonoredMidCall, nextMacrotask } from './abort.js';

const LANGUAGE = 'es-PE';

export function describeSpeechSourceContract(name: string, factory: () => SpeechSource): void {
  describe(`${name} speech source contract`, () => {
    it('isSupported returns a boolean', () => {
      expect(typeof factory().isSupported()).toBe('boolean');
    });

    it('start delivers every partial before resolving a transcript and a language, and none after', async () => {
      const source = factory();
      const partials: string[] = [];
      const result = await source.start({
        language: LANGUAGE,
        signal: new AbortController().signal,
        onPartial: (text) => partials.push(text),
      });
      const deliveredAtResolution = partials.length;
      expect(partials.every((text) => typeof text === 'string')).toBe(true);
      expect(typeof result.transcript).toBe('string');
      expect(result.language).not.toBe('');
      await nextMacrotask();
      expect(partials.length).toBe(deliveredAtResolution);
    });

    it('start with an already-aborted signal rejects with the reason', async () => {
      const source = factory();
      const reason = new Error('already aborted');
      await expect(
        source.start({
          language: LANGUAGE,
          signal: AbortSignal.abort(reason),
          onPartial: () => undefined,
        }),
      ).rejects.toBe(reason);
    });

    it('with an abort during start rejects with the reason or has already resolved within one macrotask, and delivers no partial afterwards', async () => {
      const source = factory();
      const partials: string[] = [];
      await expectAbortHonoredMidCall((signal) =>
        source.start({ language: LANGUAGE, signal, onPartial: (text) => partials.push(text) }),
      );
      const deliveredAtSettlement = partials.length;
      await nextMacrotask();
      await nextMacrotask();
      expect(partials.length).toBe(deliveredAtSettlement);
    });
  });
}
