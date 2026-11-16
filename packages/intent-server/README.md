# @jcsoftdev/intent-server

The server half of the [intent kit](../../README.md): an interpretation service that turns text into a complete, validated plan, a question with server-owned options, an ambiguity, or `unsupported`. It filters the catalog by role, matches deterministic patterns, calls your interpreter only when no pattern matches, and resolves every entity through your resolvers for the calling principal. No framework dependency.

## Install

```sh
pnpm add @jcsoftdev/intent-server @jcsoftdev/intent-core
```

## Usage

```ts
import { SPANISH_NORMALIZATION, createInterpretationService } from '@jcsoftdev/intent-server';
import { createZodSchemaAdapter } from '@jcsoftdev/intent-zod';

const service = createInterpretationService({
  capabilities: [ordersCreate],
  schema: createZodSchemaAdapter(),
  rolesOf: (principal) => ({ active: principal.activeRole, granted: principal.roles }),
  resolvers: [tableResolver, dishResolver],
  probes: [modifiersProbe],
  interpreter: llmInterpreter,
  normalization: SPANISH_NORMALIZATION,
});

app.post('/intent', async (request) =>
  service.interpret(request.session.principal, request.body, { signal: request.signal }),
);
```

The principal always comes from your server session, never from the request body.

## Ports to implement

| Port               | Responsibility                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `EntityResolver`   | Resolves text to an id (`found`, `choices`, `notFound`) and lists `options` for a principal. |
| `RequirementProbe` | Reports missing server-owned fields (with options) on its declared `paths`.                  |
| `Interpreter`      | Optional. Proposes a capability and text slots, for example from an LLM.                     |
| `SchemaAdapter`    | Validates input and lists missing paths (see `@jcsoftdev/intent-zod`).                       |

Check your adapters with `describeEntityResolverContract` and friends from `@jcsoftdev/intent-testing/contracts`.

## Security contract

- Every id-shaped input leaf is an `entities` path or a `RequirementProbe` path; the catalog refuses anything else at construction.
- Resolvers only see the principal's tenant and match labels and aliases, never ids: an id sent as text must not resolve to its record.
- Compare query and record names with `createMatchKey` on both sides. Several matches are `choices`, never `found`.
- Labels should resolve back to their own id. A display label that does not is never written back; the spoken text is, and may be asked again.
- Clients send cumulative answers on a continuation.

## Pattern rules

- `{slot}` captures into an input leaf or entity, named by its leaf name, full path or entity name; `{slot?}` is optional.
- `(el|la)` is an alternation and `list[oa]` a character class.
- At most four slots and two text slots per pattern; literal words must survive the normalizer unchanged.
- A numeric slot right before an entity slot (`{quantity?} {dish}`) is read both ways and never swapped silently.
- A text slot, a number slot and a text slot may follow each other (`mesa {table} {quantity?} {dish}`). The first text slot takes at least one token and ends before the first later token that parses as a number (digits or a number word); the number slot then takes that token and the second text slot takes the rest. When the optional number is absent the second text slot takes everything after the first. Only one number slot may sit between two text slots, and two text slots with nothing between them stay invalid. Patterns without this shape keep their existing matching.
- `,`, `;` and `.` outside a slot are whitespace in patterns, as in utterances: `mesa {table}, {quantity?} {dish}` matches "mesa 4, dos lomos".
- `foldSpanishPlural(token)` is an opt-in helper for entity resolvers: it takes a folded token and returns its singular (`lomos` to `lomo`, `limones` to `limon`, `panes` to `pan`). Words not ending in `s`, words shorter than four letters and `tres`, `gas`, `mas`, `menos`, `pues` and the weekdays are returned unchanged. The normalizer never applies it.
- Unknown or ambiguous slots, and conflicting numeric pairs, fail at construction (`INVALID_SLOT`, `AMBIGUOUS_SLOT`, `INVALID_PATTERN`).

## License

MIT © jcsoftdev
