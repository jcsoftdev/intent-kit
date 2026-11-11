import { createPlayground } from './wiring.js';
import type { PlaygroundRole } from './restaurant.js';

const ROLES: readonly PlaygroundRole[] = ['waiter', 'kitchen', 'cashier'];
const ROLE_FLAG = '--role';
const TICK_MS = 1_000;
const DEFAULT_ROLE: PlaygroundRole = 'waiter';

const isRole = (value: string | undefined): value is PlaygroundRole =>
  ROLES.some((role) => role === value);

const flagValue = (args: readonly string[], flag: string): string | undefined => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};

const textOf = (args: readonly string[]): string =>
  args.filter((arg, index) => arg !== ROLE_FLAG && args[index - 1] !== ROLE_FLAG).join(' ');

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const args = process.argv.slice(2);
const requestedRole = flagValue(args, ROLE_FLAG) ?? DEFAULT_ROLE;
const text = textOf(args);

if (!isRole(requestedRole) || text === '') {
  console.error(`usage: cli "<text>" ${ROLE_FLAG} ${ROLES.join('|')}`);
  process.exit(1);
}

const playground = createPlayground({
  principal: {
    tenantId: 't-1',
    userId: 'u-1',
    roles: [requestedRole],
    activeRole: requestedRole,
  },
});

let lastName = '';
playground.session.subscribe((state) => {
  if (state.name !== lastName) {
    lastName = state.name;
    console.log(state.name);
  }
});

let settled = false;
const submitted = playground.session.submit({ text, source: 'text' }).then(() => {
  settled = true;
});

while (!settled) {
  await playground.clock.advance(TICK_MS);
  await nextMacrotask();
}
await submitted;

playground.announcer.messages().forEach(({ message }) => console.log(message));
