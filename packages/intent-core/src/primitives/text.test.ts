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

  test('matchClosedOption returns undefined when two options match', () => {
    expect(matchClosedOption('con papas fritas o yuca', options)).toBeUndefined();
  });

  test('matchClosedOption returns undefined when no option matches', () => {
    expect(matchClosedOption('con papas', options)).toBeUndefined();
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
});
