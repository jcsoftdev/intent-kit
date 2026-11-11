import { expect, test } from 'vitest';
import { mergeAnswers } from './answers.js';

test('mergeAnswers keeps both keys', () => {
  expect(mergeAnswers({ a: '1' }, { b: ['x'] })).toEqual({ a: '1', b: ['x'] });
});

test('mergeAnswers lets the later value win for the same key', () => {
  expect(mergeAnswers({ a: '1', c: 3 }, { a: '2' })).toEqual({ a: '2', c: 3 });
});
