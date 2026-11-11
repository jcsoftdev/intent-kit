import { describe, expect, test } from 'vitest';
import { stageName } from '../contracts/index.js';
import type { IntentEvent, Outcome, Stage, Terminal } from '../contracts/index.js';
import { createEventBus, createManualClock } from '../primitives/index.js';
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

const signal = new AbortController().signal;
const timeoutFailure = {
  stage: 'resolution',
  code: 'RESOLUTION_UNAVAILABLE',
  retryable: true,
} as const;

const never = (): Promise<Outcome<Result>> => new Promise(() => undefined);

describe('pipeline run', () => {
  test('a stage that returns without calling next short-circuits; later stages never run', async () => {
    const ran: string[] = [];
    const pipeline = builderOf()
      .use(stage('first', [], [], async () => ({ ok: true, value: 'early' })))
      .use(stage('second', [], [], async (_, next) => (ran.push('second'), next())))
      .build();
    expect(await pipeline.run({ text: 't' }, { signal })).toEqual({ ok: true, value: 'early' });
    expect(ran).toEqual([]);
  });

  test('stages share state through provides and the terminal reads it', async () => {
    const pipeline = createPipelineBuilder<State, Result>({
      name: 'test',
      seeds: ['text'],
      terminal: {
        requires: ['x'],
        settle: async (context) => ({
          ok: true,
          value: `${context.get('text')}:${context.get('x')}`,
        }),
      },
    })
      .use(
        stage('provider', ['text'], ['x'], (context, next) => {
          context.set('x', 7);
          return next();
        }),
      )
      .build();
    expect(await pipeline.run({ text: 'hi' }, { signal })).toEqual({ ok: true, value: 'hi:7' });
  });

  test('set of an undeclared key throws UNDECLARED_PROVIDE', async () => {
    const pipeline = builderOf()
      .use(
        stage('rogue', [], [], (context, next) => {
          context.set('y', 1);
          return next();
        }),
      )
      .build();
    await expect(pipeline.run({ text: 't' }, { signal })).rejects.toMatchObject({
      reason: 'UNDECLARED_PROVIDE',
      subject: 'rogue:y',
    });
  });

  test('get of an absent key throws MISSING_REQUIREMENT', async () => {
    const pipeline = builderOf()
      .use(
        stage('reader', [], [], (context, next) => {
          context.get('y');
          return next();
        }),
      )
      .build();
    await expect(pipeline.run({ text: 't' }, { signal })).rejects.toMatchObject({
      reason: 'MISSING_REQUIREMENT',
    });
  });

  test('calling next twice throws NEXT_CALLED_TWICE', async () => {
    const pipeline = builderOf()
      .use(
        stage('twice', [], [], async (_, next) => {
          await next();
          return next();
        }),
      )
      .build();
    await expect(pipeline.run({ text: 't' }, { signal })).rejects.toMatchObject({
      reason: 'NEXT_CALLED_TWICE',
    });
  });

  test('the terminal cannot set', async () => {
    const pipeline = createPipelineBuilder<State, Result>({
      name: 'test',
      seeds: ['text'],
      terminal: {
        requires: [],
        settle: async (context) => {
          context.set('x', 1);
          return { ok: true, value: 'never' };
        },
      },
    }).build();
    await expect(pipeline.run({ text: 't' }, { signal })).rejects.toMatchObject({
      reason: 'UNDECLARED_PROVIDE',
    });
  });

  test('a thrown IntentFailureError becomes the outcome failure; other errors propagate', async () => {
    const { IntentFailureError } = await import('../contracts/index.js');
    const failure = { stage: 'policy', code: 'UNAUTHORIZED', retryable: false } as const;
    const failing = builderOf()
      .use(stage('deny', [], [], async () => Promise.reject(new IntentFailureError(failure))))
      .build();
    expect(await failing.run({ text: 't' }, { signal })).toEqual({ ok: false, failure });
    const crashing = builderOf()
      .use(stage('bug', [], [], async () => Promise.reject(new TypeError('bug'))))
      .build();
    await expect(crashing.run({ text: 't' }, { signal })).rejects.toThrow('bug');
  });

  test('budget 600 ms with onTimeout RESOLUTION_UNAVAILABLE: a stage stuck 700 ms on the manual clock settles with that failure', async () => {
    const clock = createManualClock();
    const slow: Stage<State, Result> = {
      ...stage('slow'),
      budget: { timeoutMs: 600, onTimeout: timeoutFailure },
      run: never,
    };
    const pipeline = createPipelineBuilder<State, Result>({
      name: 'test',
      seeds: ['text'],
      terminal: terminalOf(),
      clock,
    })
      .use(slow)
      .build();
    const running = pipeline.run({ text: 't' }, { signal });
    await clock.advance(700);
    expect(await running).toEqual({ ok: false, failure: timeoutFailure });
  });

  test('budget does not count time spent downstream after next()', async () => {
    const clock = createManualClock();
    const budgeted: Stage<State, Result> = {
      ...stage('budgeted'),
      budget: { timeoutMs: 600, onTimeout: timeoutFailure },
    };
    const downstream = stage('downstream', [], [], async (_, next) => {
      await clock.delay(2000, { signal });
      return next();
    });
    const pipeline = createPipelineBuilder<State, Result>({
      name: 'test',
      seeds: ['text'],
      terminal: terminalOf(),
      clock,
    })
      .use(budgeted)
      .use(downstream)
      .build();
    const running = pipeline.run({ text: 't' }, { signal });
    await clock.advance(2500);
    expect(await running).toEqual({ ok: true, value: 'done' });
  });

  test('a timed-out stage that later calls next does not run downstream', async () => {
    const clock = createManualClock();
    const ran: string[] = [];
    let late: (() => Promise<Outcome<Result>>) | undefined;
    const slow: Stage<State, Result> = {
      ...stage('slow'),
      budget: { timeoutMs: 100, onTimeout: timeoutFailure },
      run: (_, next) => {
        late = next;
        return never();
      },
    };
    const pipeline = createPipelineBuilder<State, Result>({
      name: 'test',
      seeds: ['text'],
      terminal: terminalOf(),
      clock,
    })
      .use(slow)
      .use(stage('after', [], [], (_, next) => (ran.push('after'), next())))
      .build();
    const running = pipeline.run({ text: 't' }, { signal });
    await clock.advance(200);
    await running;
    expect(await late?.()).toEqual({ ok: false, failure: timeoutFailure });
    expect(ran).toEqual([]);
  });

  test('aborting the root during a stage returns ABORTED with that stage phase', async () => {
    const controller = new AbortController();
    const waiting: Stage<State, Result> = {
      ...stage('waiting'),
      phase: 'interpretation',
      run: never,
    };
    const pipeline = builderOf().use(waiting).build();
    const running = pipeline.run({ text: 't' }, { signal: controller.signal });
    controller.abort();
    expect(await running).toEqual({
      ok: false,
      failure: { stage: 'interpretation', code: 'ABORTED', retryable: false },
    });
  });

  test('a root aborted before the first stage returns ABORTED without running it', async () => {
    const controller = new AbortController();
    controller.abort();
    const ran: string[] = [];
    const pipeline = builderOf()
      .use(stage('first', [], [], (_, next) => (ran.push('first'), next())))
      .build();
    const outcome = await pipeline.run({ text: 't' }, { signal: controller.signal });
    expect(outcome).toMatchObject({ ok: false, failure: { code: 'ABORTED' } });
    expect(ran).toEqual([]);
  });

  test('emits one stage.completed per stage with durationMs from the manual clock', async () => {
    const clock = createManualClock(1000);
    const events = createEventBus<IntentEvent>();
    const seen: IntentEvent[] = [];
    events.subscribe((event) => seen.push(event));
    const pipeline = createPipelineBuilder<State, Result>({
      name: 'test',
      seeds: ['text'],
      terminal: terminalOf(),
      clock,
      events,
    })
      .use(
        stage('timed', [], [], async (_, next) => {
          await clock.delay(40, { signal });
          return next();
        }),
      )
      .use(stage('quick'))
      .build();
    const running = pipeline.run({ text: 't' }, { signal });
    await clock.advance(40);
    await running;
    expect(seen).toEqual([
      { type: 'stage.completed', pipeline: 'test', stage: 'quick', durationMs: 0, ok: true },
      { type: 'stage.completed', pipeline: 'test', stage: 'timed', durationMs: 40, ok: true },
    ]);
  });

  test('a late next() after the run returned ABORTED does not settle the terminal', async () => {
    const controller = new AbortController();
    let settled = 0;
    let late: (() => Promise<Outcome<Result>>) | undefined;
    const pipeline = createPipelineBuilder<State, Result>({
      name: 'test',
      seeds: ['text'],
      terminal: {
        requires: [],
        settle: async () => {
          settled += 1;
          return { ok: true, value: 'done' };
        },
      },
    })
      .use(
        stage('waiting', [], [], (_, next) => {
          late = next;
          return never();
        }),
      )
      .build();
    const running = pipeline.run({ text: 't' }, { signal: controller.signal });
    controller.abort();
    expect(await running).toMatchObject({ ok: false, failure: { code: 'ABORTED' } });
    expect(await late?.()).toMatchObject({ ok: false, failure: { code: 'ABORTED' } });
    expect(settled).toBe(0);
  });
});
