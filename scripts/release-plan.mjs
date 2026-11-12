import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const WORKSPACE_PACKAGE = /^\s*-\s*['"]?(packages\/[^'"\s]+)['"]?/;

export const lockstepPackages = (
  packageDirs,
  read = (dir) => readJson(join(root, dir, 'package.json')),
) =>
  packageDirs
    .map((dir) => ({ dir, manifest: read(dir) }))
    .filter(({ manifest }) => !manifest.private)
    .map(({ dir, manifest }) => ({ dir, name: manifest.name, version: manifest.version }));

const lockstepErrors = (packages) => {
  const versions = new Set(packages.map(({ version }) => version));
  return versions.size > 1
    ? [
        `packages are not in lockstep: ${packages.map(({ name, version }) => `${name}@${version}`).join(', ')}`,
      ]
    : [];
};

const tagErrors = (tag, packages) => {
  const versions = [...new Set(packages.map(({ version }) => version))];
  const [version] = versions;
  return versions.length === 1 && tag !== `v${version}`
    ? [`tag ${tag} does not match package version v${version}`]
    : [];
};

export const planRelease = ({ tag, enabled, packages }) => {
  const known = new Set(packages.map(({ dir }) => dir));
  const errors = [
    ...lockstepErrors(packages),
    ...tagErrors(tag, packages),
    ...enabled
      .filter((dir) => !known.has(dir))
      .map((dir) => `publish list names "${dir}", which is not a public package`),
    ...(enabled.length === 0 ? ['publish list is empty'] : []),
  ];
  return { errors, publish: enabled.filter((dir) => known.has(dir)) };
};

const workspacePackageDirs = () =>
  readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
    .split('\n')
    .flatMap((line) => WORKSPACE_PACKAGE.exec(line)?.[1] ?? [])
    .flatMap((pattern) =>
      pattern.endsWith('/*') ? readdirPackages(pattern.slice(0, -2)) : [pattern],
    );

const readdirPackages = (parent) =>
  readdirSync(join(root, parent), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${parent}/${entry.name}`)
    .sort();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2];
  const { packages: enabled } = readJson(join(root, '.github/publish-packages.json'));
  const { errors, publish } = planRelease({
    tag,
    enabled,
    packages: lockstepPackages(workspacePackageDirs()),
  });
  if (errors.length > 0) {
    errors.forEach((error) => console.error(`::error::${error}`));
    process.exit(1);
  }
  console.log(publish.join('\n'));
}
