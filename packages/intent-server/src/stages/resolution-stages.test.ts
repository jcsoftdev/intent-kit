import { createCapabilityDefiner, createPipelineBuilder } from '@jcsoftdev/intent-core';
import type {
  Answers,
  Draft,
  EntityResolver,
  FailureCode,
  FailureStage,
  Interpretation,
  Outcome,
  RequirementProbe,
} from '@jcsoftdev/intent-core';
import { createInMemoryEntityResolver } from '@jcsoftdev/intent-testing';
import { createZodSchemaAdapter } from '@jcsoftdev/intent-zod';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createServerCatalog } from '../catalog/server-catalog.js';
import type { ServerCatalogView } from '../catalog/server-catalog.js';
import { defaultInterpretationCopy } from '../copy.js';
import type { InterpretationState } from '../state.js';
import { createNormalizer } from '../text/normalize.js';
import { createEntitiesStage } from './entities-stage.js';
import { createRequirementsStage } from './requirements-stage.js';
import { createValidateStage } from './validate-stage.js';

interface Principal {
  readonly active: string;
  readonly granted: readonly string[];
}

type State = InterpretationState<Principal>;

const define = createCapabilityDefiner<string, 'orders'>();
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
  roles: ['waiter'],
} as const;

const ordersCreate = define({
  ...base,
  id: 'orders.create',
  description: 'Create an order',
  input: z.object({
    tableId: z.string(),
    lines: z.array(z.object({ offeringId: z.string(), modifiers: z.array(z.string()).optional() })),
    note: z.string().optional(),
  }),
  entities: [
    { path: 'tableId', entity: 'table' },
    { path: 'lines[].offeringId', entity: 'dish' },
  ],
});

const secret = define({
  ...base,
  id: 'audit.export',
  agent: 'never',
  description: 'Export the audit',
  input: z.object({ tableId: z.string() }),
  entities: [{ path: 'tableId', entity: 'table' }],
});

const schema = createZodSchemaAdapter();
const catalog = createServerCatalog({
  capabilities: [ordersCreate, secret],
  schema,
  resolverEntities: ['table', 'dish'],
  normalize: createNormalizer(),
});
const view = catalog.viewFor('waiter');
const emptyView: ServerCatalogView = { entries: [], get: () => undefined };

const waiter: Principal = { active: 'waiter', granted: ['waiter'] };
const signal = new AbortController().signal;

const resolverOf = (
  entity: string,
  records: readonly { id: string; label: string }[],
  spy: string[] = [],
): EntityResolver<Principal> => {
  const inner = createInMemoryEntityResolver<Principal>({
    entity,
    records: () => records,
    options: () => records,
  });
  return {
    entity,
    resolve: (principal, query, options) => {
      spy.push(`${entity}:${query.text}:${JSON.stringify(query.hints)}`);
      return inner.resolve(principal, query, options);
    },
    options: inner.options,
  };
};

const resolvers = (spy: string[] = []) =>
  new Map<string, EntityResolver<Principal>>([
    ['table', resolverOf('table', [{ id: 'tbl-3', label: 'Mesa 3' }], spy)],
    ['dish', resolverOf('dish', [{ id: 'dish-1', label: 'Arroz con pollo' }], spy)],
  ]);

const seed = (
  input: unknown,
  answers: Answers = {},
  catalogView: ServerCatalogView = view,
  capabilityId = 'orders.create',
): Partial<State> => {
  const draft: Draft = { capabilityId, version: 1, input };
  return { principal: waiter, catalog: catalogView, draft, answers, origin: 'deterministic' };
};

const pipelineOf = (
  stages: (builder: ReturnType<typeof builderOf>) => ReturnType<typeof builderOf>,
) => stages(builderOf()).build();

const builderOf = () =>
  createPipelineBuilder<State, Interpretation>({
    name: 'resolution',
    seeds: ['principal', 'catalog', 'draft', 'answers', 'origin', 'resolvedInput'],
    terminal: {
      requires: ['resolvedInput'],
      settle: async (context) => ({
        ok: true,
        value: {
          status: 'incomplete',
          draft: {
            capabilityId: 'x',
            version: 1,
            input: context.find('validInput') ?? context.get('resolvedInput'),
          },
          missing: [],
        },
      }),
    },
  });

const run = (
  stages: (builder: ReturnType<typeof builderOf>) => ReturnType<typeof builderOf>,
  state: Partial<State>,
): Promise<Outcome<Interpretation>> => pipelineOf(stages).run(state, { signal });

const failure = (stage: FailureStage, code: FailureCode): Outcome<Interpretation> => ({
  ok: false,
  failure: { stage, code, retryable: false },
});

