# @jcsoftdev/intent-testing

Fakes and contract suites for the [intent kit](../../README.md) ports. Use the fakes to test your app against the kit, and the contract suites to prove your own adapters behave the way the kit relies on.

## Install

```sh
pnpm add -D @jcsoftdev/intent-testing vitest
```

## Usage

```ts
import { describeEntityResolverContract } from '@jcsoftdev/intent-testing/contracts';

describeEntityResolverContract('dish resolver', () => ({
  resolver: createDishResolver(db),
  principal: tenantA,
  exact: { text: 'Arroz con pollo', variant: 'ARRÓZ CON POLLO', id: arrozId },
  ambiguous: { text: 'arroz', ids: [arrozId, chaufaId] },
  unknown: 'pizza',
  options: { path: 'lines[0].offeringId', draft, ids: tenantADishIds },
  foreign: { principal: tenantB, hiddenIds: tenantADishIds },
}));
```

The root entry exports the fakes (`createFakeRouter`, `createInMemoryEntityResolver`, `createFakeCompensator`, `createScriptedConfirmation` and more). `./contracts` exports one `describe…Contract` per port: router, interpreter, entity resolver, effect, compensator, speech source and schema adapter. The suites need `vitest` 4.

## What the suites pin

- Entity resolvers never resolve a record from its id sent as text, and never show one tenant's ids to another, in `found`, `choices`, `nearest` or `options`.
- Effects and compensators resolve `ABORTED` without side effects on an aborted signal.
- A compensator applies one compensation per idempotency key.

Labels should also resolve back to their own id; the suites do not require it, because a display label is allowed, but such a label costs an extra question on number-word dishes.

## License

Proprietary. Copyright © 2026 jcsoftdev. All rights reserved. See [LICENSE](./LICENSE).
