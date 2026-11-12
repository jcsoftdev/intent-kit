import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publishRefusal } from './assert-ci-publish.mjs';

test('allows a publish from GitHub Actions', () => {
  assert.equal(publishRefusal({ CI: 'true', GITHUB_ACTIONS: 'true' }), undefined);
});

test('refuses a local publish, or one from another CI', () => {
  for (const env of [
    {},
    { CI: 'true' },
    { GITHUB_ACTIONS: 'true' },
    { CI: '1', GITHUB_ACTIONS: 'true' },
  ]) {
    assert.match(publishRefusal(env) ?? '', /release workflow/);
  }
});
