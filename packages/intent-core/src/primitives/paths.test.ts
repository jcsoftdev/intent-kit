import { describe, expect, test } from 'vitest';
import { IntentDefinitionError } from '../contracts/index.js';
import {
  expandPattern,
  formatPath,
  getAtPath,
  matchesPattern,
  overlaps,
  parsePath,
  setAtPath,
} from './paths.js';

describe('paths', () => {
  test.each([
    ['lines[].modifiers[]', ['lines', '[]', 'modifiers', '[]']],
    ['lines[0].offeringId', ['lines', 0, 'offeringId']],
    ['tableId', ['tableId']],
  ])('parsePath(%s)', (path, segments) => {
    expect(parsePath(path)).toEqual(segments);
    expect(formatPath(parsePath(path))).toBe(path);
  });

  test.each(['lines[x]', 'a..b', '', '.a', 'a.'])('parsePath rejects %j', (path) => {
    expect(() => parsePath(path)).toThrow(IntentDefinitionError);
    expect(() => parsePath(path)).toThrow('INVALID_PATH');
  });

  test('getAtPath reads nested values and returns undefined when missing', () => {
    const value = { lines: [{ offeringId: 'o-1' }] };
    expect(getAtPath(value, 'lines[0].offeringId')).toBe('o-1');
    expect(getAtPath(value, 'lines[1].offeringId')).toBeUndefined();
    expect(getAtPath(value, 'lines[].offeringId')).toBeUndefined();
  });

  test('expandPattern expands [] to existing indices', () => {
    const value = { lines: [{ modifiers: ['a', 'b'] }, { modifiers: [] }] };
    expect(expandPattern('lines[].modifiers[]', value)).toEqual([
      'lines[0].modifiers[0]',
      'lines[0].modifiers[1]',
    ]);
  });

  test('setAtPath creates missing structure and leaves the original untouched', () => {
    const original = {};
    expect(setAtPath(original, 'lines[0].modifiers', ['x'])).toEqual({
      lines: [{ modifiers: ['x'] }],
    });
    expect(original).toEqual({});
  });

  test('setAtPath copies siblings instead of mutating them', () => {
    const original = { lines: [{ qty: 1 }], tableId: 't' };
    const next = setAtPath(original, 'lines[0].qty', 2);
    expect(next).toEqual({ lines: [{ qty: 2 }], tableId: 't' });
    expect(original.lines[0]?.qty).toBe(1);
  });

  test('overlaps compares paths after replacing indices by []', () => {
    expect(overlaps('lines[0].modifiers', 'lines[].modifiers[]')).toBe(true);
    expect(overlaps('tableId', 'lines[]')).toBe(false);
  });

  test('matchesPattern matches concrete indices against []', () => {
    expect(matchesPattern('lines[3].offeringId', 'lines[].offeringId')).toBe(true);
    expect(matchesPattern('lines[3].qty', 'lines[].offeringId')).toBe(false);
    expect(matchesPattern('lines[3]', 'lines[].offeringId')).toBe(false);
  });
});
