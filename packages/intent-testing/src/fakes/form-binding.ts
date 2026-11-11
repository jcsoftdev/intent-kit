import type { EffectResult, FormBinding } from '@jcsoftdev/intent-core';

const isFilled = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

export const createFakeFormBinding = <TInput extends object>(config: {
  readonly formId: string;
  readonly required: readonly (keyof TInput)[];
  readonly submit: (values: Partial<TInput>) => EffectResult<unknown>;
}): FormBinding<TInput> & { values(): Partial<TInput>; submitted(): number } => {
  let current: Partial<TInput> = {};
  let submissions = 0;
  return {
    formId: config.formId,
    values: () => ({ ...current }),
    submitted: () => submissions,
    read: () => ({ ...current }),
    fill(patch) {
      const keys = Object.keys(patch) as (keyof TInput & string)[];
      const changed = keys.filter((key) => !Object.is(current[key], patch[key]));
      current = { ...current, ...patch };
      return changed;
    },
    isComplete: () => config.required.every((key) => isFilled(current[key])),
    async submit({ signal }) {
      signal.throwIfAborted();
      submissions += 1;
      return config.submit({ ...current });
    },
  };
};
