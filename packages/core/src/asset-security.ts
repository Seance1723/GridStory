import { GridStoryError } from './errors.js';
import type { Awaitable } from './types.js';
import type { AssetKind, ContentScope } from '@gridstory/schema';

export interface AssetSvgSanitizationResult {
  body: Uint8Array;
  changed: boolean;
  findings: string[];
}

export interface AssetSvgSanitizer {
  sanitize(input: { body: Uint8Array; filename: string }): Awaitable<AssetSvgSanitizationResult>;
}

export interface AssetContentInspection {
  body: Uint8Array;
  detectedMediaType: string;
  sanitized: boolean;
  findings: string[];
}

export interface AssetContentInspector {
  inspect(input: {
    body: Uint8Array;
    filename: string;
    declaredMediaType: string;
    kind: AssetKind;
  }): Awaitable<AssetContentInspection>;
}

export interface AssetMalwareScanResult {
  verdict: 'clean' | 'infected';
  provider: string;
  signature?: string;
}

export interface AssetMalwareScanner {
  scan(input: {
    scope: ContentScope;
    filename: string;
    mediaType: string;
    body: Uint8Array;
    checksum: string;
  }): Awaitable<AssetMalwareScanResult>;
}

function normalizedMediaType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function startsWithBytes(body: Uint8Array, bytes: number[]): boolean {
  return bytes.every((value, index) => body[index] === value);
}

function decodedText(body: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body).replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
}

function textMediaType(text: string, filename: string, declaredMediaType: string): string {
  const extension = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  if (extension === '.svg' || /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(text)) {
    return 'image/svg+xml';
  }
  if (extension === '.json' || declaredMediaType === 'application/json') {
    try {
      JSON.parse(text);
      return 'application/json';
    } catch {
      return 'text/plain';
    }
  }
  if (extension === '.md' || extension === '.markdown') return 'text/markdown';
  if (extension === '.csv') return 'text/csv';
  if (declaredMediaType.startsWith('text/')) return declaredMediaType;
  return 'text/plain';
}

