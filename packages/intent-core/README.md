# @jcsoftdev/intent-core

The client half of the [intent kit](../../README.md): capability descriptors, the ports your app implements, the action pipeline that executes a plan, and the intent session that drives a command from text to a revealed result. It has no runtime dependencies.

## Install

```sh
pnpm add @jcsoftdev/intent-core
```

## Usage

```ts
import {
  createCapabilityDefiner,
  createCapabilityRegistry,
  createIntentKit,
  createRoleAuthorizer,
} from '@jcsoftdev/intent-core';

const define = createCapabilityDefiner<Role, RouteId>();

export const ordersCreate = define({
  id: 'orders.create',
  version: 1,
  kind: 'write',
  agent: 'allowed',
  description: 'Create an order for a table',
  aliases: ['pedido'],
  examples: ['pedido de arroz con pollo para la mesa 3'],
  patterns: ['pedido de {dish} para la mesa {table}'],
  scope: 'global',
  input: ordersCreateInput,
  entities: [
    { path: 'tableId', entity: 'table' },
    { path: 'lines[].offeringId', entity: 'dish' },
  ],
  risk: 'write',
  confirmation: 'whenIrreversible',
  reversibility: { kind: 'compensate', via: 'orders.cancel', windowMs: 10_000 },
  idempotency: { kind: 'key', carrier: 'body', field: 'idempotencyKey' },
  roles: ['waiter'],
});

const registry = createCapabilityRegistry();
registry.register(ordersCreate, () => import('./effects/orders-create.js'));

const kit = createIntentKit({ registry, authorizer: createRoleAuthorizer(rolesOf), ...ports });
const session = kit.createSession();
await session.submit({ text: 'pedido de arroz con pollo para la mesa 3', source: 'text' });
```

## Ports to implement

| Port                   | Responsibility                                                                |
| ---------------------- | ----------------------------------------------------------------------------- |
| `InterpretationClient` | Sends the command to your server's interpretation service.                    |
| `Effect`               | Performs the write or read. Receives `planId` and, for keyed writes, the key. |
| `RouterAdapter`        | Navigates to the destination route and reports when it is ready.              |
| `TargetRegistry`       | Finds the element that shows the result.                                      |
| `Revealer`             | Scrolls to and focuses that element.                                          |
| `Announcer`            | Speaks the outcome to assistive technology.                                   |
| `ConfirmationPort`     | Asks the person to confirm an irreversible action.                            |
| `Compensator`          | Undoes a compensable write. Honors the request's `idempotencyKey`.            |
| `Authorizer`           | Decides whether the principal may run a capability (`createRoleAuthorizer`).  |
| `SchemaAdapter`        | Validates input against your schemas (see `@jcsoftdev/intent-zod`).           |

`@jcsoftdev/intent-testing` has a fake and a contract suite for most of them.

## Security contract

- Ids reach a plan only through entity and requirement paths resolved on the server. Never let the client or an LLM fill an id directly.
- Effects run on the client, so your API must authorize every write again and honor the idempotency key.
- After a retryable failure, such as a timed-out write, call `session.retry()`. It re-sends the same plan with the same key. Saying the command again is a new command with a new key, and therefore a new write. `retry()` is refused with a polite `NOT_AVAILABLE` notice when the last outcome is not a retryable failure of a dispatched plan, while busy, or after a reset or a role change.
- Create one kit per signed-in principal. A role change is handled by the session; a user, tenant or venue change is not.
- Continuations carry every answer given so far for the command; the session does this for you.

## License

MIT © jcsoftdev
