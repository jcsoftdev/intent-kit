import { expect, test } from 'vitest';
import type {
  ActionLifecycle,
  ActionResult,
  AnyDescriptor,
  Draft,
  EffectContext,
  EffectResult,
  Failure,
  FailureMessages,
  Interpretation,
  InterpretationInput,
  Outcome,
  SessionState,
  StandardSchemaV1,
} from '../contracts/index.js';
import { createRoleAuthorizer } from '../policy/index.js';
import { createManualClock } from '../primitives/index.js';
import { createCapabilityRegistry } from '../registry/index.js';
import { createIntentKit } from './kit.js';
import { createIntentSession } from './session.js';

interface Principal {
  readonly active: string;
  readonly granted: readonly string[];
}

const passthrough: StandardSchemaV1 = {
  '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) },
};

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
    default: { routeId: 'myOrders', target: { intent: 'my-order', key: '{output.orderId}' } },
  },
};

const draftOf = (capabilityId = 'orders.create'): Draft => ({
  capabilityId,
  version: 1,
  input: { tableId: 't-3' },
});

const complete = (planId: string): Interpretation => ({
  status: 'complete',
  planId,
  draft: draftOf(),
  summary: 'Order',
  source: 'deterministic',
});

const incomplete: Interpretation = {
  status: 'incomplete',
  draft: draftOf(),
  missing: [
    {
      path: 'side',
      reason: 'required',
      prompt: 'Con que?',
      options: [
        { id: 'opt-yuca', label: 'Yuca' },
        { id: 'opt-arroz', label: 'Arroz' },
      ],
    },
  ],
};

const ambiguousCapabilities: Interpretation = {
  status: 'ambiguous',
  candidates: [
    { kind: 'capability', capabilityId: 'orders.create', label: 'Crear' },
    { kind: 'capability', capabilityId: 'orders.cancel', label: 'Cancelar' },
  ],
};

const unsupported: Interpretation = { status: 'unsupported', suggestions: [] };

const ok = (value: Interpretation): Outcome<Interpretation> => ({ ok: true, value });

type Responder = (
  input: InterpretationInput,
  options: { signal: AbortSignal },
) => Promise<Outcome<Interpretation>>;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const failureMessages: FailureMessages = {
  CAPABILITY_NOT_FOUND: 'msg:CAPABILITY_NOT_FOUND',
  INTERPRETER_UNAVAILABLE: 'msg:INTERPRETER_UNAVAILABLE',
  INTERPRETER_TIMEOUT: 'msg:INTERPRETER_TIMEOUT',
  ENTITY_NOT_FOUND: 'msg:ENTITY_NOT_FOUND',
  RESOLUTION_UNAVAILABLE: 'msg:RESOLUTION_UNAVAILABLE',
  INVALID_INPUT: 'msg:INVALID_INPUT',
  UNAUTHORIZED: 'msg:UNAUTHORIZED',
  NOT_AVAILABLE: 'msg:NOT_AVAILABLE',
  AGENT_FORBIDDEN: 'msg:AGENT_FORBIDDEN',
  RATE_LIMITED: 'msg:RATE_LIMITED',
  CONFIRMATION_DECLINED: 'msg:CONFIRMATION_DECLINED',
  NAVIGATION_FAILED: 'msg:NAVIGATION_FAILED',
  ROUTE_NOT_READY: 'msg:ROUTE_NOT_READY',
  EXECUTION_FAILED: 'msg:EXECUTION_FAILED',
  CONFLICT: 'msg:CONFLICT',
  STALE_PLAN: 'msg:STALE_PLAN',
  TARGET_NOT_FOUND: 'msg:TARGET_NOT_FOUND',
  SEMANTICS_VIOLATION: 'msg:SEMANTICS_VIOLATION',
  ABORTED: 'msg:ABORTED',
};

interface Options {
  readonly descriptor?: AnyDescriptor;
  readonly responders?: readonly Responder[];
  readonly effect?: (input: unknown, context: EffectContext) => Promise<EffectResult<unknown>>;
  readonly confirm?: () => Promise<'confirmed' | 'declined'>;
  readonly reveal?: (signal: AbortSignal) => Promise<void>;
  readonly holdSecondAuthorization?: Promise<void>;
  readonly holdAuthorization?: { readonly at: number; readonly until: Promise<void> };
  readonly compensate?: (signal: AbortSignal) => Promise<EffectResult<unknown>>;
}

