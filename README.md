# intent kit

Turn what a person says or types ("pedido de arroz con pollo para la mesa 3") into a validated, authorized action in your app, without ever letting text, an LLM or the client invent an id.

The kit runs two pipelines:

```
client                                     server
──────                                     ──────
session.submit(text) ── InterpretationClient ──▶ interpretation pipeline
                                                 catalog (by role) → normalize → deterministic patterns
                                                 → interpreter (LLM, optional) → draft → entities
                                                 → requirements → validate
            ◀── complete plan | question | ambiguity | unsupported
action pipeline
revalidate → confirm → guard → load effect → execute → present → offer undo
```

The server owns every id. The client owns execution, navigation, presentation and undo.

## Packages

| Package                                                | What it is                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| [`@jcsoftdev/intent-core`](packages/intent-core)       | Descriptors, ports, the action pipeline and the intent session. |
| [`@jcsoftdev/intent-server`](packages/intent-server)   | The interpretation service: text to a tenant-scoped plan.       |
| [`@jcsoftdev/intent-zod`](packages/intent-zod)         | Zod adapter for the `SchemaAdapter` port.                       |
| [`@jcsoftdev/intent-testing`](packages/intent-testing) | Fakes and contract suites for every port.                       |

## Install

```sh
pnpm add @jcsoftdev/intent-core @jcsoftdev/intent-server @jcsoftdev/intent-zod zod
pnpm add -D @jcsoftdev/intent-testing
```

Node 24 or later. ESM only.

## Quick start

```ts
import {
  createCapabilityRegistry,
  createIntentKit,
  createRoleAuthorizer,
} from '@jcsoftdev/intent-core';
import { createInterpretationService } from '@jcsoftdev/intent-server';
import { createZodSchemaAdapter } from '@jcsoftdev/intent-zod';

const service = createInterpretationService({
  capabilities: [ordersCreate],
  schema: createZodSchemaAdapter(),
  rolesOf,
  resolvers: [tableResolver, dishResolver],
});

const registry = createCapabilityRegistry();
registry.register(ordersCreate, () => import('./effects/orders-create.js'));

const kit = createIntentKit({
  registry,
  authorizer: createRoleAuthorizer(rolesOf),
  interpretation: { interpret: (input, { signal }) => callYourApi(input, signal) },
  confirmation,
  router,
  targets,
  revealer,
  announcer,
  messages,
  principal: () => currentUser,
  activeRole: () => currentUser.activeRole,
  locale: 'es-PE',
  failureMessages,
});

const session = kit.createSession();
await session.submit({ text: 'pedido de arroz con pollo para la mesa 3', source: 'text' });
```

On the server, your API handler calls `service.interpret(principal, input, { signal })` with the principal from its own session, never one sent by the client.

## Integrator contract

These rules are what keep ids and tenants safe. The kit enforces what it can at construction and per request; the rest is yours.

- **Server-owned ids only on entity and requirement paths.** Every id-shaped input leaf must be declared as an `entities` path (resolved by an `EntityResolver`) or as a `RequirementProbe` path. Text, interpreter slots and client drafts are always resolved as text; an id written there is never trusted.
- **Resolvers are scoped to the principal.** `resolve` and `options` only ever see the principal's own tenant. Match on labels and aliases, never on ids: an id sent as query text must not resolve to its record.
- **Compare with one match key.** Normalize both the query and the record names with `createMatchKey` (or the same function) so case, accents and number words agree.
- **Several matches are `choices`, never `found`.** The server asks; it never picks silently.
- **Labels should round-trip.** A label your resolver returns should resolve back to its own id. When one does not (a display label like "Bebida #12"), an answered number-word pick is written back as the spoken text and may be asked again.
- **Clients send cumulative answers.** A continuation carries every answer given so far for that command, as the kit's session does.
- **One kit per signed-in principal.** Create a new kit when the user, tenant or venue changes; a role change alone is handled by the session.
- **Effects re-check on the API.** The client's authorization is a courtesy; your API authorizes every write again and honors the `idempotencyKey` it receives, including the one on a `CompensationRequest`.

## Pattern rules

Patterns make common commands deterministic and skip the LLM:

- `{slot}` captures text into an input leaf or an entity, named by its leaf name, its full path or its entity name; `{slot?}` is optional.
- `(el|la)` is an alternation and `list[oa]` a character class.
- At most four slots and two text slots per pattern. Literal words must survive the normalizer unchanged.
- A numeric slot right before an entity slot (`{quantity?} {dish}`) is read both ways ("tres leches" is three "leches" or one "Tres leches") and never swapped silently.
- An unknown slot, a slot that names two paths, or two patterns that put different numeric slots before the same entity fail at construction (`INVALID_SLOT`, `AMBIGUOUS_SLOT`, `INVALID_PATTERN`).

## Stability

The packages are `0.x`. Exported helpers beyond the documented factories and ports may change between minor versions.

## License

MIT © jcsoftdev
