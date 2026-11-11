import { describe, expect, test } from 'vitest';
import { fillTemplate, templateReferences } from './template.js';

describe('template', () => {
  test('fillTemplate resolves output and input references', () => {
    expect(fillTemplate('{output.orderId}', { input: {}, output: { orderId: 'o-1' } })).toBe('o-1');
    expect(
      fillTemplate('/orders/{output.orderId}?t={input.table.id}', {
        input: { table: { id: 7 } },
        output: { orderId: 'o-1' },
      }),
    ).toBe('/orders/o-1?t=7');
  });

  test('fillTemplate returns undefined when a value is missing or the root is unknown', () => {
    expect(fillTemplate('{output.orderId}', { input: {}, output: {} })).toBeUndefined();
    expect(fillTemplate('{session.x}', { input: {}, output: {} })).toBeUndefined();
  });

  test('templateReferences reports every distinct reference including foreign roots', () => {
    expect(templateReferences('{session.x}')).toEqual(['session.x']);
    expect(templateReferences('{input.a}/{output.b}/{input.a}')).toEqual(['input.a', 'output.b']);
    expect(templateReferences('plain')).toEqual([]);
  });
});
