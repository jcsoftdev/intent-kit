import { stageName } from '../contracts/index.js';
import type { ConfirmationPort, Failure, MessageCatalog } from '../contracts/index.js';
import { requiresConfirmation } from '../policy/index.js';
import type { ActionStage } from './action-pipeline.js';

export const CONFIRM_STAGE = stageName('confirm');

const declined: Failure = {
  stage: 'confirmation',
  code: 'CONFIRMATION_DECLINED',
  retryable: false,
};

export interface ConfirmDependencies {
  readonly confirmation: ConfirmationPort;
  readonly messages: MessageCatalog;
}

export const createConfirmStage = <TPrincipal, TRole extends string>(
  dependencies: ConfirmDependencies,
): ActionStage<TPrincipal, TRole> => ({
  name: CONFIRM_STAGE,
  phase: 'confirmation',
  requires: ['plan', 'descriptor', 'input', 'lifecycle'],
  provides: [],
  async run(context, next) {
    const plan = context.get('plan');
    const descriptor = context.get('descriptor');
    if (!requiresConfirmation(descriptor, plan.source)) {
      return next();
    }
    context.get('lifecycle').confirming(plan.planId);
    const summary =
      dependencies.messages[descriptor.id]?.confirm({
        input: context.get('input'),
        heard: plan.heard,
      }) ?? descriptor.description;
    const answer = await dependencies.confirmation
      .confirm(
        {
          planId: plan.planId,
          capabilityId: descriptor.id,
          risk: descriptor.risk,
          summary,
          heard: plan.heard,
        },
        { signal: context.signal },
      )
      .catch((error: unknown) => {
        if (context.signal.aborted) {
          throw error;
        }
        return 'declined';
      });
    return answer === 'confirmed' ? next() : { ok: false, failure: declined };
  },
});
