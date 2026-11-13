import type { SpeechPrivacyMode } from './privacy-mode.js';

export interface NoticeStore {
  acknowledged(): boolean;
  acknowledge(): void;
}

export const needsCloudNotice = (mode: SpeechPrivacyMode, store: NoticeStore): boolean =>
  mode === 'cloud' && !store.acknowledged();
