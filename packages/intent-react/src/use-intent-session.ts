import { useSyncExternalStore } from 'react';
import type { IntentSession, SessionState } from '@jcsoftdev/intent-core';
import { useIntentContext } from './intent-context.js';

export function useIntentSession(): { session: IntentSession; state: SessionState } {
  const { session } = useIntentContext();
  const state = useSyncExternalStore(session.subscribe, session.state, session.state);
  return { session, state };
}
