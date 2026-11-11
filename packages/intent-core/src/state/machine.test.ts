import { describe, expect, test } from 'vitest';
import type { ActionResult } from '../contracts/action.js';
import type { Failure } from '../contracts/failure.js';
import type { SessionEvent, SessionState } from '../contracts/session.js';
import { isCancellable, isTerminal, transition } from './machine.js';

const failure: Failure = { stage: 'execution', code: 'EXECUTION_FAILED', retryable: false };
const completedResult: ActionResult = {
  status: 'completed',
  planId: 'p1',
  capabilityId: 'cap',
  output: null,
  presentation: { status: 'shown' },
};
const handedOffResult: ActionResult = {
  status: 'handedOff',
  planId: 'p1',
  capabilityId: 'cap',
  presentation: { status: 'skipped' },
};
const undoneResult: ActionResult = { status: 'undone', planId: 'p1', capabilityId: 'cap' };
type Received = Extract<SessionEvent, { type: 'interpretation.received' }>['interpretation'];
type Clarification = Extract<SessionState, { name: 'clarifying' }>['interpretation'];
const incomplete: Clarification = {
  status: 'incomplete',
  draft: { capabilityId: 'cap', version: 1, input: {} },
  missing: [],
};
const ambiguous: Clarification = { status: 'ambiguous', candidates: [] };
const unsupportedInterpretation = { status: 'unsupported', suggestions: ['a', 'b'] } as const;

const idle: SessionState = { name: 'idle' };
const capturing: SessionState = { name: 'capturing', mode: 'typing' };
const interpreting: SessionState = { name: 'interpreting' };
const clarifying: SessionState = {
  name: 'clarifying',
  interpretation: incomplete,
};
const unsupported: SessionState = { name: 'unsupported', suggestions: [] };
const awaiting: SessionState = { name: 'awaitingConfirmation', planId: 'p1' };
const executingUnsent: SessionState = {
  name: 'executing',
  planId: 'p1',
  sent: false,
  cancellableAfterSend: false,
};
const executingSentCancellable: SessionState = {
  name: 'executing',
  planId: 'p1',
  sent: true,
  cancellableAfterSend: true,
};
const executingSentFixed: SessionState = {
  name: 'executing',
  planId: 'p1',
  sent: true,
  cancellableAfterSend: false,
};
const presenting: SessionState = { name: 'presenting', planId: 'p1' };
const completed: SessionState = { name: 'completed', result: completedResult };
const undoing: SessionState = { name: 'undoing', planId: 'p1' };
const undone: SessionState = { name: 'undone', planId: 'p1' };
const cancelled: SessionState = { name: 'cancelled' };
const failed: SessionState = { name: 'failed', failure };

const terminals: readonly SessionState[] = [completed, undone, cancelled, failed, unsupported];
const allStates: readonly SessionState[] = [
  idle,
  capturing,
  interpreting,
  clarifying,
  unsupported,
  awaiting,
  executingUnsent,
  executingSentCancellable,
  executingSentFixed,
  presenting,
  completed,
  undoing,
  undone,
  cancelled,
  failed,
];

const typed = (mode: 'typing' | 'listening'): SessionEvent => ({ type: 'capture.started', mode });
const submitted: SessionEvent = { type: 'capture.submitted' };
const received = (interpretation: Received): SessionEvent => ({
  type: 'interpretation.received',
  interpretation,
});
const answer: SessionEvent = { type: 'answer.submitted' };
const confirmation: SessionEvent = { type: 'confirmation.requested', planId: 'p1' };
const started: SessionEvent = { type: 'execution.started', planId: 'p1' };
const sent = (cancellableAfterSend: boolean): SessionEvent => ({
  type: 'execution.sent',
  cancellableAfterSend,
});
const presentation: SessionEvent = { type: 'presentation.started' };
const settled = (result: ActionResult): SessionEvent => ({ type: 'action.settled', result });
const undoStarted: SessionEvent = { type: 'undo.started', planId: 'p1' };
const undoFinished: SessionEvent = { type: 'undo.finished' };
const cancel: SessionEvent = { type: 'cancel' };
const fail: SessionEvent = { type: 'failure', failure };
const reset: SessionEvent = { type: 'reset' };

const allEvents: readonly SessionEvent[] = [
  typed('listening'),
  submitted,
  received(incomplete),
  answer,
  confirmation,
  started,
  sent(true),
  presentation,
  settled(completedResult),
  undoStarted,
  undoFinished,
  cancel,
  fail,
  reset,
];

const interpretingNames = (state: SessionState): string => state.name;

function variant(state: SessionState): string {
  if (state.name !== 'executing') return state.name;
  if (!state.sent) return 'executing(unsent)';
  return state.cancellableAfterSend ? 'executing(sent,cancellable)' : 'executing(sent,fixed)';
}

