import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findBoundaryViolations } from './boundaries.mjs';

const root = new URL('..', import.meta.url).pathname;

const walk = (directory) =>
  readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const packageSources = () =>
  readdirSync(join(root, 'packages'))
    .map((name) => join(root, 'packages', name, 'src'))
    .filter((directory) => statSync(directory, { throwIfNoEntry: false })?.isDirectory())
    .flatMap(walk)
    .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
    .map((file) => ({ path: relative(root, file), source: readFileSync(file, 'utf8') }));

const nonEmpty = (record) => record !== undefined && Object.keys(record).length > 0;

const coreManifestProblems = () => {
  const manifest = JSON.parse(
    readFileSync(join(root, 'packages/intent-core/package.json'), 'utf8'),
  );
  return ['dependencies', 'peerDependencies']
    .filter((field) => nonEmpty(manifest[field]))
    .map((field) => `packages/intent-core/package.json: ${field} must be empty`);
};

const lines = [
  ...findBoundaryViolations(packageSources()).map(
    ({ path, specifier, rule }) => `${path}: ${rule}: ${specifier}`,
  ),
  ...coreManifestProblems(),
];

lines.forEach((line) => console.error(line));
process.exit(lines.length === 0 ? 0 : 1);