const harness = (options: Options = {}) => {
  const clock = createManualClock();
  const registry = createCapabilityRegistry();
  const calls: EffectContext[] = [];
  const interpretations: InterpretationInput[] = [];
  const signals: AbortSignal[] = [];
  const announcements: { message: string; politeness: string }[] = [];
  const descriptor = options.descriptor ?? ordersCreate;
  const effect =
    options.effect ??
    (async (): Promise<EffectResult<unknown>> => ({ ok: true, output: { orderId: 'o-1' } }));
  registry.register(descriptor, async () => ({
    default: {
      run: (input, context) => {
        calls.push(context);
        return effect(input, context);
      },
    },
  }));
  const responders = [...(options.responders ?? [])];
  const reveals: AbortSignal[] = [];
  const compensations: AbortSignal[] = [];
  let role = 'waiter';
  const baseAuthorizer = createRoleAuthorizer((principal: Principal) => principal);
  let authorizations = 0;
  const kit = createIntentKit<Principal, string, string, string>({
    registry,
    authorizer: {
      async authorize(principal, authorized, authorizeOptions) {
        authorizations += 1;
        if (authorizations === 2) {
          await options.holdSecondAuthorization;
        }
        if (authorizations === options.holdAuthorization?.at) {
          await options.holdAuthorization.until;
        }
        return baseAuthorizer.authorize(principal, authorized, authorizeOptions);
      },
    },
    confirmation: { confirm: options.confirm ?? (async () => 'confirmed') },
    router: {
      currentRoute: () => undefined,
      navigate: async () => undefined,
      waitUntilReady: async () => undefined,
    },
    targets: {
      register: () => () => undefined,
      find: () => undefined,
      waitFor: async (ref) => ref.intent,
    },
    revealer: {
      async reveal(_element, _mode, { signal }) {
        reveals.push(signal);
        await options.reveal?.(signal);
      },
    },
    announcer: { announce: (message, politeness) => announcements.push({ message, politeness }) },
    messages: {
      [descriptor.id]: { success: () => 'Pedido enviado', confirm: () => 'Confirmar' },
    },
    compensator: {
      async compensate(_request, { signal }) {
        compensations.push(signal);
        return options.compensate ? options.compensate(signal) : { ok: true, output: null };
      },
    },
    clock,
    interpretation: {
      interpret(input, { signal }) {
        interpretations.push(input);
        signals.push(signal);
        const responder = responders.shift();
        return responder
          ? responder(input, { signal })
          : Promise.resolve({ ok: true, value: unsupported });
      },
    },
    principal: () => ({ active: role, granted: ['waiter', 'host'] }),
    activeRole: () => role,
    locale: 'es-PE',
    failureMessages,
  });
  const session = kit.createSession();
  const states: SessionState[] = [];
  session.subscribe((state) => states.push(state));
  const names = (): string[] =>
    states.map((state) => state.name).filter((name, index, all) => name !== all[index - 1]);
  return {
    kit,
    session,
    clock,
    calls,
    interpretations,
    signals,
    announcements,
    reveals,
    compensations,
    states,
    names,
    setRole: (next: string) => {
      role = next;
    },
  };
};

const answering =
  (value: Interpretation): Responder =>
  async () =>
    ok(value);

const graceDescriptor: AnyDescriptor = {
  ...ordersCreate,
  reversibility: { kind: 'grace', delayMs: 5000 },
};

const completedResult = (state: SessionState): ActionResult | undefined =>
  state.name === 'completed' ? state.result : undefined;

test('complete interpretation goes interpreting, executing, presenting, completed with no clarifying in between', async () => {
  const h = harness({ responders: [answering(complete('p-1'))] });
  const state = await h.session.submit({ text: 'pedido mesa 3', source: 'text' });
  expect(h.names()).toEqual(['interpreting', 'executing', 'presenting', 'completed']);
  expect(completedResult(state)?.status).toBe('completed');
  expect(h.calls).toHaveLength(1);
});

test('incomplete clarifies; answerByText sends a continuation with the Yuca option id and the received draft', async () => {
  const h = harness({ responders: [answering(incomplete), answering(complete('p-1'))] });
  const clarifying = await h.session.submit({ text: 'pedido', source: 'voice' });
  expect(clarifying.name).toBe('clarifying');
  const state = await h.session.answerByText('con yuca');
  expect(h.interpretations[1]).toEqual({
    kind: 'continuation',
    locale: 'es-PE',
    source: 'voice',
    continuation: { draft: draftOf(), answers: { side: 'opt-yuca' } },
    origin: 'interpreter',
  });
  expect(completedResult(state)?.status).toBe('completed');
});

test('answerByText with no matching option stays clarifying and makes no interpretation call', async () => {
  const h = harness({ responders: [answering(incomplete)] });
  await h.session.submit({ text: 'pedido', source: 'text' });
  const state = await h.session.answerByText('con camote');
  expect(state.name).toBe('clarifying');
  expect(h.interpretations).toHaveLength(1);
});

test('answers accumulate across clarification rounds', async () => {
  const second: Interpretation = {
    ...incomplete,
    missing: [{ path: 'size', reason: 'required', prompt: 'Tamano?' }],
  };
  const h = harness({
    responders: [answering(incomplete), answering(second), answering(complete('p-1'))],
  });
  await h.session.submit({ text: 'pedido', source: 'text' });
  await h.session.answerByText('yuca');
  await h.session.answer({ size: 'grande' });
  expect(h.interpretations[2]).toMatchObject({
    continuation: { answers: { side: 'opt-yuca', size: 'grande' } },
  });
});

test('ambiguous capabilities: chooseCapability re-sends the text with restrictTo', async () => {
  const h = harness({ responders: [answering(ambiguousCapabilities), answering(complete('p-1'))] });
  await h.session.submit({ text: 'crear pedido', source: 'text' });
  await h.session.chooseCapability('orders.create');
  expect(h.interpretations[1]).toMatchObject({
    kind: 'utterance',
    text: 'crear pedido',
    restrictTo: 'orders.create',
  });
});

test('cancel while interpreting aborts the interpretation signal and ends cancelled', async () => {
  const pending = deferred<Outcome<Interpretation>>();
  const h = harness({ responders: [() => pending.promise] });
  const submitted = h.session.submit({ text: 'pedido', source: 'text' });
  await flush();
  h.session.cancel();
  expect(h.signals[0]?.aborted).toBe(true);
  expect(h.session.state().name).toBe('cancelled');
  pending.resolve(ok(complete('p-1')));
  await submitted;
  expect(h.session.state().name).toBe('cancelled');
  expect(h.calls).toEqual([]);
});

