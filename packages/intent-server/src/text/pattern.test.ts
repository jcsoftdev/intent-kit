import { IntentDefinitionError } from '@jcsoftdev/intent-core';
import { describe, expect, test } from 'vitest';
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
    const pattern = compilePattern('{a} y {b} para {c}', kindOf);
    const started = performance.now();
    expect(pattern.match('a '.repeat(250))).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(50);
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
});