export function detectAssetMediaType(
  body: Uint8Array,
  filename: string,
  declaredMediaType: string,
): string {
  if (startsWithBytes(body, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWithBytes(body, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWithBytes(body, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (
    startsWithBytes(body, [0x52, 0x49, 0x46, 0x46]) &&
    String.fromCharCode(...body.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (startsWithBytes(body, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (startsWithBytes(body, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip';
  if (body.byteLength >= 12 && String.fromCharCode(...body.slice(4, 8)) === 'ftyp') {
    return 'video/mp4';
  }
  const text = decodedText(body);
  if (text !== null && !text.includes('\0')) {
    return textMediaType(text, filename, normalizedMediaType(declaredMediaType));
  }
  return 'application/octet-stream';
}

function mediaTypesMatch(declared: string, detected: string): boolean {
  if (declared === 'application/octet-stream') return true;
  if (declared === detected) return true;
  if (declared === 'image/jpg' && detected === 'image/jpeg') return true;
  return false;
}

function kindMatches(kind: AssetKind, mediaType: string): boolean {
  if (kind === 'image') return mediaType.startsWith('image/');
  if (kind === 'video') return mediaType.startsWith('video/');
  return true;
}

function stripUnsafeUriAttributes(svg: string, findings: Set<string>): string {
  return svg.replace(
    /\s(?:(?:[a-z0-9_.-]+:)?href|src|(?:[a-z0-9_.-]+:)?base)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
    (attribute) => {
      const raw = attribute
        .slice(attribute.indexOf('=') + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (raw.startsWith('#')) return attribute;
      findings.add('svg_external_reference_removed');
      return '';
    },
  );
}

const unsafeSvgElementPattern =
  /<(?:[a-z][\w.-]*:)?(?:script|foreignObject|iframe|object|embed|link|style|animate|set|animateTransform|animateMotion)\b/i;

export class ConservativeSvgSanitizer implements AssetSvgSanitizer {
  sanitize(input: { body: Uint8Array }): AssetSvgSanitizationResult {
    const source = decodedText(input.body);
    if (source === null || !/<svg\b/i.test(source)) {
      throw new GridStoryError('SVG content is invalid.', 'invalid_svg_content', 422);
    }
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
      throw new GridStoryError(
        'SVG document declarations and entities are not allowed.',
        'unsafe_svg_content',
        422,
      );
    }
    const withoutXmlDeclaration = source.replace(/^\s*<\?xml\s+[^?]*\?>/i, '');
    if (/<\?/.test(withoutXmlDeclaration)) {
      throw new GridStoryError(
        'SVG processing instructions are not allowed.',
        'unsafe_svg_content',
        422,
      );
    }
    const findings = new Set<string>();
    let sanitized = source.replace(/<!--([\s\S]*?)-->/g, () => {
      findings.add('svg_comments_removed');
      return '';
    });
    sanitized = sanitized.replace(
      /<(?:[a-z][\w.-]*:)?(script|foreignObject|iframe|object|embed|link|style|animate|set|animateTransform|animateMotion)\b[^>]*>[\s\S]*?<\/(?:[a-z][\w.-]*:)?\1\s*>/gi,
      () => {
        findings.add('svg_active_content_removed');
        return '';
      },
    );
    sanitized = sanitized.replace(
      /<(?:[a-z][\w.-]*:)?(?:script|foreignObject|iframe|object|embed|link|style|animate|set|animateTransform|animateMotion)\b[^>]*\/?\s*>/gi,
      () => {
        findings.add('svg_active_content_removed');
        return '';
      },
    );
    sanitized = sanitized.replace(/\son[a-z0-9:_-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, () => {
      findings.add('svg_event_handler_removed');
      return '';
    });
    sanitized = sanitized.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, () => {
      findings.add('svg_style_removed');
      return '';
    });
    sanitized = stripUnsafeUriAttributes(sanitized, findings);
    sanitized = sanitized.replace(
      /\s[a-z0-9:_-]+\s*=\s*("[^"]*url\((?!#)[^"]*"|'[^']*url\((?!#)[^']*')/gi,
      () => {
        findings.add('svg_external_url_removed');
        return '';
      },
    );
    if (
      unsafeSvgElementPattern.test(sanitized) ||
      /\son[a-z0-9:_-]+\s*=/i.test(sanitized) ||
      /\sstyle\s*=/i.test(sanitized) ||
      /\b(?:javascript|vbscript):/i.test(sanitized) ||
      /url\(\s*(?!#)/i.test(sanitized)
    ) {
      throw new GridStoryError(
        'SVG active content could not be removed safely.',
        'unsafe_svg_content',
        422,
      );
    }
    if (!/^\s*(?:<\?xml\s+[^?]*\?>\s*)?<svg\b/i.test(sanitized)) {
      throw new GridStoryError('SVG root element is invalid.', 'invalid_svg_content', 422);
    }
    return {
      body: new TextEncoder().encode(sanitized),
      changed: sanitized !== source,
      findings: [...findings].sort(),
    };
  }
}
export class BuiltInAssetContentInspector implements AssetContentInspector {
  readonly #svgSanitizer: AssetSvgSanitizer;

  constructor(svgSanitizer: AssetSvgSanitizer = new ConservativeSvgSanitizer()) {
    this.#svgSanitizer = svgSanitizer;
  }

  async inspect(input: {
    body: Uint8Array;
    filename: string;
    declaredMediaType: string;
    kind: AssetKind;
  }): Promise<AssetContentInspection> {
    const declaredMediaType = normalizedMediaType(input.declaredMediaType);
    const detectedMediaType = detectAssetMediaType(input.body, input.filename, declaredMediaType);
    if (!mediaTypesMatch(declaredMediaType, detectedMediaType)) {
      throw new GridStoryError(
        `Declared media type ${declaredMediaType} does not match detected ${detectedMediaType}.`,
        'asset_media_type_mismatch',
        422,
        { declaredMediaType, detectedMediaType },
      );
    }
    if (!kindMatches(input.kind, detectedMediaType)) {
      throw new GridStoryError(
        `Asset kind ${input.kind} does not match detected ${detectedMediaType}.`,
        'asset_kind_mismatch',
        422,
        { kind: input.kind, detectedMediaType },
      );
    }
    if (detectedMediaType !== 'image/svg+xml') {
      return {
        body: Uint8Array.from(input.body),
        detectedMediaType,
        sanitized: false,
        findings: [],
      };
    }
    const sanitized = await this.#svgSanitizer.sanitize({
      body: input.body,
      filename: input.filename,
    });
    return {
      body: sanitized.body,
      detectedMediaType,
      sanitized: sanitized.changed,
      findings: sanitized.findings,
    };
  }
}