test('cancel after execution.sent for a write is ignored and the result still completes', async () => {
  const release = deferred<EffectResult<unknown>>();
  const h = harness({
    responders: [answering(complete('p-1'))],
    effect: () => release.promise,
  });
  const submitted = h.session.submit({ text: 'pedido', source: 'text' });
  await flush();
  expect(h.session.state()).toMatchObject({ name: 'executing', sent: true });
  h.session.cancel();
  expect(h.session.state().name).toBe('executing');
  release.resolve({ ok: true, output: { orderId: 'o-1' } });
  const state = await submitted;
  expect(completedResult(state)?.status).toBe('completed');
  expect(h.names()).not.toContain('cancelled');
});

const inGraceWindow = async (responders: readonly Responder[] = []) => {
  const h = harness({
    descriptor: graceDescriptor,
    responders: [answering(complete('p-1')), ...responders],
  });
  const submitted = h.session.submit({ text: 'pedido', source: 'text' });
  await flush();
  expect(h.session.state()).toMatchObject({ name: 'executing', planId: 'p-1', sent: false });
  return { h, submitted };
};

test.each<[string, (h: ReturnType<typeof harness>) => void]>([
  ['cancel', (h) => h.session.cancel()],
  ['reset', (h) => h.session.reset()],
  ['flush', (h) => h.session.flush()],
  [
    'a role change',
    (h) => {
      h.setRole('host');
      h.session.flush();
    },
  ],
])(
  '%s during the grace window sends the action at once instead of dropping it',
  async (_name, interrupt) => {
    const { h, submitted } = await inGraceWindow();
    interrupt(h);
    const state = await submitted;
    expect(h.calls).toHaveLength(1);
    expect(completedResult(state)?.status).toBe('completed');
    expect(h.names()).not.toContain('cancelled');
  },
);

test('a role change during the grace window no longer drops the action when the window ends', async () => {
  const { h, submitted } = await inGraceWindow();
  h.setRole('host');
  await h.clock.advance(5000);
  expect(completedResult(await submitted)?.status).toBe('completed');
  expect(h.calls).toHaveLength(1);
});

test('a new submit during the grace window sends the first action at once and then runs the second', async () => {
  const { h, submitted } = await inGraceWindow([answering(unsupported)]);
  const second = h.session.submit({ text: 'otro', source: 'text' });
  expect(completedResult(await submitted)?.status).toBe('completed');
  expect((await second).name).toBe('unsupported');
  expect(h.calls).toHaveLength(1);
  expect(h.names()).toEqual([
    'interpreting',
    'executing',
    'presenting',
    'completed',
    'interpreting',
    'unsupported',
  ]);
});

test('undo after a flush is refused because the action was already sent', async () => {
  const { h, submitted } = await inGraceWindow();
  h.session.flush();
  await submitted;
  expect(await h.kit.undo.undo('p-1', { signal: new AbortController().signal })).toMatchObject({
    ok: false,
  });
  expect(h.calls).toHaveLength(1);
});

test('flush outside a grace window changes nothing', async () => {
  const release = deferred<EffectResult<unknown>>();
  const h = harness({ responders: [answering(complete('p-1'))], effect: () => release.promise });
  const submitted = h.session.submit({ text: 'pedido', source: 'text' });
  await flush();
  h.session.flush();
  expect(h.session.state()).toMatchObject({ name: 'executing', sent: true });
  release.resolve({ ok: true, output: { orderId: 'o-1' } });
  expect(completedResult(await submitted)?.status).toBe('completed');
});

test('a second submit while executing-sent waits and starts only after the first completes', async () => {
  const release = deferred<EffectResult<unknown>>();
  const h = harness({
    responders: [answering(complete('p-1')), answering(unsupported)],
    effect: () => release.promise,
  });
  const first = h.session.submit({ text: 'uno', source: 'text' });
  await flush();
  const second = h.session.submit({ text: 'dos', source: 'text' });
  await flush();
  expect(h.interpretations).toHaveLength(1);
  release.resolve({ ok: true, output: { orderId: 'o-1' } });
  expect(completedResult(await first)?.status).toBe('completed');
  expect((await second).name).toBe('unsupported');
  expect(h.interpretations.map((input) => (input.kind === 'utterance' ? input.text : ''))).toEqual([
    'uno',
    'dos',
  ]);
  expect(h.names()).toEqual([
    'interpreting',
    'executing',
    'presenting',
    'completed',
    'interpreting',
    'unsupported',
  ]);
});

test('a second submit while interpreting aborts the first and ignores its late response', async () => {
  const late = deferred<Outcome<Interpretation>>();
  const h = harness({ responders: [() => late.promise, answering(unsupported)] });
  const first = h.session.submit({ text: 'uno', source: 'text' });
  await flush();
  const second = h.session.submit({ text: 'dos', source: 'text' });
  await flush();
  expect(h.signals[0]?.aborted).toBe(true);
  late.resolve(ok(complete('p-1')));
  await first;
  await second;
  expect(h.names()).toEqual(['interpreting', 'cancelled', 'interpreting', 'unsupported']);
  expect(h.session.state().name).toBe('unsupported');
  expect(h.calls).toEqual([]);
});

test('a failed interpretation is announced assertively with failureMessages[code]', async () => {
  const failure: Failure = {
    stage: 'interpretation',
    code: 'INTERPRETER_TIMEOUT',
    retryable: true,
  };
  const h = harness({ responders: [async () => ({ ok: false, failure })] });
  const state = await h.session.submit({ text: 'pedido', source: 'text' });
  expect(state).toEqual({ name: 'failed', failure });
  expect(h.announcements).toEqual([
    { message: 'msg:INTERPRETER_TIMEOUT', politeness: 'assertive' },
  ]);
});

