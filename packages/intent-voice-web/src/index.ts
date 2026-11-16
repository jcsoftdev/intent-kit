export { type NoticeStore, needsCloudNotice } from './cloud-notice.js';
export { type SpeechPrivacyMode, webSpeechAvailability } from './privacy-mode.js';
export type {
  RecognitionAlternativeLike,
  RecognitionErrorEventLike,
  RecognitionLike,
  RecognitionResultEventLike,
  RecognitionResultLike,
} from './recognition-types.js';
export {
  SPEECH_ERROR_REASONS,
  SpeechCaptureError,
  type SpeechErrorReason,
} from './speech-errors.js';
export {
  createWebSpeechSource,
  type WebSpeechSource,
  type WebSpeechSourceOptions,
} from './web-speech-source.js';
