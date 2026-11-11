import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findBoundaryViolations } from './boundaries.mjs';

const rulesFor = (path, source) =>
  findBoundaryViolations([{ path, source }])
    .map(({ rule }) => rule)
    .sort();

const cases = [
  {
    name: 'core-no-imports rejects a bare specifier',
    path: 'packages/intent-core/src/a.ts',
    source: "import { z } from 'zod';",
    expected: ['core-no-imports'],
  },
  {
    name: 'relative imports in core pass',
    path: 'packages/intent-core/src/a.ts',
    source: "import { b } from './b.js';",
    expected: [],
  },
  {
    name: 'core test files may import vitest',
    path: 'packages/intent-core/src/a.test.ts',
    source: "import { test } from 'vitest';",
    expected: [],
  },
  {
    name: 'no-framework rejects react in the server',
    path: 'packages/intent-server/src/a.ts',
    source: "import React from 'react';",
    expected: ['no-framework'],
  },
  {
    name: 'server test files may import intent-zod',
    path: 'packages/intent-server/src/a.test.ts',
    source: "import { createZodSchemaAdapter } from '@jcsoftdev/intent-zod';",
    expected: [],
  },
  {
    name: 'testing-only-in-tests rejects intent-testing in core',
    path: 'packages/intent-core/src/a.ts',
    source: "export * from '@jcsoftdev/intent-testing';",
    expected: ['core-no-imports', 'testing-only-in-tests'],
  },
  {
    name: 'no-dom-globals flags document access in core',
    path: 'packages/intent-core/src/a.ts',
    source: 'const x = document.body;',
    expected: ['no-dom-globals'],
  },
  {
    name: 'dynamic node builtin in the server is flagged',
    path: 'packages/intent-server/src/a.ts',
    source: "await import('node:fs');",
    expected: ['no-node-builtins'],
  },
];

for (const { name, path, source, expected } of cases) {
  test(name, () => {
    assert.deepEqual(rulesFor(path, source), expected);
  });
}
