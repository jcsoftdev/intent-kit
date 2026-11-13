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
    name: 'server production code may not import zod directly',
    path: 'packages/intent-server/src/a.ts',
    source: "import { z } from 'zod';",
    expected: ['server-no-schema-adapter'],
  },
  {
    name: 'server test files may import zod',
    path: 'packages/intent-server/src/a.test.ts',
    source: "import { z } from 'zod';",
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
  {
    name: 'intent-dom importing react is rejected',
    path: 'packages/intent-dom/src/a.ts',
    source: "import { useState } from 'react';",
    expected: ['dom-packages-no-framework'],
  },
  {
    name: 'intent-react importing next is rejected',
    path: 'packages/intent-react/src/a.tsx',
    source: "import { useRouter } from 'next/navigation';",
    expected: ['react-no-next-or-design-system'],
  },
  {
    name: 'intent-react importing @jcsoftdev/ui is rejected',
    path: 'packages/intent-react/src/a.tsx',
    source: "import { Button } from '@jcsoftdev/ui';",
    expected: ['react-no-next-or-design-system'],
  },
  {
    name: 'intent-react importing react is allowed',
    path: 'packages/intent-react/src/a.tsx',
    source: "import { useState } from 'react';",
    expected: [],
  },
  {
    name: 'intent-ui importing next is rejected',
    path: 'packages/intent-ui/src/a.tsx',
    source: "import Link from 'next/link';",
    expected: ['ui-no-next'],
  },
  {
    name: 'intent-ui importing @jcsoftdev/ui and react is allowed',
    path: 'packages/intent-ui/src/a.tsx',
    source: "import { useState } from 'react';\nimport { Button } from '@jcsoftdev/ui';",
    expected: [],
  },
  {
    name: 'intent-voice-web importing react is rejected',
    path: 'packages/intent-voice-web/src/a.ts',
    source: "import { useEffect } from 'react';",
    expected: ['dom-packages-no-framework'],
  },
  {
    name: 'intent-dom may use DOM globals',
    path: 'packages/intent-dom/src/a.ts',
    source: 'const x = document.body;',
    expected: [],
  },
  {
    name: 'intent-next importing react and next is allowed',
    path: 'packages/intent-next/src/a.tsx',
    source: "import { useEffect } from 'react';\nimport { useRouter } from 'next/navigation';",
    expected: [],
  },
];

for (const { name, path, source, expected } of cases) {
  test(name, () => {
    assert.deepEqual(rulesFor(path, source), expected);
  });
}
