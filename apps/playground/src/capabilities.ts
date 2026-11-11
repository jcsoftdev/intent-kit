import { createCapabilityDefiner } from '@jcsoftdev/intent-core';
import type { PlaygroundRole, PlaygroundRouteId } from './restaurant.js';
import {
  changePasswordInput,
  changePasswordOutput,
  closeShiftInput,
  closeShiftOutput,
  markReadyInput,
  markReadyOutput,
  ordersCreateInput,
  ordersCreateOutput,
  recallInput,
  recallOutput,
} from './schemas.js';

const define = createCapabilityDefiner<PlaygroundRole, PlaygroundRouteId>();

export const ordersCreate = define({
  id: 'orders.create',
  version: 1,
  kind: 'write',
  agent: 'allowed',
  description: 'Crear un pedido para una mesa',
  aliases: ['pedido', 'manda', 'mandale', 'pide', 'ordena'],
  examples: ['pedido de arroz con pollo para la mesa 3'],
  patterns: [
    '{quantity?} {dish} para la mesa {table}',
    'pedido de {quantity?} {dish} para la mesa {table}',
  ],
  scope: 'global',
  input: ordersCreateInput,
  output: ordersCreateOutput,
  entities: [
    { path: 'tableId', entity: 'table' },
    { path: 'lines[].offeringId', entity: 'dish' },
  ],
  risk: 'write',
  confirmation: 'whenIrreversible',
  reversibility: { kind: 'compensate', via: 'kitchen.lines.recall', windowMs: 0 },
  idempotency: { kind: 'key', carrier: 'body', field: 'idempotencyKey' },
  roles: ['waiter'],
  destination: {
    default: { routeId: 'orders', target: { intent: 'order-card', key: '{output.orderId}' } },
    byRole: {
      waiter: { routeId: 'myOrders', target: { intent: 'my-order', key: '{output.orderId}' } },
    },
  },
  form: { formId: 'manual-order' },
});

export const markReady = define({
  id: 'kitchen.lines.markReady',
  version: 1,
  kind: 'write',
  agent: 'allowed',
  description: 'Marcar un plato como listo',
  aliases: ['listo', 'lista', 'despacha', 'sale'],
  examples: ['el arroz con pollo está listo'],
  patterns: ['(el|la) {kitchenLine} está list[oa]'],
  scope: 'global',
  input: markReadyInput,
  output: markReadyOutput,
  entities: [{ path: 'lineIds[]', entity: 'kitchenLine' }],
  risk: 'write',
  confirmation: 'never',
  reversibility: { kind: 'grace', delayMs: 5000 },
  idempotency: { kind: 'natural' },
  roles: ['kitchen', 'waiter'],
  destination: {
    default: { routeId: 'myOrders', target: { intent: 'my-order', key: '{output.orderId}' } },
    byRole: {
      kitchen: {
        routeId: 'kitchenQueue',
        target: { intent: 'kitchen-ticket', key: '{output.orderId}' },
      },
    },
  },
});

export const recall = define({
  id: 'kitchen.lines.recall',
  version: 1,
  kind: 'write',
  agent: 'never',
  description: 'Retirar un pedido de la cola de cocina',
  aliases: [],
  examples: [],
  patterns: [],
  scope: 'global',
  input: recallInput,
  output: recallOutput,
  entities: [],
  risk: 'write',
  confirmation: 'never',
  reversibility: { kind: 'none' },
  idempotency: { kind: 'natural' },
  roles: ['kitchen', 'waiter'],
});

export const closeShift = define({
  id: 'cash.shift.close',
  version: 1,
  kind: 'write',
  agent: 'allowed',
  description: 'Cerrar la caja del turno',
  aliases: ['cierra la caja', 'cerrar caja', 'cerrar la caja'],
  examples: ['cierra la caja'],
  patterns: ['cierra la caja'],
  scope: 'global',
  input: closeShiftInput,
  output: closeShiftOutput,
  entities: [],
  risk: 'destructive',
  confirmation: 'always',
  reversibility: { kind: 'none' },
  idempotency: { kind: 'natural' },
  roles: ['cashier'],
});

export const changePassword = define({
  id: 'auth.password.change',
  version: 1,
  kind: 'write',
  agent: 'never',
  description: 'Cambiar la contraseña',
  aliases: [],
  examples: [],
  patterns: [],
  scope: 'global',
  input: changePasswordInput,
  output: changePasswordOutput,
  entities: [],
  risk: 'write',
  confirmation: 'always',
  reversibility: { kind: 'none' },
  idempotency: { kind: 'none' },
  roles: ['waiter', 'kitchen', 'cashier'],
});

export const playgroundCapabilities = [
  ordersCreate,
  markReady,
  recall,
  closeShift,
  changePassword,
] as const;

export type PlaygroundCapabilityId = (typeof playgroundCapabilities)[number]['id'];
