import { expect, test } from 'vitest';
import type {
  ActionLifecycle,
  ActionResult,
  AnyDescriptor,
  ConfirmationPort,
  ConfirmationRequest,
  Destination,
  EffectContext,
  EffectResult,
  ExecutablePlan,
  Failure,
  FormBinding,
  Outcome,
  StandardSchemaV1,
  TargetRef,
} from '../contracts/index.js';
import { createRoleAuthorizer, createUndoRegistry } from '../policy/index.js';
import { createManualClock, createSequentialIdSource } from '../primitives/index.js';
import { createCapabilityRegistry } from '../registry/index.js';
import { createActionPipeline } from './action-pipeline.js';
import { createFormBindingRegistry } from './form-binding-registry.js';

interface Principal {
  readonly active: string;
  readonly granted: readonly string[];
}

const passthrough: StandardSchemaV1 = {
  '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) },
};

const requiresTable: StandardSchemaV1 = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) =>
      typeof value === 'object' && value !== null && 'tableId' in value
        ? { value }
        : { issues: [{ message: 'tableId is required' }] },
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const tableOf = (output: unknown): string =>
  isRecord(output) && typeof output.table === 'string' ? output.table : '';

const ordersCreate: AnyDescriptor = {
  id: 'orders.create',
  version: 1,
  kind: 'write',
  agent: 'allowed',
  description: 'Create an order',
  aliases: [],
  examples: [],
  patterns: [],
  scope: 'global',
  input: passthrough,
  entities: [],
  risk: 'write',
  confirmation: 'never',
  reversibility: { kind: 'compensate', via: 'orders.cancel', windowMs: 5000 },
  idempotency: { kind: 'none' },
  roles: ['waiter', 'host'],
  destination: {
    default: { routeId: 'orders', params: { id: '{output.orderId}' } },
    byRole: {
      waiter: { routeId: 'myOrders', target: { intent: 'my-order', key: '{output.orderId}' } },
    },
  },
};

const waiter: Principal = { active: 'waiter', granted: ['waiter'] };

const orderPlan = (
  overrides: { readonly source?: 'text' | 'voice'; readonly version?: number } = {},
) => ({
  planId: 'p-1',
  draft: {
    capabilityId: 'orders.create',
    version: overrides.version ?? 1,
    input: { tableId: 't-3' },
  },
  source: overrides.source ?? 'text',
  ...(overrides.source === 'voice' ? { heard: 'cierra la caja' } : {}),
});

interface Options {
  readonly descriptor?: AnyDescriptor;
  readonly mounted?: readonly string[];
  readonly route?: { readonly routeId: string; readonly params: Record<string, string> };
  readonly confirmation?: 'confirmed' | 'declined';
  readonly confirm?: ConfirmationPort['confirm'];
  readonly onConfirm?: () => void;
  readonly successThrows?: boolean;
  readonly navigateFails?: boolean;
  readonly effect?: (input: unknown, context: EffectContext) => Promise<EffectResult<unknown>>;
  readonly withUndo?: boolean;
  readonly withCompensator?: boolean;
  readonly holdSecondAuthorization?: Promise<void>;
  readonly hangReveal?: boolean;
}

