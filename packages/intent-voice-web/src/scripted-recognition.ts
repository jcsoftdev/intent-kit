import type {
  RecognitionLike,
  RecognitionResultEventLike,
  RecognitionResultLike,
} from './recognition-types.js';

export const resultOf = (transcript: string, isFinal: boolean): RecognitionResultLike =>
  Object.assign([{ transcript }], { isFinal });

export class ScriptedRecognition implements RecognitionLike {
  lang = '';
  interimResults = false;
  continuous = false;
  processLocally: boolean | undefined = undefined;
  started = false;
  stopped = false;
  aborted = false;
  onresult: ((event: RecognitionResultEventLike) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor(private readonly onStart: (recognition: ScriptedRecognition) => void = () => {}) {}

  start(): void {
    this.started = true;
    this.onStart(this);
  }

  stop(): void {
    this.stopped = true;
    this.onend?.();
  }

  abort(): void {
    this.aborted = true;
  }

  emit(...results: RecognitionResultLike[]): void {
    this.onresult?.({ results });
  }
}
