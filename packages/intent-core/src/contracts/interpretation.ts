import type { JsonObject } from './json.js';

export interface CapabilityManifestEntry {
  readonly id: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly examples: readonly string[];
  readonly inputJsonSchema: JsonObject;
}

export interface InterpretRequest {
  readonly text: string;
  readonly locale: string;
  readonly source: 'text' | 'voice';
  readonly catalog: readonly CapabilityManifestEntry[];
  readonly context: { readonly routeId?: string; readonly selected?: { readonly entity: string } };
}

export interface Proposal {
  readonly capabilityId: string;
  readonly slots: Readonly<Record<string, string | number | boolean | readonly string[]>>;
  readonly confidence: number;
}

export type InterpreterResult =
  | { readonly status: 'proposed'; readonly proposals: readonly Proposal[] }
  | { readonly status: 'unsupported' };

export interface Interpreter {
  interpret(
    request: InterpretRequest,
    options: { signal: AbortSignal },
  ): Promise<InterpreterResult>;
}

export interface ClosedOption {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
}

export interface MissingField {
  readonly path: string;
  readonly reason: 'required' | 'requirement';
  readonly prompt: string;
  readonly options?: readonly ClosedOption[];
  readonly min?: number;
  readonly max?: number;
}

export interface Draft {
  readonly capabilityId: string;
  readonly version: number;
  readonly input: unknown;
}

export type InterpretationOrigin = 'deterministic' | 'interpreter';

export type AmbiguityCandidate =
  | { readonly kind: 'capability'; readonly capabilityId: string; readonly label: string }
  | { readonly kind: 'entity'; readonly path: string; readonly option: ClosedOption };

export type Interpretation =
  | {
      readonly status: 'complete';
      readonly planId: string;
      readonly draft: Draft;
      readonly summary: string;
      readonly source: InterpretationOrigin;
    }
  | {
      readonly status: 'incomplete';
      readonly draft: Draft;
      readonly missing: readonly MissingField[];
    }
  | {
      readonly status: 'ambiguous';
      readonly draft?: Draft;
      readonly candidates: readonly AmbiguityCandidate[];
    }
  | { readonly status: 'unsupported'; readonly suggestions: readonly string[] };

export interface Continuation {
  readonly draft: Draft;
  readonly answers: Readonly<Record<string, string | readonly string[] | number>>;
}

export type Answers = Continuation['answers'];

export type InterpretationInput =
  | {
      readonly kind: 'utterance';
      readonly text: string;
      readonly locale: string;
      readonly source: 'text' | 'voice';
      readonly context: InterpretRequest['context'];
      readonly restrictTo?: string;
    }
  | {
      readonly kind: 'continuation';
      readonly locale: string;
      readonly source: 'text' | 'voice';
      readonly continuation: Continuation;
      readonly origin: InterpretationOrigin;
    };