const failWith = (message: string): never => {
  throw new Error(message);
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const orderOutput = { orderId: 'o-1', table: 'Mesa 3' };

const harness = (options: Options = {}) => {
  const clock = createManualClock();
  const ids = createSequentialIdSource('p-');
  const registry = createCapabilityRegistry();
  const forms = createFormBindingRegistry();
  const undo = createUndoRegistry({ clock });
  const calls: EffectContext[] = [];
  const navigations: Destination<string>[] = [];
  const revealed: string[] = [];
  const announcements: { message: string; politeness: string }[] = [];
  const confirmations: ConfirmationRequest[] = [];
  const compensations: unknown[] = [];
  let route = options.route;
  const mounted = new Set(options.mounted ?? []);
  const keyOf = (ref: TargetRef): string => `${ref.intent}:${ref.key ?? ''}`;
  const descriptor = options.descriptor ?? ordersCreate;
  const effect =
    options.effect ??
    (async (): Promise<EffectResult<unknown>> => ({ ok: true, output: orderOutput }));
  registry.register(descriptor, async () => ({
    default: {
      run: (input, context) => {
        calls.push(context);
        return effect(input, context);
      },
    },
  }));
  const lifecycleCalls: string[] = [];
  const lifecycle: ActionLifecycle = {
    confirming: () => lifecycleCalls.push('confirming'),
    executing: () => lifecycleCalls.push('executing'),
    sending: (_planId, cancellable) => lifecycleCalls.push(`sending:${cancellable}`),
    presenting: () => new AbortController().signal,
  };
  const baseAuthorizer = createRoleAuthorizer((principal: Principal) => principal);
  let authorizations = 0;
  const pipeline = createActionPipeline<Principal, string, string, string>({
    registry,
    authorizer: {
      async authorize(principal, authorized, authorizeOptions) {
        authorizations += 1;
        if (authorizations === 2) {
          await options.holdSecondAuthorization;
        }
        return baseAuthorizer.authorize(principal, authorized, authorizeOptions);
      },
    },
    confirmation: {
      confirm:
        options.confirm ??
        (async (request) => {
          options.onConfirm?.();
          confirmations.push(request);
          return options.confirmation ?? 'confirmed';
        }),
    },
    router: {
      currentRoute: () => route,
      async navigate(destination) {
        if (options.navigateFails) {
          throw new Error('navigation blocked');
        }
        navigations.push(destination);
        route = { routeId: destination.routeId, params: { ...destination.params } };
      },
      waitUntilReady: async () => undefined,
    },
    targets: {
      register: () => () => undefined,
      find: (ref) => (mounted.has(keyOf(ref)) ? keyOf(ref) : undefined),
      async waitFor(ref) {
        if (!mounted.has(keyOf(ref))) {
          throw new Error('target never mounted');
        }
        return keyOf(ref);
      },
    },
    revealer: {
      async reveal(element) {
        revealed.push(element);
        if (options.hangReveal) {
          await new Promise<void>(() => undefined);
        }
      },
    },
    announcer: {
      announce: (message, politeness) => announcements.push({ message, politeness }),
    },
    messages: {
      [descriptor.id]: {
        success: ({ output }) =>
          options.successThrows
            ? failWith('formatter')
            : `Pedido enviado a cocina · ${tableOf(output)}`,
        confirm: ({ heard }) => `Confirmar: ${heard ?? ''}`,
      },
    },
    forms,
    clock,
    ...(options.withUndo ? { undo } : {}),
    ...(options.withCompensator
      ? {
          compensator: {
            async compensate(request) {
              compensations.push(request.via);
              return { ok: true, output: null };
            },
          },
        }
      : {}),
  });
  const run = (
    plan: ExecutablePlan = orderPlan(),
    principal: Principal = waiter,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<Outcome<ActionResult>> =>
    pipeline.run({ plan, principal, role: principal.active, lifecycle }, { signal });
  return {
    run,
    clock,
    ids,
    calls,
    navigations,
    revealed,
    announcements,
    confirmations,
    compensations,
    lifecycleCalls,
    undo,
    forms,
    route: () => route,
  };
};

const failureOf = (outcome: Outcome<ActionResult>): Failure | undefined =>
  outcome.ok ? undefined : outcome.failure;

test('complete reversible write runs without confirmation, navigates once, reveals my-order:o-1 and announces politely', async () => {
  const h = harness({ mounted: ['my-order:o-1'] });
  const outcome = await h.run();
  expect(outcome).toEqual({
    ok: true,
    value: {
      status: 'completed',
      planId: 'p-1',
      capabilityId: 'orders.create',
      output: orderOutput,
      presentation: { status: 'shown' },
    },
  });
  expect(h.confirmations).toEqual([]);
  expect(h.navigations).toEqual([
    { routeId: 'myOrders', target: { intent: 'my-order', key: 'o-1' } },
  ]);
  expect(h.revealed).toEqual(['my-order:o-1']);
  expect(h.announcements).toEqual([
    { message: 'Pedido enviado a cocina · Mesa 3', politeness: 'polite' },
  ]);
  expect(h.lifecycleCalls).toEqual(['executing', 'sending:false']);
});

test('already on the destination route → zero navigations, still revealed', async () => {
  const h = harness({ mounted: ['my-order:o-1'], route: { routeId: 'myOrders', params: {} } });
  await h.run();
  expect(h.navigations).toEqual([]);
  expect(h.revealed).toEqual(['my-order:o-1']);
});

test('whenIrreversible + reversibility none + voice → confirmation requested with heard; declined → CONFIRMATION_DECLINED and the effect never ran', async () => {
  const h = harness({
    descriptor: {
      ...ordersCreate,
      confirmation: 'whenIrreversible',
      reversibility: { kind: 'none' },
    },
    confirmation: 'declined',
  });
  const outcome = await h.run(orderPlan({ source: 'voice' }));
  expect(h.confirmations).toEqual([
    {
      planId: 'p-1',
      capabilityId: 'orders.create',
      risk: 'write',
      summary: 'Confirmar: cierra la caja',
      heard: 'cierra la caja',
    },
  ]);
  expect(failureOf(outcome)).toEqual({
    stage: 'confirmation',
    code: 'CONFIRMATION_DECLINED',
    retryable: false,
  });
  expect(h.calls).toEqual([]);
});

test('two concurrent runs with planId p-1 call the effect once and both resolve to the same object', async () => {
  const h = harness({ mounted: ['my-order:o-1'] });
  const [first, second] = await Promise.all([h.run(), h.run()]);
  expect(h.calls).toHaveLength(1);
  expect(second).toBe(first);
  const replay = await h.run();
  expect(replay).toBe(first);
  expect(h.calls).toHaveLength(1);
});

test('idempotency key carries the planId into EffectContext', async () => {
  const keyed = harness({
    descriptor: {
      ...ordersCreate,
      idempotency: { kind: 'key', carrier: 'header', field: 'Idempotency-Key' },
    },
  });
  await keyed.run();
  expect(keyed.calls.map((call) => call.idempotencyKey)).toEqual(['p-1']);
  const plain = harness();
  await plain.run();
  expect(plain.calls.map((call) => call.idempotencyKey)).toEqual([undefined]);
});

const graceDescriptor: AnyDescriptor = {
  ...ordersCreate,
  reversibility: { kind: 'grace', delayMs: 5000 },
};

test('grace 5000 ms: undo before advance(5000) → status undone and the effect never ran', async () => {
  const h = harness({ descriptor: graceDescriptor, withUndo: true });
  const settled = h.run();
  await flush();
  expect(h.undo.active().map((entry) => entry.kind)).toEqual(['grace']);
  const undone = await h.undo.undo('p-1', { signal: new AbortController().signal });
  expect(undone.ok).toBe(true);
  expect(await settled).toEqual({
    ok: true,
    value: { status: 'undone', planId: 'p-1', capabilityId: 'orders.create' },
  });
  await h.clock.advance(5000);
  expect(h.calls).toEqual([]);
});

test('grace 5000 ms: without undo, the effect runs after 5000 ms', async () => {
  const h = harness({ descriptor: graceDescriptor, withUndo: true });
  const settled = h.run();
  await flush();
  await h.clock.advance(4999);
  expect(h.calls).toEqual([]);
  await h.clock.advance(1);
  const outcome = await settled;
  expect(h.calls).toHaveLength(1);
  expect(outcome.ok && outcome.value.status).toBe('completed');
  expect(h.undo.active()).toEqual([]);
});

test('target never mounts → completed with presentation degraded TARGET_NOT_FOUND and the success announcement', async () => {
  const h = harness();
  const outcome = await h.run();
  expect(outcome.ok && outcome.value).toMatchObject({
    status: 'completed',
    presentation: { status: 'degraded', code: 'TARGET_NOT_FOUND' },
  });
  expect(h.announcements).toEqual([
    { message: 'Pedido enviado a cocina · Mesa 3', politeness: 'polite' },
  ]);
});

test('router.navigate rejects → completed with degraded NAVIGATION_FAILED', async () => {
  const h = harness({ navigateFails: true, mounted: ['my-order:o-1'] });
  const outcome = await h.run();
  expect(outcome.ok && outcome.value).toMatchObject({
    status: 'completed',
    presentation: { status: 'degraded', code: 'NAVIGATION_FAILED' },
  });
  expect(h.announcements).toHaveLength(1);
});

test('handoff capability: no effect loaded, destination revealed, status handedOff', async () => {
  const h = harness({
    descriptor: {
      ...ordersCreate,
      kind: 'handoff',
      agent: 'handoff',
      risk: 'read',
      destination: {
        default: { routeId: 'importer', target: { intent: 'import-button' } },
      },
    },
    mounted: ['import-button:'],
  });
  const outcome = await h.run();
  expect(outcome).toEqual({
    ok: true,
    value: {
      status: 'handedOff',
      planId: 'p-1',
      capabilityId: 'orders.create',
      presentation: { status: 'shown' },
    },
  });
  expect(h.revealed).toEqual(['import-button:']);
  expect(h.calls).toEqual([]);
  expect(h.announcements).toEqual([]);
});

test.each<[string, Options, Parameters<typeof orderPlan>[0], Principal, Failure]>([
  [
    'stale draft version',
    {},
    { version: 2 },
    waiter,
    { stage: 'interpretation', code: 'STALE_PLAN', retryable: false },
  ],
  [
    'role not allowed',
    {},
    {},
    { active: 'cook', granted: ['cook'] },
    { stage: 'policy', code: 'UNAUTHORIZED', retryable: false },
  ],
])('%s', async (_name, options, planOverrides, principal, failure) => {
  const h = harness(options);
  expect(failureOf(await h.run(orderPlan(planOverrides), principal))).toEqual(failure);
  expect(h.calls).toEqual([]);
});

test('invalid input → INVALID_INPUT', async () => {
  const h = harness({ descriptor: { ...ordersCreate, input: requiresTable } });
  const plan = {
    planId: 'p-1',
    draft: { capabilityId: 'orders.create', version: 1, input: {} },
    source: 'text' as const,
  };
  expect(failureOf(await h.run(plan))).toEqual({
    stage: 'interpretation',
    code: 'INVALID_INPUT',
    retryable: false,
  });
});

test('unknown capability → CAPABILITY_NOT_FOUND', async () => {
  const h = harness();
  const plan = {
    planId: 'p-1',
    draft: { capabilityId: 'orders.missing', version: 1, input: {} },
    source: 'text' as const,
  };
  expect(failureOf(await h.run(plan))?.code).toBe('CAPABILITY_NOT_FOUND');
});

const formDescriptor: AnyDescriptor = { ...ordersCreate, form: { formId: 'order-form' } };

const bindingDouble = (): { binding: FormBinding<unknown>; submits: number[] } => {
  const submits: number[] = [];
  return {
    submits,
    binding: {
      formId: 'order-form',
      read: () => ({}),
      fill: (patch) => Object.keys(patch),
      isComplete: () => true,
      async submit() {
        submits.push(1);
        return { ok: true, output: orderOutput };
      },
    },
  };
};

test('form binding mounted on the current route → form fill effect used', async () => {
  const h = harness({ descriptor: formDescriptor, route: { routeId: 'orders', params: {} } });
  const form = bindingDouble();
  h.forms.register(form.binding, 'orders');
  const outcome = await h.run();
  expect(outcome.ok).toBe(true);
  expect(form.submits).toEqual([1]);
  expect(h.calls).toEqual([]);
});

test('form binding on another route → registry effect used', async () => {
  const h = harness({ descriptor: formDescriptor, route: { routeId: 'home', params: {} } });
  const form = bindingDouble();
  h.forms.register(form.binding, 'orders');
  await h.run();
  expect(form.submits).toEqual([]);
  expect(h.calls).toHaveLength(1);
});

test('compensate with a window offers an undo entry that calls the compensator', async () => {
  const h = harness({ withUndo: true, withCompensator: true, mounted: ['my-order:o-1'] });
  const outcome = await h.run();
  expect(outcome.ok && outcome.value.status === 'completed' && outcome.value.undo).toEqual({
    planId: 'p-1',
    capabilityId: 'orders.create',
    kind: 'compensate',
    expiresAt: 5000,
  });
  await h.undo.undo('p-1', { signal: new AbortController().signal });
  expect(h.compensations).toEqual(['orders.cancel']);
});

test('an effect that never answers fails at the execute budget, retryable only with idempotency', async () => {
  const hanging = (): Promise<EffectResult<unknown>> => new Promise(() => undefined);
  const plain = harness({ effect: hanging });
  const settled = plain.run();
  await flush();
  await plain.clock.advance(10_000);
  expect(failureOf(await settled)).toEqual({
    stage: 'execution',
    code: 'EXECUTION_FAILED',
    retryable: false,
  });
  const natural = harness({
    effect: hanging,
    descriptor: { ...ordersCreate, idempotency: { kind: 'natural' } },
  });
  const naturalSettled = natural.run();
  await flush();
  await natural.clock.advance(10_000);
  expect(failureOf(await naturalSettled)?.retryable).toBe(true);
});

test('a keyed write that timed out retries with the same plan and key, and its success is kept', async () => {
  const written = new Set<string>();
  let attempts = 0;
  const h = harness({
    mounted: ['my-order:o-1'],
    descriptor: {
      ...ordersCreate,
      idempotency: { kind: 'key', carrier: 'header', field: 'Idempotency-Key' },
    },
    effect: async (_input, context) => {
      attempts += 1;
      if (attempts === 1) {
        return new Promise(() => undefined);
      }
      written.add(context.idempotencyKey ?? '');
      return { ok: true, output: orderOutput };
    },
  });
  const timedOut = h.run();
  await flush();
  await h.clock.advance(10_000);
  expect(failureOf(await timedOut)).toEqual({
    stage: 'execution',
    code: 'EXECUTION_FAILED',
    retryable: true,
  });

  const retried = await h.run();
  const replay = await h.run();

  expect(retried.ok && retried.value.status).toBe('completed');
  expect(replay).toBe(retried);
  expect(h.calls.map((call) => call.idempotencyKey)).toEqual(['p-1', 'p-1']);
  expect([...written]).toEqual(['p-1']);
});

test('a non-retryable failure is kept for its plan and never re-runs the effect', async () => {
  const h = harness({
    effect: async () => {
      throw new Error('boom');
    },
  });
  const first = await h.run();
  const second = await h.run();
  expect(second).toBe(first);
  expect(h.calls).toHaveLength(1);
});

test('an effect that throws → EXECUTION_FAILED not retryable', async () => {
  const h = harness({
    effect: async () => {
      throw new Error('boom');
    },
  });
  expect(failureOf(await h.run())).toEqual({
    stage: 'execution',
    code: 'EXECUTION_FAILED',
    retryable: false,
  });
});

test('an effect failure passes through unchanged', async () => {
  const conflict: Failure = {
    stage: 'execution',
    code: 'CONFLICT',
    appCode: 'x',
    retryable: false,
  };
  const h = harness({ effect: async () => ({ ok: false, failure: conflict }) });
  expect(failureOf(await h.run())).toEqual(conflict);
});

const alwaysConfirm: AnyDescriptor = {
  ...ordersCreate,
  confirmation: 'always',
  reversibility: { kind: 'none' },
};

test.each<[string, ConfirmationPort['confirm']]>([
  ['resolves undefined', async () => Reflect.get({}, 'answer')],
  ['resolves an unknown string', async () => Reflect.get({ answer: 'dismissed' }, 'answer')],
  [
    'rejects',
    async () => {
      throw new Error('dialog crashed');
    },
  ],
  [
    'throws synchronously',
    () => {
      throw new Error('dialog crashed');
    },
  ],
])('a confirmation port that %s never runs the effect', async (_name, confirm) => {
  const h = harness({ descriptor: alwaysConfirm, confirm });
  expect(failureOf(await h.run())).toEqual({
    stage: 'confirmation',
    code: 'CONFIRMATION_DECLINED',
    retryable: false,
  });
  expect(h.calls).toEqual([]);
});

test('a throwing success formatter degrades the presentation, keeps the write completed and offers undo', async () => {
  const h = harness({
    successThrows: true,
    withUndo: true,
    withCompensator: true,
    mounted: ['my-order:o-1'],
  });
  const outcome = await h.run();
  expect(outcome.ok && outcome.value).toMatchObject({
    status: 'completed',
    undo: { kind: 'compensate' },
  });
  expect(h.calls).toHaveLength(1);
  expect(h.undo.active()).toHaveLength(1);
  expect(await h.run()).toBe(outcome);
});

test('a role change while the confirmation is open fails UNAUTHORIZED with zero effect calls', async () => {
  const principal = { active: 'waiter', granted: ['waiter'] };
  const h = harness({
    descriptor: alwaysConfirm,
    onConfirm: () => {
      principal.active = 'cook';
    },
  });
  expect(failureOf(await h.run(orderPlan(), principal))).toEqual({
    stage: 'policy',
    code: 'UNAUTHORIZED',
    retryable: false,
  });
  expect(h.calls).toEqual([]);
});

test('an abort while re-authorization is pending never calls the effect', async () => {
  let release: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = harness({ holdSecondAuthorization: hold });
  const controller = new AbortController();
  const settled = h.run(orderPlan(), waiter, controller.signal);
  await flush();
  controller.abort();
  release();
  expect(failureOf(await settled)?.code).toBe('ABORTED');
  await flush();
  expect(h.calls).toEqual([]);
});

test('a revealer that ignores abort and never settles cannot hold the action: it completes degraded at the budget', async () => {
  const h = harness({ mounted: ['my-order:o-1'], hangReveal: true });
  const settled = h.run();
  await flush();
  await h.clock.advance(6000);
  expect((await settled).ok && (await settled)).toMatchObject({
    ok: true,
    value: { status: 'completed', presentation: { status: 'degraded', code: 'ABORTED' } },
  });
  expect(h.announcements).toHaveLength(1);
});
