import { describeSpeechSourceContract } from '@jcsoftdev/intent-testing/contracts';
import { describe, expect, it } from 'vitest';
import { resultOf, ScriptedRecognition } from '../test/scripted-recognition.js';
import { SpeechCaptureError, type SpeechErrorReason } from './speech-errors.js';
import { createWebSpeechSource } from './web-speech-source.js';

const sourceOver = (recognition: ScriptedRecognition | undefined) =>
  createWebSpeechSource({
    createRecognition: () => recognition,
    preferLocal: false,
  });

const endingOnItsOwn = () =>
  createWebSpeechSource({
    createRecognition: () =>
      new ScriptedRecognition((recognition) => {
        setTimeout(() => {
          recognition.emit(resultOf('dos', false));
          recognition.emit(resultOf('dos mesas', true));
          recognition.onend?.();
        }, 0);
      }),
    preferLocal: false,
  });

describeSpeechSourceContract('web speech', endingOnItsOwn);

describe('web speech source', () => {
  it('stop after two interim results resolves with the final transcript and language es-PE', async () => {
    const recognition = new ScriptedRecognition();
    const partials: string[] = [];
    const pending = sourceOver(recognition).start({
      language: 'es-PE',
      signal: new AbortController().signal,
      onPartial: (text) => partials.push(text),
    });
    await Promise.resolve();
    await Promise.resolve();
    recognition.emit(resultOf('dos', false));
    recognition.emit(resultOf('dos mesas', false));
    recognition.emit(resultOf('dos mesas para hoy', true));
    recognition.onend?.();
    await expect(pending).resolves.toEqual({
      transcript: 'dos mesas para hoy',
      language: 'es-PE',
    });
    expect(partials).toEqual(['dos', 'dos mesas', 'dos mesas para hoy']);
    expect(recognition.lang).toBe('es-PE');
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
  });

  it('stop on the source stops the recognition and resolves with the finals', async () => {
    const recognition = new ScriptedRecognition();
    const source = sourceOver(recognition);
    const pending = source.start({
      language: 'es-PE',
      signal: new AbortController().signal,
      onPartial: () => undefined,
    });
    await Promise.resolve();
    await Promise.resolve();
    recognition.emit(resultOf('cobra la mesa', true), resultOf('cuatro', false));
    source.stop();
    await expect(pending).resolves.toEqual({ transcript: 'cobra la mesa', language: 'es-PE' });
    expect(recognition.stopped).toBe(true);
  });

  it.each<[string, SpeechErrorReason]>([
    ['not-allowed', 'permissionDenied'],
    ['no-speech', 'noSpeech'],
    ['audio-capture', 'audioCapture'],
    ['network', 'network'],
    ['language-not-supported', 'languageUnsupported'],
  ])('error %s rejects SpeechCaptureError %s', async (engineError, reason) => {
    const recognition = new ScriptedRecognition((started) =>
      setTimeout(() => started.onerror?.({ error: engineError }), 0),
    );
    const failure = await sourceOver(recognition)
      .start({
        language: 'es-PE',
        signal: new AbortController().signal,
        onPartial: () => undefined,
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SpeechCaptureError);
    expect((failure as SpeechCaptureError).reason).toBe(reason);
  });

  it('abort calls recognition.abort and rejects with the signal reason, no partial afterwards', async () => {
    const recognition = new ScriptedRecognition();
    const controller = new AbortController();
    const partials: string[] = [];
    const reason = new Error('cancelled');
    const pending = sourceOver(recognition).start({
      language: 'es-PE',
      signal: controller.signal,
      onPartial: (text) => partials.push(text),
    });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    recognition.emit(resultOf('late', false));
    expect(recognition.aborted).toBe(true);
    expect(partials).toEqual([]);
  });

  it('isSupported is false without a constructor and start rejects unsupported', async () => {
    const source = sourceOver(undefined);
    expect(source.isSupported()).toBe(false);
    const failure = await source
      .start({
        language: 'es-PE',
        signal: new AbortController().signal,
        onPartial: () => undefined,
      })
      .catch((error: unknown) => error);
    expect((failure as SpeechCaptureError).reason).toBe('unsupported');
  });
});
