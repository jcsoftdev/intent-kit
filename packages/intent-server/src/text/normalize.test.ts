import { foldText, matchClosedOption } from '@jcsoftdev/intent-core';
import { describe, expect, test } from 'vitest';
import { createMatchKey, createNormalizer } from './normalize.js';

const normalize = createNormalizer();
const matchKey = createMatchKey();

describe('normalize', () => {
  test.each([
    ['Haz un pedido de arroz con pollo para la mesa 3', 'pedido de arroz con pollo para la mesa 3'],
    ['dos inca kola para llevar', 'dos inca kola para llevar'],
    ['El arroz con pollo está listo', 'el arroz con pollo esta listo'],
    ['Por favor, haz un tres leches para la mesa tres', 'un tres leches para la mesa tres'],
    ['una cerveza para la mesa 3', 'cerveza para la mesa 3'],
    ['un 3 leches para la mesa 3', 'un 3 leches para la mesa 3'],
    ['MESA   3', 'mesa 3'],
  ])('normalize(%s)', (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });

  test('truncates input to 500 characters before folding', () => {
    expect(normalize('a'.repeat(900))).toBe('a'.repeat(500));
  });

  test.each([
    ['dos inca kola', '2 inca kola'],
    ['Por favor, haz un tres leches para la mesa tres', '1 3 leches para la mesa 3'],
    ['un arroz con pollo', 'arroz con pollo'],
  ])('matchKey(%s)', (input, expected) => {
    expect(matchKey(input)).toBe(expected);
  });

  test('resolvers keyed with the match key find "Tres leches" from either spelling', () => {
    const options = [
      { id: 'a', label: 'Tres leches' },
      { id: 'b', label: 'Arroz con pollo' },
      { id: 'c', label: 'Dos leches' },
    ];
    expect(matchClosedOption('tres leches', options, foldText)?.id).toBe('a');
    expect(matchClosedOption('3 leches', options, foldText)).toBeUndefined();
    expect(matchClosedOption('3 leches', options, matchKey)?.id).toBe('a');
  });
});