test('undo inside the window goes undoing then undone', async () => {
  const h = harness({ responders: [answering(complete('p-1'))] });
  await h.session.submit({ text: 'pedido', source: 'text' });
  const state = await h.session.undo('p-1');
  expect(state).toEqual({ name: 'undone', planId: 'p-1' });
  expect(h.names().slice(-3)).toEqual(['completed', 'undoing', 'undone']);
});

test('undo after the window fails with STALE_PLAN', async () => {
  const h = harness({ responders: [answering(complete('p-1'))] });
  await h.session.submit({ text: 'pedido', source: 'text' });
  await h.clock.advance(6000);
  const state = await h.session.undo('p-1');
  expect(state).toEqual({
    name: 'failed',
    failure: { stage: 'execution', code: 'STALE_PLAN', retryable: false },
  });
  expect(h.announcements.at(-1)).toEqual({ message: 'msg:STALE_PLAN', politeness: 'assertive' });
});

const keyedOrders: AnyDescriptor = {
  ...ordersCreate,
  idempotency: { kind: 'key', carrier: 'body', field: 'idempotencyKey' },
};

const lostFirstResponse = () => {
  const orders = new Map<string, { readonly orderId: string }>();
  let attempts = 0;
  const effect = async (
    _input: unknown,
    context: EffectContext,
  ): Promise<EffectResult<unknown>> => {
    attempts += 1;
    const key = context.idempotencyKey ?? '';
    const order = orders.get(key) ?? { orderId: `o-${orders.size + 1}` };
    orders.set(key, order);
    return attempts === 1 ? new Promise(() => undefined) : { ok: true, output: order };
  };
  return { effect, orders };
};

const timedOut = async (h: ReturnType<typeof harness>): Promise<SessionState> => {
  const submitted = h.session.submit({ text: 'pedido', source: 'text' });
  await flush();
  await h.clock.advance(10_000);
  return submitted;
};

const notAvailable = { message: 'msg:NOT_AVAILABLE', politeness: 'polite' };

test('retry after a timed-out keyed write re-sends the same plan and key and creates one order', async () => {
  const api = lostFirstResponse();
  const h = harness({
    descriptor: keyedOrders,
    responders: [answering(complete('p-1'))],
    effect: api.effect,
  });
  expect(await timedOut(h)).toEqual({
    name: 'failed',
    failure: { stage: 'execution', code: 'EXECUTION_FAILED', retryable: true },
  });

  const state = await h.session.retry();

  expect(state.name).toBe('completed');
  expect(h.calls.map((call) => call.idempotencyKey)).toEqual(['p-1', 'p-1']);
  expect(api.orders.size).toBe(1);
  expect(h.interpretations).toHaveLength(1);
});

test('retry after a non-retryable failure is refused with a polite notice and no state change', async () => {
  const h = harness({
    responders: [answering(complete('p-1'))],
    effect: async () => {
      throw new Error('boom');
    },
  });
  const failed = await h.session.submit({ text: 'pedido', source: 'text' });

  expect(await h.session.retry()).toBe(failed);
  expect(h.session.state()).toBe(failed);
  expect(h.calls).toHaveLength(1);
  expect(h.announcements.at(-1)).toEqual(notAvailable);
});

test('retry after an interpretation failure is refused because no plan was dispatched', async () => {
  const failure: Failure = {
    stage: 'interpretation',
    code: 'INTERPRETER_TIMEOUT',
    retryable: true,
  };
  const h = harness({ responders: [async () => ({ ok: false, failure })] });
  await h.session.submit({ text: 'pedido', source: 'text' });

  expect((await h.session.retry()).name).toBe('failed');
  expect(h.calls).toEqual([]);
  expect(h.announcements.at(-1)).toEqual(notAvailable);
});

test.each([
  ['a reset', (h: ReturnType<typeof harness>) => h.session.reset(), 'idle'],
  ['a role change', (h: ReturnType<typeof harness>) => h.setRole('host'), 'failed'],
])('retry after %s is refused', async (_case, interrupt, stays) => {
  const api = lostFirstResponse();
  const h = harness({
    descriptor: keyedOrders,
    responders: [answering(complete('p-1'))],
    effect: api.effect,
  });
  await timedOut(h);
  interrupt(h);

  expect((await h.session.retry()).name).toBe(stays);
  expect(h.calls).toHaveLength(1);
  expect(h.announcements.at(-1)).toEqual(notAvailable);
});

test('retry while busy is refused', async () => {
  const release = deferred<EffectResult<unknown>>();
  const h = harness({ responders: [answering(complete('p-1'))], effect: () => release.promise });
  const submitted = h.session.submit({ text: 'pedido', source: 'text' });
  await flush();

  expect((await h.session.retry()).name).toBe('executing');
  expect(h.announcements.at(-1)).toEqual(notAvailable);
  release.resolve({ ok: true, output: { orderId: 'o-1' } });
  await submitted;
  expect(h.calls).toHaveLength(1);
});

const RETRY_REVALIDATION = 3;

const abortedFailure: Failure = { stage: 'execution', code: 'ABORTED', retryable: true };

const heldRetry = async (responders: readonly Responder[] = []) => {
  const gate = deferred<void>();
  const api = lostFirstResponse();
  const h = harness({
    descriptor: keyedOrders,
    responders: [answering(complete('p-1')), ...responders],
    effect: api.effect,
    holdAuthorization: { at: RETRY_REVALIDATION, until: gate.promise },
  });
  await timedOut(h);
  const retried = h.session.retry();
  expect(h.session.state()).toEqual({
    name: 'executing',
    planId: 'p-1',
    sent: false,
    cancellableAfterSend: false,
  });
  return { h, gate, retried };
};

