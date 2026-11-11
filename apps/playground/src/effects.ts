import { abortFailure } from '@jcsoftdev/intent-core';
import type { Effect, EffectResult, Failure } from '@jcsoftdev/intent-core';
import type { PlaceOrderRefusal, PlaygroundPrincipal, RestaurantStore } from './restaurant.js';
import type {
  ChangePasswordInput,
  ChangePasswordOutput,
  CloseShiftInput,
  CloseShiftOutput,
  MarkReadyInput,
  MarkReadyOutput,
  OrdersCreateInput,
  OrdersCreateOutput,
  RecallInput,
  RecallOutput,
} from './schemas.js';

export const OUT_OF_SEQUENCE = 'LINEA_FUERA_DE_SECUENCIA';

const aborted: EffectResult<never> = { ok: false, failure: abortFailure('execution') };

const executionFailure = (code: Failure['code'], appCode?: string): EffectResult<never> => ({
  ok: false,
  failure: {
    stage: 'execution',
    code,
    ...(appCode === undefined ? {} : { appCode }),
    retryable: false,
  },
});

const REFUSALS: Readonly<Record<PlaceOrderRefusal, EffectResult<never>>> = {
  TABLE_NOT_FOUND: executionFailure('INVALID_INPUT', 'TABLE_NOT_FOUND'),
  DISH_NOT_FOUND: executionFailure('INVALID_INPUT', 'DISH_NOT_FOUND'),
  INVALID_MODIFIERS: executionFailure('INVALID_INPUT', 'INVALID_MODIFIERS'),
  OUT_OF_STOCK: executionFailure('CONFLICT', 'OUT_OF_STOCK'),
};

export interface EffectDependencies {
  readonly store: RestaurantStore;
  readonly principal: () => PlaygroundPrincipal;
  readonly now: () => number;
}

export function createOrdersCreateEffect(
  dependencies: EffectDependencies,
): Effect<OrdersCreateInput, OrdersCreateOutput> {
  const { store, principal, now } = dependencies;
  return {
    async run(input, context) {
      if (context.signal.aborted) {
        return aborted;
      }
      const { tenantId, userId } = principal();
      const placed = store.placeOrder({
        tenantId,
        waiterId: userId,
        idempotencyKey: context.idempotencyKey ?? context.planId,
        tableId: input.tableId,
        lines: input.lines,
        now: now(),
      });
      if (!placed.ok) {
        return REFUSALS[placed.reason];
      }
      return {
        ok: true,
        output: {
          orderId: placed.order.id,
          serviceNumber: placed.order.serviceNumber,
          total: placed.order.total,
          tableLabel: placed.tableLabel,
        },
      };
    },
  };
}

const SEQUENCES = {
  EN_COLA: ['PREPARANDO', 'LISTO'],
  PREPARANDO: ['LISTO'],
} as const;

const sequenceFrom = (state: string): readonly ('PREPARANDO' | 'LISTO')[] | undefined =>
  state === 'EN_COLA' || state === 'PREPARANDO' ? SEQUENCES[state] : undefined;

export function createMarkReadyEffect(
  dependencies: EffectDependencies,
): Effect<MarkReadyInput, MarkReadyOutput> {
  const { store, principal } = dependencies;
  return {
    async run(input, context) {
      if (context.signal.aborted) {
        return aborted;
      }
      const { tenantId, userId, activeRole } = principal();
      const lines = store.lines(tenantId);
      const targets = input.lineIds.map((id) => lines.find((line) => line.id === id));
      const found = targets.flatMap((line) => (line ? [line] : []));
      if (found.length !== targets.length) {
        return executionFailure('ENTITY_NOT_FOUND');
      }
      if (activeRole === 'waiter' && found.some((line) => line.waiterId !== userId)) {
        return executionFailure('UNAUTHORIZED');
      }
      if (found.some((line) => sequenceFrom(line.state) === undefined)) {
        return executionFailure('CONFLICT', OUT_OF_SEQUENCE);
      }
      found.forEach((line) =>
        (sequenceFrom(line.state) ?? []).forEach((to) => store.advanceLine(tenantId, line.id, to)),
      );
      const [first] = found;
      return first
        ? {
            ok: true,
            output: {
              orderId: first.orderId,
              serviceNumber: first.serviceNumber,
              dishName: first.dishName,
              tableLabel: first.tableLabel,
            },
          }
        : executionFailure('INVALID_INPUT');
    },
  };
}

export function createRecallEffect(
  dependencies: EffectDependencies,
): Effect<RecallInput, RecallOutput> {
  return {
    async run(input, context) {
      if (context.signal.aborted) {
        return aborted;
      }
      const removed = dependencies.store.recallOrder(
        dependencies.principal().tenantId,
        input.orderId,
      );
      return { ok: true, output: { removed } };
    },
  };
}

export function createCloseShiftEffect(
  dependencies: EffectDependencies,
): Effect<CloseShiftInput, CloseShiftOutput> {
  return {
    async run(_input, context) {
      if (context.signal.aborted) {
        return aborted;
      }
      dependencies.store.closeCashShift(dependencies.principal().tenantId);
      return { ok: true, output: { closed: true } };
    },
  };
}

export const changePasswordEffect: Effect<ChangePasswordInput, ChangePasswordOutput> = {
  async run(_input, context) {
    return context.signal.aborted ? aborted : { ok: true, output: { changed: true } };
  },
};
