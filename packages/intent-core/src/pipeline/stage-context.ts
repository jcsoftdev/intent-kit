import { IntentDefinitionError } from '../contracts/index.js';
import type { StageContext } from '../contracts/index.js';

export const createStageContext = <TState>(
  values: Map<keyof TState, unknown>,
  signal: AbortSignal,
  owner: string,
  provides: readonly (keyof TState)[],
): StageContext<TState> => {
  const find = <K extends keyof TState>(key: K): TState[K] | undefined =>
    values.get(key) as TState[K] | undefined;
  return {
    signal,
    find,
    has: (key) => values.has(key),
    get(key) {
      if (!values.has(key)) {
        throw new IntentDefinitionError('MISSING_REQUIREMENT', `${owner}:${String(key)}`);
      }
      return values.get(key) as TState[typeof key];
    },
    set(key, value) {
      if (!provides.includes(key)) {
        throw new IntentDefinitionError('UNDECLARED_PROVIDE', `${owner}:${String(key)}`);
      }
      values.set(key, value);
    },
  };
};
