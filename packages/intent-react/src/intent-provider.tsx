import { useMemo, type ReactNode } from 'react';
import type { IntentKit, TargetRegistry } from '@jcsoftdev/intent-core';
import { IntentContext } from './intent-context.js';

export interface IntentProviderProps {
  readonly kit: IntentKit;
  readonly targets: TargetRegistry<Element>;
  readonly children: ReactNode;
}

export function IntentProvider({ kit, targets, children }: IntentProviderProps) {
  const value = useMemo(() => ({ session: kit.createSession(), targets }), [kit, targets]);
  return <IntentContext value={value}>{children}</IntentContext>;
}
