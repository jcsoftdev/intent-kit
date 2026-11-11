import type { ActionResult, Presentation } from './action.js';
import type { FailureCode } from './failure.js';
import type { Interpretation, InterpretationOrigin } from './interpretation.js';
import type { StageName } from './pipeline.js';
import type { SemanticExpectation } from './ports.js';
import type { SessionState } from './session.js';

export type IntentEvent =
  | {
      readonly type: 'stage.completed';
      readonly pipeline: string;
      readonly stage: StageName;
      readonly durationMs: number;
      readonly ok: boolean;
      readonly code?: FailureCode;
    }
  | {
      readonly type: 'interpretation.settled';
      readonly status: Interpretation['status'] | 'failed';
      readonly capabilityId?: string;
      readonly origin?: InterpretationOrigin;
      readonly planId?: string;
      readonly code?: FailureCode;
    }
  | {
      readonly type: 'action.settled';
      readonly status: ActionResult['status'] | 'failed';
      readonly capabilityId: string;
      readonly planId: string;
      readonly code?: FailureCode;
      readonly presentation?: Presentation['status'];
    }
  | {
      readonly type: 'session.transition';
      readonly from: SessionState['name'];
      readonly to: SessionState['name'];
    }
  | {
      readonly type: 'semantics.violation';
      readonly intent: string;
      readonly key?: string;
      readonly expected: SemanticExpectation;
    }
  | {
      readonly type: 'undo.offered' | 'undo.executed' | 'undo.expired';
      readonly planId: string;
      readonly capabilityId: string;
    };
