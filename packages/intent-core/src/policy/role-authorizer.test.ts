import { expect, test } from 'vitest';
import type { AnyDescriptor, StandardSchemaV1 } from '../contracts/index.js';
import { createRoleAuthorizer } from './role-authorizer.js';

const schema: StandardSchemaV1 = {
  '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) },
};

const descriptor: AnyDescriptor = {
  id: 'orders.create',
  version: 1,
  kind: 'write',
  agent: 'allowed',
  description: 'Create an order',
  aliases: [],
  examples: [],
  patterns: [],
  scope: 'global',
  input: schema,
  entities: [],
  risk: 'write',
  confirmation: 'never',
  reversibility: { kind: 'none' },
  idempotency: { kind: 'none' },
  roles: ['waiter'],
};

interface Principal {
  readonly active: string;
  readonly granted: readonly string[];
}

const authorizer = createRoleAuthorizer((principal: Principal) => principal);
const signal = new AbortController().signal;

test('allows an active granted role listed on the descriptor', async () => {
  const decision = await authorizer.authorize(
    { active: 'waiter', granted: ['waiter'] },
    descriptor,
    { signal },
  );
  expect(decision).toEqual({ allowed: true });
});

test.each<[string, Principal, AnyDescriptor, string]>([
  ['active role not granted', { active: 'waiter', granted: ['host'] }, descriptor, 'UNAUTHORIZED'],
  [
    'agent never',
    { active: 'waiter', granted: ['waiter'] },
    { ...descriptor, agent: 'never' },
    'AGENT_FORBIDDEN',
  ],
  [
    'role not in descriptor roles',
    { active: 'cook', granted: ['cook'] },
    descriptor,
    'UNAUTHORIZED',
  ],
])('authorizer denies when %s', async (_, principal, target, code) => {
  const decision = await authorizer.authorize(principal, target, { signal });
  expect(decision).toEqual({
    allowed: false,
    failure: { stage: 'policy', code, retryable: false },
  });
});

test('only the active role counts: waiter active, host granted, host-only descriptor → UNAUTHORIZED', async () => {
  const decision = await authorizer.authorize(
    { active: 'waiter', granted: ['waiter', 'host'] },
    { ...descriptor, roles: ['host'] },
    { signal },
  );
  expect(decision).toEqual({
    allowed: false,
    failure: { stage: 'policy', code: 'UNAUTHORIZED', retryable: false },
  });
});
