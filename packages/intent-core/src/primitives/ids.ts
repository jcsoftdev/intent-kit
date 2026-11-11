import type { IdSource } from '../contracts/index.js';

export const randomIdSource: IdSource = {
  next: () => crypto.randomUUID(),
};

export const createSequentialIdSource = (prefix = 'id-'): IdSource => {
  let counter = 0;
  return {
    next: () => {
      counter += 1;
      return `${prefix}${counter}`;
    },
  };
};
