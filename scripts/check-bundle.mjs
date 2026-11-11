import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const entries = ['packages/intent-core/dist/index.js', 'packages/intent-server/dist/index.js'];
const FORBIDDEN_TEXT = [
  'SpeechRecognition',
  'requestAnimationFrame',
  'matchMedia',
  'react',
  'document.',
];

const bundle = async (entry) => {
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
  return { entry, output, inputs, bytes: Buffer.byteLength(output) };
};

const problems = ({ entry, output, inputs }) => [
  ...inputs
    .filter((input) => input.split('/').includes('node_modules'))
    .map((input) => `${entry}: bundles dependency ${input}`),
  ...FORBIDDEN_TEXT.filter((text) => output.includes(text)).map(
    (text) => `${entry}: output contains ${text}`,
  ),
];

const results = await Promise.all(entries.map(bundle));
const found = results.flatMap(problems);
const core = results[0];

console.log(`core bundle: ${core.bytes} bytes`);
found.forEach((line) => console.error(line));
process.exit(found.length === 0 ? 0 : 1);
