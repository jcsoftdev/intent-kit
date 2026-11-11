import { foldText, matchClosedOption } from '@jcsoftdev/intent-core';
import { describe, expect, test } from 'vitest';
import { createNormalizer } from './normalize.js';

const normalize = createNormalizer();

describe('normalize', () => {
  test.each([
    ['Haz un pedido de arroz con pollo para la mesa 3', 'pedido de arroz con pollo para la mesa 3'],
    ['dos inca kola para llevar', '2 inca kola para llevar'],
    ['El arroz con pollo está listo', 'el arroz con pollo esta listo'],
    ['Por favor, haz un tres leches para la mesa tres', '3 leches para la mesa 3'],
    ['MESA   3', 'mesa 3'],
  ])('normalize(%s)', (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });

  test('truncates input to 500 characters before folding', () => {
    expect(normalize('a'.repeat(900))).toBe('a'.repeat(500));
  });

  test('resolvers built with the kit normalizer still find "Tres leches" after the dish became "3 leches"', () => {
    const dish = normalize('un tres leches para la mesa 3').split(' para ')[0] as string;
    expect(dish).toBe('3 leches');
    const options = [
      { id: 'a', label: 'Tres leches' },
      { id: 'b', label: 'Arroz con pollo' },
      { id: 'c', label: 'Dos leches' },
    ];
    expect(matchClosedOption(dish, options, foldText)).toBeUndefined();
    expect(matchClosedOption(dish, options, normalize)?.id).toBe('a');
  });
});
