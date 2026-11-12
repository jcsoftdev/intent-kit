import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';

const run = async (args: readonly string[]) => {
  const lines: string[] = [];
  const code = await runCli(args, (line) => lines.push(line));
  return { code, lines };
};

describe('cli', () => {
  it('exits 0 and prints the states and the announcement for a completed command', async () => {
    const { code, lines } = await run(['Haz un pedido de arroz con pollo para la mesa 3']);

    expect(code).toBe(0);
    expect(lines).toEqual([
      'interpreting',
      'executing',
      'presenting',
      'completed',
      'Pedido enviado a cocina · Mesa 3',
    ]);
  });

  it('exits non-zero when the session ends failed', async () => {
    const { code, lines } = await run(['el arroz con pollo esta listo', '--role', 'kitchen']);

    expect(code).not.toBe(0);
    expect(lines).toContain('failed');
  });

  it('exits non-zero when the command still needs an answer', async () => {
    const { code, lines } = await run(['pedido de lomo saltado para la mesa 3']);

    expect(code).not.toBe(0);
    expect(lines).toContain('clarifying');
  });

  it('exits non-zero on an unknown role', async () => {
    const { code } = await run(['hola', '--role', 'chef']);

    expect(code).not.toBe(0);
  });
});
