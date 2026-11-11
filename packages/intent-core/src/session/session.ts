import type {
  ActionLifecycle,
  ActionResult,
  Announcer,
  Answers,
  EventBus,
  ExecutablePlan,
  Failure,
  FailureMessages,
  Interpretation,
  InterpretationClient,
  InterpretationInput,
  InterpretationOrigin,
  InterpretRequest,
  IntentEvent,
  Outcome,
  Pipeline,
  SessionEvent,
  SessionState,
  UndoRegistry,
  Unregister,
} from '../contracts/index.js';
import type { ActionState } from '../action/index.js';
import { abortFailure } from '../primitives/index.js';
import { isCancellable, isTerminal, transition } from '../state/index.js';
import { answersFromText, mergeAnswers } from './answers.js';

export interface Command {
  readonly text: string;
  readonly source: 'text' | 'voice';
  readonly context?: InterpretRequest['context'];
}

export interface IntentSession {
  state(): SessionState;
  subscribe(listener: (state: SessionState) => void): Unregister;
  submit(command: Command): Promise<SessionState>;
  answer(answers: Answers): Promise<SessionState>;
  answerByText(text: string): Promise<SessionState>;
  chooseCapability(capabilityId: string): Promise<SessionState>;
  cancel(): void;
  undo(planId: string): Promise<SessionState>;
  reset(): void;
}

export interface SessionDependencies<TPrincipal, TRole extends string> {
  readonly interpretation: InterpretationClient;
  readonly pipeline: Pipeline<ActionState<TPrincipal, TRole>, ActionResult>;
  readonly undo: UndoRegistry;
  readonly announcer: Announcer;
  readonly events: EventBus<IntentEvent>;
  readonly principal: () => TPrincipal;
  readonly activeRole: () => TRole;
  readonly locale: string;
  readonly failureMessages: FailureMessages;
}

interface Run<TRole extends string> {
  readonly controller: AbortController;
  readonly role: TRole;
  readonly command: Command;
  reveal: AbortController | undefined;
  last: SessionState;
  origin: InterpretationOrigin;
  answers: Answers;
}

type CompleteInterpretation = Extract<Interpretation, { status: 'complete' }>;

const interpreterUnavailable: Failure = {
  stage: 'interpretation',
  code: 'INTERPRETER_UNAVAILABLE',
  retryable: true,
};

const executionFailed: Failure = { stage: 'execution', code: 'EXECUTION_FAILED', retryable: false };

const idle: SessionState = { name: 'idle' };

const doNothing = (): void => undefined;

const holdsNewCommands = (state: SessionState): boolean =>
  (state.name === 'executing' && state.sent) ||
  state.name === 'presenting' ||
  state.name === 'undoing';

