import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  redactObviousSecrets,
  buildVisionClassificationRequest,
  parseVisionClassificationResponse,
  classifyPageWithVision,
  rateLimitWaitMs,
  MAX_SOURCE_CHARS_FOR_VISION
} from '../../../src/spec/visionClassifier.js';
import type { DomTextNode } from '../../../src/spec/pageCaptureSchema.js';

function node(overrides: Partial<DomTextNode> = {}): DomTextNode {
  return { selectorHint: 'div', text: 'Welcome', kind: 'static', ...overrides };
}

describe('redactObviousSecrets', () => {
  it('redacts a variable named like a secret assigned a long quoted value', () => {
    const source = `const apiKey = "abcdefghijklmnop1234567890";`;
    expect(redactObviousSecrets(source)).toBe(`const apiKey = "[REDACTED]";`);
  });

  it('redacts known secret-shaped prefixes', () => {
    expect(redactObviousSecrets('const x = "sk_abcdefghij1234567890";')).toContain('[REDACTED]');
    expect(redactObviousSecrets('AKIAABCDEFGHIJKLMNOP')).toBe('[REDACTED]');
    expect(redactObviousSecrets('ghp_abcdefghijklmnopqrstuvwxyz123456')).toBe('[REDACTED]');
  });

  it('leaves ordinary source code with no secret-shaped substrings completely unchanged', () => {
    const source = `export default function HomePage() {\n  return <div>Welcome</div>;\n}\n`;
    expect(redactObviousSecrets(source)).toBe(source);
  });
});

describe('buildVisionClassificationRequest', () => {
  it('sets JSON mode and includes the literal word "json" in the prompt (required by Groq)', () => {
    const request = buildVisionClassificationRequest('base64data', [node()], 'const x = 1;', 'some-model');
    expect((request as any).response_format).toEqual({ type: 'json_object' });
    const textPart = (request as any).messages[0].content.find((c: any) => c.type === 'text');
    expect(textPart.text.toLowerCase()).toContain('json');
  });

  it('sets temperature: 0 for best-effort determinism', () => {
    const request = buildVisionClassificationRequest('base64data', [node()], 'const x = 1;', 'some-model');
    expect((request as any).temperature).toBe(0);
  });

  it('includes the image as a base64 data URL and wires the model through', () => {
    const request = buildVisionClassificationRequest('deadbeef', [node()], 'const x = 1;', 'my-vision-model');
    expect((request as any).model).toBe('my-vision-model');
    const imagePart = (request as any).messages[0].content.find((c: any) => c.type === 'image_url');
    expect(imagePart.image_url.url).toBe('data:image/png;base64,deadbeef');
  });

  it('truncates source longer than MAX_SOURCE_CHARS_FOR_VISION, keeping the tail, with a visible marker', () => {
    const longSource = 'A'.repeat(MAX_SOURCE_CHARS_FOR_VISION + 500) + 'TAIL_MARKER_END';
    const request = buildVisionClassificationRequest('base64data', [node()], longSource, 'some-model');
    const textPart = (request as any).messages[0].content.find((c: any) => c.type === 'text');
    expect(textPart.text).toContain('truncated');
    expect(textPart.text).toContain('TAIL_MARKER_END');
    expect(textPart.text).not.toContain('A'.repeat(MAX_SOURCE_CHARS_FOR_VISION + 500));
  });

  it('redacts obvious secrets before they ever reach the built request', () => {
    const source = `const secret = "abcdefghijklmnop1234567890";`;
    const request = buildVisionClassificationRequest('base64data', [node()], source, 'some-model');
    const textPart = (request as any).messages[0].content.find((c: any) => c.type === 'text');
    expect(textPart.text).not.toContain('abcdefghijklmnop1234567890');
    expect(textPart.text).toContain('[REDACTED]');
  });
});

function groqEnvelope(contentObject: unknown): unknown {
  return { choices: [{ message: { content: JSON.stringify(contentObject) } }] };
}

