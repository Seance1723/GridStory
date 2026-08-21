# @gridstory/client

Framework-neutral GridStory delivery and management client with a separate browser-safe preview protocol entry point.

## Install

After an authorized GridStory package release:

```bash
pnpm add @gridstory/client
```

The current `0.0.0` package is a private verification artifact and is not available from a public registry.

## Public exports

- `@gridstory/client` provides `GridStoryClient`, `createGridStoryClient`, stable API errors, and public client contracts.
- `@gridstory/client/preview` provides browser preview controller and application runtime helpers.

```ts
import { createGridStoryClient } from '@gridstory/client';
import { createGridStoryPreviewRuntime } from '@gridstory/client/preview';
```

Import the preview entry only in browser code. Published content and authenticated management operations remain explicit client calls.

## License

Apache-2.0. See `LICENSE` in the package archive.
