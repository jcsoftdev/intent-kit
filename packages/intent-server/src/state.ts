import { stageName } from '@jcsoftdev/intent-core';
import type {
  Answers,
  Decision,
  Draft,
  InterpretationInput,
  InterpretationOrigin,
  Proposal,
  StageName,
} from '@jcsoftdev/intent-core';
import type { ServerCatalogView } from './catalog/server-catalog.js';
import type { CapturedSplit } from './text/pattern.js';

export interface NumberSplit {
  readonly textPath: string;
  readonly numberPath: string;
  readonly whole: string;
  readonly rest: string;
  readonly value: number;
}

export interface InterpretationState<TPrincipal> {
  readonly input: InterpretationInput;
  readonly principal: TPrincipal;
  readonly normalizedText: string;
  readonly catalog: ServerCatalogView;
  readonly proposal: Proposal;
  readonly origin: InterpretationOrigin;
  readonly draft: Draft;
  readonly capturedSplits: readonly CapturedSplit[];
  readonly numberSplits: readonly NumberSplit[];
  readonly answers: Answers;
  readonly resolvedInput: unknown;
  readonly labels: Readonly<Record<string, string>>;
  readonly validInput: unknown;
  readonly decision: Decision;
}

export const INTERPRETATION_STAGES: {
  readonly normalize: StageName;
  readonly catalog: StageName;
  readonly deterministic: StageName;
  readonly interpret: StageName;
  readonly draft: StageName;
  readonly entities: StageName;
  readonly requirements: StageName;
  readonly validate: StageName;
  readonly authorize: StageName;
} = {
  normalize: stageName('normalize'),
  catalog: stageName('catalog'),
  deterministic: stageName('deterministic'),
  interpret: stageName('interpret'),
  draft: stageName('draft'),
  entities: stageName('entities'),
  requirements: stageName('requirements'),
  validate: stageName('validate'),
  authorize: stageName('authorize'),
};
