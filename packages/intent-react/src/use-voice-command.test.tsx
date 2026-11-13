import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { SpeechSource } from '@jcsoftdev/intent-core';
import { createFakeSpeechSource } from '@jcsoftdev/intent-testing';
import { createRecordingTargets, createTestKit, wrapperOf } from '../test/support.js';
import { useIntentSession } from './use-intent-session.js';
import { useVoiceCommand } from './use-voice-command.js';

const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const setup = (speech: SpeechSource) => {
  const kit = createTestKit();
  const submitted: unknown[] = [];
  const baseCreate = kit.createSession.bind(kit);
  const spyKit = {
    ...kit,
    createSession: () => {
      const session = baseCreate();
      const submit = session.submit.bind(session);
      return {
        ...session,
        submit: (command: Parameters<typeof session.submit>[0]) => {
          submitted.push(command);
          return submit(command);
        },
      };
    },
  };
  const onError = vi.fn();
  const rendered = renderHook(
    () => ({
      voice: useVoiceCommand({ speech, language: 'es-PE', onError }),
      intent: useIntentSession(),
    }),
    { wrapper: wrapperOf(spyKit, createRecordingTargets()) },
  );
  return { ...rendered, submitted, onError };
};

test('press then release submits once with source voice', async () => {
  const speech = createFakeSpeechSource({ transcript: 'mesa 4, dos lomos', partials: ['mesa'] });
  const { result, submitted } = setup(speech);
  act(() => result.current.voice.press());
  expect(result.current.voice.listening).toBe(true);
  expect(result.current.intent.state).toEqual({ name: 'capturing', mode: 'listening' });
  await flush();
  act(() => result.current.voice.release());
  await flush();
  expect(submitted).toEqual([{ text: 'mesa 4, dos lomos', source: 'voice' }]);
  expect(result.current.voice.listening).toBe(false);
});

test('release with an empty transcript does not submit', async () => {
  const { result, submitted } = setup(createFakeSpeechSource({ transcript: '   ' }));
  act(() => result.current.voice.press());
  await flush();
  act(() => result.current.voice.release());
  await flush();
  expect(submitted).toEqual([]);
  expect(result.current.intent.state.name).toBe('idle');
});

test('cancel while listening aborts and does not submit', async () => {
  let aborted = false;
  const speech: SpeechSource = {
    isSupported: () => true,
    start: ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(signal.reason);
        });
      }),
    stop: () => undefined,
  };
  const { result, submitted, onError } = setup(speech);
  act(() => result.current.voice.press());
  act(() => result.current.voice.cancel());
  await flush();
  expect(aborted).toBe(true);
  expect(submitted).toEqual([]);
  expect(onError).not.toHaveBeenCalled();
  expect(result.current.voice.listening).toBe(false);
  expect(result.current.intent.state.name).toBe('idle');
});

test('a permissionDenied error calls onError and leaves the session idle', async () => {
  const denied = Object.assign(new Error('denied'), { reason: 'permissionDenied' });
  const speech: SpeechSource = {
    isSupported: () => true,
    start: () => Promise.reject(denied),
    stop: () => undefined,
  };
  const { result, submitted, onError } = setup(speech);
  act(() => result.current.voice.press());
  await flush();
  expect(onError).toHaveBeenCalledExactlyOnceWith(denied);
  expect(submitted).toEqual([]);
  expect(result.current.intent.state.name).toBe('idle');
});
