# @gridstory/react

React component registration, governed presentation resolution, and structured GridStory component-tree rendering.

## Install

After an authorized GridStory package release:

```bash
pnpm add @gridstory/react react
```

The current `0.0.0` package is a private verification artifact and is not available from a public registry. React `>=18.3.0 <20.0.0` is a peer dependency.

## Public export

`@gridstory/react` provides `createComponentRegistry`, `GridStoryRenderer`, and presentation-resolution contracts.

```tsx
import { createComponentRegistry, GridStoryRenderer } from '@gridstory/react';
```

The application owns the registered React components and production styling; GridStory stores validated component IDs, props, versions, and slots rather than executable author code.

## License

Apache-2.0. See `LICENSE` in the package archive.
