import { IntentFailureError, stageName } from '../contracts/index.js';
import type {
  ActionResult,
  AnyDescriptor,
  Authorizer,
  Clock,
  Effect,
  EffectResult,
  ExecutablePlan,
  Failure,
  Outcome,
  UndoRegistry,
} from '../contracts/index.js';
import type { ActionStage } from './action-pipeline.js';

export const EXECUTE_STAGE = stageName('execute');

export interface ExecuteDependencies<TPrincipal> {
  readonly authorizer: Authorizer<TPrincipal>;
  readonly clock: Clock;
  readonly executeMs: number;
  readonly undo?: UndoRegistry;
}

const budgetExpired: EffectResult<unknown> = {
  ok: false,
  failure: { stage: 'execution', code: 'ABORTED', retryable: true },
};

const stalePlan: Failure = { stage: 'execution', code: 'STALE_PLAN', retryable: false };

const executionFailure = (retryable: boolean): Failure => ({
  stage: 'execution',
  code: 'EXECUTION_FAILED',
  retryable,
});

const isRetryable = (descriptor: AnyDescriptor): boolean => descriptor.idempotency.kind !== 'none';

const raceBudget = (
  work: Promise<EffectResult<unknown>>,
  budget: AbortSignal,
): Promise<EffectResult<unknown>> =>
  new Promise((resolve, reject) => {
    const expire = (): void => resolve(budgetExpired);
    if (budget.aborted) {
      expire();
      return;
    }
    budget.addEventListener('abort', expire, { once: true });
    work.then(resolve, reject).finally(() => budget.removeEventListener('abort', expire));
  });

type GraceOutcome = 'elapsed' | 'undone';

const waitForGrace = async (
  dependencies: Pick<ExecuteDependencies<unknown>, 'clock' | 'undo'>,
  plan: ExecutablePlan,
  descriptor: AnyDescriptor,
  signal: AbortSignal,
): Promise<GraceOutcome> => {
  const { reversibility } = descriptor;
  if (reversibility.kind !== 'grace') {
    return 'elapsed';
  }
  const cancel = new AbortController();
  let elapsed = false;
  const unregister = dependencies.undo?.offer({
    planId: plan.planId,
    capabilityId: descriptor.id,
    kind: 'grace',
    expiresAt: dependencies.clock.now() + reversibility.delayMs,
    undo: async () => {
      if (elapsed) {
        return { ok: false, failure: stalePlan };
      }
      cancel.abort();
      return { ok: true, output: null };
    },
  });
  try {
    await dependencies.clock.delay(reversibility.delayMs, {
      signal: AbortSignal.any([signal, cancel.signal]),
    });
    elapsed = true;
    unregister?.();
    return 'elapsed';
  } catch (error) {
    if (cancel.signal.aborted && !signal.aborted) {
      return 'undone';
    }
    unregister?.();
    throw error;
  }
};

const invokeEffect = async (
  effect: Effect<unknown, unknown>,
  input: unknown,
  descriptor: AnyDescriptor,
  plan: ExecutablePlan,
  signals: { readonly root: AbortSignal; readonly budget: AbortSignal },
): Promise<EffectResult<unknown>> => {
  const signal = AbortSignal.any([signals.root, signals.budget]);
  const expired = (): boolean => signals.budget.aborted && !signals.root.aborted;
  const timeoutFailure: EffectResult<unknown> = {
    ok: false,
    failure: executionFailure(isRetryable(descriptor)),
  };
  const context = {
    signal,
    planId: plan.planId,
    ...(descriptor.idempotency.kind === 'key' ? { idempotencyKey: plan.planId } : {}),
  };
  try {
    const result = await raceBudget(effect.run(input, context), signals.budget);
    return !result.ok && result.failure.code === 'ABORTED' && expired() ? timeoutFailure : result;
  } catch (error) {
    if (signals.root.aborted || error instanceof IntentFailureError) {
      throw error;
    }
    return expired() ? timeoutFailure : { ok: false, failure: executionFailure(false) };
  }
};

export const createExecuteStage = <TPrincipal, TRole extends string>(
  dependencies: ExecuteDependencies<TPrincipal>,
): ActionStage<TPrincipal, TRole> => ({
  name: EXECUTE_STAGE,
  phase: 'execution',
  requires: ['plan', 'principal', 'descriptor', 'input', 'lifecycle'],
  provides: ['output'],
  async run(context, next): Promise<Outcome<ActionResult>> {
    const effect = context.find('effect');
    if (!effect) {
      return next();
    }
    const plan = context.get('plan');
    const descriptor = context.get('descriptor');
    const grace = await waitForGrace(dependencies, plan, descriptor, context.signal);
    if (grace === 'undone') {
      return {
        ok: true,
        value: { status: 'undone', planId: plan.planId, capabilityId: descriptor.id },
      };
    }
    context.signal.throwIfAborted();
    const decision = await dependencies.authorizer.authorize(context.get('principal'), descriptor, {
      signal: context.signal,
    });
    if (!decision.allowed) {
      return { ok: false, failure: decision.failure };
    }
    context
      .get('lifecycle')
      .sending(plan.planId, descriptor.kind === 'read' || descriptor.kind === 'navigate');
    const result = await invokeEffect(effect, context.get('input'), descriptor, plan, {
      root: context.signal,
      budget: dependencies.clock.timeout(dependencies.executeMs),
    });
    if (!result.ok) {
      return { ok: false, failure: result.failure };
    }
    context.set('output', result.output);
    return next();
  },
});
