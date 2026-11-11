import type { CapabilityMessages, FailureMessages, MessageCatalog } from '@jcsoftdev/intent-core';
import type { PlaygroundCapabilityId } from './capabilities.js';
import { markReadyOutput, ordersCreateOutput } from './schemas.js';

const DONE = 'Listo';

const plain = (success: string, confirm: string): CapabilityMessages => ({
  success: () => success,
  confirm: () => confirm,
});

const ordersCreateMessages: CapabilityMessages = {
  success: ({ output }) => {
    const parsed = ordersCreateOutput.safeParse(output);
    return parsed.success ? `Pedido enviado a cocina · ${parsed.data.tableLabel}` : DONE;
  },
  confirm: () => '¿Enviar el pedido a cocina?',
};

const markReadyMessages: CapabilityMessages = {
  success: ({ output }) => {
    const parsed = markReadyOutput.safeParse(output);
    return parsed.success ? `Listo: ${parsed.data.dishName} · ${parsed.data.tableLabel}` : DONE;
  },
  confirm: () => '¿Marcar el plato como listo?',
};

export const playgroundMessages: MessageCatalog<PlaygroundCapabilityId> = {
  'orders.create': ordersCreateMessages,
  'kitchen.lines.markReady': markReadyMessages,
  'kitchen.lines.recall': plain('Pedido retirado de la cola', '¿Retirar el pedido de la cola?'),
  'cash.shift.close': plain('Caja cerrada', '¿Cerrar la caja del turno?'),
  'auth.password.change': plain('Contraseña actualizada', '¿Cambiar tu contraseña?'),
};

export const failureMessages: FailureMessages = {
  CAPABILITY_NOT_FOUND: 'No reconocí esa acción',
  INTERPRETER_UNAVAILABLE: 'El asistente no está disponible ahora',
  INTERPRETER_TIMEOUT: 'El asistente tardó demasiado en responder',
  ENTITY_NOT_FOUND: 'No hay ningún elemento pendiente que coincida con lo que dijiste',
  RESOLUTION_UNAVAILABLE: 'No pude consultar los datos, inténtalo de nuevo',
  INVALID_INPUT: 'Los datos de la solicitud no son válidos',
  UNAUTHORIZED: 'No tienes permiso para hacer eso',
  NOT_AVAILABLE: 'Esa acción no está disponible ahora',
  AGENT_FORBIDDEN: 'El asistente no puede hacer eso, hazlo tú desde la pantalla',
  RATE_LIMITED: 'Demasiados intentos, espera un momento',
  CONFIRMATION_DECLINED: 'Acción cancelada',
  NAVIGATION_FAILED: 'No pude abrir la pantalla',
  ROUTE_NOT_READY: 'La pantalla tardó demasiado en cargar',
  EXECUTION_FAILED: 'No se pudo completar la acción',
  CONFLICT: 'La acción choca con el estado actual',
  STALE_PLAN: 'La solicitud ya no está vigente, inténtalo de nuevo',
  TARGET_NOT_FOUND: 'No encontré el elemento en pantalla',
  SEMANTICS_VIOLATION: 'La pantalla no cumple lo esperado',
  ABORTED: 'Acción cancelada',
};
