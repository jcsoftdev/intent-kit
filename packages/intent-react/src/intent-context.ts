import { createContext, useContext } from 'react';
import type { IntentSession, TargetRegistry } from '@jcsoftdev/intent-core';

export interface IntentContextValue {
  readonly session: IntentSession;
  readonly targets: TargetRegistry<Element>;
}

export const IntentContext = createContext<IntentContextValue | undefined>(undefined);

export function useIntentContext(): IntentContextValue {
  const value = useContext(IntentContext);
  if (!value) {
    throw new Error('Intent hooks must be used inside an IntentProvider');
  }
  return value;
}
