import type { ComponentNode, DesignSystemManifest } from '@gridstory/schema';

export interface PresentationResolutionOptions {
  designSystem?: DesignSystemManifest;
  breakpoint?: string;
}

function materializeSymbol(
  node: ComponentNode,
  designSystem: DesignSystemManifest | undefined,
): ComponentNode {
  const reference = node.presentation?.symbol;
  if (!reference || reference.detached || !designSystem) return node;
  const symbol = designSystem.symbols.find((candidate) => candidate.id === reference.id);
  if (!symbol) return node;
  const overrides = Object.fromEntries(
    symbol.allowedPropOverrides.flatMap((name) =>
      Object.hasOwn(node.props, name) ? [[name, node.props[name]]] : [],
    ),
  );
  return {
    ...symbol.node,
    id: node.id,
    props: { ...symbol.node.props, ...overrides },
    presentation: {
      ...symbol.node.presentation,
      ...node.presentation,
      symbol: reference,
    },
  };
}

export function resolveNodePresentation(
  source: ComponentNode,
  options: PresentationResolutionOptions = {},
): ComponentNode {
  if (
    source.presentation?.designSystemVersion !== undefined &&
    source.presentation.designSystemVersion !== options.designSystem?.version
  ) {
    return source;
  }
  const node = materializeSymbol(source, options.designSystem);
  const presentation = node.presentation;
  if (!presentation || !options.designSystem) return node;
  const variant = presentation.variantId
    ? options.designSystem.variants.find(
        (candidate) =>
          candidate.id === presentation.variantId && candidate.component === node.component,
      )
    : undefined;
  const tokenValues = new Map(
    options.designSystem.tokens.map((token) => [token.id, token.value] as const),
  );
  const tokenProps = Object.fromEntries(
    Object.entries(presentation.tokenBindings ?? {}).flatMap(([prop, tokenId]) => {
      const value = tokenValues.get(tokenId);
      return value === undefined ? [] : [[prop, value]];
    }),
  );
  const responsiveProps = options.breakpoint
    ? Object.fromEntries(
        Object.entries(presentation.responsive ?? {}).flatMap(([prop, values]) =>
          Object.hasOwn(values, options.breakpoint as string)
            ? [[prop, values[options.breakpoint as string]]]
            : [],
        ),
      )
    : {};
  return {
    ...node,
    props: {
      ...node.props,
      ...variant?.props,
      ...tokenProps,
      ...responsiveProps,
    },
  };
}
