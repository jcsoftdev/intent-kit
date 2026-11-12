import { describe, expect, test } from 'vitest';
import { foldText, matchClosedOption } from './text.js';

const options = [
  { id: 'papas', label: 'Papas fritas' },
  { id: 'ensalada', label: 'Ensalada' },
  { id: 'yuca', label: 'Yuca' },
];

describe('text', () => {
  test.each([
    ['Está LISTO!', 'esta listo'],
    ['  Mesa   3 ', 'mesa 3'],
    ['¿Arroz con pollo?', 'arroz con pollo'],
    ['Ñandú', 'nandu'],
  ])('foldText(%s)', (text, folded) => {
    expect(foldText(text)).toBe(folded);
  });

  test('matchClosedOption picks the single option whose tokens all appear', () => {
    expect(matchClosedOption('con yuca', options)?.id).toBe('yuca');
  });

  test('matchClosedOption returns undefined when the text names two options', () => {
    expect(matchClosedOption('con papas o yuca', options)).toBeUndefined();
    expect(matchClosedOption('con papas fritas o yuca', options)).toBeUndefined();
    expect(matchClosedOption('arroz con pollo con papas o yuca', options)).toBeUndefined();
    expect(matchClosedOption('papas, no yuca', options)).toBeUndefined();
  });

  test('matchClosedOption accepts a partial mention of a single option', () => {
    expect(matchClosedOption('con papas', options)?.id).toBe('papas');
  });

  test('matchClosedOption never picks a negated option', () => {
    expect(matchClosedOption('sin yuca', options)).toBeUndefined();
  });

  test('matchClosedOption returns undefined when nothing is mentioned', () => {
    expect(matchClosedOption('lo que sea', options)).toBeUndefined();
  });

  test('a full label wins over an option whose tokens it covers', () => {
    const nested = [
      { id: 'arroz', label: 'Arroz' },
      { id: 'arroz-pollo', label: 'Arroz con pollo' },
    ];
    expect(matchClosedOption('quiero arroz con pollo', nested)?.id).toBe('arroz-pollo');
  });

  test('an exact folded equality wins over token matches', () => {
    const nested = [
      { id: 'arroz', label: 'Arroz' },
      { id: 'arroz-pollo', label: 'Arroz con pollo' },
    ];
    expect(matchClosedOption('arroz con pollo', nested)?.id).toBe('arroz-pollo');
    expect(matchClosedOption('ARROZ', nested)?.id).toBe('arroz');
  });

  test('a custom fold is applied to text and labels', () => {
    expect(matchClosedOption('YUCA', options, (text) => text.toLowerCase())?.id).toBe('yuca');
  });

  describe('detail', () => {
    const tables = [
      { id: 'salon', label: 'Mesa 3', detail: 'Salón' },
      { id: 'terraza', label: 'Mesa 3', detail: 'Terraza' },
    ];

    test.each([
      ['mesa 3 terraza', 'terraza'],
      ['la de terraza', 'terraza'],
      ['mesa 3 del salon', 'salon'],
      ['Mesa 3 Salón', 'salon'],
    ])('%s picks the option whose detail is mentioned', (text, id) => {
      expect(matchClosedOption(text, tables)?.id).toBe(id);
    });

    test('text that fits both options by label alone stays ambiguous', () => {
      expect(matchClosedOption('mesa 3', tables)).toBeUndefined();
    });

    test('naming both details or negating the chosen one picks nothing', () => {
      expect(matchClosedOption('mesa 3 salon o terraza', tables)).toBeUndefined();
      expect(matchClosedOption('mesa 3 no terraza', tables)).toBeUndefined();
    });
  });
});