describe('transition table', () => {
  test.each<[SessionState, SessionEvent, SessionState]>([
    ...[idle, ...terminals].map((from): [SessionState, SessionEvent, SessionState] => [
      from,
      typed('listening'),
      { name: 'capturing', mode: 'listening' },
    ]),
    ...[idle, capturing, ...terminals].map((from): [SessionState, SessionEvent, SessionState] => [
      from,
      submitted,
      interpreting,
    ]),
    [interpreting, received(incomplete), { name: 'clarifying', interpretation: incomplete }],
    [interpreting, received(ambiguous), { name: 'clarifying', interpretation: ambiguous }],
    [
      interpreting,
      received(unsupportedInterpretation),
      { name: 'unsupported', suggestions: ['a', 'b'] },
    ],
    [clarifying, answer, interpreting],
    ...[interpreting, clarifying].map((from): [SessionState, SessionEvent, SessionState] => [
      from,
      confirmation,
      awaiting,
    ]),
    ...[interpreting, clarifying, awaiting].map(
      (from): [SessionState, SessionEvent, SessionState] => [from, started, executingUnsent],
    ),
    [executingUnsent, sent(true), executingSentCancellable],
    [executingUnsent, sent(false), executingSentFixed],
    [executingSentFixed, presentation, presenting],
    [executingUnsent, presentation, presenting],
    ...[executingUnsent, executingSentFixed, presenting].flatMap(
      (from): [SessionState, SessionEvent, SessionState][] => [
        [from, settled(completedResult), completed],
        [from, settled(handedOffResult), { name: 'completed', result: handedOffResult }],
      ],
    ),
    [executingSentFixed, settled(undoneResult), undone],
    [completed, undoStarted, undoing],
    [undoing, undoFinished, undone],
    ...[
      capturing,
      interpreting,
      clarifying,
      awaiting,
      executingUnsent,
      executingSentCancellable,
    ].map((from): [SessionState, SessionEvent, SessionState] => [from, cancel, cancelled]),
    ...allStates
      .filter((state) => !isTerminal(state))
      .map((from): [SessionState, SessionEvent, SessionState] => [
        from,
        fail,
        { name: 'failed', failure },
      ]),
    ...terminals.map((from): [SessionState, SessionEvent, SessionState] => [from, reset, idle]),
  ])('%o + %o', (from, event, expected) => {
    expect(transition(from, event)).toEqual(expected);
  });
});

describe('no-ops', () => {
  test('cancel in executing(sent: true, cancellableAfterSend: false) is a no-op', () => {
    expect(transition(executingSentFixed, cancel)).toBe(executingSentFixed);
  });

  test('cancel in executing(sent: true) does not produce cancelled', () => {
    expect(transition(executingSentFixed, cancel).name).toBe('executing');
    expect(transition(executingSentFixed, cancel)).not.toEqual(cancelled);
  });

  test('a duplicate execution.sent in executing(sent: true) returns the same object', () => {
    expect(transition(executingSentFixed, sent(true))).toBe(executingSentFixed);
    expect(transition(executingSentCancellable, sent(true))).toBe(executingSentCancellable);
  });

  test('cancel in presenting is a no-op for the reducer', () => {
    expect(transition(presenting, cancel)).toBe(presenting);
  });

  test('undo.started with a foreign planId is a no-op', () => {
    expect(transition(completed, { type: 'undo.started', planId: 'other' })).toBe(completed);
  });

  test('every state x event pair not in the table returns the identical state object', () => {
    const changed: string[] = [];
    for (const state of allStates) {
      for (const event of allEvents) {
        const next = transition(state, event);
        if (next !== state) changed.push(`${variant(state)}+${event.type}`);
      }
    }
    expect([...new Set(changed)].sort()).toEqual([...new Set(EXPECTED_CHANGES)].sort());
  });
});

const EXECUTING = ['executing(unsent)', 'executing(sent,cancellable)', 'executing(sent,fixed)'];

const EXPECTED_CHANGES: readonly string[] = [
  ...['idle', 'completed', 'undone', 'cancelled', 'failed', 'unsupported'].map(
    (name) => `${name}+capture.started`,
  ),
  ...['idle', 'capturing', 'completed', 'undone', 'cancelled', 'failed', 'unsupported'].map(
    (name) => `${name}+capture.submitted`,
  ),
  'interpreting+interpretation.received',
  'clarifying+answer.submitted',
  ...['interpreting', 'clarifying'].map((name) => `${name}+confirmation.requested`),
  ...['interpreting', 'clarifying', 'awaitingConfirmation'].map(
    (name) => `${name}+execution.started`,
  ),
  'executing(unsent)+execution.sent',
  ...EXECUTING.map((name) => `${name}+presentation.started`),
  ...[...EXECUTING, 'presenting'].map((name) => `${name}+action.settled`),
  'completed+undo.started',
  'undoing+undo.finished',
  ...[
    'capturing',
    'interpreting',
    'clarifying',
    'awaitingConfirmation',
    'executing(unsent)',
    'executing(sent,cancellable)',
  ].map((name) => `${name}+cancel`),
  ...allStates.filter((state) => !isTerminal(state)).map((state) => `${variant(state)}+failure`),
  ...terminals.map((state) => `${state.name}+reset`),
];

describe('predicates', () => {
  test('isTerminal is true exactly for completed, undone, cancelled, failed, unsupported', () => {
    const terminalNames = allStates.filter(isTerminal).map(interpretingNames);
    expect([...new Set(terminalNames)].sort()).toEqual(
      ['cancelled', 'completed', 'failed', 'undone', 'unsupported'].sort(),
    );
  });

  test.each([
    [capturing, true],
    [interpreting, true],
    [clarifying, true],
    [awaiting, true],
    [executingUnsent, true],
    [executingSentCancellable, true],
    [executingSentFixed, false],
    [presenting, true],
    [idle, false],
    [completed, false],
    [undoing, false],
  ])('isCancellable(%o) is %s', (state, expected) => {
    expect(isCancellable(state)).toBe(expected);
  });
});
