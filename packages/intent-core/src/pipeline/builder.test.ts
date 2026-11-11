import { describe, expect, test } from 'vitest';
import { stageName } from '../contracts/index.js';
import type { Stage, Terminal } from '../contracts/index.js';
import { createPipelineBuilder } from './builder.js';

interface State {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

type Result = string;

const stage = (
  name: string,
  requires: readonly (keyof State)[] = [],
  provides: readonly (keyof State)[] = [],
  run: Stage<State, Result>['run'] = (_, next) => next(),
): Stage<State, Result> => ({
  name: stageName(name),
  phase: 'resolution',
  requires,
  provides,
  run,
});

const terminalOf = (requires: readonly (keyof State)[] = []): Terminal<State, Result> => ({
  requires,
  settle: async () => ({ ok: true, value: 'done' }),
});

const builderOf = (requires: readonly (keyof State)[] = []) =>
  createPipelineBuilder<State, Result>({
    name: 'test',
    seeds: ['text'],
    terminal: terminalOf(requires),
  });

const a = stage('a');
const needsX = stage('needsX', ['x']);
const providesX = stage('providesX', [], ['x']);

const reasonOf = (build: () => unknown): string | undefined => {
  try {
    build();
    return undefined;
  } catch (error) {
    return (error as { reason?: string }).reason;
  }
};

describe('pipeline builder', () => {
  test.each([
    ['duplicate name', [a, a], [], 'DUPLICATE_STAGE'],
    ['requires a key nobody provides', [needsX], [], 'MISSING_REQUIREMENT'],
    [
      'requires a key provided only by a later stage',
      [needsX, providesX],
      [],
      'MISSING_REQUIREMENT',
    ],
    ['terminal requires a missing key', [a], ['y'], 'MISSING_REQUIREMENT'],
  ] as const)('build rejects %s', (_, stages, terminalRequires, reason) => {
    const builder = stages.reduce(
      (current, next) => current.use(next),
      builderOf(terminalRequires as readonly (keyof State)[]),
    );
    expect(reasonOf(() => builder.build())).toBe(reason);
  });

  test('build accepts a seed requirement and an earlier provide', () => {
    const builder = builderOf(['x'])
      .use(stage('seeded', ['text']))
      .use(providesX)
      .use(needsX);
    expect(builder.build().stages).toEqual(['seeded', 'providesX', 'needsX']);
  });

  test('insertAfter places the stage right after the anchor; replace swaps it in place; stages lists names in order', () => {
    const base = builderOf().use(stage('one')).use(stage('two')).use(stage('three'));
    const inserted = base.insertAfter(stageName('one'), stage('between'));
    const replaced = inserted.replace(stageName('two'), stage('swapped'));
    expect(base.build().stages).toEqual(['one', 'two', 'three']);
    expect(inserted.build().stages).toEqual(['one', 'between', 'two', 'three']);
    expect(replaced.build().stages).toEqual(['one', 'between', 'swapped', 'three']);
  });

  test('insertAfter("ghost") throws UNKNOWN_ANCHOR', () => {
    const builder = builderOf().use(a).insertAfter(stageName('ghost'), stage('b'));
    expect(reasonOf(() => builder.build())).toBe('UNKNOWN_ANCHOR');
  });

  test('replace of an absent name throws UNKNOWN_ANCHOR', () => {
    const builder = builderOf().replace(stageName('ghost'), stage('b'));
    expect(reasonOf(() => builder.build())).toBe('UNKNOWN_ANCHOR');
  });
});
