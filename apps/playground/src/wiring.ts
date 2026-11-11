import {
  createCapabilityRegistry,
  createFormBindingRegistry,
  createIntentKit,
  createManualClock,
  createRoleAuthorizer,
  stageName,
} from '@jcsoftdev/intent-core';
import type {
  Effect,
  FormBindingRegistry,
  InterpretationClient,
  Interpretation,
  IntentKit,
  IntentSession,
  ManualClock,
  PrincipalRoles,
  SemanticExpectation,
  Stage,
  TargetRef,
  Unregister,
} from '@jcsoftdev/intent-core';
import {
  INTERPRETATION_STAGES,
  SPANISH_NORMALIZATION,
  createInterpretationService,
  createNormalizer,
} from '@jcsoftdev/intent-server';
import type { InterpretationService, InterpretationState } from '@jcsoftdev/intent-server';
import {
  createFakeTargetRegistry,
  createRecordingAnnouncer,
  createRecordingEventBus,
  createRecordingRevealer,
  createScriptedConfirmation,
} from '@jcsoftdev/intent-testing';
import type { FakeElement, FakeTargetRegistry } from '@jcsoftdev/intent-testing';
import { createZodSchemaAdapter } from '@jcsoftdev/intent-zod';
import { playgroundCapabilities } from './capabilities.js';
import type { PlaygroundCapabilityId } from './capabilities.js';
import {
  changePasswordEffect,
  createCloseShiftEffect,
  createMarkReadyEffect,
  createOrdersCreateEffect,
  createRecallEffect,
} from './effects.js';
import { createKeywordInterpreter } from './interpreter.js';
import type { KeywordInterpreter } from './interpreter.js';
import { failureMessages, playgroundMessages } from './messages.js';
import { createModifiersProbe } from './probes.js';
import { PLAYGROUND_EPOCH, createRestaurantStore } from './restaurant.js';
import type {
  PlaygroundPrincipal,
  PlaygroundRole,
  PlaygroundRouteId,
  RestaurantStore,
} from './restaurant.js';
import { createPlaygroundResolvers } from './resolvers.js';
import { createMemoryRouter } from './router.js';
import type { MemoryRouter } from './router.js';

export interface AuditLog {
  recorded(): readonly (readonly string[])[];
}

export interface Playground {
  readonly store: RestaurantStore;
  readonly router: MemoryRouter;
  readonly targets: FakeTargetRegistry;
  readonly announcer: ReturnType<typeof createRecordingAnnouncer>;
  readonly interpreter: KeywordInterpreter;
  readonly service: InterpretationService<PlaygroundPrincipal>;
  readonly kit: IntentKit;
  readonly session: IntentSession;
  readonly clock: ManualClock;
  readonly revealer: ReturnType<typeof createRecordingRevealer>;
  readonly confirmation: ReturnType<typeof createScriptedConfirmation>;
  readonly events: ReturnType<typeof createRecordingEventBus>;
  readonly forms: FormBindingRegistry;
  readonly audit: AuditLog;
}

export interface PlaygroundOptions {
  readonly principal: PlaygroundPrincipal;
  readonly route?: PlaygroundRouteId;
  readonly confirmations?: readonly ('confirmed' | 'declined')[];
}

interface PageMount {
  readonly routeId: PlaygroundRouteId;
  readonly ref: TargetRef;
  readonly element: FakeElement;
}

interface MountedPage {
  readonly mount: PageMount;
  unregister: Unregister | undefined;
}

const LOCALE = 'es-PE';
const ARTICLE: SemanticExpectation = { role: 'article', requireName: true };

const HOME_ROUTES: Readonly<Record<PlaygroundRole, PlaygroundRouteId>> = {
  waiter: 'salon',
  kitchen: 'kitchenQueue',
  cashier: 'cash',
};

const rolesOf = (principal: PlaygroundPrincipal): PrincipalRoles<PlaygroundRole> => ({
  active: principal.activeRole,
  granted: principal.roles,
});

const keyOf = ({ ref }: PageMount): string => JSON.stringify([ref.intent, ref.key ?? null]);

const articleOf = (intent: string, orderId: string, name: string): FakeElement => ({
  id: `${intent}:${orderId}`,
  role: 'article',
  name,
});

const orderMount = (
  routeId: PlaygroundRouteId,
  intent: string,
  orderId: string,
  name: string,
): PageMount => ({
  routeId,
  ref: { intent, key: orderId },
  element: articleOf(intent, orderId, name),
});

function createPageMounts(router: MemoryRouter, targets: FakeTargetRegistry) {
  const pages = new Map<string, MountedPage>();

  const sync = (): void => {
    const current = router.currentRoute()?.routeId;
    pages.forEach((page) => {
      const visible = page.mount.routeId === current;
      if (visible && !page.unregister) {
        page.unregister = targets.register(page.mount.ref, page.mount.element, ARTICLE);
      } else if (!visible && page.unregister) {
        page.unregister();
        page.unregister = undefined;
      }
    });
  };

  router.subscribe(sync);

  return {
    mount(mount: PageMount): void {
      const key = keyOf(mount);
      if (!pages.has(key)) {
        pages.set(key, { mount, unregister: undefined });
      }
      sync();
    },
  };
}

