export const FAILURE_STAGES = [
  'interpretation',
  'resolution',
  'policy',
  'confirmation',
  'navigation',
  'execution',
  'presentation',
] as const;

export const FAILURE_CODES = [
  'CAPABILITY_NOT_FOUND',
  'INTERPRETER_UNAVAILABLE',
  'INTERPRETER_TIMEOUT',
  'ENTITY_NOT_FOUND',
  'RESOLUTION_UNAVAILABLE',
  'INVALID_INPUT',
  'UNAUTHORIZED',
  'NOT_AVAILABLE',
  'AGENT_FORBIDDEN',
  'RATE_LIMITED',
  'CONFIRMATION_DECLINED',
  'NAVIGATION_FAILED',
  'ROUTE_NOT_READY',
  'EXECUTION_FAILED',
  'CONFLICT',
  'STALE_PLAN',
  'TARGET_NOT_FOUND',
  'SEMANTICS_VIOLATION',
  'ABORTED',
] as const;

export type FailureStage = (typeof FAILURE_STAGES)[number];
export type FailureCode = (typeof FAILURE_CODES)[number];

export interface Failure {
  readonly stage: FailureStage;
  readonly code: FailureCode;
  readonly appCode?: string;
  readonly retryable: boolean;
}

export type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: Failure };

export class IntentFailureError extends Error {
  readonly failure: Failure;

  constructor(failure: Failure) {
    super(`${failure.stage}:${failure.code}`);
    this.name = 'IntentFailureError';
    this.failure = failure;
  }
}

export const DEFINITION_ERROR_REASONS = [
  'DUPLICATE_ID',
  'INVALID_ID',
  'INVALID_VERSION',
  'INVALID_SCHEMA',
  'INVALID_PATH',
  'INVALID_TEMPLATE',
  'INVALID_REVERSIBILITY',
  'INVALID_ROLES',
  'INVALID_DESTINATION',
  'INVALID_PATTERN',
  'INVALID_SLOT',
  'AMBIGUOUS_SLOT',
  'MISSING_RESOLVER',
  'UNSUPPORTED_SCHEMA_VENDOR',
  'DUPLICATE_STAGE',
  'UNKNOWN_ANCHOR',
  'MISSING_REQUIREMENT',
  'UNDECLARED_PROVIDE',
  'NEXT_CALLED_TWICE',
  'DUPLICATE_TARGET',
] as const;

export type DefinitionErrorReason = (typeof DEFINITION_ERROR_REASONS)[number];

export class IntentDefinitionError extends Error {
  readonly reason: DefinitionErrorReason;
  readonly subject: string;

  constructor(reason: DefinitionErrorReason, subject: string) {
    super(`${reason}: ${subject}`);
    this.name = 'IntentDefinitionError';
    this.reason = reason;
    this.subject = subject;
  }
}