export function createIntentSession<TPrincipal, TRole extends string>(
  dependencies: SessionDependencies<TPrincipal, TRole>,
): IntentSession {
  const listeners = new Set<(state: SessionState) => void>();
  let current: SessionState = idle;
  let active: Run<TRole> | undefined;
  let running: Promise<void> | undefined;
  let queueTicket = 0;

  const send = (run: Run<TRole>, event: SessionEvent): void => {
    if (run !== active) {
      return;
    }
    const next = transition(current, event);
    if (next === current) {
      return;
    }
    const from = current.name;
    current = next;
    run.last = next;
    dependencies.events.emit({ type: 'session.transition', from, to: next.name });
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch {
        continue;
      }
    }
  };

  const track = (work: Promise<void>): Promise<void> => {
    const tracked: Promise<void> = work.then(doNothing, doNothing).then(() => {
      if (running === tracked) {
        running = undefined;
      }
    });
    running = tracked;
    return tracked;
  };

  const fail = (run: Run<TRole>, failure: Failure): void => {
    if (run !== active || isTerminal(current)) {
      return;
    }
    dependencies.announcer.announce(dependencies.failureMessages[failure.code], 'assertive');
    send(run, { type: 'failure', failure });
  };

  const cancelRun = (run: Run<TRole>): void => {
    if (run !== active) {
      return;
    }
    if (current.name === 'presenting') {
      run.reveal?.abort();
      return;
    }
    if (isCancellable(current)) {
      run.controller.abort();
      send(run, { type: 'cancel' });
    }
  };

  const roleChanged = (run: Run<TRole>): boolean => dependencies.activeRole() !== run.role;

  const cancelIfRoleChanged = (run: Run<TRole>): boolean => {
    if (!roleChanged(run)) {
      return false;
    }
    cancelRun(run);
    return true;
  };

  const guardRole = (run: Run<TRole>): void => {
    cancelIfRoleChanged(run);
    run.controller.signal.throwIfAborted();
  };

  const lifecycleOf = (run: Run<TRole>): ActionLifecycle => ({
    confirming(planId) {
      guardRole(run);
      send(run, { type: 'confirmation.requested', planId });
    },
    executing(planId) {
      guardRole(run);
      send(run, { type: 'execution.started', planId });
    },
    sending(_planId, cancellableAfterSend) {
      guardRole(run);
      send(run, { type: 'execution.sent', cancellableAfterSend });
    },
    presenting() {
      const reveal = new AbortController();
      run.reveal = reveal;
      send(run, { type: 'presentation.started' });
      return AbortSignal.any([reveal.signal, run.controller.signal]);
    },
  });

  const planOf = (run: Run<TRole>, interpretation: CompleteInterpretation): ExecutablePlan => ({
    planId: interpretation.planId,
    draft: interpretation.draft,
    source: run.command.source,
    ...(run.command.source === 'voice' ? { heard: run.command.text } : {}),
  });

  const runAction = async (run: Run<TRole>, plan: ExecutablePlan): Promise<void> => {
    let outcome: Outcome<ActionResult>;
    try {
      outcome = await dependencies.pipeline.run(
        {
          plan,
          principal: dependencies.principal(),
          role: run.role,
          lifecycle: lifecycleOf(run),
        },
        { signal: run.controller.signal },
      );
    } catch {
      outcome = { ok: false, failure: executionFailed };
    }
    if (run !== active) {
      return;
    }
    if (outcome.ok) {
      send(run, { type: 'action.settled', result: outcome.value });
    } else if (!run.controller.signal.aborted) {
      fail(run, outcome.failure);
    }
  };

  const handle = async (run: Run<TRole>, interpretation: Interpretation): Promise<void> => {
    if (interpretation.status === 'complete') {
      run.origin = interpretation.source;
      await track(runAction(run, planOf(run, interpretation)));
      return;
    }
    send(run, { type: 'interpretation.received', interpretation });
  };

  const interpret = async (run: Run<TRole>, input: InterpretationInput): Promise<void> => {
    let outcome: Outcome<Interpretation>;
    try {
      outcome = await dependencies.interpretation.interpret(input, {
        signal: run.controller.signal,
      });
    } catch {
      outcome = {
        ok: false,
        failure: run.controller.signal.aborted
          ? abortFailure('interpretation')
          : interpreterUnavailable,
      };
    }
    if (run !== active || run.controller.signal.aborted || cancelIfRoleChanged(run)) {
      return;
    }
    if (outcome.ok) {
      await handle(run, outcome.value);
    } else {
      fail(run, outcome.failure);
    }
  };

  const utteranceOf = (run: Run<TRole>, restrictTo?: string): InterpretationInput => ({
    kind: 'utterance',
    text: run.command.text,
    locale: dependencies.locale,
    source: run.command.source,
    context: run.command.context ?? {},
    ...(restrictTo === undefined ? {} : { restrictTo }),
  });

  const submit = async (command: Command): Promise<SessionState> => {
    queueTicket += 1;
    const ticket = queueTicket;
    await Promise.resolve();
    while (ticket === queueTicket && holdsNewCommands(current) && running) {
      if (current.name === 'presenting') {
        active?.reveal?.abort();
      }
      await running;
    }
    if (ticket !== queueTicket) {
      return current;
    }
    if (active) {
      cancelRun(active);
    }
    const run: Run<TRole> = {
      controller: new AbortController(),
      role: dependencies.activeRole(),
      command,
      reveal: undefined,
      last: current,
      origin: 'interpreter',
      answers: {},
    };
    active = run;
    send(run, { type: 'capture.submitted' });
    await interpret(run, utteranceOf(run));
    return run.last;
  };

  const resume = async (
    answers: Answers | undefined,
    restrictTo: string | undefined,
  ): Promise<SessionState> => {
    const run = active;
    if (!run || current.name !== 'clarifying' || cancelIfRoleChanged(run)) {
      return current;
    }
    const { interpretation } = current;
    if (restrictTo !== undefined) {
      send(run, { type: 'answer.submitted' });
      await interpret(run, utteranceOf(run, restrictTo));
      return run.last;
    }
    if (!answers || !interpretation.draft) {
      return current;
    }
    run.answers = mergeAnswers(run.answers, answers);
    send(run, { type: 'answer.submitted' });
    await interpret(run, {
      kind: 'continuation',
      locale: dependencies.locale,
      source: run.command.source,
      continuation: { draft: interpretation.draft, answers: run.answers },
      origin: run.origin,
    });
    return run.last;
  };

  const runUndo = async (run: Run<TRole>, planId: string): Promise<void> => {
    try {
      const result = await dependencies.undo.undo(planId, { signal: run.controller.signal });
      if (result.ok) {
        send(run, { type: 'undo.finished' });
      } else {
        fail(run, result.failure);
      }
    } catch {
      fail(run, executionFailed);
    }
  };

  const undo = async (planId: string): Promise<SessionState> => {
    const run = active;
    if (!run) {
      return current;
    }
    if (current.name === 'executing' && current.planId === planId) {
      await dependencies.undo
        .undo(planId, { signal: run.controller.signal })
        .then(doNothing, doNothing);
      await running;
      return current;
    }
    send(run, { type: 'undo.started', planId });
    if (current.name !== 'undoing') {
      return current;
    }
    await track(runUndo(run, planId));
    return current;
  };

  return {
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    submit,
    answer: (answers) => resume(answers, undefined),
    answerByText(text) {
      const answers =
        current.name === 'clarifying' ? answersFromText(current.interpretation, text) : undefined;
      return answers ? resume(answers, undefined) : Promise.resolve(current);
    },
    chooseCapability(capabilityId) {
      const ambiguous =
        current.name === 'clarifying' && current.interpretation.status === 'ambiguous';
      return ambiguous ? resume(undefined, capabilityId) : Promise.resolve(current);
    },
    cancel() {
      if (active) {
        cancelRun(active);
      }
    },
    undo,
    reset() {
      const run = active;
      if (run) {
        cancelRun(run);
        send(run, { type: 'reset' });
      }
    },
  };
}
