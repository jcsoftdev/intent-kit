import { stageName } from '../contracts/index.js';
import type { Clock, Compensator, UndoEntry, UndoRegistry } from '../contracts/index.js';
import type { ActionStage } from './action-pipeline.js';
import { isHandoff } from './load-effect-stage.js';

export const OFFER_UNDO_STAGE = stageName('offerUndo');

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
    const entry: UndoEntry = {
      planId: context.get('plan').planId,
      capabilityId: descriptor.id,
      kind: 'compensate',
      expiresAt: dependencies.clock.now() + reversibility.windowMs,
    };
    const request = {
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
