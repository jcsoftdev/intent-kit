import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { SemanticExpectation, TargetRef } from '@jcsoftdev/intent-core';
import { createIntentBridge } from './intent-bridge.js';
import { useIntentContext } from './intent-context.js';

export function useIntentTarget(
  ref: TargetRef,
  expectation: SemanticExpectation,
): (element: Element | null) => void {
  const { targets } = useIntentContext();
  const bridge = useMemo(() => createIntentBridge(targets), [targets]);
  const unregister = useRef<(() => void) | undefined>(undefined);
  const { intent, key } = ref;
  const { role, requireName } = expectation;

  const attach = useCallback(
    (element: Element | null) => {
      unregister.current?.();
      unregister.current = element
        ? bridge.registerTarget(key === undefined ? { intent } : { intent, key }, element, {
            role,
            requireName,
          })
        : undefined;
    },
    [bridge, intent, key, role, requireName],
  );

  useEffect(
    () => () => {
      unregister.current?.();
      unregister.current = undefined;
    },
    [],
  );

  return attach;
}
