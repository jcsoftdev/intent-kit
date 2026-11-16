import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const entries = ['packages/intent-core/dist/index.js', 'packages/intent-server/dist/index.js'];
const BROWSER_ENTRIES = [
  'packages/intent-dom/dist/index.js',
  'packages/intent-voice-web/dist/index.js',
];
const FORBIDDEN_TEXT = [
  'SpeechRecognition',
  'requestAnimationFrame',
  'matchMedia',
  'react',
  'document.',
];

const bundle = async ([entry, forbidden]) => {
  const result = await build({
    entryPoints: [`${root}${entry}`],
    bundle: true,
    platform: 'neutral',
    format: 'esm',
    metafile: true,
    write: false,
    external: [],
  });
  const output = result.outputFiles.map((file) => file.text).join('');
  const inputs = Object.keys(result.metafile.inputs);
  return { entry, output, inputs, forbidden, bytes: Buffer.byteLength(output) };
};

const problems = ({ entry, output, inputs, forbidden }) => [
  ...inputs
    .filter((input) => input.split('/').includes('node_modules'))
    .map((input) => `${entry}: bundles dependency ${input}`),
  ...forbidden
    .filter((text) => output.includes(text))
    .map((text) => `${entry}: output contains ${text}`),
];

const targets = [
  ...entries.map((entry) => [entry, FORBIDDEN_TEXT]),
  ...BROWSER_ENTRIES.map((entry) => [entry, ['react']]),
];
const results = await Promise.all(targets.map(bundle));
const found = results.flatMap(problems);
const core = results[0];

console.log(`core bundle: ${core.bytes} bytes`);
found.forEach((line) => console.error(line));
process.exit(found.length === 0 ? 0 : 1);
