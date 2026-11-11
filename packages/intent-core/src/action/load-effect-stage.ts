import { stageName } from '../contracts/index.js';
import type {
  AnyDescriptor,
  CapabilityRegistry,
  FormBindingRegistry,
  RouterAdapter,
} from '../contracts/index.js';
import type { ActionStage } from './action-pipeline.js';
import { createFormFillEffect } from './form-fill-effect.js';

export const LOAD_EFFECT_STAGE = stageName('loadEffect');

export const isHandoff = (descriptor: AnyDescriptor): boolean =>
  descriptor.agent === 'handoff' || descriptor.kind === 'handoff';

export interface LoadEffectDependencies {
  readonly registry: CapabilityRegistry;
  readonly router: Pick<RouterAdapter<string>, 'currentRoute'>;
  readonly forms?: FormBindingRegistry;
}

const mountedBinding = (dependencies: LoadEffectDependencies, descriptor: AnyDescriptor) => {
  const registration = descriptor.form && dependencies.forms?.find(descriptor.form.formId);
  const route = dependencies.router.currentRoute();
  return registration && route?.routeId === registration.routeId ? registration.binding : undefined;
};

export const createLoadEffectStage = <TPrincipal, TRole extends string>(
  dependencies: LoadEffectDependencies,
): ActionStage<TPrincipal, TRole> => ({
  name: LOAD_EFFECT_STAGE,
  phase: 'execution',
  requires: ['plan', 'descriptor', 'lifecycle'],
  provides: ['effect'],
  async run(context, next) {
    const descriptor = context.get('descriptor');
    context.get('lifecycle').executing(context.get('plan').planId);
    if (isHandoff(descriptor)) {
      return next();
    }
    const binding = mountedBinding(dependencies, descriptor);
    context.set(
      'effect',
      binding
        ? createFormFillEffect(binding)
        : await dependencies.registry.loadEffect(descriptor.id, { signal: context.signal }),
    );
    return next();
  },
});
