export const SPEECH_ERROR_REASONS = [
  'unsupported',
  'permissionDenied',
  'noSpeech',
  'audioCapture',
  'network',
  'languageUnsupported',
  'aborted',
] as const;

export type SpeechErrorReason = (typeof SPEECH_ERROR_REASONS)[number];

export class SpeechCaptureError extends Error {
  readonly reason: SpeechErrorReason;

  constructor(reason: SpeechErrorReason) {
    super(`speech capture failed: ${reason}`);
    this.name = 'SpeechCaptureError';
    this.reason = reason;
  }
}

const ENGINE_ERROR_REASONS: Readonly<Record<string, SpeechErrorReason>> = {
  'not-allowed': 'permissionDenied',
  'service-not-allowed': 'permissionDenied',
  'no-speech': 'noSpeech',
  'audio-capture': 'audioCapture',
  network: 'network',
  'language-not-supported': 'languageUnsupported',
  aborted: 'aborted',
};

export const speechErrorFromEngine = (engineError: string): SpeechCaptureError =>
  new SpeechCaptureError(ENGINE_ERROR_REASONS[engineError] ?? 'network');
