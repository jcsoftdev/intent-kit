import type { Failure, FailureStage, Outcome } from './failure.js';

export type StageName = string & { readonly __brand: 'StageName' };

export function stageName(name: string): StageName {
  return name as StageName;
}

export interface StageBudget {
  readonly timeoutMs: number;
  readonly onTimeout: Failure;
}

export interface StageContext<TState> {
  readonly signal: AbortSignal;
  get<K extends keyof TState>(key: K): TState[K];
  find<K extends keyof TState>(key: K): TState[K] | undefined;
  has(key: keyof TState): boolean;
  set<K extends keyof TState>(key: K, value: TState[K]): void;
}

export interface Stage<TState, TResult> {
  readonly name: StageName;
  readonly phase: FailureStage;
  readonly requires: readonly (keyof TState)[];
  readonly provides: readonly (keyof TState)[];
  readonly budget?: StageBudget;
  run(
    context: StageContext<TState>,
    next: () => Promise<Outcome<TResult>>,
  ): Promise<Outcome<TResult>>;
}

export interface Terminal<TState, TResult> {
  readonly requires: readonly (keyof TState)[];
  settle(context: StageContext<TState>): Promise<Outcome<TResult>>;
}

export interface Pipeline<TState, TResult> {
  readonly stages: readonly StageName[];
  run(seed: Partial<TState>, options: { signal: AbortSignal }): Promise<Outcome<TResult>>;
}

export interface PipelineBuilder<TState, TResult> {
  use(stage: Stage<TState, TResult>): PipelineBuilder<TState, TResult>;
  insertAfter(anchor: StageName, stage: Stage<TState, TResult>): PipelineBuilder<TState, TResult>;
  replace(target: StageName, stage: Stage<TState, TResult>): PipelineBuilder<TState, TResult>;
  build(): Pipeline<TState, TResult>;
}
