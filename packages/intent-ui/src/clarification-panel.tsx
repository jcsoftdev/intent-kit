import { useRef, type KeyboardEvent } from 'react';
import type { Answers, ClosedOption, SessionState } from '@jcsoftdev/intent-core';
import type { AssistantCopy } from './copy.js';

type ClarifyingState = Extract<SessionState, { name: 'clarifying' }>;

interface ClosedQuestion {
  readonly path: string;
  readonly prompt: string;
  readonly options: readonly ClosedOption[];
}

export function closedQuestionOf(state: ClarifyingState): ClosedQuestion | undefined {
  const { interpretation } = state;
  if (interpretation.status === 'incomplete') {
    const field = interpretation.missing.find(({ options }) => options !== undefined);
    return field?.options && { path: field.path, prompt: field.prompt, options: field.options };
  }
  const entities = interpretation.candidates.flatMap((candidate) =>
    candidate.kind === 'entity' ? [candidate] : [],
  );
  const [first] = entities;
  return (
    first && {
      path: first.path,
      prompt: first.path,
      options: entities.filter(({ path }) => path === first.path).map(({ option }) => option),
    }
  );
}

export interface ClarificationPanelProps {
  readonly state: ClarifyingState;
  readonly onAnswer: (answers: Answers) => void;
  readonly copy: AssistantCopy;
}

const STEP_KEYS: Readonly<Record<string, number>> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

export function ClarificationPanel({ state, onAnswer, copy }: ClarificationPanelProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const question = closedQuestionOf(state);
  if (!question) {
    return null;
  }

  const move = (from: number, event: KeyboardEvent<HTMLButtonElement>) => {
    const step = STEP_KEYS[event.key];
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    const count = question.options.length;
    refs.current[(from + step + count) % count]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={copy.clarifyTitle(question.prompt)}
      data-density="compact"
      className="flex flex-col gap-1 rounded-dialog surface-overlay p-2 shadow-overlay"
    >
      <p className="px-2 pt-1 text-meta text-ink-3">{copy.clarifyTitle(question.prompt)}</p>
      {question.options.map((option, index) => (
        <button
          key={option.id}
          ref={(element) => {
            refs.current[index] = element;
          }}
          type="button"
          role="radio"
          aria-checked={false}
          tabIndex={index === 0 ? 0 : -1}
          className="flex min-h-control-sm items-center justify-between gap-3 rounded-button px-2.5 text-left text-fs-130 text-ink hover:bg-surface-2 focus-visible:focus-ring"
          onKeyDown={(event) => move(index, event)}
          onClick={() => onAnswer({ [question.path]: option.id })}
        >
          <span className="min-w-0 truncate">{option.label}</span>
          {option.detail === undefined ? null : (
            <span className="shrink-0 text-meta text-ink-3">{option.detail}</span>
          )}
        </button>
      ))}
    </div>
  );
}
