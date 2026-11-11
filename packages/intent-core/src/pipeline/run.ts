import { IntentFailureError } from '../contracts/index.js';
import { IntentDefinitionError } from '../contracts/index.js';
import type {
  Clock,
  EventBus,
  Failure,
  IntentEvent,
  Outcome,
  Stage,
  Terminal,
} from '../contracts/index.js';
import { abortFailure } from '../primitives/index.js';
import { createStageContext } from './stage-context.js';

export interface PipelineDefinition<TState, TResult> {
  readonly name: string;
  readonly stages: readonly Stage<TState, TResult>[];
  readonly terminal: Terminal<TState, TResult>;
  readonly clock: Clock;
  readonly events: EventBus<IntentEvent>;
}

const fail = <T>(failure: Failure): Outcome<T> => ({ ok: false, failure });

const settleTerminal = async <TState, TResult>(
  definition: PipelineDefinition<TState, TResult>,
  values: Map<keyof TState, unknown>,
  root: AbortSignal,
): Promise<Outcome<TResult>> => {
  const context = createStageContext<TState>(values, root, 'terminal', []);
  try {
    return await definition.terminal.settle(context);
  } catch (error) {
    if (error instanceof IntentFailureError) {
      return fail(error.failure);
    }
    throw error;
  }
};

interface Gate<TResult> {
  readonly interrupted: Promise<Outcome<TResult>>;
  readonly dispose: () => void;
}

const openGate = <TResult>(
  signals: readonly { readonly signal: AbortSignal; readonly outcome: () => Outcome<TResult> }[],
): Gate<TResult> => {
  const cleanups: (() => void)[] = [];
  const interrupted = new Promise<Outcome<TResult>>((resolve) => {
    for (const { signal, outcome } of signals) {
      const onAbort = (): void => resolve(outcome());
      if (signal.aborted) {
        onAbort();
        continue;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      cleanups.push(() => signal.removeEventListener('abort', onAbort));
    }
  });
  const dispose = (): void => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
  return { interrupted, dispose };
};

const runStage = async <TState, TResult>(
  definition: PipelineDefinition<TState, TResult>,
  values: Map<keyof TState, unknown>,
  root: AbortSignal,
  position: number,
): Promise<Outcome<TResult>> => {
  const stage = definition.stages[position];
  if (!stage) {
    return settleTerminal(definition, values, root);
  }
  if (root.aborted) {
    return fail(abortFailure(stage.phase));
  }
  const { clock } = definition;
  const started = clock.now();
  const budgetSignal = stage.budget ? clock.timeout(stage.budget.timeoutMs) : undefined;
  const signal = budgetSignal ? AbortSignal.any([root, budgetSignal]) : root;
  const context = createStageContext<TState>(values, signal, stage.name, stage.provides);
  let nextCalled = false;
  let timedOut = false;
  const timeoutOutcome = (): Outcome<TResult> => {
    timedOut = true;
    return fail(stage.budget?.onTimeout ?? abortFailure(stage.phase));
  };
  const gate = openGate<TResult>([
    { signal: root, outcome: () => fail(abortFailure(stage.phase)) },
    ...(budgetSignal ? [{ signal: budgetSignal, outcome: timeoutOutcome }] : []),
  ]);
  const downstream = async (): Promise<Outcome<TResult>> => {
    if (nextCalled) {
      throw new IntentDefinitionError('NEXT_CALLED_TWICE', stage.name);
    }
    nextCalled = true;
    if (timedOut) {
      return fail(stage.budget?.onTimeout ?? abortFailure(stage.phase));
    }
    if (root.aborted) {
      return fail(abortFailure(stage.phase));
    }
    return runStage(definition, values, root, position + 1);
  };
  const guarded = new Promise<Outcome<TResult>>((resolve, reject) => {
    const own = stage.run(context, downstream);
    own.then(resolve, reject);
    void gate.interrupted.then((outcome) => {
      if (!nextCalled) {
        resolve(outcome);
      }
    });
  });
  let outcome: Outcome<TResult>;
  try {
    outcome = await guarded;
  } catch (error) {
    if (error instanceof IntentFailureError) {
      outcome = fail(error.failure);
    } else if (root.aborted && !(error instanceof IntentDefinitionError)) {
      outcome = fail(abortFailure(stage.phase));
    } else {
      throw error;
    }
  } finally {
    gate.dispose();
  }
  definition.events.emit({
    type: 'stage.completed',
    pipeline: definition.name,
    stage: stage.name,
    durationMs: clock.now() - started,
    ok: outcome.ok,
    ...(outcome.ok ? {} : { code: outcome.failure.code }),
  });
  return outcome;
};

export const runPipeline = <TState, TResult>(
  definition: PipelineDefinition<TState, TResult>,
  seed: Partial<TState>,
  root: AbortSignal,
): Promise<Outcome<TResult>> => {
  const values = new Map<keyof TState, unknown>(
    Object.entries(seed).filter(([, value]) => value !== undefined) as [keyof TState, unknown][],
  );
  return runStage(definition, values, root, 0);
};
