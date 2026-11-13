import { defineConfig } from 'vitest/config';
import { workspaceAliases } from '../../vitest.aliases.js';

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
