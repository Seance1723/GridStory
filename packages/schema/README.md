# @gridstory/schema

Canonical, runtime-validated GridStory content, component, query, preview, workflow, release, and resource-limit contracts.

## Install

After an authorized GridStory package release:

```bash
pnpm add @gridstory/schema
```

The current `0.0.0` package is a private verification artifact and is not available from a public registry.

## Public exports

- `@gridstory/schema` provides the canonical Zod schemas, inferred contract types, and contract helpers.
- `@gridstory/schema/typegen` provides canonical TypeScript contract generation.

```ts
import { componentManifestSchema } from '@gridstory/schema';
import { generateTypeScriptContracts } from '@gridstory/schema/typegen';
```

The package is framework-neutral. Browser, server, and React-specific entry points remain separate packages.

## License

Apache-2.0. See `LICENSE` in the package archive.
