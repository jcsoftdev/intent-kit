import type { FailureCode } from './failure.js';
import type { Draft } from './interpretation.js';
import type { UndoEntry } from './ports.js';

export interface ExecutablePlan {
  readonly planId: string;
  readonly draft: Draft;
  readonly source: 'text' | 'voice';
  readonly heard?: string;
}

export type Presentation =
  | { readonly status: 'shown' }
  | { readonly status: 'skipped' }
  | { readonly status: 'degraded'; readonly code: FailureCode };

export type ActionResult =
  | {
      readonly status: 'completed';
      readonly planId: string;
      readonly capabilityId: string;
      readonly output: unknown;
      readonly presentation: Presentation;
      readonly undo?: UndoEntry;
    }
  | {
      readonly status: 'handedOff';
      readonly planId: string;
      readonly capabilityId: string;
      readonly presentation: Presentation;
    }
  | { readonly status: 'undone'; readonly planId: string; readonly capabilityId: string };

export interface ActionLifecycle {
  confirming(planId: string): void;
  executing(planId: string): void;
  sending(planId: string, cancellableAfterSend: boolean): void;
  presenting(planId: string): AbortSignal;
}

export interface CapabilityMessages {
  success(context: { readonly input: unknown; readonly output: unknown }): string;
  confirm(context: { readonly input: unknown; readonly heard?: string }): string;
}

export type MessageCatalog = Readonly<Record<string, CapabilityMessages>>;
export type FailureMessages = Readonly<Record<FailureCode, string>>;
