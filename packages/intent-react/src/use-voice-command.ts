import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechSource } from '@jcsoftdev/intent-core';
import { useIntentContext } from './intent-context.js';

export interface VoiceCommandOptions {
  readonly speech: SpeechSource;
  readonly language: string;
  readonly onError: (error: Error) => void;
}

export interface VoiceCommand {
  readonly listening: boolean;
  readonly partial: string;
  press(): void;
  release(): void;
  cancel(): void;
}

type Recognition = { readonly transcript: string } | { readonly failure: Error };

interface Run {
  readonly signal: AbortSignal;
  released: boolean;
  settled: Recognition | undefined;
  finished: boolean;
}

const asError = (reason: unknown): Error =>
  reason instanceof Error ? reason : new Error(String(reason));

export function useVoiceCommand(options: VoiceCommandOptions): VoiceCommand {
  const { session } = useIntentContext();
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const current = useRef<Run | undefined>(undefined);
  const latest = useRef(options);
  latest.current = options;

  const finish = useCallback(
    (run: Run) => {
      const recognition = run.settled;
      if (run.finished || !run.released || !recognition) {
        return;
      }
      run.finished = true;
      if (current.current === run) {
        current.current = undefined;
      }
      setListening(false);
      setPartial('');
      if (run.signal.aborted) {
        return;
      }
      if ('failure' in recognition) {
        session.cancel();
        session.reset();
        latest.current.onError(recognition.failure);
        return;
      }
      const text = recognition.transcript.trim();
      if (text === '') {
        session.cancel();
        session.reset();
        return;
      }
      void session.submit({ text, source: 'voice' });
    },
    [session],
  );

  const press = useCallback(() => {
    if (current.current) {
      return;
    }
    const signal = session.capture('listening');
    if (signal.aborted) {
      return;
    }
    const run: Run = { signal, released: false, settled: undefined, finished: false };
    current.current = run;
    setListening(true);
    setPartial('');
    const { speech, language } = latest.current;
    const settle = (recognition: Recognition) => {
      run.settled = recognition;
      run.released ||= run.signal.aborted || 'failure' in recognition;
      if (!run.released) {
        setListening(false);
      }
      finish(run);
    };
    speech.start({ language, signal, onPartial: (text) => !run.finished && setPartial(text) }).then(
      ({ transcript }) => settle({ transcript }),
      (reason: unknown) => settle({ failure: asError(reason) }),
    );
  }, [session, finish]);

  const release = useCallback(() => {
    const run = current.current;
    if (!run || run.released) {
      return;
    }
    run.released = true;
    latest.current.speech.stop();
    finish(run);
  }, [finish]);

  const cancel = useCallback(() => {
    const run = current.current;
    if (!run) {
      return;
    }
    current.current = undefined;
    run.finished = true;
    session.cancel();
    session.reset();
    setListening(false);
    setPartial('');
  }, [session]);

  useEffect(() => cancel, [cancel]);

  return { listening, partial, press, release, cancel };
}
