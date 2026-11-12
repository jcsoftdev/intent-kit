import { IntentDefinitionError, foldText } from '@jcsoftdev/intent-core';
import { describe, expect, test } from 'vitest';
import { createNormalizer } from './normalize.js';
import { compilePattern } from './pattern.js';
import type { SlotKind } from './pattern.js';

const kindOf = (slot: string): SlotKind => (slot === 'quantity' ? 'number' : 'text');
const order = compilePattern('pedido de {quantity?} {dish} para la mesa {table}', kindOf);

describe('compilePattern', () => {
  test('optional quantity absent', () => {
    expect(order.match('pedido de arroz con pollo para la mesa 3')).toEqual({
      dish: 'arroz con pollo',
      table: '3',
    });
  });

  test('optional quantity present', () => {
    expect(order.match('pedido de 2 inca kola para la mesa 3')).toEqual({
      quantity: '2',
      dish: 'inca kola',
      table: '3',
    });
  });

  test('alternation and character class', () => {
    const ready = compilePattern('(el|la) {dish} está list[oa]', kindOf);
    expect(ready.match('la causa esta lista')).toEqual({ dish: 'causa' });
    expect(ready.match('el arroz con pollo esta listo')).toEqual({ dish: 'arroz con pollo' });
    expect(ready.match('arroz con pollo listo')).toBeUndefined();
  });

  test('does not match an empty dish', () => {
    const pattern = compilePattern('{dish} para la mesa {table}', kindOf);
    expect(pattern.match(' para la mesa 3')).toBeUndefined();
    expect(pattern.match('  para la mesa 3')).toBeUndefined();
  });

  test('leading optional slot', () => {
    const pattern = compilePattern('{quantity?} {dish} listo', kindOf);
    expect(pattern.match('2 causas listo')).toEqual({ quantity: '2', dish: 'causas' });
    expect(pattern.match('causas listo')).toEqual({ dish: 'causas' });
  });

  test('500 characters of "a " against a three-slot pattern settles in under 50 ms', () => {
    const pattern = compilePattern('{a} y {b} para {quantity}', kindOf);
    const started = performance.now();
    expect(pattern.match('a '.repeat(250))).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(50);
  });

  test('the worst allowed pattern (two text slots, numbers, one repeated separator) settles within 50 ms on 500 characters', () => {
    const pattern = compilePattern('{quantity?} {a} x {b} y', kindOf);
    const started = performance.now();
    expect(pattern.match('x '.repeat(250))).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(50);
  });

  test.each(['{a} {b} listo', '{a} {b} {c} {d} listo', '{a} {quantity?} {b} listo', '(a|{x}) {y}'])(
    'adjacent text slots or slots in alternations in %j throw INVALID_PATTERN',
    (template) => {
      expect(() => compilePattern(template, kindOf)).toThrow('INVALID_PATTERN');
    },
  );

  test('a literal between text slots is accepted', () => {
    expect(() => compilePattern('{a} con {b} listo', kindOf)).not.toThrow();
  });

  test.each(['haz un pedido de {dish}', 'pedido de un {dish}', 'oye {dish}'])(
    'literal %j that the normalizer rewrites throws INVALID_PATTERN',
    (template) => {
      expect(() => compilePattern(template, kindOf, createNormalizer())).toThrow('INVALID_PATTERN');
    },
  );

  test('a normalizer-stable template compiles and matches normalized text', () => {
    const pattern = compilePattern('pedido de {dish} para la mesa 1', kindOf, createNormalizer());
    expect(pattern.match('pedido de causa para la mesa 1')).toEqual({ dish: 'causa' });
  });

  test.each([
    'pedido de {dish',
    'pedido )de',
    '(a||b) {x}',
    'list[] {x}',
    '{x} {x}',
    '',
    '{bad name}',
  ])('pattern %j throws INVALID_PATTERN', (template) => {
    expect(() => compilePattern(template, kindOf)).toThrow(IntentDefinitionError);
    expect(() => compilePattern(template, kindOf)).toThrow('INVALID_PATTERN');
  });

  describe('number words', () => {
    const words = new Map([
      ['un', 1],
      ['dos', 2],
      ['tres', 3],
    ]);
    const counted = compilePattern(
      '{quantity?} {dish} para la mesa {table}',
      (slot) => (slot === 'quantity' || slot === 'table' ? 'number' : 'text'),
      foldText,
      words,
    );

    test('a numeric slot accepts a number word and converts only its own capture', () => {
      expect(counted.match('dos tres leches para la mesa tres')).toEqual({
        quantity: '2',
        dish: 'tres leches',
        table: '3',
      });
    });

    test('a captured quantity also yields the reading where the dish text keeps it', () => {
      expect(counted.alternatives('tres leches para la mesa 3')).toEqual([
        { dish: 'tres leches', table: '3' },
      ]);
      expect(counted.alternatives('leches para la mesa 3')).toEqual([]);
    });

    test('a quantity that does not precede a text slot has no alternative', () => {
      const reserve = compilePattern(
        'reserva {table} para {quantity} personas',
        (slot) => (slot === 'quantity' ? 'number' : 'text'),
        foldText,
        words,
      );
      expect(reserve.match('reserva terraza para tres personas')).toEqual({
        table: 'terraza',
        quantity: '3',
      });
      expect(reserve.alternatives('reserva terraza para tres personas')).toEqual([]);
    });
  });
});
