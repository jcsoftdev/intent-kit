import { fileURLToPath } from 'node:url';

export const publishRefusal = (env) =>
  env.CI === 'true' && env.GITHUB_ACTIONS === 'true'
    ? undefined
    : 'Publishing runs only from the release workflow in GitHub Actions. Push a v<version> tag instead.';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const refusal = publishRefusal(process.env);
  if (refusal !== undefined) {
    console.error(refusal);
    process.exit(1);
  }
}