describe('resolution stages', () => {
  test('entities hints carry the resolved top-level entity to every indexed entity', async () => {
    const spy: string[] = [];
    const outcome = await run(
      (builder) => builder.use(createEntitiesStage({ resolvers: resolvers(spy), budgetMs: 400 })),
      seed({ tableId: 'mesa 3', lines: [{ offeringId: 'arroz con pollo' }] }),
    );
    expect(spy).toEqual(['table:mesa 3:{}', 'dish:arroz con pollo:{"table":"tbl-3"}']);
    expect(outcome).toMatchObject({
      ok: true,
      value: { draft: { input: { tableId: 'tbl-3', lines: [{ offeringId: 'dish-1' }] } } },
    });
  });

  test('entities never replace the draft texts with ids', async () => {
    const draftInput = { tableId: 'mesa 3', lines: [{ offeringId: 'arroz con pollo' }] };
    const state = seed(draftInput);
    await run(
      (builder) => builder.use(createEntitiesStage({ resolvers: resolvers(), budgetMs: 400 })),
      state,
    );
    expect(state.draft?.input).toEqual({
      tableId: 'mesa 3',
      lines: [{ offeringId: 'arroz con pollo' }],
    });
  });

  test('an entity capability with agent "never" is never resolved and the stage refuses it', async () => {
    const spy: string[] = [];
    const outcome = await run(
      (builder) => builder.use(createEntitiesStage({ resolvers: resolvers(spy), budgetMs: 400 })),
      seed({ tableId: 'mesa 3' }, {}, view, 'audit.export'),
    );
    expect(outcome).toEqual(failure('policy', 'CAPABILITY_NOT_FOUND'));
    expect(spy).toEqual([]);
  });

  test('entities with no resolver registered for a declared entity fail non-retryably', async () => {
    const outcome = await run(
      (builder) => builder.use(createEntitiesStage({ resolvers: new Map(), budgetMs: 400 })),
      seed({ tableId: 'mesa 3', lines: [] }),
    );
    expect(outcome).toEqual({
      ok: false,
      failure: { stage: 'resolution', code: 'RESOLUTION_UNAVAILABLE', retryable: false },
    });
  });

  test('a malformed or wildcard answer path is INVALID_INPUT, never an exception', async () => {
    for (const path of ['__proto__', 'lines[]', 'a..b']) {
      const outcome = await run(
        (builder) => builder.use(createEntitiesStage({ resolvers: resolvers(), budgetMs: 400 })),
        seed({ tableId: 'mesa 3', lines: [] }, { [path]: 'x' }),
      );
      expect(outcome).toEqual(failure('resolution', 'INVALID_INPUT'));
    }
  });

  test('an answer that is not a string for an entity path is INVALID_INPUT', async () => {
    const outcome = await run(
      (builder) => builder.use(createEntitiesStage({ resolvers: resolvers(), budgetMs: 400 })),
      seed({ tableId: 'mesa 3', lines: [] }, { tableId: ['tbl-3'] }),
    );
    expect(outcome).toEqual(failure('resolution', 'INVALID_INPUT'));
  });

  test('requirements without a probe pass through; selections outside [min, max] are INVALID_INPUT', async () => {
    const probe: RequirementProbe<Principal> = {
      capabilityId: 'orders.create',
      probe: async () => [
        {
          path: 'lines[0].modifiers',
          reason: 'requirement',
          prompt: 'Guarnición',
          min: 1,
          max: 1,
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        },
      ],
    };
    const stages = (builder: ReturnType<typeof builderOf>) =>
      builder.use(createEntitiesStage({ resolvers: resolvers(), budgetMs: 400 })).use(
        createRequirementsStage({
          probes: new Map([[probe.capabilityId, probe]]),
          budgetMs: 200,
        }),
      );
    const input = { tableId: 'mesa 3', lines: [{ offeringId: 'arroz con pollo' }] };
    const tooMany = await run(stages, seed(input, { 'lines[0].modifiers': ['a', 'b'] }));
    expect(tooMany).toEqual(failure('resolution', 'INVALID_INPUT'));
    const none = await run(stages, seed(input, { 'lines[0].modifiers': [] }));
    expect(none).toEqual(failure('resolution', 'INVALID_INPUT'));
    const asked = await run(stages, seed(input));
    expect(asked).toMatchObject({
      ok: true,
      value: { status: 'incomplete', missing: [{ path: 'lines[0].modifiers' }] },
    });
    const withoutProbe = await run(
      (builder) =>
        builder
          .use(createEntitiesStage({ resolvers: resolvers(), budgetMs: 400 }))
          .use(createRequirementsStage({ probes: new Map(), budgetMs: 200 })),
      seed(input),
    );
    expect(withoutProbe).toMatchObject({ ok: true, value: { status: 'incomplete', missing: [] } });
  });

  test('answer for "lines[0].offeringId" consumed by validate is rejected because it overlaps an entity path', async () => {
    const outcome = await run(
      (builder) =>
        builder.use(
          createValidateStage({
            schema,
            resolvers: resolvers(),
            copy: defaultInterpretationCopy,
          }),
        ),
      {
        ...seed({}, { 'lines[0].offeringId': 'dish-1' }),
        resolvedInput: { tableId: 'tbl-3', lines: [] },
      },
    );
    expect(outcome).toEqual(failure('resolution', 'INVALID_INPUT'));
  });

  test('validate rejects an answer for a path that was not asked', async () => {
    const stage = createValidateStage({
      schema,
      resolvers: resolvers(),
      copy: defaultInterpretationCopy,
    });
    const outcome = await pipelineOf((builder) => builder.use(stage)).run(
      {
        ...seed({}, { note: 'sin ají' }),
        resolvedInput: { tableId: 'tbl-3', lines: [] },
      },
      { signal },
    );
    expect(outcome).toEqual(failure('resolution', 'INVALID_INPUT'));
  });

  test('validate refuses a capability missing from the catalog view', async () => {
    const outcome = await run(
      (builder) =>
        builder.use(
          createValidateStage({ schema, resolvers: resolvers(), copy: defaultInterpretationCopy }),
        ),
      { ...seed({}, {}, emptyView), resolvedInput: {} },
    );
    expect(outcome).toEqual(failure('policy', 'CAPABILITY_NOT_FOUND'));
  });
});
