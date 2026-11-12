import type { ActionResult } from './action.js';
import type { Failure } from './failure.js';
import type { Interpretation } from './interpretation.js';

export type SessionState =
  | { readonly name: 'idle' }
  | { readonly name: 'capturing'; readonly mode: 'listening' | 'typing' }
  | { readonly name: 'interpreting' }
  | {
      readonly name: 'clarifying';
      readonly interpretation: Extract<Interpretation, { status: 'incomplete' | 'ambiguous' }>;
    }
  | { readonly name: 'unsupported'; readonly suggestions: readonly string[] }
  | { readonly name: 'awaitingConfirmation'; readonly planId: string }
  | {
      readonly name: 'executing';
      readonly planId: string;
      readonly sent: boolean;
      readonly cancellableAfterSend: boolean;
    }
  | { readonly name: 'presenting'; readonly planId: string }
  | { readonly name: 'completed'; readonly result: ActionResult }
  | { readonly name: 'undoing'; readonly planId: string }
  | { readonly name: 'undone'; readonly planId: string }
  | { readonly name: 'cancelled' }
  | { readonly name: 'failed'; readonly failure: Failure };

export type SessionEvent =
  | { readonly type: 'capture.started'; readonly mode: 'listening' | 'typing' }
  | { readonly type: 'capture.submitted' }
  | {
      readonly type: 'interpretation.received';
      readonly interpretation: Exclude<Interpretation, { status: 'complete' }>;
    }
  | { readonly type: 'answer.submitted' }
  | { readonly type: 'retry.started'; readonly planId: string }
  | { readonly type: 'confirmation.requested'; readonly planId: string }
  | { readonly type: 'execution.started'; readonly planId: string }
  | { readonly type: 'execution.sent'; readonly cancellableAfterSend: boolean }
  | { readonly type: 'presentation.started' }
  | { readonly type: 'action.settled'; readonly result: ActionResult }
  | { readonly type: 'undo.started'; readonly planId: string }
  | { readonly type: 'undo.finished' }
  | { readonly type: 'cancel' }
  | { readonly type: 'failure'; readonly failure: Failure }
  | { readonly type: 'reset' };
