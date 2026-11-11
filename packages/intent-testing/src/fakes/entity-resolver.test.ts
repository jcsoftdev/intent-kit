import { foldText } from '@jcsoftdev/intent-core';
import { describe, expect, it } from 'vitest';
import { createInMemoryEntityResolver, type EntityRecord } from './entity-resolver.js';

const signal = new AbortController().signal;
const query = (text: string) => ({ text, hints: {}, scope: 'any' as const });

const build = (records: readonly EntityRecord[], normalize?: (text: string) => string) =>
  createInMemoryEntityResolver<null>({
    entity: 'dish',
    records: () => records,
    ...(normalize ? { normalize } : {}),
  });

describe('in-memory entity resolver', () => {
  it('with a normalizer that maps "tres" to "3" finds "Tres leches" from the text "3 leches"', async () => {
    const normalize = (text: string): string =>
      foldText(text)
        .split(' ')
        .map((token) => (token === 'tres' ? '3' : token))
        .join(' ');
    const resolver = build(
      [
        { id: 'd1', label: 'Tres leches' },
        { id: 'd2', label: 'Suspiro limeño' },
      ],
      normalize,
    );
    await expect(resolver.resolve(null, query('3 leches'), { signal })).resolves.toEqual({
      status: 'found',
      id: 'd1',
      label: 'Tres leches',
    });
  });

  it('"arroz" with records "Arroz con pollo" and "Arroz chaufa" → choices in record order; "arroz con polo" → notFound with nearest ["Arroz con pollo", …]', async () => {
    const resolver = build([
      { id: 'd1', label: 'Arroz con pollo' },
      { id: 'd2', label: 'Arroz chaufa' },
      { id: 'd3', label: 'Ceviche' },
    ]);
    await expect(resolver.resolve(null, query('arroz'), { signal })).resolves.toEqual({
      status: 'choices',
      options: [
        { id: 'd1', label: 'Arroz con pollo' },
        { id: 'd2', label: 'Arroz chaufa' },
      ],
    });
    await expect(resolver.resolve(null, query('arroz con polo'), { signal })).resolves.toEqual({
      status: 'notFound',
      nearest: [
        { id: 'd1', label: 'Arroz con pollo' },
        { id: 'd2', label: 'Arroz chaufa' },
      ],
    });
  });

  it('matches aliases exactly and rejects when aborted', async () => {
    const resolver = build([
      { id: 'd1', label: 'Lomo saltado', aliases: ['lomito'], detail: 'S/ 32' },
    ]);
    await expect(resolver.resolve(null, query('Lomito'), { signal })).resolves.toEqual({
      status: 'found',
      id: 'd1',
      label: 'Lomo saltado',
    });
    const aborted = new AbortController();
    aborted.abort(new Error('stop'));
    await expect(resolver.resolve(null, query('lomo'), { signal: aborted.signal })).rejects.toThrow(
      'stop',
    );
  });

  it('an empty or blank query is notFound instead of matching every record', async () => {
    const resolver = build([{ id: 'd1', label: 'Ceviche' }]);
    for (const text of ['', '   ']) {
      await expect(resolver.resolve(null, query(text), { signal })).resolves.toEqual({
        status: 'notFound',
        nearest: [],
      });
    }
  });
});
