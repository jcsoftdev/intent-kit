import { pathToFileURL } from 'node:url';
import { createPlayground } from './wiring.js';
import type { PlaygroundRole } from './restaurant.js';

const ROLES: readonly PlaygroundRole[] = ['waiter', 'kitchen', 'cashier'];
const ROLE_FLAG = '--role';
const TICK_MS = 1_000;
const MAX_TICKS = 60;
const DEFAULT_ROLE: PlaygroundRole = 'waiter';
const SUCCESS_EXIT = 0;
const FAILURE_EXIT = 1;
const UNANSWERED_STATES: ReadonlySet<string> = new Set(['failed', 'clarifying', 'unsupported']);

const isRole = (value: string | undefined): value is PlaygroundRole =>
  ROLES.some((role) => role === value);

const flagValue = (args: readonly string[], flag: string): string | undefined => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};

const textOf = (args: readonly string[]): string =>
  args.filter((arg, index) => arg !== ROLE_FLAG && args[index - 1] !== ROLE_FLAG).join(' ');

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function runCli(
  args: readonly string[],
  write: (line: string) => void,
): Promise<number> {
  const role = flagValue(args, ROLE_FLAG) ?? DEFAULT_ROLE;
  const text = textOf(args);
  if (!isRole(role) || text === '') {
    write(`usage: cli "<text>" ${ROLE_FLAG} ${ROLES.join('|')}`);
    return FAILURE_EXIT;
  }
  const playground = createPlayground({
    principal: { tenantId: 't-1', userId: 'u-1', roles: [role], activeRole: role },
  });
  let lastName = '';
  playground.session.subscribe((state) => {
    if (state.name !== lastName) {
      lastName = state.name;
      write(state.name);
    }
  });
  let settled = false;
  const submitted = playground.session.submit({ text, source: 'text' }).then(() => {
    settled = true;
  });
  for (let tick = 0; !settled && tick < MAX_TICKS; tick += 1) {
    await playground.clock.advance(TICK_MS);
    await nextMacrotask();
  }
  if (!settled) {
    playground.session.cancel();
  }
  await submitted;
  playground.announcer.messages().forEach(({ message }) => write(message));
  return settled && !UNANSWERED_STATES.has(playground.session.state().name)
    ? SUCCESS_EXIT
    : FAILURE_EXIT;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = await runCli(process.argv.slice(2), console.log);
}
