import { expect, test } from 'vitest';
import type {
  ActionLifecycle,
  ActionResult,
  AnyDescriptor,
  Destination,
  Outcome,
  Presentation,
  StandardSchemaV1,
} from '../contracts/index.js';
import { createPipelineBuilder } from '../pipeline/index.js';
import { createManualClock } from '../primitives/index.js';
import type { ActionState } from './action-pipeline.js';
import { createPresentStage } from './present-stage.js';

const schema: StandardSchemaV1 = {
  '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) },
};

const descriptor: AnyDescriptor = {
  id: 'orders.create',
  version: 1,
  kind: 'write',
  agent: 'allowed',
  description: 'Create an order',
  aliases: [],
  examples: [],
  patterns: [],
  scope: 'global',
  input: schema,
  entities: [],
  risk: 'write',
  confirmation: 'never',
  reversibility: { kind: 'none' },
  idempotency: { kind: 'none' },
  roles: ['waiter'],
  destination: {
    default: { routeId: 'orders', target: { intent: 'my-order', key: '{output.orderId}' } },
  },
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const rejectOnAbort = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));

interface Setup {
  readonly announcements: string[];
  readonly reveal: AbortController;
  readonly clock: ReturnType<typeof createManualClock>;
  presentation(overrides?: {
    readonly descriptor?: AnyDescriptor;
    readonly output?: unknown;
  }): Promise<Outcome<ActionResult>>;
}

const setup = (behavior: {
  readonly waitUntilReady?: (signal: AbortSignal) => Promise<void>;
  readonly reveal?: (signal: AbortSignal) => Promise<void>;
}): Setup => {
  const announcements: string[] = [];
  const reveal = new AbortController();
  const clock = createManualClock();
  const lifecycle: ActionLifecycle = {
    confirming: () => undefined,
    executing: () => undefined,
    sending: () => undefined,
    presenting: () => reveal.signal,
  };
  const pipeline = createPipelineBuilder<ActionState<unknown, string>, ActionResult>({
    name: 'present-only',
    seeds: ['plan', 'descriptor', 'input', 'output', 'role', 'lifecycle'],
    clock,
    terminal: {
      requires: ['descriptor', 'presentation'],
      async settle(context) {
        return {
          ok: true,
          value: {
            status: 'completed',
            planId: 'p-1',
            capabilityId: context.get('descriptor').id,
            output: null,
            presentation: context.get('presentation'),
          },
        };
      },
    },
  })
    .use(
      createPresentStage({
        router: {
          currentRoute: () => ({ routeId: 'orders', params: {} }),
          navigate: async (_destination: Destination<string>) => undefined,
          waitUntilReady: (_destination, { signal }) =>
            behavior.waitUntilReady ? behavior.waitUntilReady(signal) : Promise.resolve(),
        },
        targets: { register: () => () => undefined, find: () => 'el', waitFor: async () => 'el' },
        revealer: {
          reveal: (_element, _mode, { signal }) =>
            behavior.reveal ? behavior.reveal(signal) : Promise.resolve(),
        },
        announcer: { announce: (message) => announcements.push(message) },
        messages: {
          'orders.create': { success: () => 'done', confirm: () => 'sure?' },
        },
        clock,
        presentMs: 3000,
        targetMs: 3000,
      }),
    )
    .build();
  return {
    announcements,
    reveal,
    clock,
    presentation: (overrides = {}) =>
      pipeline.run(
        {
          plan: {
            planId: 'p-1',
            draft: { capabilityId: 'orders.create', version: 1, input: {} },
            source: 'text',
          },
          descriptor: overrides.descriptor ?? descriptor,
          input: {},
          output: overrides.output ?? { orderId: 'o-1' },
          role: 'waiter',
          lifecycle,
        },
        { signal: new AbortController().signal },
      ),
  };
};

const presentationOf = (outcome: Outcome<ActionResult>): Presentation | undefined =>
  outcome.ok && outcome.value.status === 'completed' ? outcome.value.presentation : undefined;

test('no destination rule → skipped, and the success message is still announced politely', async () => {
  const { presentation, announcements } = setup({});
  const { destination: _unused, ...withoutDestination } = descriptor;
  const outcome = await presentation({ descriptor: withoutDestination });
  expect(presentationOf(outcome)).toEqual({ status: 'skipped' });
  expect(announcements).toEqual(['done']);
});

test('a destination template with a missing output field → degraded TARGET_NOT_FOUND', async () => {
  const { presentation, announcements } = setup({});
  const outcome = await presentation({ output: {} });
  expect(presentationOf(outcome)).toEqual({ status: 'degraded', code: 'TARGET_NOT_FOUND' });
  expect(announcements).toEqual(['done']);
});

test('the route never becomes ready → degraded ROUTE_NOT_READY', async () => {
  const { presentation } = setup({ waitUntilReady: () => Promise.reject(new Error('timeout')) });
  expect(presentationOf(await presentation())).toEqual({
    status: 'degraded',
    code: 'ROUTE_NOT_READY',
  });
});

test('the present budget cuts a route that stays pending', async () => {
  const { presentation, clock } = setup({ waitUntilReady: rejectOnAbort });
  const settled = presentation();
  await flush();
  await clock.advance(3000);
  expect(presentationOf(await settled)).toEqual({ status: 'degraded', code: 'ROUTE_NOT_READY' });
});

test('cancelling while revealing cuts the reveal but the action stays completed', async () => {
  const { presentation, reveal, announcements } = setup({ reveal: rejectOnAbort });
  const settled = presentation();
  await flush();
  reveal.abort();
  const outcome = await settled;
  expect(outcome.ok).toBe(true);
  expect(presentationOf(outcome)).toEqual({ status: 'degraded', code: 'ABORTED' });
  expect(announcements).toEqual(['done']);
});

test('a handoff capability presents the destination and announces nothing', async () => {
  const { presentation, announcements } = setup({ reveal: () => Promise.resolve() });
  const outcome = await presentation({ descriptor: { ...descriptor, agent: 'handoff' } });
  expect(presentationOf(outcome)).toEqual({ status: 'shown' });
  expect(announcements).toEqual([]);
});