test.each([
  ['cancel', (h: ReturnType<typeof harness>) => h.session.cancel(), 'cancelled'],
  ['reset', (h: ReturnType<typeof harness>) => h.session.reset(), 'idle'],
])(
  '%s before a retry reaches its effect stops it with nothing written',
  async (_case, interrupt, ends) => {
    const { h, gate, retried } = await heldRetry();
    interrupt(h);
    gate.resolve();
    await retried;
    await flush();

    expect(h.session.state().name).toBe(ends);
    expect(h.calls).toHaveLength(1);
  },
);

test('a new command before a retry reaches its effect cancels the retry with nothing written', async () => {
  const { h, gate, retried } = await heldRetry([answering(unsupported)]);
  const next = h.session.submit({ text: 'otra cosa', source: 'text' });
  gate.resolve();
  await retried;

  expect((await next).name).toBe('unsupported');
  expect(h.calls).toHaveLength(1);
});

test('a second retry in the same tick is refused and the first ends completed', async () => {
  const api = lostFirstResponse();
  const h = harness({
    descriptor: keyedOrders,
    responders: [answering(complete('p-1'))],
    effect: api.effect,
  });
  await timedOut(h);

  const first = h.session.retry();
  const second = h.session.retry();

  expect((await second).name).toBe('executing');
  expect((await first).name).toBe('completed');
  expect(h.session.state().name).toBe('completed');
  expect(h.calls).toHaveLength(2);
  expect(api.orders.size).toBe(1);
  expect(h.announcements).toContainEqual(notAvailable);
});

test.each(['never', 'always'] as const)(
  'retry after an abandoned undo of a completed write is refused (confirmation %s)',
  async (confirmation) => {
    let confirmations = 0;
    const h = harness({
      descriptor: {
        ...ordersCreate,
        confirmation,
        reversibility: { kind: 'compensate', via: 'orders.cancel', windowMs: 60_000 },
      },
      responders: [answering(complete('p-1'))],
      confirm: async () => {
        confirmations += 1;
        return 'confirmed';
      },
      compensate: hangingUntilAborted,
    });
    await h.session.submit({ text: 'pedido', source: 'text' });
    const undone = h.session.undo('p-1');
    await flush();
    await h.clock.advance(10_000);
    const abandoned = await undone;
    const askedBefore = confirmations;

    expect(abandoned).toEqual({ name: 'failed', failure: abortedFailure });
    expect(await h.session.retry()).toBe(abandoned);
    expect(h.calls).toHaveLength(1);
    expect(confirmations).toBe(askedBefore);
    expect(h.announcements.at(-1)).toEqual(notAvailable);
  },
);

test('retry after an abandoned undo of an older plan never re-sends a failed forward write', async () => {
  const h = harness({
    responders: [answering(complete('p-0')), answering(complete('p-1'))],
    descriptor: {
      ...keyedOrders,
      reversibility: { kind: 'compensate', via: 'orders.cancel', windowMs: 60_000 },
    },
    effect: async (_input, context) =>
      context.planId === 'p-1'
        ? new Promise(() => undefined)
        : { ok: true, output: { orderId: 'o-0' } },
    compensate: hangingUntilAborted,
  });
  await h.session.submit({ text: 'uno', source: 'text' });
  expect((await timedOut(h)).name).toBe('failed');
  const undone = h.session.undo('p-0');
  await flush();
  await h.clock.advance(10_000);
  expect(await undone).toEqual({ name: 'failed', failure: abortedFailure });

  expect((await h.session.retry()).name).toBe('failed');
  expect(h.calls.map((call) => call.planId)).toEqual(['p-0', 'p-1']);
  expect(h.announcements.at(-1)).toEqual(notAvailable);
});

