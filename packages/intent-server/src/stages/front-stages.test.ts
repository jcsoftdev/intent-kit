import { createCapabilityDefiner } from '@jcsoftdev/intent-core';
import type { AnyDescriptor } from '@jcsoftdev/intent-core';
import { z } from 'zod';
import { createManualClock, createPipelineBuilder } from '@jcsoftdev/intent-core';
import type {
  Interpretation,
  InterpretationInput,
  InterpretRequest,
  InterpreterResult,
  Outcome,
  Proposal,
} from '@jcsoftdev/intent-core';
import { createZodSchemaAdapter } from '@jcsoftdev/intent-zod';
import { createFakeInterpreter } from '@jcsoftdev/intent-testing';
import { describe, expect, test } from 'vitest';
import { createServerCatalog } from '../catalog/server-catalog.js';
import { defaultInterpretationCopy } from '../copy.js';
import type { InterpretationState } from '../state.js';
import { createNormalizer } from '../text/normalize.js';
import { createCatalogStage } from './catalog-stage.js';
import { createDeterministicStage } from './deterministic-stage.js';
import { createDraftStage } from './draft-stage.js';
import { createInterpretStage } from './interpret-stage.js';
import { createNormalizeStage } from './normalize-stage.js';

type Role = 'waiter' | 'cashier' | 'admin';

const define = createCapabilityDefiner<Role, 'orders'>();
const base = {
  version: 1,
  kind: 'write',
  agent: 'allowed',
  aliases: [],
  examples: [],
  patterns: [],
  scope: 'global',
  entities: [],
  risk: 'write',
  confirmation: 'never',
  reversibility: { kind: 'none' },
  idempotency: { kind: 'none' },
} as const;

const ordersCreate = define({
  ...base,
  id: 'orders.create',
  description: 'Create an order',
  examples: ['haz un pedido de arroz con pollo para la mesa 3'],
  patterns: ['{quantity?} {dish} para la mesa {table}', 'pedido de {dish} para la mesa {table}'],
  input: z.object({
    tableId: z.uuid(),
    dishId: z.uuid(),
    quantity: z.number().int().optional(),
  }),
  entities: [
    { path: 'tableId', entity: 'table' },
    { path: 'dishId', entity: 'dish' },
  ],
  roles: ['waiter', 'admin'],
});

const cashShiftClose = define({
  ...base,
  id: 'cash.shift.close',
  description: 'Close the cash shift',
  input: z.object({ note: z.string().optional() }),
  roles: ['cashier'],
});

const secretAudit = define({
  ...base,
  id: 'audit.export',
  agent: 'never',
  description: 'Export the audit',
  input: z.object({ note: z.string().optional() }),
  roles: ['waiter', 'cashier'],
});

const kitchenMarkReady = define({
  ...base,
  id: 'kitchen.lines.markReady',
  description: 'Mark a line ready',
  input: z.object({ lineId: z.uuid() }),
  entities: [{ path: 'lineId', entity: 'line' }],
  roles: ['waiter'],
});

const allDescriptors: readonly AnyDescriptor[] = [
  ordersCreate,
  cashShiftClose,
  secretAudit,
  kitchenMarkReady,
];

const resolverEntities = ['table', 'dish', 'line'];

interface Principal {
  readonly active: string;
  readonly granted: readonly string[];
}

type State = InterpretationState<Principal>;

const normalize = createNormalizer();
const catalog = createServerCatalog({
  capabilities: allDescriptors,
  schema: createZodSchemaAdapter(),
  resolverEntities,
  normalize,
});

const waiter: Principal = { active: 'waiter', granted: ['waiter'] };
const signal = new AbortController().signal;

const utterance = (text: string, restrictTo?: string): InterpretationInput => ({
  kind: 'utterance',
  text,
  locale: 'es-PE',
  source: 'text',
  context: {},
  ...(restrictTo === undefined ? {} : { restrictTo }),
});

const continuation = (capabilityId: string, version: number): Partial<State> => ({
  input: {
    kind: 'continuation',
    locale: 'es-PE',
    source: 'text',
    origin: 'deterministic',
    continuation: { draft: { capabilityId, version, input: {} }, answers: {} },
  },
  draft: { capabilityId, version, input: {} },
  answers: {},
  origin: 'deterministic',
});

const proposalOf = (capabilityId: string, confidence: number): Proposal => ({
  capabilityId,
  slots: {},
  confidence,
});

const proposed = (...proposals: readonly Proposal[]): InterpreterResult => ({
  status: 'proposed',
  proposals,
});

