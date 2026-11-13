import { fileURLToPath } from 'node:url';

const fromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export const workspaceAliases: Record<string, string> = {
  '@jcsoftdev/intent-testing/contracts': fromRoot(
    './packages/intent-testing/src/contracts/index.ts',
  ),
  '@jcsoftdev/intent-core': fromRoot('./packages/intent-core/src/index.ts'),
  '@jcsoftdev/intent-zod': fromRoot('./packages/intent-zod/src/index.ts'),
  '@jcsoftdev/intent-server': fromRoot('./packages/intent-server/src/index.ts'),
  '@jcsoftdev/intent-testing': fromRoot('./packages/intent-testing/src/index.ts'),
  '@jcsoftdev/intent-dom': fromRoot('./packages/intent-dom/src/index.ts'),
  '@jcsoftdev/intent-voice-web': fromRoot('./packages/intent-voice-web/src/index.ts'),
  '@jcsoftdev/intent-react': fromRoot('./packages/intent-react/src/index.ts'),
  '@jcsoftdev/intent-next': fromRoot('./packages/intent-next/src/index.ts'),
  '@jcsoftdev/intent-ui': fromRoot('./packages/intent-ui/src/index.ts'),
};
