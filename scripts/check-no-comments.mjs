import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const walk = (directory) =>
  statSync(directory, { throwIfNoEntry: false })?.isDirectory()
    ? readdirSync(directory).flatMap((entry) => {
        const full = join(directory, entry);
        return statSync(full).isDirectory() ? walk(full) : [full];
      })
    : [];

const children = (directory) =>
  statSync(directory, { throwIfNoEntry: false })?.isDirectory()
    ? readdirSync(directory).map((name) => join(directory, name))
    : [];

const scanned = () =>
  [
    ...children(join(root, 'packages')).flatMap((dir) => walk(join(dir, 'src'))),
    ...children(join(root, 'apps')).flatMap((dir) => [
      ...walk(join(dir, 'src')),
      ...walk(join(dir, 'test')),
    ]),
    ...walk(join(root, 'scripts')),
  ].filter((file) => file.endsWith('.ts') || file.endsWith('.mjs'));

const STRING_LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\[\s\S])*`/g;
const REGEX_LITERAL =
  /(?<=(?:^|[(,=:>\[!&|?{};]|\breturn)\s*)\/(?![/*])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[a-z]*/gm;
const blank = (text) => text.replace(/[^\n]/g, ' ');

const strip = (source) => source.replace(REGEX_LITERAL, blank).replace(STRING_LITERAL, blank);

const offending = (file) =>
  strip(readFileSync(file, 'utf8'))
    .split('\n')
    .flatMap((line, index) =>
      line.includes('//') || line.includes('/*') ? [`${relative(root, file)}:${index + 1}`] : [],
    );

const found = scanned().flatMap(offending);

found.forEach((line) => console.error(line));
process.exit(found.length === 0 ? 0 : 1);
