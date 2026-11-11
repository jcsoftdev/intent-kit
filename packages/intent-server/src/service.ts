import {
  createPipelineBuilder,
  createRoleAuthorizer,
  noopEventBus,
  randomIdSource,
  systemClock,
} from '@jcsoftdev/intent-core';
import type {
  AnyDescriptor,
  Authorizer,
  Clock,
  EventBus,
  IdSource,
  IntentEvent,
  Interpretation,
  InterpretationInput,
  Interpreter,
  Outcome,
  PipelineBuilder,
  PrincipalRoles,
  RequirementProbe,
  SchemaAdapter,
  StageName,
  EntityResolver,
} from '@jcsoftdev/intent-core';
import { createServerCatalog } from './catalog/server-catalog.js';
import { defaultInterpretationCopy } from './copy.js';
import type { InterpretationCopy } from './copy.js';
import { createAuthorizeStage } from './stages/authorize-stage.js';
import { createCatalogStage } from './stages/catalog-stage.js';
import { createDeterministicStage } from './stages/deterministic-stage.js';
import { createDraftStage } from './stages/draft-stage.js';
import { createEntitiesStage } from './stages/entities-stage.js';
import { createInterpretStage } from './stages/interpret-stage.js';
import { createNormalizeStage } from './stages/normalize-stage.js';
import { createPlanTerminal } from './stages/plan-terminal.js';
import { createRequirementsStage } from './stages/requirements-stage.js';
import { createValidateStage } from './stages/validate-stage.js';
import type { InterpretationState } from './state.js';
import { createNormalizer } from './text/normalize.js';
import type { NormalizationRules } from './text/normalize.js';

export interface InterpretationBudgets {
  readonly interpretMs: number;
  readonly entitiesMs: number;
  readonly requirementsMs: number;
}

export const DEFAULT_INTERPRETATION_BUDGETS: InterpretationBudgets = {
  interpretMs: 4_000,
  entitiesMs: 400,
  requirementsMs: 200,
};

export interface InterpretationServiceConfig<TPrincipal, TRole extends string> {
  readonly capabilities: readonly AnyDescriptor[];
  readonly schema: SchemaAdapter;
  readonly rolesOf: (principal: TPrincipal) => PrincipalRoles<TRole>;
  readonly resolvers: readonly EntityResolver<TPrincipal>[];
  readonly probes?: readonly RequirementProbe<TPrincipal>[];
  readonly interpreter?: Interpreter;
  readonly authorizer?: Authorizer<TPrincipal>;
  readonly copy?: InterpretationCopy;
  readonly normalization?: NormalizationRules;
  readonly clock?: Clock;
  readonly ids?: IdSource;
  readonly events?: EventBus<IntentEvent>;
  readonly budgets?: Partial<InterpretationBudgets>;
  readonly customize?: (
    builder: PipelineBuilder<InterpretationState<TPrincipal>, Interpretation>,
  ) => PipelineBuilder<InterpretationState<TPrincipal>, Interpretation>;
}

export interface InterpretationService<TPrincipal> {
  readonly stages: readonly StageName[];
  interpret(
    principal: TPrincipal,
    input: InterpretationInput,
    options: { signal: AbortSignal },
  ): Promise<Outcome<Interpretation>>;
}

const PIPELINE_NAME = 'interpretation';

const settledEvent = (outcome: Outcome<Interpretation>): IntentEvent => {
  if (!outcome.ok) {
    return {
      type: 'interpretation.settled',
      status: 'failed',
      code: outcome.failure.code,
    };
  }
  const { value } = outcome;
  const capabilityId = 'draft' in value && value.draft ? value.draft.capabilityId : undefined;
  return {
    type: 'interpretation.settled',
    status: value.status,
    ...(capabilityId === undefined ? {} : { capabilityId }),
    ...(value.status === 'complete' ? { origin: value.source, planId: value.planId } : {}),
  };
};

const seedFor = <TPrincipal>(
  principal: TPrincipal,
  input: InterpretationInput,
): Partial<InterpretationState<TPrincipal>> =>
  input.kind === 'continuation'
    ? {
        input,
        principal,
        draft: input.continuation.draft,
        answers: input.continuation.answers,
        origin: input.origin,
      }
    : { input, principal };

const byEntity = <TItem extends { readonly entity: string }>(
  items: readonly TItem[],
): ReadonlyMap<string, TItem> => new Map(items.map((item) => [item.entity, item]));

export function createInterpretationService<TPrincipal, TRole extends string>(
  config: InterpretationServiceConfig<TPrincipal, TRole>,
): InterpretationService<TPrincipal> {
  const copy = config.copy ?? defaultInterpretationCopy;
  const budgets = { ...DEFAULT_INTERPRETATION_BUDGETS, ...config.budgets };
  const events = config.events ?? noopEventBus;
  const normalize = createNormalizer(config.normalization);
  const resolvers = byEntity(config.resolvers);
  const probes = new Map((config.probes ?? []).map((probe) => [probe.capabilityId, probe]));
  const catalog = createServerCatalog({
    capabilities: config.capabilities,
    schema: config.schema,
    resolverEntities: config.resolvers.map(({ entity }) => entity),
    normalize,
  });
  const base = createPipelineBuilder<InterpretationState<TPrincipal>, Interpretation>({
    name: PIPELINE_NAME,
    seeds: ['input', 'principal', 'draft', 'answers', 'origin'],
    clock: config.clock ?? systemClock,
    events,
    terminal: createPlanTerminal({ ids: config.ids ?? randomIdSource, copy }),
  })
    .use(createNormalizeStage(normalize))
    .use(createCatalogStage(catalog, config.rolesOf))
    .use(createDeterministicStage())
    .use(
      createInterpretStage({
        ...(config.interpreter ? { interpreter: config.interpreter } : {}),
        copy,
        budgetMs: budgets.interpretMs,
      }),
    )
    .use(createDraftStage(copy))
    .use(createEntitiesStage({ resolvers, budgetMs: budgets.entitiesMs }))
    .use(createRequirementsStage({ probes, budgetMs: budgets.requirementsMs }))
    .use(createValidateStage({ schema: config.schema, resolvers, copy }))
    .use(createAuthorizeStage(config.authorizer ?? createRoleAuthorizer(config.rolesOf)));
  const pipeline = (config.customize ? config.customize(base) : base).build();
  return {
    stages: pipeline.stages,
    async interpret(principal, input, options) {
      const outcome = await pipeline.run(seedFor(principal, input), options);
      events.emit(settledEvent(outcome));
      return outcome;
    },
  };
}
