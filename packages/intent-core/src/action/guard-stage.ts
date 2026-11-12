import { stageName } from '../contracts/index.js';
import type { ActionResult, Outcome } from '../contracts/index.js';
import type { ActionStage } from './action-pipeline.js';

export const GUARD_STAGE = stageName('guard');

const isWorthKeeping = (outcome: Outcome<ActionResult>): boolean =>
  outcome.ok || !outcome.failure.retryable;

export const createGuardStage = <TPrincipal, TRole extends string>(): ActionStage<
  TPrincipal,
  TRole
> => {
  const outcomes = new Map<string, Promise<Outcome<ActionResult>>>();
  const forget = (planId: string, run: Promise<Outcome<ActionResult>>): void => {
    if (outcomes.get(planId) === run) {
      outcomes.delete(planId);
    }
  };
  return {
    name: GUARD_STAGE,
    phase: 'execution',
    requires: ['plan'],
    provides: [],
    async run(context, next) {
      const { planId } = context.get('plan');
      const existing = outcomes.get(planId);
      if (existing) {
        return existing;
      }
      const run = next();
      outcomes.set(planId, run);
      run.then(
        (outcome) => {
          if (!isWorthKeeping(outcome)) {
            forget(planId, run);
          }
        },
        () => forget(planId, run),
      );
      return run;
    },
  };
};
