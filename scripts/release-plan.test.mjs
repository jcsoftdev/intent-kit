import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lockstepPackages, planRelease } from './release-plan.mjs';

const packages = [
  { dir: 'packages/intent-core', name: '@jcsoftdev/intent-core', version: '0.1.0' },
  { dir: 'packages/intent-server', name: '@jcsoftdev/intent-server', version: '0.1.0' },
];

const plan = (overrides) =>
  planRelease({
    tag: 'v0.1.0',
    enabled: ['packages/intent-core', 'packages/intent-server'],
    packages,
    ...overrides,
  });

test('publishes the enabled packages in list order', () => {
  assert.deepEqual(plan(), {
    errors: [],
    publish: ['packages/intent-core', 'packages/intent-server'],
  });
});

test('rejects a tag that does not match the version', () => {
  assert.match(plan({ tag: 'v0.1.1' }).errors.join(), /does not match/);
});

test('rejects diverging versions without a misleading tag error', () => {
  const diverged = plan({ packages: [packages[0], { ...packages[1], version: '0.2.0' }] });
  assert.equal(diverged.errors.length, 1);
  assert.match(diverged.errors[0], /lockstep/);
});

test('rejects an unknown or empty publish list', () => {
  assert.match(plan({ enabled: ['packages/nope'] }).errors.join(), /not a public package/);
  assert.match(plan({ enabled: [] }).errors.join(), /empty/);
});

test('leaves private workspace packages out of the lockstep set', () => {
  const manifests = {
    'packages/a': { name: 'a', version: '1.0.0' },
    'apps/b': { name: 'b', version: '0.0.0', private: true },
  };
  assert.deepEqual(
    lockstepPackages(Object.keys(manifests), (dir) => manifests[dir]),
    [{ dir: 'packages/a', name: 'a', version: '1.0.0' }],
  );
});

test('nine enabled packages at 0.2.0 plan a v0.2.0 release', () => {
  const names = ['core', 'zod', 'server', 'testing', 'dom', 'voice-web', 'react', 'next', 'ui'];
  const nine = names.map((name) => ({
    dir: `packages/intent-${name}`,
    name: `@jcsoftdev/intent-${name}`,
    version: '0.2.0',
  }));
  assert.deepEqual(
    planRelease({ tag: 'v0.2.0', enabled: nine.map(({ dir }) => dir), packages: nine }),
    { errors: [], publish: nine.map(({ dir }) => dir) },
  );
});
