import { IntentDefinitionError } from '../contracts/index.js';
import type {
  Clock,
  EventBus,
  IntentEvent,
  Pipeline,
  PipelineBuilder,
  Stage,
  StageName,
  Terminal,
} from '../contracts/index.js';
import { noopEventBus, systemClock } from '../primitives/index.js';
import { runPipeline } from './run.js';

export interface PipelineConfig<TState, TResult> {
  readonly name: string;
  readonly seeds: readonly (keyof TState)[];
  readonly terminal: Terminal<TState, TResult>;
  readonly clock?: Clock;
  readonly events?: EventBus<IntentEvent>;
}

type Operation<TState, TResult> =
  | { readonly kind: 'use'; readonly stage: Stage<TState, TResult> }
  | {
      readonly kind: 'insertAfter' | 'replace';
      readonly anchor: StageName;
      readonly stage: Stage<TState, TResult>;
    };

const indexOfStage = <TState, TResult>(
  stages: readonly Stage<TState, TResult>[],
  anchor: StageName,
): number => {
  const position = stages.findIndex((stage) => stage.name === anchor);
  if (position === -1) {
    throw new IntentDefinitionError('UNKNOWN_ANCHOR', anchor);
  }
  return position;
};

const applyOperation = <TState, TResult>(
  stages: readonly Stage<TState, TResult>[],
  operation: Operation<TState, TResult>,
): readonly Stage<TState, TResult>[] => {
  if (operation.kind === 'use') {
    return [...stages, operation.stage];
  }
  const position = indexOfStage(stages, operation.anchor);
  return operation.kind === 'insertAfter'
    ? [...stages.slice(0, position + 1), operation.stage, ...stages.slice(position + 1)]
    : [...stages.slice(0, position), operation.stage, ...stages.slice(position + 1)];
};

const assertUniqueNames = <TState, TResult>(stages: readonly Stage<TState, TResult>[]): void => {
  const seen = new Set<string>();
  for (const stage of stages) {
    if (seen.has(stage.name)) {
      throw new IntentDefinitionError('DUPLICATE_STAGE', stage.name);
    }
    seen.add(stage.name);
  }
};

const assertRequirements = <TState, TResult>(
  stages: readonly Stage<TState, TResult>[],
  config: PipelineConfig<TState, TResult>,
): void => {
  const available = new Set<keyof TState>(config.seeds);
  const check = (owner: string, requires: readonly (keyof TState)[]): void => {
    for (const key of requires) {
      if (!available.has(key)) {
        throw new IntentDefinitionError('MISSING_REQUIREMENT', `${owner}:${String(key)}`);
      }
    }
  };
  for (const stage of stages) {
    check(stage.name, stage.requires);
    for (const key of stage.provides) {
      available.add(key);
    }
  }
  check('terminal', config.terminal.requires);
};

const createBuilder = <TState, TResult>(
  config: PipelineConfig<TState, TResult>,
  operations: readonly Operation<TState, TResult>[],
): PipelineBuilder<TState, TResult> => {
  const extend = (operation: Operation<TState, TResult>): PipelineBuilder<TState, TResult> =>
    createBuilder(config, [...operations, operation]);
  return {
    use: (stage) => extend({ kind: 'use', stage }),
    insertAfter: (anchor, stage) => extend({ kind: 'insertAfter', anchor, stage }),
    replace: (anchor, stage) => extend({ kind: 'replace', anchor, stage }),
    build(): Pipeline<TState, TResult> {
      const stages = operations.reduce<readonly Stage<TState, TResult>[]>(applyOperation, []);
      assertUniqueNames(stages);
      assertRequirements(stages, config);
      const clock = config.clock ?? systemClock;
      const events = config.events ?? noopEventBus;
      return {
        stages: stages.map((stage) => stage.name),
        run: (seed, options) =>
          runPipeline(
            { name: config.name, stages, terminal: config.terminal, clock, events },
            seed,
            options.signal,
          ),
      };
    },
  };
};

export const createPipelineBuilder = <TState, TResult>(
  config: PipelineConfig<TState, TResult>,
): PipelineBuilder<TState, TResult> => createBuilder(config, []);
