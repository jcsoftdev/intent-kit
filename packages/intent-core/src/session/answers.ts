import type {
  AmbiguityCandidate,
  Answers,
  ClosedOption,
  Interpretation,
} from '../contracts/index.js';
import { matchClosedOption } from '../primitives/index.js';

export type Clarification = Extract<Interpretation, { status: 'incomplete' | 'ambiguous' }>;

interface ClosedQuestion {
  readonly path: string;
  readonly options: readonly ClosedOption[];
}

type EntityCandidate = Extract<AmbiguityCandidate, { kind: 'entity' }>;

export function mergeAnswers(previous: Answers, next: Answers): Answers {
  return { ...previous, ...next };
}

const isEntityCandidate = (candidate: AmbiguityCandidate): candidate is EntityCandidate =>
  candidate.kind === 'entity';

const questionOf = (clarification: Clarification): ClosedQuestion | undefined => {
  if (clarification.status === 'incomplete') {
    const [field] = clarification.missing;
    return field?.options ? { path: field.path, options: field.options } : undefined;
  }
  const entities = clarification.candidates.filter(isEntityCandidate);
  const [first] = entities;
  if (!first) {
    return undefined;
  }
  return {
    path: first.path,
    options: entities.filter(({ path }) => path === first.path).map(({ option }) => option),
  };
};

export function answersFromText(clarification: Clarification, text: string): Answers | undefined {
  const question = questionOf(clarification);
  const match = question ? matchClosedOption(text, question.options) : undefined;
  return question && match ? { [question.path]: match.id } : undefined;
}
