export interface RecognitionAlternativeLike {
  readonly transcript: string;
}

export interface RecognitionResultLike extends ArrayLike<RecognitionAlternativeLike> {
  readonly isFinal: boolean;
}

export interface RecognitionResultEventLike {
  readonly results: ArrayLike<RecognitionResultLike>;
}

export interface RecognitionErrorEventLike {
  readonly error: string;
}

export interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionResultEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

export interface RecognitionConstructorLike {
  new (): RecognitionLike;
  available?(options: { langs: string[]; processLocally: boolean }): Promise<string>;
}

export const recognitionConstructor = (): RecognitionConstructorLike | undefined => {
  const scope = globalThis as {
    SpeechRecognition?: RecognitionConstructorLike;
    webkitSpeechRecognition?: RecognitionConstructorLike;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
};

export const createDefaultRecognition = (): RecognitionLike | undefined => {
  const Constructor = recognitionConstructor();
  return Constructor === undefined ? undefined : new Constructor();
};
