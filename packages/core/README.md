# @gridstory/core

GridStory's framework-neutral content, persistence, authorization, audit, workflow, release, search, plugin, asset, and operations services.

## Install

After an authorized GridStory package release:

```bash
pnpm add @gridstory/core
```

The current `0.0.0` package is a private verification artifact and is not available from a public registry.

## Public export

`@gridstory/core` exposes the service and repository contracts used by the standalone control plane.

```ts
import { ContentService, SqliteContentRepository } from '@gridstory/core';
```

Core is a server package. Applications should normally use `@gridstory/client` for HTTP delivery and management rather than embedding control-plane services in a browser bundle.

## License

Apache-2.0. See `LICENSE` in the package archive.