const mounting = <TInput, TOutput>(
  effect: Effect<TInput, TOutput>,
  mountsOf: (output: TOutput) => readonly PageMount[],
  mount: (page: PageMount) => void,
): Effect<TInput, TOutput> => ({
  async run(input, context) {
    const result = await effect.run(input, context);
    if (result.ok) {
      mountsOf(result.output).forEach(mount);
    }
    return result;
  },
});

const createAuditStage = (
  log: (readonly string[])[],
): Stage<InterpretationState<PlaygroundPrincipal>, Interpretation> => ({
  name: stageName('audit'),
  phase: 'policy',
  requires: ['catalog'],
  provides: [],
  async run(context, next) {
    log.push(context.get('catalog').entries.map((entry) => entry.descriptor.id));
    return next();
  },
});

const initialRoute = (options: PlaygroundOptions): PlaygroundRouteId =>
  options.route ?? HOME_ROUTES[options.principal.activeRole];

export function createPlayground(options: PlaygroundOptions): Playground {
  const { principal } = options;
  const clock = createManualClock(PLAYGROUND_EPOCH);
  const store = createRestaurantStore();
  const router = createMemoryRouter({ routeId: initialRoute(options) });
  const targets = createFakeTargetRegistry();
  const announcer = createRecordingAnnouncer();
  const revealer = createRecordingRevealer();
  const confirmation = createScriptedConfirmation(options.confirmations ?? []);
  const events = createRecordingEventBus();
  const forms = createFormBindingRegistry();
  const interpreter = createKeywordInterpreter();
  const auditLog: (readonly string[])[] = [];
  const pages = createPageMounts(router, targets);
  const normalize = createNormalizer(SPANISH_NORMALIZATION);
  const dependencies = { store, principal: () => principal, now: () => clock.now() };

  const service = createInterpretationService<PlaygroundPrincipal, PlaygroundRole>({
    capabilities: playgroundCapabilities,
    schema: createZodSchemaAdapter(),
    rolesOf,
    resolvers: createPlaygroundResolvers({ store, clock, normalize }),
    probes: [createModifiersProbe(store)],
    interpreter,
    normalization: SPANISH_NORMALIZATION,
    clock,
    events,
    customize: (builder) =>
      builder.insertAfter(INTERPRETATION_STAGES.catalog, createAuditStage(auditLog)),
  });

  const interpretation: InterpretationClient = {
    interpret: (input, { signal }) => service.interpret(principal, input, { signal }),
  };

  const effects: Readonly<Record<PlaygroundCapabilityId, Effect<never, unknown>>> = {
    'orders.create': mounting(
      createOrdersCreateEffect(dependencies),
      ({ orderId, serviceNumber, tableLabel }) => {
        const name = `Pedido ${serviceNumber} · ${tableLabel}`;
        return [
          orderMount('myOrders', 'my-order', orderId, name),
          orderMount('orders', 'order-card', orderId, name),
        ];
      },
      pages.mount,
    ),
    'kitchen.lines.markReady': mounting(
      createMarkReadyEffect(dependencies),
      ({ orderId, serviceNumber, tableLabel }) => {
        const name = `Pedido ${serviceNumber} · ${tableLabel}`;
        return [
          orderMount('myOrders', 'my-order', orderId, name),
          orderMount('kitchenQueue', 'kitchen-ticket', orderId, name),
        ];
      },
      pages.mount,
    ),
    'kitchen.lines.recall': createRecallEffect(dependencies),
    'cash.shift.close': createCloseShiftEffect(dependencies),
    'auth.password.change': changePasswordEffect,
  };

  const registry = createCapabilityRegistry();
  playgroundCapabilities.forEach((descriptor) =>
    registry.register(descriptor, async () => ({ default: effects[descriptor.id] })),
  );

  const kit = createIntentKit<PlaygroundPrincipal, PlaygroundRole, PlaygroundRouteId, FakeElement>({
    registry,
    authorizer: createRoleAuthorizer(rolesOf),
    confirmation,
    router,
    targets,
    revealer,
    announcer,
    messages: playgroundMessages,
    forms,
    clock,
    events,
    interpretation,
    principal: () => principal,
    activeRole: () => principal.activeRole,
    locale: LOCALE,
    failureMessages,
  });

  return {
    store,
    router,
    targets,
    announcer,
    interpreter,
    service,
    kit,
    session: kit.createSession(),
    clock,
    revealer,
    confirmation,
    events,
    forms,
    audit: { recorded: () => [...auditLog] },
  };
}