test('cancel while presenting completes with presentation degraded ABORTED and still announces success', async () => {
  const h = harness({
    responders: [answering(complete('p-1'))],
    reveal: (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  });
  const submitted = h.session.submit({ text: 'pedido', source: 'text' });
  await flush();
  expect(h.session.state().name).toBe('presenting');
  h.session.cancel();
  const state = await submitted;
  expect(completedResult(state)).toMatchObject({
    status: 'completed',
    presentation: { status: 'degraded', code: 'ABORTED' },
  });
  expect(h.announcements).toEqual([{ message: 'Pedido enviado', politeness: 'polite' }]);
});

test('a new submit while presenting cuts only the reveal: the write completes, is not ABORTED and keeps its undo offer', async () => {
  const h = harness({
    responders: [answering(complete('p-1')), answering(unsupported)],
    reveal: (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  });
  const first = h.session.submit({ text: 'uno', source: 'text' });
  await flush();
  expect(h.session.state().name).toBe('presenting');
  const second = h.session.submit({ text: 'dos', source: 'text' });
  expect(completedResult(await first)).toMatchObject({
    status: 'completed',
    presentation: { status: 'degraded', code: 'ABORTED' },
  });
  expect((await second).name).toBe('unsupported');
  expect(h.names()).not.toContain('cancelled');
  expect(h.names()).not.toContain('failed');
  expect(h.kit.undo.active().map((entry) => entry.planId)).toEqual(['p-1']);
  expect(h.signals[0]?.aborted).toBe(false);
});

test('when the present budget expires the reveal signal is aborted so a late target cannot steal focus', async () => {
  const h = harness({
    responders: [answering(complete('p-1'))],
    reveal: () => new Promise<void>(() => undefined),
  });
  const submitted = h.session.submit({ text: 'uno', source: 'text' });
  await flush();
  expect(h.session.state().name).toBe('presenting');
  await h.clock.advance(6000);
  expect(completedResult(await submitted)).toMatchObject({
    presentation: { status: 'degraded', code: 'ABORTED' },
  });
  expect(h.reveals[0]?.aborted).toBe(true);
});

test('a grace undo settles undone while the session is executing and the effect never runs', async () => {
  const h = harness({ descriptor: graceDescriptor, responders: [answering(complete('p-1'))] });
  const submitted = h.session.submit({ text: 'pedido', source: 'text' });
  await flush();
  expect(h.session.state()).toMatchObject({ name: 'executing', sent: false });
  const state = await h.session.undo('p-1');
  expect(state).toEqual({ name: 'undone', planId: 'p-1' });
  await submitted;
  await h.clock.advance(10_000);
  expect(h.calls).toEqual([]);
});

test('a role change during confirmation cancels the command and the effect never runs', async () => {
  const answer = deferred<'confirmed' | 'declined'>();
  const h = harness({
    descriptor: { ...ordersCreate, confirmation: 'always' },
    responders: [answering(complete('p-1'))],
    confirm: () => answer.promise,
  });
  const submitted = h.session.submit({ text: 'pedido', source: 'text' });
  await flush();
  expect(h.session.state().name).toBe('awaitingConfirmation');
  h.setRole('host');
  answer.resolve('confirmed');
  expect((await submitted).name).toBe('cancelled');
  expect(h.calls).toEqual([]);
});

test('events from a superseded command never change the current state', async () => {
  const lifecycles: ActionLifecycle[] = [];
  const pending = deferred<Outcome<ActionResult>>();
  const late = deferred<Outcome<Interpretation>>();
  let calls = 0;
  const session = createIntentSession<Principal, string>({
    interpretation: {
      interpret: () => {
        calls += 1;
        return calls === 1 ? Promise.resolve(ok(complete('p-1'))) : late.promise;
      },
    },
    pipeline: {
      stages: [],
      run: (seed) => {
        if (seed.lifecycle) {
          lifecycles.push(seed.lifecycle);
        }
        return pending.promise;
      },
    },
    undo: {
      offer: () => () => undefined,
      active: () => [],
      undo: async () => ({ ok: true, output: null }),
    },
    announcer: { announce: () => undefined },
    events: { emit: () => undefined, subscribe: () => () => undefined },
    clock: createManualClock(),
    undoMs: 10_000,
    principal: () => ({ active: 'waiter', granted: ['waiter'] }),
    activeRole: () => 'waiter',
    locale: 'es-PE',
    failureMessages,
  });
  const first = session.submit({ text: 'uno', source: 'text' });
  await flush();
  const lifecycle = lifecycles[0];
  const second = session.submit({ text: 'dos', source: 'text' });
  await flush();
  expect(session.state().name).toBe('interpreting');
  expect(() => lifecycle?.confirming('p-1')).toThrow();
  expect(() => lifecycle?.executing('p-1', false)).toThrow();
  expect(() => lifecycle?.sending('p-1', false)).toThrow();
  lifecycle?.presenting('p-1');
  expect(session.state().name).toBe('interpreting');
  pending.resolve({
    ok: true,
    value: {
      status: 'completed',
      planId: 'p-1',
      capabilityId: 'orders.create',
      output: null,
      presentation: { status: 'shown' },
    },
  });
  await first;
  late.resolve(ok(unsupported));
  expect((await second).name).toBe('unsupported');
});

test('cancel while re-authorization is pending never calls the effect', async () => {
  const hold = deferred<void>();
  const h = harness({
    responders: [answering(complete('p-1'))],
    holdSecondAuthorization: hold.promise,
  });
  const submitted = h.session.submit({ text: 'pedido', source: 'text' });
  await flush();
  h.session.cancel();
  hold.resolve();
  await submitted;
  await flush();
  expect(h.session.state().name).toBe('cancelled');
  expect(h.calls).toEqual([]);
});

test('a new submit while re-authorization is pending never calls the superseded effect', async () => {
  const hold = deferred<void>();
  const h = harness({
    responders: [answering(complete('p-1')), answering(unsupported)],
    holdSecondAuthorization: hold.promise,
  });
  const first = h.session.submit({ text: 'uno', source: 'text' });
  await flush();
  const second = h.session.submit({ text: 'dos', source: 'text' });
  await flush();
  hold.resolve();
  await first;
  await second;
  expect(h.calls).toEqual([]);
  expect(h.names()).toEqual([
    'interpreting',
    'executing',
    'cancelled',
    'interpreting',
    'unsupported',
  ]);
});

test('a submit racing an undo queues behind it and then runs through the normal states', async () => {
  const h = harness({
    responders: [answering(complete('p-1')), answering(complete('p-2'))],
  });
  await h.session.submit({ text: 'uno', source: 'text' });
  const second = h.session.submit({ text: 'dos', source: 'text' });
  const undone = h.session.undo('p-1');
  expect((await undone).name).toBe('undone');
  const state = await second;
  expect(completedResult(state)?.planId).toBe('p-2');
  expect(h.names().slice(-7)).toEqual([
    'completed',
    'undoing',
    'undone',
    'interpreting',
    'executing',
    'presenting',
    'completed',
  ]);
  expect(h.calls).toHaveLength(2);
});

test('undo of an earlier plan still offered works after another command and is announced when it fails', async () => {
  const h = harness({ responders: [answering(complete('p-1')), answering(unsupported)] });
  await h.session.submit({ text: 'uno', source: 'text' });
  await h.session.submit({ text: 'dos', source: 'text' });
  expect(h.kit.undo.active().map((entry) => entry.planId)).toEqual(['p-1']);
  expect(await h.session.undo('p-1')).toEqual({ name: 'undone', planId: 'p-1' });
  expect(h.kit.undo.active()).toEqual([]);
  expect((await h.session.undo('p-1')).name).toBe('failed');
  expect(h.announcements.at(-1)).toEqual({ message: 'msg:STALE_PLAN', politeness: 'assertive' });
});

test('the lifecycle refuses to send once the command is cancelled', async () => {
  const lifecycles: ActionLifecycle[] = [];
  const session = createIntentSession<Principal, string>({
    interpretation: { interpret: async () => ok(complete('p-1')) },
    pipeline: {
      stages: [],
      run: (seed) => {
        if (seed.lifecycle) {
          lifecycles.push(seed.lifecycle);
        }
        return new Promise(() => undefined);
      },
    },
    undo: {
      offer: () => () => undefined,
      active: () => [],
      undo: async () => ({ ok: true, output: null }),
    },
    announcer: { announce: () => undefined },
    events: { emit: () => undefined, subscribe: () => () => undefined },
    clock: createManualClock(),
    undoMs: 10_000,
    principal: () => ({ active: 'waiter', granted: ['waiter'] }),
    activeRole: () => 'waiter',
    locale: 'es-PE',
    failureMessages,
  });
  void session.submit({ text: 'uno', source: 'text' });
  await flush();
  lifecycles[0]?.executing('p-1', false);
  session.cancel();
  expect(() => lifecycles[0]?.sending('p-1', false)).toThrow();
  expect(session.state().name).toBe('cancelled');
});

const abortedResult: EffectResult<unknown> = {
  ok: false,
  failure: { stage: 'execution', code: 'ABORTED', retryable: true },
};

const honoringSignal = (signal: AbortSignal): Promise<EffectResult<unknown>> =>
  Promise.resolve(signal.aborted ? abortedResult : { ok: true, output: null });

const hangingUntilAborted = (signal: AbortSignal): Promise<EffectResult<unknown>> =>
  new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(abortedResult), { once: true });
  });

