import {
  createCapabilityDefiner,
  createManualClock,
  createPipelineBuilder,
} from '@jcsoftdev/intent-core';
import type { Interpretation, InterpretationInput, Outcome } from '@jcsoftdev/intent-core';
import { createZodSchemaAdapter } from '@jcsoftdev/intent-zod';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createServerCatalog } from '../catalog/server-catalog.js';
import type { InterpretationState } from '../state.js';
import { createNormalizer, numberWordsOf } from '../text/normalize.js';
import { createCatalogStage } from './catalog-stage.js';
import { createDeterministicStage } from './deterministic-stage.js';
import { createNormalizeStage } from './normalize-stage.js';

type Role = 'waiter';

interface Principal {
  readonly active: string;
  readonly granted: readonly string[];
}

const define = createCapabilityDefiner<Role, 'orders'>();
const base = {
  version: 1,
  kind: 'write',
  agent: 'allowed',
  aliases: [],
  examples: [],
  scope: 'global',
  risk: 'write',
  confirmation: 'never',
  reversibility: { kind: 'none' },
  idempotency: { kind: 'none' },
  roles: ['waiter'],
} as const;

const addToTable = define({
  ...base,
  id: 'orders.addToTable',
  description: 'Add a dish to a table',
  patterns: ['mesa {table}, {quantity?} {dish}'],
  input: z.object({ tableId: z.uuid(), dishId: z.uuid(), quantity: z.number().int().optional() }),
  entities: [
    { path: 'tableId', entity: 'table' },
    { path: 'dishId', entity: 'dish' },
  ],
});

const rivalAddToTable = define({
  ...base,
  id: 'orders.rivalAddToTable',
  description: 'Another way to add a dish to a table',
  patterns: ['mesa {table} {quantity?} {dish}'],
  input: z.object({ tableId: z.uuid(), dishId: z.uuid(), quantity: z.number().int().optional() }),
  entities: [
    { path: 'tableId', entity: 'table' },
    { path: 'dishId', entity: 'dish' },
  ],
});

const normalize = createNormalizer();
const waiter: Principal = { active: 'waiter', granted: ['waiter'] };

const interpret = async (
  descriptors: Parameters<typeof createServerCatalog>[0]['capabilities'],
  text: string,
): Promise<Outcome<Interpretation>> => {
  const catalog = createServerCatalog({
    capabilities: descriptors,
    schema: createZodSchemaAdapter(),
    resolverEntities: ['table', 'dish'],
    normalize,
    numberWords: numberWordsOf(),
  });
  const pipeline = createPipelineBuilder<InterpretationState<Principal>, Interpretation>({
    name: 'interpretation',
    seeds: ['input', 'principal', 'draft', 'answers', 'origin'],
    clock: createManualClock(),
    terminal: {
      requires: ['proposal'],
      settle: async (context) => {
        const proposal = context.get('proposal');
        return {
          ok: true,
          value: {
            status: 'incomplete',
            draft: { capabilityId: proposal.capabilityId, version: 1, input: proposal.slots },
            missing: [],
          },
        };
      },
    },
  })
    .use(createNormalizeStage(normalize))
    .use(createCatalogStage(catalog, (principal: Principal) => principal))
    .use(createDeterministicStage())
    .build();
  const input: InterpretationInput = {
    kind: 'utterance',
    text,
    locale: 'es-PE',
    source: 'voice',
    context: {},
  };
  return pipeline.run({ input, principal: waiter }, { signal: new AbortController().signal });
};

const slotsOf = (outcome: Outcome<Interpretation>): unknown =>
  outcome.ok && outcome.value.status === 'incomplete' ? outcome.value.draft.input : outcome;

describe('a staff utterance with a table, a quantity and a dish', () => {
  test.each([
    ['mesa 4, dos lomos', { table: '4', quantity: '2', dish: 'lomos' }],
    ['mesa 4 dos lomos saltados', { table: '4', quantity: '2', dish: 'lomos saltados' }],
    ['Mesa 4, 3 anticuchos', { table: '4', quantity: '3', dish: 'anticuchos' }],
    ['mesa 4, lomo saltado', { table: '4', dish: 'lomo saltado' }],
    ['mesa 4 lomo saltado', { table: '4', dish: 'lomo saltado' }],
  ])('%j matches deterministically', async (text, slots) => {
    const outcome = await interpret([addToTable], text);
    expect(slotsOf(outcome)).toEqual(slots);
  });

  test('two capabilities that both match stay ambiguous', async () => {
    const outcome = await interpret([addToTable, rivalAddToTable], 'mesa 4, dos lomos');
    expect(outcome).toMatchObject({ ok: true, value: { status: 'ambiguous' } });
  });
});
