import type { SpeechSource } from '@jcsoftdev/intent-core';
import { describe, expect, it } from 'vitest';

const LANGUAGE = 'es-PE';

export function describeSpeechSourceContract(name: string, factory: () => SpeechSource): void {
  describe(`${name} speech source contract`, () => {
    it('isSupported returns a boolean', () => {
      expect(typeof factory().isSupported()).toBe('boolean');
    });

    it('start calls onPartial before resolving the transcript and the requested language', async () => {
      const source = factory();
      const partials: string[] = [];
      const result = await source.start({
        language: LANGUAGE,
        signal: new AbortController().signal,
        onPartial: (text) => partials.push(text),
      });
      expect(partials.length).toBeGreaterThan(0);
      expect(typeof result.transcript).toBe('string');
      expect(result.language).toBe(LANGUAGE);
    });

    it('start with an already-aborted signal rejects with the reason', async () => {
      const source = factory();
      const reason = new Error('already aborted');
      const controller = new AbortController();
      controller.abort(reason);
      await expect(
        source.start({ language: LANGUAGE, signal: controller.signal, onPartial: () => undefined }),
      ).rejects.toBe(reason);
    });
  });
}
