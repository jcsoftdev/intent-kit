import type { ReactNode } from 'react';
import {
  createCapabilityRegistry,
  createIntentKit,
  createRoleAuthorizer,
  type FailureMessages,
  type IntentKit,
  type SemanticExpectation,
  type TargetRef,
  type TargetRegistry,
} from '@jcsoftdev/intent-core';
import { IntentProvider } from '../src/intent-provider.js';

const failureMessages: FailureMessages = {
  CAPABILITY_NOT_FOUND: 'x',
  INTERPRETER_UNAVAILABLE: 'x',
  INTERPRETER_TIMEOUT: 'x',
  ENTITY_NOT_FOUND: 'x',
  RESOLUTION_UNAVAILABLE: 'x',
  INVALID_INPUT: 'x',
  UNAUTHORIZED: 'x',
  NOT_AVAILABLE: 'x',
  AGENT_FORBIDDEN: 'x',
  RATE_LIMITED: 'x',
  CONFIRMATION_DECLINED: 'x',
  NAVIGATION_FAILED: 'x',
  ROUTE_NOT_READY: 'x',
  EXECUTION_FAILED: 'x',
  CONFLICT: 'x',
  STALE_PLAN: 'x',
  TARGET_NOT_FOUND: 'x',
  SEMANTICS_VIOLATION: 'x',
  ABORTED: 'x',
};

export interface RecordingTargets extends TargetRegistry<Element> {
  readonly registered: () => readonly string[];
}

export const createRecordingTargets = (): RecordingTargets => {
  const live = new Map<string, Element>();
  const keyOf = (ref: TargetRef): string => `${ref.intent}:${ref.key ?? ''}`;
  return {
    register(ref: TargetRef, element: Element, _expectation: SemanticExpectation) {
      live.set(keyOf(ref), element);
      return () => {
        live.delete(keyOf(ref));
      };
    },
    find: (ref) => live.get(keyOf(ref)),
    waitFor: async (ref) => {
      const element = live.get(keyOf(ref));
      if (!element) {
        throw new Error('missing');
      }
      return element;
    },
    registered: () => [...live.keys()],
  };
};

export const createTestKit = (): IntentKit =>
  createIntentKit<null, string, string, Element>({
    registry: createCapabilityRegistry(),
    authorizer: createRoleAuthorizer(() => ({ active: 'waiter', granted: ['waiter'] })),
    confirmation: { confirm: async () => 'confirmed' },
    router: {
      currentRoute: () => undefined,
      navigate: async () => undefined,
      waitUntilReady: async () => undefined,
    },
    targets: createRecordingTargets(),
    revealer: { reveal: async () => undefined },
    announcer: { announce: () => undefined },
    messages: {},
    compensator: { compensate: async () => ({ ok: true, output: null }) },
    interpretation: {
      interpret: async () => ({ ok: true, value: { status: 'unsupported', suggestions: [] } }),
    },
    principal: () => null,
    activeRole: () => 'waiter',
    locale: 'es-PE',
    failureMessages,
  });

export const wrapperOf =
  (kit: IntentKit, targets: TargetRegistry<Element>) =>
  ({ children }: { children: ReactNode }) => (
    <IntentProvider kit={kit} targets={targets}>
      {children}
    </IntentProvider>
  );
