import { recognitionConstructor } from './recognition-types.js';

export type SpeechPrivacyMode = 'local' | 'cloud' | 'unsupported';

export const webSpeechAvailability = async (language: string): Promise<SpeechPrivacyMode> => {
  const Constructor = recognitionConstructor();
  if (Constructor === undefined) {
    return 'unsupported';
  }
  if (typeof Constructor.available !== 'function') {
    return 'cloud';
  }
  try {
    const status = await Constructor.available({ langs: [language], processLocally: true });
    return status === 'available' ? 'local' : 'cloud';
  } catch {
    return 'cloud';
  }
};