describe('parseVisionClassificationResponse', () => {
  const nodes: DomTextNode[] = [node({ text: 'a' }), node({ text: 'b' })];

  it('parses a valid response', () => {
    const raw = groqEnvelope({
      classifications: [
        { index: 0, kind: 'static' },
        { index: 1, kind: 'dynamic', dynamicShape: 'number' }
      ]
    });
    expect(parseVisionClassificationResponse(raw, nodes)).toEqual([{ kind: 'static' }, { kind: 'dynamic', dynamicShape: 'number' }]);
  });

  it('re-sorts by index regardless of the order entries were returned in', () => {
    const raw = groqEnvelope({
      classifications: [
        { index: 1, kind: 'dynamic', dynamicShape: 'uuid' },
        { index: 0, kind: 'static' }
      ]
    });
    expect(parseVisionClassificationResponse(raw, nodes)).toEqual([{ kind: 'static' }, { kind: 'dynamic', dynamicShape: 'uuid' }]);
  });

  it('returns null when choices/message/content is missing', () => {
    expect(parseVisionClassificationResponse({}, nodes)).toBeNull();
    expect(parseVisionClassificationResponse({ choices: [] }, nodes)).toBeNull();
    expect(parseVisionClassificationResponse({ choices: [{ message: {} }] }, nodes)).toBeNull();
  });

  it('returns null when content is not valid JSON', () => {
    const raw = { choices: [{ message: { content: 'not json at all' } }] };
    expect(parseVisionClassificationResponse(raw, nodes)).toBeNull();
  });

  it('returns null when valid JSON is missing classifications', () => {
    expect(parseVisionClassificationResponse(groqEnvelope({}), nodes)).toBeNull();
  });

  it('returns null on a length mismatch (too few or too many)', () => {
    expect(parseVisionClassificationResponse(groqEnvelope({ classifications: [{ index: 0, kind: 'static' }] }), nodes)).toBeNull();
    expect(
      parseVisionClassificationResponse(
        groqEnvelope({
          classifications: [
            { index: 0, kind: 'static' },
            { index: 1, kind: 'static' },
            { index: 2, kind: 'static' }
          ]
        }),
        nodes
      )
    ).toBeNull();
  });

  it('returns null on duplicate or missing index values', () => {
    expect(
      parseVisionClassificationResponse(
        groqEnvelope({
          classifications: [
            { index: 0, kind: 'static' },
            { index: 0, kind: 'static' }
          ]
        }),
        nodes
      )
    ).toBeNull();
  });

  it('returns null on an invalid dynamicShape enum value', () => {
    const raw = groqEnvelope({
      classifications: [
        { index: 0, kind: 'static' },
        { index: 1, kind: 'dynamic', dynamicShape: 'not-a-real-shape' }
      ]
    });
    expect(parseVisionClassificationResponse(raw, nodes)).toBeNull();
  });

  it('returns null when dynamicShape is present alongside kind: static', () => {
    const raw = groqEnvelope({
      classifications: [
        { index: 0, kind: 'static', dynamicShape: 'number' },
        { index: 1, kind: 'static' }
      ]
    });
    expect(parseVisionClassificationResponse(raw, nodes)).toBeNull();
  });

  it('returns null when dynamicShape is missing for kind: dynamic', () => {
    const raw = groqEnvelope({
      classifications: [
        { index: 0, kind: 'dynamic' },
        { index: 1, kind: 'static' }
      ]
    });
    expect(parseVisionClassificationResponse(raw, nodes)).toBeNull();
  });

  it('returns null for a non-object top-level input', () => {
    expect(parseVisionClassificationResponse('a string', nodes)).toBeNull();
    expect(parseVisionClassificationResponse(null, nodes)).toBeNull();
    expect(parseVisionClassificationResponse(42, nodes)).toBeNull();
  });
});

describe('rateLimitWaitMs', () => {
  it('uses the Retry-After header when present and positive', async () => {
    const response = { headers: new Headers({ 'retry-after': '2' }) } as unknown as Response;
    expect(await rateLimitWaitMs(response)).toBe(2000);
  });

  it('falls back to parsing the wait time out of the response body when no usable header is present — the real shape Groq actually returns', async () => {
    // Confirmed live: a real 429 from Groq carried no usable Retry-After
    // header; the suggested wait only appeared in the JSON error message.
    const response = {
      headers: new Headers(),
      clone: () => ({
        text: async () =>
          JSON.stringify({
            error: {
              message:
                'Rate limit reached for model `qwen/qwen3.6-27b` in organization `org_123` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 5967, Requested 6578. Please try again in 34.0875s.',
              type: 'tokens',
              code: 'rate_limit_exceeded'
            }
          })
      })
    } as unknown as Response;
    expect(await rateLimitWaitMs(response)).toBeCloseTo(34087.5, -1);
  });

  it('falls back to a fixed default when neither header nor body yields a usable wait time', async () => {
    const response = {
      headers: new Headers(),
      clone: () => ({ text: async () => 'not a parseable body' })
    } as unknown as Response;
    expect(await rateLimitWaitMs(response)).toBe(5000);
  });

  it('caps an unusually large suggested wait rather than waiting indefinitely', async () => {
    const response = { headers: new Headers({ 'retry-after': '99999' }) } as unknown as Response;
    expect(await rateLimitWaitMs(response)).toBe(60000);
  });
});

describe('classifyPageWithVision', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const nodes: DomTextNode[] = [node()];
  const screenshot = Buffer.from('fake-png-bytes');

  it('sends the request to Groq with the API key as an Authorization bearer header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => groqEnvelope({ classifications: [{ index: 0, kind: 'static' }] })
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await classifyPageWithVision(screenshot, nodes, 'const x = 1;', 'test-key', 'test-model');

    expect(result).toEqual([{ kind: 'static' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer test-key');
    expect(JSON.parse(options.body).model).toBe('test-model');
  });

  it('returns null (not a throw) on a rejected fetch promise', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down'))
    );
    expect(await classifyPageWithVision(screenshot, nodes, '', 'key', 'model')).toBeNull();
  });

  it('returns null (not a throw) on a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, headers: new Headers() })
    );
    expect(await classifyPageWithVision(screenshot, nodes, '', 'key', 'model')).toBeNull();
  });

  it('skips the call entirely for an oversized screenshot buffer, without ever calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const huge = Buffer.alloc(16 * 1024 * 1024); // over the 15MB safety margin
    expect(await classifyPageWithVision(huge, nodes, '', 'key', 'model')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries exactly once on a 429, honoring Retry-After, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'retry-after': '0.01' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => groqEnvelope({ classifications: [{ index: 0, kind: 'static' }] })
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await classifyPageWithVision(screenshot, nodes, '', 'key', 'model');
    expect(result).toEqual([{ kind: 'static' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to null if still rate-limited after the one retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, headers: new Headers({ 'retry-after': '0.01' }) });
    vi.stubGlobal('fetch', fetchMock);

    expect(await classifyPageWithVision(screenshot, nodes, '', 'key', 'model')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
