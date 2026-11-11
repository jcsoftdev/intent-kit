const IMPORT_PATTERNS = [
  /\bimport\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:[^'"()]*?\s+from\s+)['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const DOM_PATTERNS = [/\b(?:document|window|navigator)\./, /\bHTMLElement\b/];

const NODE_BUILTINS = new Set(['fs', 'path', 'http', 'https', 'net', 'child_process']);

const isTestFile = (path) => /\.test(?:-d)?\.ts$/.test(path);
const inPackage = (path, name) => path.startsWith(`packages/${name}/src/`);
const inAnyPackage = (path) => /^packages\/[^/]+\/src\//.test(path);

const isBare = (specifier) => !specifier.startsWith('.');
const isFramework = (specifier) =>
  ['react', 'react-dom', 'next'].includes(specifier) ||
  specifier.startsWith('react/') ||
  specifier.startsWith('next/');
const isNodeBuiltin = (specifier) => specifier.startsWith('node:') || NODE_BUILTINS.has(specifier);
const isTestingPackage = (specifier) =>
  specifier === '@jcsoftdev/intent-testing' || specifier.startsWith('@jcsoftdev/intent-testing/');

const SPECIFIER_RULES = [
  {
    rule: 'core-no-imports',
    applies: (path) => inPackage(path, 'intent-core') && !isTestFile(path),
    forbids: isBare,
  },
  { rule: 'no-framework', applies: inAnyPackage, forbids: isFramework },
  {
    rule: 'no-node-builtins',
    applies: (path) => inPackage(path, 'intent-core') || inPackage(path, 'intent-server'),
    forbids: isNodeBuiltin,
  },
  {
    rule: 'server-no-schema-adapter',
    applies: (path) => inPackage(path, 'intent-server') && !isTestFile(path),
    forbids: (specifier) => specifier === '@jcsoftdev/intent-zod',
  },
  {
    rule: 'testing-only-in-tests',
    applies: (path) =>
      (inPackage(path, 'intent-core') ||
        inPackage(path, 'intent-zod') ||
        inPackage(path, 'intent-server')) &&
      !isTestFile(path),
    forbids: isTestingPackage,
  },
];

const domGlobalApplies = (path) =>
  (inPackage(path, 'intent-core') || inPackage(path, 'intent-server')) && !isTestFile(path);

const readSpecifiers = (source) =>
  IMPORT_PATTERNS.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1]),
  ).filter((specifier) => specifier !== undefined);

const specifierViolations = ({ path, source }) => {
  const specifiers = readSpecifiers(source);
  return SPECIFIER_RULES.filter(({ applies }) => applies(path)).flatMap(({ rule, forbids }) =>
    specifiers.filter(forbids).map((specifier) => ({ path, specifier, rule })),
  );
};

const domViolations = ({ path, source }) => {
  if (!domGlobalApplies(path)) return [];
  return DOM_PATTERNS.flatMap((pattern) => {
    const match = source.match(pattern);
    return match ? [{ path, specifier: match[0], rule: 'no-dom-globals' }] : [];
  });
};

export const findBoundaryViolations = (files) =>
  files.flatMap((file) => [...specifierViolations(file), ...domViolations(file)]);
