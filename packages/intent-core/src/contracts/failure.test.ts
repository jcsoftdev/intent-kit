import { describe, expect, it } from 'vitest';
import {
  FAILURE_CODES,
  IntentDefinitionError,
  IntentFailureError,
  type Failure,
} from './failure.js';

describe('failure model', () => {
  it('lists 19 unique failure codes including RESOLUTION_UNAVAILABLE', () => {
    expect(FAILURE_CODES).toHaveLength(19);
    expect(new Set(FAILURE_CODES).size).toBe(19);
    expect(FAILURE_CODES).toContain('RESOLUTION_UNAVAILABLE');
  });

  it('keeps the failure on IntentFailureError', () => {
    const failure: Failure = { stage: 'execution', code: 'CONFLICT', retryable: false };
    expect(new IntentFailureError(failure).failure).toBe(failure);
  });

  it('names reason and subject in IntentDefinitionError', () => {
    const error = new IntentDefinitionError('DUPLICATE_ID', 'orders.create');
    expect(error.message).toContain('DUPLICATE_ID');
    expect(error.message).toContain('orders.create');
    expect(error.reason).toBe('DUPLICATE_ID');
    expect(error.subject).toBe('orders.create');
  });
});