const twoPlans = [answering(complete('p-1')), answering(complete('p-2'))];

test('undo of an earlier plan works after a later command was cancelled, with a compensator that honors its signal', async () => {
  const pending = deferred<Outcome<Interpretation>>();
  const h = harness({
    responders: [answering(complete('p-1')), () => pending.promise],
    compensate: honoringSignal,
  });
  await h.session.submit({ text: 'uno', source: 'text' });
  const second = h.session.submit({ text: 'dos', source: 'text' });
  await flush();
  h.session.cancel();
  pending.resolve(ok(unsupported));
  await second;
  expect(h.session.state().name).toBe('cancelled');
  expect(await h.session.undo('p-1')).toEqual({ name: 'undone', planId: 'p-1' });
});

test('undo of an earlier plan works after a cancelled command was reset, with a compensator that honors its signal', async () => {
  const pending = deferred<Outcome<Interpretation>>();
  const h = harness({
    responders: [answering(complete('p-1')), () => pending.promise],
    compensate: honoringSignal,
  });
  await h.session.submit({ text: 'uno', source: 'text' });
  const second = h.session.submit({ text: 'dos', source: 'text' });
  await flush();
  h.session.cancel();
  pending.resolve(ok(unsupported));
  await second;
  h.session.reset();
  expect(h.session.state().name).toBe('idle');
  expect(await h.session.undo('p-1')).toEqual({ name: 'undone', planId: 'p-1' });
});

test('reset drops a queued submit: it resolves cancelled and never interprets', async () => {
  const release = deferred<EffectResult<unknown>>();
  const h = harness({
    responders: [answering(complete('p-1')), answering(complete('p-2'))],
    effect: () => release.promise,
  });
  const first = h.session.submit({ text: 'uno', source: 'text' });
  await flush();
  const queued = h.session.submit({ text: 'dos', source: 'text' });
  await flush();
  h.session.reset();
  release.resolve({ ok: true, output: { orderId: 'o-1' } });
  await first;
  expect(await queued).toEqual({ name: 'cancelled' });
  expect(h.interpretations).toHaveLength(1);
});

test('a second undo while undoing runs no parallel compensation and says an undo is in progress', async () => {
  const h = harness({ responders: twoPlans, compensate: hangingUntilAborted });
  await h.session.submit({ text: 'uno', source: 'text' });
  await h.session.submit({ text: 'dos', source: 'text' });
  const first = h.session.undo('p-2');
  await flush();
  const refused = await h.session.undo('p-1');
  expect(refused).toEqual({ name: 'undoing', planId: 'p-2' });
  expect(h.compensations).toHaveLength(1);
  expect(h.announcements.at(-1)).toEqual({ message: 'msg:NOT_AVAILABLE', politeness: 'polite' });
  h.session.cancel();
  await first;
});

test('an undo that never settles fails retryable at its budget, keeps the offer and releases queued submits', async () => {
  const h = harness({
    descriptor: {
      ...ordersCreate,
      reversibility: { kind: 'compensate', via: 'orders.cancel', windowMs: 60_000 },
    },
    responders: [answering(complete('p-1')), answering(unsupported)],
    compensate: hangingUntilAborted,
  });
  await h.session.submit({ text: 'uno', source: 'text' });
  const undone = h.session.undo('p-1');
  const queued = h.session.submit({ text: 'dos', source: 'text' });
  await flush();
  expect(h.session.state().name).toBe('undoing');
  await h.clock.advance(10_000);
  expect(await undone).toEqual({
    name: 'failed',
    failure: { stage: 'execution', code: 'ABORTED', retryable: true },
  });
  expect((await queued).name).toBe('unsupported');
  expect(h.kit.undo.active().map((entry) => entry.planId)).toEqual(['p-1']);
});