const harness = (
  script: (request: InterpretRequest) => InterpreterResult,
  options: { readonly delayMs?: number } = {},
) => {
  const clock = createManualClock();
  const interpreter = createFakeInterpreter(script, { ...options, clock });
  const pipeline = createPipelineBuilder<State, Interpretation>({
    name: 'interpretation',
    seeds: ['input', 'principal', 'draft', 'answers', 'origin'],
    clock,
    terminal: {
      requires: ['draft'],
      settle: async (context) => ({
        ok: true,
        value: { status: 'incomplete', draft: context.get('draft'), missing: [] },
      }),
    },
  })
    .use(createNormalizeStage(normalize))
    .use(createCatalogStage(catalog, (principal: Principal) => principal))
    .use(createDeterministicStage())
    .use(createInterpretStage({ interpreter, copy: defaultInterpretationCopy, budgetMs: 4000 }))
    .use(createDraftStage(defaultInterpretationCopy))
    .build();
  const run = (
    seed: Partial<State>,
    runSignal: AbortSignal = signal,
  ): Promise<Outcome<Interpretation>> => pipeline.run(seed, { signal: runSignal });
  return { clock, interpreter, run };
};

const unsupportedScript = (): InterpreterResult => ({ status: 'unsupported' });

describe('front interpretation stages', () => {
  test('a deterministic utterance builds a draft and never calls the interpreter', async () => {
    const { interpreter, run } = harness(unsupportedScript);
    const outcome = await run({
      input: utterance('haz un pedido de arroz con pollo para la mesa 3'),
      principal: waiter,
    });
    expect(outcome).toEqual({
      ok: true,
      value: {
        status: 'incomplete',
        draft: {
          capabilityId: 'orders.create',
          version: 1,
          input: { dishId: 'arroz con pollo', tableId: '3' },
        },
        missing: [],
      },
    });
    expect(interpreter.calls()).toHaveLength(0);
  });

  test('the more specific pattern keeps the whole dish name', async () => {
    const { run } = harness(unsupportedScript);
    const outcome = await run({
      input: utterance('pedido de arroz con pollo para la mesa 3'),
      principal: waiter,
    });
    expect(outcome).toMatchObject({
      ok: true,
      value: { draft: { input: { dishId: 'arroz con pollo', tableId: '3' } } },
    });
  });

  test('an active role outside the granted roles is UNAUTHORIZED', async () => {
    const { run } = harness(unsupportedScript);
    const outcome = await run({
      input: utterance('hola'),
      principal: { active: 'admin', granted: ['waiter'] },
    });
    expect(outcome).toEqual({
      ok: false,
      failure: { stage: 'policy', code: 'UNAUTHORIZED', retryable: false },
    });
  });

  test('an utterance with no pattern calls the interpreter once with waiter manifests only', async () => {
    const { interpreter, run } = harness(() =>
      proposed(proposalOf('kitchen.lines.markReady', 0.9)),
    );
    const outcome = await run({ input: utterance('la milanesa ya salio'), principal: waiter });
    expect(interpreter.calls()).toHaveLength(1);
    expect(interpreter.calls()[0]?.catalog.map((entry) => entry.id)).toEqual([
      'orders.create',
      'kitchen.lines.markReady',
    ]);
    expect(interpreter.calls()[0]?.text).toBe('la milanesa ya salio');
    expect(outcome).toMatchObject({
      ok: true,
      value: { draft: { capabilityId: 'kitchen.lines.markReady' } },
    });
  });

  test('a capability outside the view proposed by the interpreter is unsupported', async () => {
    const { run } = harness(() => proposed(proposalOf('cash.shift.close', 0.99)));
    const outcome = await run({ input: utterance('cierra la caja'), principal: waiter });
    expect(outcome).toEqual({
      ok: true,
      value: {
        status: 'unsupported',
        suggestions: ['haz un pedido de arroz con pollo para la mesa 3'],
      },
    });
  });

  test('an interpreter slower than 4000 ms fails with a retryable INTERPRETER_TIMEOUT', async () => {
    const { clock, run } = harness(() => proposed(proposalOf('orders.create', 0.9)), {
      delayMs: 6000,
    });
    const pending = run({ input: utterance('quiero algo'), principal: waiter });
    await clock.advance(4000);
    expect(await pending).toEqual({
      ok: false,
      failure: { stage: 'interpretation', code: 'INTERPRETER_TIMEOUT', retryable: true },
    });
  });

  test('an interpreter that throws fails with a retryable INTERPRETER_UNAVAILABLE', async () => {
    const clock = createManualClock();
    const interpreter = createFakeInterpreter(unsupportedScript, { fail: true, clock });
    const pipeline = createPipelineBuilder<State, Interpretation>({
      name: 'interpretation',
      seeds: ['input', 'principal'],
      clock,
      terminal: {
        requires: [],
        settle: async () => ({ ok: true, value: { status: 'unsupported', suggestions: [] } }),
      },
    })
      .use(createNormalizeStage(normalize))
      .use(createCatalogStage(catalog, (principal: Principal) => principal))
      .use(createInterpretStage({ interpreter, copy: defaultInterpretationCopy, budgetMs: 4000 }))
      .build();
    expect(
      await pipeline.run({ input: utterance('quiero algo'), principal: waiter }, { signal }),
    ).toEqual({
      ok: false,
      failure: { stage: 'interpretation', code: 'INTERPRETER_UNAVAILABLE', retryable: true },
    });
  });

  test('two close proposals are ambiguous and a clear leader wins', async () => {
    const close = harness(() =>
      proposed(proposalOf('orders.create', 0.7), proposalOf('kitchen.lines.markReady', 0.6)),
    );
    const closeOutcome = await close.run({ input: utterance('quiero algo'), principal: waiter });
    expect(closeOutcome).toEqual({
      ok: true,
      value: {
        status: 'ambiguous',
        candidates: [
          { kind: 'capability', capabilityId: 'orders.create', label: 'Create an order' },
          {
            kind: 'capability',
            capabilityId: 'kitchen.lines.markReady',
            label: 'Mark a line ready',
          },
        ],
      },
    });
    const clear = harness(() =>
      proposed(proposalOf('kitchen.lines.markReady', 0.5), proposalOf('orders.create', 0.9)),
    );
    expect(await clear.run({ input: utterance('quiero algo'), principal: waiter })).toMatchObject({
      ok: true,
      value: { draft: { capabilityId: 'orders.create' } },
    });
  });

  test('a continuation outside the view is unsupported and a stale version is STALE_PLAN', async () => {
    const { interpreter, run } = harness(unsupportedScript);
    const foreign = await run({ ...continuation('cash.shift.close', 1), principal: waiter });
    expect(foreign).toMatchObject({ ok: true, value: { status: 'unsupported' } });
    const missing = await run({ ...continuation('nope.nothing', 1), principal: waiter });
    expect(missing).toEqual(foreign);
    const stale = await run({ ...continuation('orders.create', 2), principal: waiter });
    expect(stale).toEqual({
      ok: false,
      failure: { stage: 'interpretation', code: 'STALE_PLAN', retryable: false },
    });
    const valid = await run({ ...continuation('orders.create', 1), principal: waiter });
    expect(valid).toMatchObject({ ok: true, value: { draft: { capabilityId: 'orders.create' } } });
    expect(interpreter.calls()).toHaveLength(0);
  });

  test('restrictTo limits what the interpreter sees', async () => {
    const { interpreter, run } = harness(unsupportedScript);
    await run({
      input: utterance('la milanesa ya salio', 'kitchen.lines.markReady'),
      principal: waiter,
    });
    expect(interpreter.calls()[0]?.catalog.map((entry) => entry.id)).toEqual([
      'kitchen.lines.markReady',
    ]);
  });

  test('same-capability proposals that disagree on a slot drop that slot instead of guessing', async () => {
    const { run } = harness(() =>
      proposed(
        { capabilityId: 'orders.create', slots: { dish: 'arroz', table: '3' }, confidence: 0.7 },
        { capabilityId: 'orders.create', slots: { dish: 'arroz', table: '8' }, confidence: 0.65 },
      ),
    );
    const outcome = await run({ input: utterance('quiero algo'), principal: waiter });
    expect(outcome).toMatchObject({ ok: true, value: { status: 'incomplete' } });
    expect(outcome).toMatchObject({
      value: { draft: { capabilityId: 'orders.create', input: { dishId: 'arroz' } } },
    });
    expect(JSON.stringify(outcome)).not.toContain('tableId');
  });

  test('a close runner-up of another capability stays ambiguous', async () => {
    const { run } = harness(() =>
      proposed(
        proposalOf('orders.create', 0.9),
        proposalOf('orders.create', 0.85),
        proposalOf('kitchen.lines.markReady', 0.8),
      ),
    );
    const outcome = await run({ input: utterance('quiero algo'), principal: waiter });
    expect(outcome).toMatchObject({ ok: true, value: { status: 'ambiguous' } });
  });

  test('interpreter slots reach the draft as text, an id-shaped value stays text and unknown keys are dropped', async () => {
    const uuid = '9b2f4c1e-8a7d-4b3a-9c1e-2d5f6a7b8c9d';
    const { run } = harness(() =>
      proposed({
        capabilityId: 'orders.create',
        slots: { table: uuid, dish: 'arroz con pollo', bogus: 'x' },
        confidence: 0.9,
      }),
    );
    const outcome = await run({ input: utterance('quiero algo'), principal: waiter });
    expect(outcome).toMatchObject({
      ok: true,
      value: { draft: { input: { tableId: uuid, dishId: 'arroz con pollo' } } },
    });
    expect(JSON.stringify(outcome)).not.toContain('bogus');
  });

  test('an empty view settles unsupported without calling the interpreter', async () => {
    const { interpreter, run } = harness(unsupportedScript);
    const outcome = await run({
      input: utterance('cierra la caja', 'cash.shift.close'),
      principal: waiter,
    });
    expect(outcome).toMatchObject({ ok: true, value: { status: 'unsupported' } });
    expect(interpreter.calls()).toHaveLength(0);
  });

  test('a caller abort during interpretation settles ABORTED, not INTERPRETER_UNAVAILABLE', async () => {
    const { clock, run } = harness(() => proposed(proposalOf('orders.create', 0.9)), {
      delayMs: 3000,
    });
    const controller = new AbortController();
    const pending = run({ input: utterance('quiero algo'), principal: waiter }, controller.signal);
    await clock.advance(100);
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, failure: { code: 'ABORTED' } });
  });
});
