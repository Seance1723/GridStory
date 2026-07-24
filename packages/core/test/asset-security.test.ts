import { describe, expect, it } from 'vitest';
import {
  BuiltInAssetContentInspector,
  ConservativeSvgSanitizer,
  detectAssetMediaType,
} from '../src/index.js';

describe('asset content security', () => {
  it('detects binary signatures and rejects declared MIME or asset-kind mismatches', async () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    expect(detectAssetMediaType(jpeg, 'hero.jpg', 'image/jpeg')).toBe('image/jpeg');

    const inspector = new BuiltInAssetContentInspector();
    await expect(
      inspector.inspect({
        body: new TextEncoder().encode('plain text'),
        filename: 'hero.jpg',
        declaredMediaType: 'image/jpeg',
        kind: 'image',
      }),
    ).rejects.toMatchObject({ code: 'asset_media_type_mismatch', statusCode: 422 });
    await expect(
      inspector.inspect({
        body: jpeg,
        filename: 'hero.jpg',
        declaredMediaType: 'image/jpeg',
        kind: 'video',
      }),
    ).rejects.toMatchObject({ code: 'asset_kind_mismatch', statusCode: 422 });
  });

  it('removes executable SVG content and external references', () => {
    const source = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
      <script>alert(1)</script>
      <evil:script xmlns:evil="urn:evil">alert(2)</evil:script>
      <a href="https://evil.example.test/tracker"><text style="fill:red">Unsafe</text></a>
      <image src="https://evil.example.test/pixel" />
      <use href="#safe-symbol" />
    </svg>`;
    const sanitized = new ConservativeSvgSanitizer().sanitize({
      body: new TextEncoder().encode(source),
      filename: 'icon.svg',
    });
    const output = new TextDecoder().decode(sanitized.body);

    expect(sanitized.changed).toBe(true);
    expect(sanitized.findings).toEqual([
      'svg_active_content_removed',
      'svg_event_handler_removed',
      'svg_external_reference_removed',
      'svg_style_removed',
    ]);
    expect(output).not.toMatch(/script|onload|evil\.example|style=/i);
    expect(output).toContain('href="#safe-symbol"');
  });

  it('rejects SVG document declarations and entities', () => {
    expect(() =>
      new ConservativeSvgSanitizer().sanitize({
        body: new TextEncoder().encode(
          '<!DOCTYPE svg [<!ENTITY payload SYSTEM "file:///etc/passwd">]><svg>&payload;</svg>',
        ),
        filename: 'unsafe.svg',
      }),
    ).toThrowError(expect.objectContaining({ code: 'unsafe_svg_content', statusCode: 422 }));
    expect(() =>
      new ConservativeSvgSanitizer().sanitize({
        body: new TextEncoder().encode(
          '<?xml-stylesheet href="https://evil.example.test/style.css"?><svg></svg>',
        ),
        filename: 'stylesheet.svg',
      }),
    ).toThrowError(expect.objectContaining({ code: 'unsafe_svg_content', statusCode: 422 }));
  });
});
