import type {
  AgentExposure,
  AnyDescriptor,
  CapabilityScope,
  Destination,
  RiskLevel,
  Unregister,
} from './descriptor.js';
import type { Failure, Outcome } from './failure.js';
import type { InterpretationInput, Interpretation } from './interpretation.js';
import type { JsonObject } from './json.js';
import type { StandardSchemaV1 } from './standard-schema.js';

export interface EffectContext {
  readonly signal: AbortSignal;
  readonly planId: string;
  readonly idempotencyKey?: string;
}

export type EffectResult<TOutput> =
  | { readonly ok: true; readonly output: TOutput }
  | { readonly ok: false; readonly failure: Failure };

export interface Effect<TInput, TOutput> {
  run(input: TInput, context: EffectContext): Promise<EffectResult<TOutput>>;
}

export type EffectLoader = () => Promise<{ readonly default: Effect<unknown, unknown> }>;

export interface DiscoveryFilter {
  readonly role?: string;
  readonly exposures?: readonly AgentExposure[];
  readonly scopes?: readonly CapabilityScope[];
}

export interface CapabilityRegistry {
  register(descriptor: AnyDescriptor, loader?: EffectLoader): Unregister;
  get(id: string): AnyDescriptor | undefined;
  discover(filter: DiscoveryFilter): readonly AnyDescriptor[];
  loadEffect(id: string, options: { signal: AbortSignal }): Promise<Effect<unknown, unknown>>;
}

export interface RouterAdapter<TRouteId extends string> {
  currentRoute():
    { readonly routeId: TRouteId; readonly params: Readonly<Record<string, string>> } | undefined;
  navigate(destination: Destination<TRouteId>, options: { signal: AbortSignal }): Promise<void>;
  waitUntilReady(
    destination: Destination<TRouteId>,
    options: { signal: AbortSignal },
  ): Promise<void>;
}

export type CurrentRoute<TRouteId extends string> = NonNullable<
  ReturnType<RouterAdapter<TRouteId>['currentRoute']>
>;

export interface TargetRef {
  readonly intent: string;
  readonly key?: string;
}

export interface SemanticExpectation {
  readonly role: string;
  readonly requireName: boolean;
}

export interface TargetRegistry<TElement> {
  register(ref: TargetRef, element: TElement, expectation: SemanticExpectation): Unregister;
  find(ref: TargetRef): TElement | undefined;
  waitFor(ref: TargetRef, options: { signal: AbortSignal; timeoutMs: number }): Promise<TElement>;
}

export interface Revealer<TElement> {
  reveal(
    element: TElement,
    mode: 'highlight' | 'focus' | 'highlightAndFocus',
    options: { signal: AbortSignal },
  ): Promise<void>;
}

export interface Announcer {
  announce(message: string, politeness: 'polite' | 'assertive'): void;
}

export interface SpeechSource {
  isSupported(): boolean;
  start(options: {
    language: string;
    signal: AbortSignal;
    onPartial: (text: string) => void;
  }): Promise<{ readonly transcript: string; readonly language: string }>;
  stop(): void;
}

export interface FormBinding<TInput> {
  readonly formId: string;
  read(): Partial<TInput>;
  fill(patch: Partial<TInput>): readonly string[];
  isComplete(): boolean;
  submit(options: { signal: AbortSignal }): Promise<EffectResult<unknown>>;
}

export interface SchemaAdapter {
  toJsonSchema(schema: StandardSchemaV1): JsonObject;
  validate<T>(
    schema: StandardSchemaV1<unknown, T>,
    value: unknown,
    options: { signal: AbortSignal },
  ): Promise<Outcome<T>>;
  missingPaths(
    schema: StandardSchemaV1,
    value: unknown,
    options: { signal: AbortSignal },
  ): Promise<readonly string[]>;
}

export type Decision =
  { readonly allowed: true } | { readonly allowed: false; readonly failure: Failure };

export interface Authorizer<TPrincipal> {
  authorize(
    principal: TPrincipal,
    descriptor: AnyDescriptor,
    options: { signal: AbortSignal },
  ): Promise<Decision>;
}

export interface ConfirmationRequest {
  readonly planId: string;
  readonly capabilityId: string;
  readonly risk: RiskLevel;
  readonly summary: string;
  readonly heard?: string;
}

export interface ConfirmationPort {
  confirm(
    request: ConfirmationRequest,
    options: { signal: AbortSignal },
  ): Promise<'confirmed' | 'declined'>;
}

export interface Clock {
  now(): number;
  timeout(ms: number): AbortSignal;
  delay(ms: number, options: { signal: AbortSignal }): Promise<void>;
}

export interface IdSource {
  next(): string;
}

export interface EventBus<TEvent extends { readonly type: string }> {
  emit(event: TEvent): void;
  subscribe(listener: (event: TEvent) => void): Unregister;
}

export interface UndoEntry {
  readonly planId: string;
  readonly capabilityId: string;
  readonly kind: 'compensate' | 'grace';
  readonly expiresAt: number;
}

export type UndoOffer = UndoEntry & {
  readonly undo: (options: { signal: AbortSignal }) => Promise<EffectResult<unknown>>;
};

export interface UndoRegistry {
  offer(offer: UndoOffer): Unregister;
  active(): readonly UndoEntry[];
  undo(planId: string, options: { signal: AbortSignal }): Promise<EffectResult<unknown>>;
}

export interface CompensationRequest {
  readonly via: string;
  readonly descriptor: AnyDescriptor;
  readonly input: unknown;
  readonly output: unknown;
}

export interface Compensator {
  compensate(
    request: CompensationRequest,
    options: { signal: AbortSignal },
  ): Promise<EffectResult<unknown>>;
}

export interface FormBindingRegistry {
  register(binding: FormBinding<unknown>, routeId: string): Unregister;
  find(
    formId: string,
  ): { readonly binding: FormBinding<unknown>; readonly routeId: string } | undefined;
}

export interface InterpretationClient {
  interpret(
    input: InterpretationInput,
    options: { signal: AbortSignal },
  ): Promise<Outcome<Interpretation>>;
}
