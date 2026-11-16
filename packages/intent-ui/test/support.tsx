import type { ReactNode } from 'react';
import {
  createCapabilityRegistry,
  createIntentKit,
  createRoleAuthorizer,
  type ConfirmationPort,
  type FailureMessages,
  type IntentKit,
  type Interpretation,
  type InterpretationInput,
  type TargetRegistry,
} from '@jcsoftdev/intent-core';
import { IntentProvider } from '@jcsoftdev/intent-react';
import type { AssistantCopy } from '../src/copy.js';

const failureCodes = [
  'CAPABILITY_NOT_FOUND',
  'INTERPRETER_UNAVAILABLE',
  'INTERPRETER_TIMEOUT',
  'ENTITY_NOT_FOUND',
  'RESOLUTION_UNAVAILABLE',
  'INVALID_INPUT',
  'UNAUTHORIZED',
  'NOT_AVAILABLE',
  'AGENT_FORBIDDEN',
  'RATE_LIMITED',
  'CONFIRMATION_DECLINED',
  'NAVIGATION_FAILED',
  'ROUTE_NOT_READY',
  'EXECUTION_FAILED',
  'CONFLICT',
  'STALE_PLAN',
  'TARGET_NOT_FOUND',
  'SEMANTICS_VIOLATION',
  'ABORTED',
] as const;

const failureMessages = Object.fromEntries(
  failureCodes.map((code) => [code, 'x']),
) as unknown as FailureMessages;

export const copy: AssistantCopy = {
  askAssistant: (query) => `Preguntar: ${query}`,
  heard: (transcript) => `Escuché: «${transcript}»`,
  confirm: 'Confirmar',
  decline: 'Cancelar',
  listening: 'Escuchando',
  holdToTalk: 'Mantén para hablar',
  cloudNotice: {
    title: 'Voz en la nube',
    body: 'Se envía el audio',
    accept: 'Aceptar',
    decline: 'No',
  },
  undo: 'Deshacer',
  clarifyTitle: (prompt) => `Elige: ${prompt}`,
};

const noTargets: TargetRegistry<Element> = {
  register: () => () => undefined,
  find: () => undefined,
  waitFor: async () => {
    throw new Error('missing');
  },
};

export interface TestKit {
  readonly kit: IntentKit;
  readonly targets: TargetRegistry<Element>;
  readonly inputs: InterpretationInput[];
}

export const createTestKit = (
  confirmation: ConfirmationPort = { confirm: async () => 'confirmed' },
  interpretation: Interpretation = { status: 'unsupported', suggestions: [] },
): TestKit => {
  const inputs: InterpretationInput[] = [];
  const kit = createIntentKit<null, string, string, Element>({
    registry: createCapabilityRegistry(),
    authorizer: createRoleAuthorizer(() => ({ active: 'waiter', granted: ['waiter'] })),
    confirmation,
    router: {
      currentRoute: () => undefined,
      navigate: async () => undefined,
      waitUntilReady: async () => undefined,
    },
    targets: noTargets,
    revealer: { reveal: async () => undefined },
    announcer: { announce: () => undefined },
    messages: {},
    compensator: { compensate: async () => ({ ok: true, output: null }) },
    interpretation: {
      interpret: async (input) => {
        inputs.push(input);
        return { ok: true, value: interpretation };
      },
    },
    principal: () => null,
    activeRole: () => 'waiter',
    locale: 'es-PE',
    failureMessages,
  });
  return { kit, targets: noTargets, inputs };
};

export const wrapperOf =
  ({ kit, targets }: TestKit) =>
  ({ children }: { children: ReactNode }) => (
    <IntentProvider kit={kit} targets={targets}>
      {children}
    </IntentProvider>
  );
