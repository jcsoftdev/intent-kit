import { createActionPipeline } from '../action/index.js';
import type { ActionPipelineConfig } from '../action/index.js';
import type {
  ActionLifecycle,
  ActionResult,
  CapabilityRegistry,
  ExecutablePlan,
  FailureMessages,
  InterpretationClient,
  Outcome,
  UndoRegistry,
} from '../contracts/index.js';
import { createUndoRegistry } from '../policy/index.js';
import { DEFAULT_ACTION_BUDGETS } from '../action/index.js';
import { noopEventBus, systemClock } from '../primitives/index.js';
import { createIntentSession } from './session.js';
import type { FailureMessageResolver, IntentSession } from './session.js';

export interface IntentKitConfig<
  TPrincipal,
  TRole extends string,
  TRouteId extends string,
  TElement,
> extends ActionPipelineConfig<TPrincipal, TRole, TRouteId, TElement> {
  readonly interpretation: InterpretationClient;
  readonly principal: () => TPrincipal;
  readonly activeRole: () => TRole;
  readonly locale: string;
  readonly failureMessages: FailureMessages;
  readonly failureMessage?: FailureMessageResolver;
}

export interface IntentKit {
  readonly registry: CapabilityRegistry;
  readonly undo: UndoRegistry;
  createSession(): IntentSession;
  dispatch(plan: ExecutablePlan, options: { signal: AbortSignal }): Promise<Outcome<ActionResult>>;
}

const detachedLifecycle = (signal: AbortSignal): ActionLifecycle => ({
  confirming: () => undefined,
  executing: () => undefined,
  graceFlush: () => new AbortController().signal,
  sending: () => undefined,
  presenting: () => signal,
});

export function createIntentKit<
  TPrincipal,
  TRole extends string,
  TRouteId extends string,
  TElement,
>(config: IntentKitConfig<TPrincipal, TRole, TRouteId, TElement>): IntentKit {
  const undo =
    config.undo ??
    createUndoRegistry({
      ...(config.clock ? { clock: config.clock } : {}),
      ...(config.events ? { events: config.events } : {}),
    });
  const pipeline = createActionPipeline({ ...config, undo });
  return {
    registry: config.registry,
    undo,
    createSession: () =>
      createIntentSession({
        interpretation: config.interpretation,
        pipeline,
        undo,
        announcer: config.announcer,
        events: config.events ?? noopEventBus,
        clock: config.clock ?? systemClock,
        undoMs:
          config.budgets?.undoMs ?? config.budgets?.executeMs ?? DEFAULT_ACTION_BUDGETS.undoMs,
        principal: config.principal,
        activeRole: config.activeRole,
        locale: config.locale,
        failureMessages: config.failureMessages,
        failureMessage: config.failureMessage,
      }),
    dispatch: (plan, { signal }) =>
      pipeline.run(
        {
          plan,
          principal: config.principal(),
          role: config.activeRole(),
          lifecycle: detachedLifecycle(signal),
        },
        { signal },
      ),
  };
}
