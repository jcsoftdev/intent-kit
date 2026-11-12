import { stageName } from '../contracts/index.js';
import type {
  Clock,
  CompensationRequest,
  Compensator,
  UndoEntry,
  UndoRegistry,
} from '../contracts/index.js';
import type { ActionStage } from './action-pipeline.js';
import { isHandoff } from './load-effect-stage.js';

export const OFFER_UNDO_STAGE = stageName('offerUndo');

const compensationKeyOf = (planId: string): string => `${planId}:undo`;

export interface OfferUndoDependencies {
  readonly clock: Clock;
  readonly undo?: UndoRegistry;
  readonly compensator?: Compensator;
}

export const createOfferUndoStage = <TPrincipal, TRole extends string>(
  dependencies: OfferUndoDependencies,
): ActionStage<TPrincipal, TRole> => ({
  name: OFFER_UNDO_STAGE,
  phase: 'execution',
  requires: ['plan', 'descriptor', 'input'],
  provides: ['undo'],
  async run(context, next) {
    const descriptor = context.get('descriptor');
    const { reversibility } = descriptor;
    const { undo, compensator } = dependencies;
    if (
      !undo ||
      !compensator ||
      isHandoff(descriptor) ||
      reversibility.kind !== 'compensate' ||
      reversibility.windowMs <= 0
    ) {
      return next();
    }
    const { planId } = context.get('plan');
    const entry: UndoEntry = {
      planId,
      capabilityId: descriptor.id,
      kind: 'compensate',
      expiresAt: dependencies.clock.now() + reversibility.windowMs,
    };
    const request: CompensationRequest = {
      planId,
      idempotencyKey: compensationKeyOf(planId),
      via: reversibility.via,
      descriptor,
      input: context.get('input'),
      output: context.find('output'),
    };
    undo.offer({ ...entry, undo: (options) => compensator.compensate(request, options) });
    context.set('undo', entry);
    return next();
  },
});