test('a retry after an undo abandoned at its budget never compensates twice and reports the late success', async () => {
  const late = deferred<EffectResult<unknown>>();
  const h = harness({
    descriptor: {
      ...ordersCreate,
      reversibility: { kind: 'compensate', via: 'orders.cancel', windowMs: 60_000 },
    },
    responders: [answering(complete('p-1'))],
    compensate: () => late.promise,
  });
  await h.session.submit({ text: 'uno', source: 'text' });
  const abandoned = h.session.undo('p-1');
  await flush();
  await h.clock.advance(10_000);
  expect((await abandoned).name).toBe('failed');

  late.resolve({ ok: true, output: null });
  await flush();
  expect(h.kit.undo.active()).toEqual([]);

  expect(await h.session.undo('p-1')).toEqual({ name: 'undone', planId: 'p-1' });
  expect(h.compensations).toHaveLength(1);
});

test('a retry while an abandoned undo is still in flight waits for it instead of compensating again', async () => {
  const late = deferred<EffectResult<unknown>>();
  const h = harness({
    descriptor: {
      ...ordersCreate,
      reversibility: { kind: 'compensate', via: 'orders.cancel', windowMs: 60_000 },
    },
    responders: [answering(complete('p-1'))],
    compensate: () => late.promise,
  });
  await h.session.submit({ text: 'uno', source: 'text' });
  const abandoned = h.session.undo('p-1');
  await flush();
  await h.clock.advance(10_000);
  await abandoned;

  const retry = h.session.undo('p-1');
  await flush();
  late.resolve({ ok: true, output: null });

  expect(await retry).toEqual({ name: 'undone', planId: 'p-1' });
  expect(h.compensations).toHaveLength(1);
});

test('cancel during undoing aborts the undo signal and ends failed ABORTED', async () => {
  const h = harness({ responders: [answering(complete('p-1'))], compensate: hangingUntilAborted });
  await h.session.submit({ text: 'uno', source: 'text' });
  const undone = h.session.undo('p-1');
  await flush();
  h.session.cancel();
  expect((await undone).name).toBe('failed');
  expect(h.compensations[0]?.aborted).toBe(true);
});

test('reset during undoing aborts the undo first and returns to idle', async () => {
  const h = harness({ responders: [answering(complete('p-1'))], compensate: hangingUntilAborted });
  await h.session.submit({ text: 'uno', source: 'text' });
  const undone = h.session.undo('p-1');
  await flush();
  h.session.reset();
  expect(h.session.state().name).toBe('idle');
  await undone;
  expect(h.session.state().name).toBe('idle');
  expect(h.compensations[0]?.aborted).toBe(true);
  expect(h.names()).not.toContain('failed');
  expect(h.announcements.map(({ message }) => message)).not.toContain('msg:ABORTED');
});

test('cancel drops a queued submit: it resolves cancelled and never interprets', async () => {
  const release = deferred<EffectResult<unknown>>();
  const h = harness({
    responders: [answering(complete('p-1')), answering(complete('p-2'))],
    effect: () => release.promise,
  });
  const first = h.session.submit({ text: 'uno', source: 'text' });
  await flush();
  const queued = h.session.submit({ text: 'dos', source: 'text' });
  await flush();
  h.session.cancel();
  release.resolve({ ok: true, output: { orderId: 'o-1' } });
  expect(completedResult(await first)?.status).toBe('completed');
  expect(await queued).toEqual({ name: 'cancelled' });
  expect(h.interpretations).toHaveLength(1);
  expect(h.calls).toHaveLength(1);
});

test('an undo refused because the session is busy announces that it cannot undo now', async () => {
  const pending = deferred<Outcome<Interpretation>>();
  const h = harness({ responders: [answering(complete('p-1')), () => pending.promise] });
  await h.session.submit({ text: 'uno', source: 'text' });
  const second = h.session.submit({ text: 'dos', source: 'text' });
  await flush();
  expect((await h.session.undo('p-1')).name).toBe('interpreting');
  expect(h.announcements.at(-1)).toEqual({ message: 'msg:NOT_AVAILABLE', politeness: 'polite' });
  h.session.cancel();
  pending.resolve(ok(unsupported));
  await second;
});

test('capture moves idle to capturing listening and submit leaves it for interpreting', async () => {
  const h = harness({ responders: [answering(complete('p-1'))] });
  const signal = h.session.capture('listening');
  expect(h.session.state()).toEqual({ name: 'capturing', mode: 'listening' });
  expect(signal.aborted).toBe(false);
  await h.session.submit({ text: 'pedido', source: 'voice' });
  expect(signal.aborted).toBe(true);
  expect(h.names()).toEqual(['capturing', 'interpreting', 'executing', 'presenting', 'completed']);
});

test('cancel while capturing aborts the capture signal and ends in cancelled without calling interpret', () => {
  const h = harness();
  const signal = h.session.capture('typing');
  h.session.cancel();
  expect(signal.aborted).toBe(true);
  expect(h.session.state().name).toBe('cancelled');
  expect(h.interpretations).toEqual([]);
});

test('a second capture aborts the first capture signal', () => {
  const h = harness();
  const first = h.session.capture('typing');
  const second = h.session.capture('listening');
  expect(first.aborted).toBe(true);
  expect(second.aborted).toBe(false);
  expect(h.session.state()).toEqual({ name: 'capturing', mode: 'listening' });
});
