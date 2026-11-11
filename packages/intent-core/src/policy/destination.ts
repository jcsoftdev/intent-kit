import type { CapabilityDescriptor, Destination } from '../contracts/index.js';
import { fillTemplate } from '../primitives/index.js';
import type { TemplateScope } from '../primitives/index.js';

export type ResolvedDestination<TRouteId extends string> =
  | { readonly status: 'none' }
  | { readonly status: 'ready'; readonly destination: Destination<TRouteId> }
  | { readonly status: 'unresolved'; readonly code: 'TARGET_NOT_FOUND' };

const unresolved = { status: 'unresolved', code: 'TARGET_NOT_FOUND' } as const;

const fillParams = (
  params: Readonly<Record<string, string>>,
  scope: TemplateScope,
): Record<string, string> | undefined => {
  const filled: Record<string, string> = {};
  for (const [name, template] of Object.entries(params)) {
    const value = fillTemplate(template, scope);
    if (value === undefined) {
      return undefined;
    }
    filled[name] = value;
  }
  return filled;
};

const fillTarget = (
  target: NonNullable<Destination<string>['target']>,
  scope: TemplateScope,
): Destination<string>['target'] | undefined => {
  if (target.key === undefined) {
    return { intent: target.intent };
  }
  const key = fillTemplate(target.key, scope);
  return key === undefined ? undefined : { intent: target.intent, key };
};

const fillDestination = <TRouteId extends string>(
  rule: Destination<TRouteId>,
  scope: TemplateScope,
): Destination<TRouteId> | undefined => {
  const params = rule.params ? fillParams(rule.params, scope) : undefined;
  const target = rule.target ? fillTarget(rule.target, scope) : undefined;
  if ((rule.params && !params) || (rule.target && !target)) {
    return undefined;
  }
  return {
    routeId: rule.routeId,
    ...(params ? { params } : {}),
    ...(target ? { target } : {}),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const destinationFromOutput = <TRouteId extends string>(
  output: unknown,
): ResolvedDestination<TRouteId> =>
  isRecord(output) && typeof output.routeId === 'string'
    ? { status: 'ready', destination: { routeId: output.routeId as TRouteId } }
    : unresolved;

export const resolveDestination = <TRole extends string, TRouteId extends string>(
  descriptor: CapabilityDescriptor<TRole, TRouteId, unknown, unknown>,
  role: TRole,
  scope: TemplateScope,
): ResolvedDestination<TRouteId> => {
  if (!descriptor.destination) {
    return descriptor.kind === 'navigate'
      ? destinationFromOutput(scope.output)
      : { status: 'none' };
  }
  const rule = descriptor.destination.byRole?.[role] ?? descriptor.destination.default;
  const destination = fillDestination(rule, scope);
  return destination ? { status: 'ready', destination } : unresolved;
};
