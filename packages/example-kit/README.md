# @gridstory/example-kit

Reference GridStory schemas, component manifests, generated types, design tokens, React components, and stylesheet used by the runnable examples.

## Install

After an authorized GridStory package release:

```bash
pnpm add @gridstory/example-kit react
```

The current `0.0.0` package is a private verification artifact and is not available from a public registry. React `>=18.3.0 <20.0.0` is a peer dependency.

## Public exports

- `@gridstory/example-kit/manifests` provides the example page schema, component manifests, and welcome content.
- `@gridstory/example-kit/react` provides the example component registry.
- `@gridstory/example-kit/generated` provides generated content/component TypeScript contracts.
- `@gridstory/example-kit/design-system` provides example design tokens and governed presentation data.
- `@gridstory/example-kit/styles.css` provides the example application stylesheet.

```ts
import { componentManifests, pageSchema } from '@gridstory/example-kit/manifests';
import { exampleComponentRegistry } from '@gridstory/example-kit/react';
import '@gridstory/example-kit/styles.css';
```

This package is an integration reference, not a production design system or a promise of application-specific component support.

## License

Apache-2.0. See `LICENSE` in the package archive.
