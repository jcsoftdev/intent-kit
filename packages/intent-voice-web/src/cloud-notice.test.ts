import { describe, expect, it } from 'vitest';
import { needsCloudNotice } from './cloud-notice.js';
import type { SpeechPrivacyMode } from './privacy-mode.js';

describe('needsCloudNotice', () => {
  it.each<[SpeechPrivacyMode, boolean, boolean]>([
    ['local', false, false],
    ['local', true, false],
    ['cloud', false, true],
    ['cloud', true, false],
    ['unsupported', false, false],
    ['unsupported', true, false],
  ])('mode %s acknowledged %s needs notice %s', (mode, acknowledged, expected) => {
    const store = { acknowledged: () => acknowledged, acknowledge: () => undefined };
    expect(needsCloudNotice(mode, store)).toBe(expected);
  });
});
