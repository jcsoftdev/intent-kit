import type { SessionEvent, SessionState } from '../contracts/session.js';

type Name = SessionState['name'];

const TERMINAL_NAMES: ReadonlySet<Name> = new Set([
  'completed',
  'undone',
  'cancelled',
  'failed',
  'unsupported',
]);

const CAPTURE_START_FROM: ReadonlySet<Name> = new Set(['idle']);
const CAPTURE_SUBMIT_FROM: ReadonlySet<Name> = new Set(['idle', 'capturing']);
const UNDO_START_FROM: ReadonlySet<Name> = new Set(['idle']);
const CONFIRMATION_FROM: ReadonlySet<Name> = new Set(['interpreting', 'clarifying']);
const EXECUTION_FROM: ReadonlySet<Name> = new Set([
  'interpreting',
  'clarifying',
  'awaitingConfirmation',
]);
const SETTLE_FROM: ReadonlySet<Name> = new Set(['executing', 'presenting']);
const CANCEL_FROM: ReadonlySet<Name> = new Set([
  'capturing',
  'interpreting',
  'clarifying',
  'awaitingConfirmation',
]);

export function isTerminal(state: SessionState): boolean {
  return TERMINAL_NAMES.has(state.name);
}

export function isCancellable(state: SessionState): boolean {
  if (state.name === 'executing') return !state.sent || state.cancellableAfterSend;
  return state.name === 'presenting' || CANCEL_FROM.has(state.name);
}

function startsFrom(from: ReadonlySet<Name>, state: SessionState): boolean {
  return from.has(state.name) || isTerminal(state);
}

function reduce(state: SessionState, event: SessionEvent): SessionState | undefined {
  switch (event.type) {
    case 'capture.started':
      return startsFrom(CAPTURE_START_FROM, state)
        ? { name: 'capturing', mode: event.mode }
        : undefined;
    case 'capture.submitted':
      return startsFrom(CAPTURE_SUBMIT_FROM, state) ? { name: 'interpreting' } : undefined;
    case 'interpretation.received':
      if (state.name !== 'interpreting') return undefined;
      return event.interpretation.status === 'unsupported'
        ? { name: 'unsupported', suggestions: event.interpretation.suggestions }
        : { name: 'clarifying', interpretation: event.interpretation };
    case 'answer.submitted':
      return state.name === 'clarifying' ? { name: 'interpreting' } : undefined;
    case 'confirmation.requested':
      return CONFIRMATION_FROM.has(state.name)
        ? { name: 'awaitingConfirmation', planId: event.planId }
        : undefined;
    case 'execution.started':
      return EXECUTION_FROM.has(state.name)
        ? { name: 'executing', planId: event.planId, sent: false, cancellableAfterSend: false }
        : undefined;
    case 'execution.sent':
      return state.name === 'executing' && !state.sent
        ? { ...state, sent: true, cancellableAfterSend: event.cancellableAfterSend }
        : undefined;
    case 'presentation.started':
      return state.name === 'executing' ? { name: 'presenting', planId: state.planId } : undefined;
    case 'action.settled':
      return settle(state, event.result);
    case 'undo.started':
      return startsFrom(UNDO_START_FROM, state)
        ? { name: 'undoing', planId: event.planId }
        : undefined;
    case 'undo.finished':
      return state.name === 'undoing' ? { name: 'undone', planId: state.planId } : undefined;
    case 'cancel':
      return isCancellable(state) && state.name !== 'presenting'
        ? { name: 'cancelled' }
        : undefined;
    case 'failure':
      return isTerminal(state) ? undefined : { name: 'failed', failure: event.failure };
    case 'reset':
      return isTerminal(state) || state.name === 'undoing' ? { name: 'idle' } : undefined;
  }
}

function settle(
  state: SessionState,
  result: Extract<SessionEvent, { type: 'action.settled' }>['result'],
): SessionState | undefined {
  if (!SETTLE_FROM.has(state.name)) return undefined;
  if (result.status === 'undone') {
    return state.name === 'executing' ? { name: 'undone', planId: result.planId } : undefined;
  }
  return { name: 'completed', result };
}

export function transition(state: SessionState, event: SessionEvent): SessionState {
  return reduce(state, event) ?? state;
}
