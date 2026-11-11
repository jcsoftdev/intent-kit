import { stageName } from '../contracts/index.js';
import type {
  Announcer,
  AnyDescriptor,
  Clock,
  Destination,
  FailureCode,
  MessageCatalog,
  Presentation,
  Revealer,
  RouterAdapter,
  TargetRegistry,
} from '../contracts/index.js';
import { resolveDestination } from '../policy/index.js';
import type { ActionStage } from './action-pipeline.js';
import { isHandoff } from './load-effect-stage.js';

export const PRESENT_STAGE = stageName('present');

export interface PresentDependencies<TElement> {
  readonly router: RouterAdapter<string>;
  readonly targets: TargetRegistry<TElement>;
  readonly revealer: Revealer<TElement>;
  readonly announcer: Announcer;
  readonly messages: MessageCatalog;
  readonly clock: Clock;
  readonly presentMs: number;
  readonly targetMs: number;
}

const shown: Presentation = { status: 'shown' };
const degraded = (code: FailureCode): Presentation => ({ status: 'degraded', code });

const sameParams = (
  current: Readonly<Record<string, string>>,
  wanted: Readonly<Record<string, string>>,
): boolean => {
  const names = Object.keys(wanted);
  return (
    names.length === Object.keys(current).length && names.every((n) => current[n] === wanted[n])
  );
};

const isCurrent = (
  current: ReturnType<RouterAdapter<string>['currentRoute']>,
  destination: Destination<string>,
): boolean =>
  current !== undefined &&
  current.routeId === destination.routeId &&
  sameParams(current.params, destination.params ?? {});

const failureOf = (reveal: AbortSignal, code: FailureCode): Presentation =>
  degraded(reveal.aborted ? 'ABORTED' : code);

const showDestination = async <TElement>(
  dependencies: PresentDependencies<TElement>,
  destination: Destination<string>,
  reveal: AbortSignal,
): Promise<Presentation> => {
  const routing = AbortSignal.any([reveal, dependencies.clock.timeout(dependencies.presentMs)]);
  try {
    if (!isCurrent(dependencies.router.currentRoute(), destination)) {
      await dependencies.router.navigate(destination, { signal: routing });
    }
  } catch {
    return failureOf(reveal, 'NAVIGATION_FAILED');
  }
  try {
    await dependencies.router.waitUntilReady(destination, { signal: routing });
  } catch {
    return failureOf(reveal, 'ROUTE_NOT_READY');
  }
  if (!destination.target) {
    return shown;
  }
  try {
    const element = await dependencies.targets.waitFor(destination.target, {
      signal: reveal,
      timeoutMs: dependencies.targetMs,
    });
    await dependencies.revealer.reveal(element, 'highlightAndFocus', { signal: reveal });
  } catch {
    return failureOf(reveal, 'TARGET_NOT_FOUND');
  }
  return shown;
};

const presentationOf = async <TElement>(
  dependencies: PresentDependencies<TElement>,
  resolved: ReturnType<typeof resolveDestination<string, string>>,
  reveal: AbortSignal,
): Promise<Presentation> => {
  switch (resolved.status) {
    case 'none':
      return { status: 'skipped' };
    case 'unresolved':
      return degraded(resolved.code);
    case 'ready':
      return showDestination(dependencies, resolved.destination, reveal);
  }
};

const announceSuccess = <TElement>(
  dependencies: PresentDependencies<TElement>,
  descriptor: AnyDescriptor,
  scope: { readonly input: unknown; readonly output: unknown },
): void => {
  const message = dependencies.messages[descriptor.id]?.success(scope);
  if (message !== undefined) {
    dependencies.announcer.announce(message, 'polite');
  }
};

const raceBudget = (work: Promise<Presentation>, budget: AbortSignal): Promise<Presentation> =>
  new Promise((resolve, reject) => {
    const expire = (): void => resolve(degraded('ABORTED'));
    if (budget.aborted) {
      expire();
      return;
    }
    budget.addEventListener('abort', expire, { once: true });
    work.then(resolve, reject).finally(() => budget.removeEventListener('abort', expire));
  });

const present = async <TPrincipal, TRole extends string, TElement>(
  dependencies: PresentDependencies<TElement>,
  context: Parameters<ActionStage<TPrincipal, TRole>['run']>[0],
  descriptor: AnyDescriptor,
  scope: { readonly input: unknown; readonly output: unknown },
): Promise<Presentation> => {
  let presentation: Presentation;
  try {
    const reveal = context.get('lifecycle').presenting(context.get('plan').planId);
    const resolved = resolveDestination<string, string>(descriptor, context.get('role'), scope);
    const budget = dependencies.clock.timeout(dependencies.presentMs + dependencies.targetMs);
    presentation = await raceBudget(
      presentationOf(dependencies, resolved, AbortSignal.any([reveal, budget])),
      budget,
    );
  } catch {
    presentation = degraded('ABORTED');
  }
  if (!isHandoff(descriptor)) {
    try {
      announceSuccess(dependencies, descriptor, scope);
    } catch {
      return presentation;
    }
  }
  return presentation;
};

export const createPresentStage = <TPrincipal, TRole extends string, TElement>(
  dependencies: PresentDependencies<TElement>,
): ActionStage<TPrincipal, TRole> => ({
  name: PRESENT_STAGE,
  phase: 'presentation',
  requires: ['plan', 'descriptor', 'input', 'role', 'lifecycle'],
  provides: ['presentation'],
  async run(context, next) {
    const descriptor = context.get('descriptor');
    const scope = { input: context.get('input'), output: context.find('output') };
    const presentation = await present(dependencies, context, descriptor, scope);
    context.set('presentation', presentation);
    return next();
  },
});
