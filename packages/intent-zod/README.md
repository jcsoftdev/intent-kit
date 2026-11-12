# @jcsoftdev/intent-zod

A [Zod](https://zod.dev) 4 implementation of the intent kit's `SchemaAdapter` port. It validates capability input, lists the missing paths the server asks for, and converts schemas to the JSON Schema the catalog and interpreter read. Part of the [intent kit](../../README.md).

## Install

```sh
pnpm add @jcsoftdev/intent-zod @jcsoftdev/intent-core zod
```

## Usage

```ts
import { createInterpretationService } from '@jcsoftdev/intent-server';
import { createZodSchemaAdapter } from '@jcsoftdev/intent-zod';

const service = createInterpretationService({
  capabilities,
  schema: createZodSchemaAdapter(),
  rolesOf,
  resolvers,
});
```

## Ports

It implements `SchemaAdapter`; there is nothing else to implement.

## Security contract

Schemas must be closed objects without `$ref` or tuples, and every id-shaped leaf (`z.uuid()` and friends) must be declared as an entity or requirement path on its capability. The server catalog checks this when it is built and fails closed.

## License

MIT © jcsoftdev
