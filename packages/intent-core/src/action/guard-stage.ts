import { stageName } from '../contracts/index.js';
import type { ActionResult, Outcome } from '../contracts/index.js';
import type { ActionStage } from './action-pipeline.js';

export const GUARD_STAGE = stageName('guard');

export const createGuardStage = <TPrincipal, TRole extends string>(): ActionStage<
  TPrincipal,
  TRole
> => {
  const outcomes = new Map<string, Promise<Outcome<ActionResult>>>();
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
      const first = next();
      outcomes.set(planId, first);
      return first;
    },
  };
};
