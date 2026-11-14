import { IntentDefinitionError, foldText } from '@jcsoftdev/intent-core';
import { describe, expect, test } from 'vitest';
import { createNormalizer } from './normalize.js';
import { compilePattern, splitLeadingNumber } from './pattern.js';
import type { SlotKind } from './pattern.js';

const kindOf = (slot: string): SlotKind => (slot === 'quantity' ? 'number' : 'text');
const order = compilePattern('pedido de {quantity?} {dish} para la mesa {table}', kindOf);

describe('decimal slots', () => {
  const normalize = createNormalizer();
  const decimals = (slot: string): SlotKind => (slot === 'amount' ? 'decimal' : 'number');
  const charge = compilePattern('paga con {amount}', decimals, normalize);
  const table = compilePattern('mesa {table} paga con {amount}', decimals, normalize);

  test.each([
    ['paga con 235.50', '235.50'],
    ['paga con 235,50', '235.50'],
    ['paga con 200.5', '200.50'],
    ['paga con 35.05', '35.05'],
    ['paga con 235 con 50', '235.50'],
    ['paga con 12 con 5', '12.05'],
    ['paga con 50', '50'],
  ])('%s captures %s', (utterance, amount) => {
    expect(charge.match(normalize(utterance))).toEqual({ amount });
  });

  test('a whole number slot never takes a fraction', () => {
    expect(table.match(normalize('mesa 2 paga con 35.50'))).toEqual({
      table: '2',
      amount: '35.50',
    });
    expect(table.match(normalize('mesa 2.50 paga con 35'))).toBeUndefined();
  });

  test('a fraction of three digits is not a decimal', () => {
    expect(charge.match(normalize('paga con 1.234'))).toBeUndefined();
  });
});

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

  test('a pattern without slots matches the whole phrase and nothing else', () => {
    const open = compilePattern('abre la cola', kindOf);
    expect(open.match('abre la cola')).toEqual({});
    expect(open.match('abre la cola de cocina')).toBeUndefined();
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

  test.each([
    '{a} {b} listo',
    '{a} {b} {c} {d} listo',
    '{a} {quantity?} {quantity2?} {b} listo',
    '(a|{x}) {y}',
  ])('adjacent text slots or slots in alternations in %j throw INVALID_PATTERN', (template) => {
    expect(() => compilePattern(template, kindOf)).toThrow('INVALID_PATTERN');
  });

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

    test('a captured quantity also yields the unsplit text of the slot it precedes', () => {
      expect(counted.pairs).toEqual([{ numberSlot: 'quantity', textSlot: 'dish' }]);
      expect(counted.splits('tres leches para la mesa 3')).toEqual([
        { textSlot: 'dish', whole: 'tres leches' },
      ]);
      expect(counted.splits('leches para la mesa 3')).toEqual([]);
    });

    test('a required quantity and every number-before-text pair split too', () => {
      const pairs = compilePattern(
        'agrega {quantity} {dish} y {quantity2?} {side}',
        (slot) => (slot.startsWith('quantity') ? 'number' : 'text'),
        foldText,
        words,
      );
      expect(pairs.splits('agrega dos arroz y tres leches')).toEqual([
        { textSlot: 'dish', whole: 'dos arroz' },
        { textSlot: 'side', whole: 'tres leches' },
      ]);
      expect(pairs.splits('agrega dos arroz y leches')).toEqual([
        { textSlot: 'dish', whole: 'dos arroz' },
      ]);
    });

    test('a leading number splits off digits or a number word and keeps the rest', () => {
      expect(splitLeadingNumber('tres leches', words)).toEqual({ value: 3, rest: 'leches' });
      expect(splitLeadingNumber('12 chicha', words)).toEqual({ value: 12, rest: 'chicha' });
      expect(splitLeadingNumber('leches', words)).toBeUndefined();
      expect(splitLeadingNumber('tres', words)).toBeUndefined();
    });

    test('a quantity that does not precede a text slot has no split', () => {
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
      expect(reserve.pairs).toEqual([]);
      expect(reserve.splits('reserva terraza para tres personas')).toEqual([]);
    });
  });

  describe('a number slot between two text slots', () => {
    const words = new Map([
      ['un', 1],
      ['dos', 2],
      ['tres', 3],
    ]);
    const kinds = (slot: string): SlotKind => (slot === 'quantity' ? 'number' : 'text');
    const normalize = createNormalizer();
    const optional = compilePattern('mesa {table} {quantity?} {dish}', kinds, normalize, words);
    const required = compilePattern('mesa {table} {quantity} {dish}', kinds, normalize, words);
    const punctuated = compilePattern('mesa {table}, {quantity?} {dish}', kinds, normalize, words);

    test.each([
      ['mesa 4 dos lomos', { table: '4', quantity: '2', dish: 'lomos' }],
      ['mesa 4 2 lomos saltados', { table: '4', quantity: '2', dish: 'lomos saltados' }],
      ['mesa 4 lomo saltado', { table: '4', dish: 'lomo saltado' }],
      ['mesa 4 dos tres leches', { table: '4', quantity: '2', dish: 'tres leches' }],
      ['mesa terraza 4 dos lomos', { table: 'terraza', quantity: '4', dish: 'dos lomos' }],
      ['mesa 4 dos', { table: '4', dish: 'dos' }],
    ])('optional quantity: %j', (utterance, expected) => {
      expect(optional.match(normalize(utterance))).toEqual(expected);
    });

    test.each([
      ['mesa 4, dos lomos', { table: '4', quantity: '2', dish: 'lomos' }],
      ['Mesa 4, lomo saltado.', { table: '4', dish: 'lomo saltado' }],
      ['mesa 4; 3 anticuchos', { table: '4', quantity: '3', dish: 'anticuchos' }],
      ['mesa 4 dos lomos', { table: '4', quantity: '2', dish: 'lomos' }],
    ])('comma in the pattern and %j', (utterance, expected) => {
      expect(punctuated.match(normalize(utterance))).toEqual(expected);
    });

    test('a required quantity is mandatory', () => {
      expect(required.match('mesa 4 dos lomos')).toEqual({
        table: '4',
        quantity: '2',
        dish: 'lomos',
      });
      expect(required.match('mesa 4 lomo saltado')).toBeUndefined();
    });

    test('the text slot ends at the first number token after its first token', () => {
      expect(optional.match('mesa terraza 4 dos lomos')).toEqual({
        table: 'terraza',
        quantity: '4',
        dish: 'dos lomos',
      });
      expect(required.match('mesa terraza norte 4 lomos')).toEqual({
        table: 'terraza norte',
        quantity: '4',
        dish: 'lomos',
      });
    });

    test('the quantity pairs with the dish and splits it', () => {
      expect(optional.pairs).toEqual([{ numberSlot: 'quantity', textSlot: 'dish' }]);
      expect(optional.splits('mesa 4 dos lomos')).toEqual([
        { textSlot: 'dish', whole: 'dos lomos' },
      ]);
    });

    test('punctuation between slots is whitespace in both the pattern and the utterance', () => {
      const separated = compilePattern('mesa {table}. para; {dish}; listo', kinds);
      expect(separated.match('mesa 4, para lomo listo')).toEqual({ table: '4', dish: 'lomo' });
      expect(separated.template).toBe('mesa {table}. para; {dish}; listo');
    });

    test('a slot name keeps its dots and brackets', () => {
      expect(compilePattern('mesa {order.table}, con {dish}', kinds).slots).toEqual([
        'order.table',
        'dish',
      ]);
    });

    test.each(['{a} {quantity} {quantity2} {b}', '{a} {b} {quantity?} {c}'])(
      '%j throws INVALID_PATTERN',
      (template) => {
        const numbers = (slot: string): SlotKind =>
          slot.startsWith('quantity') ? 'number' : 'text';
        expect(() => compilePattern(template, numbers)).toThrow('INVALID_PATTERN');
      },
    );

    test('a pattern with no number between text slots keeps its lazy capture', () => {
      const reserve = compilePattern('reserva {table} {quantity}', kinds, normalize, words);
      expect(reserve.match('reserva 4 5 6')).toEqual({ table: '4 5', quantity: '6' });
    });

    test('500 characters settle within 50 ms', () => {
      const started = performance.now();
      expect(optional.match(`mesa ${'x '.repeat(248)}`.trim())).toEqual({
        table: 'x',
        dish: 'x '.repeat(247).trim(),
      });
      expect(performance.now() - started).toBeLessThan(50);
    });
  });
});
