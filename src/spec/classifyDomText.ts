import type { DomTextNode, DynamicShape } from './pageCaptureSchema.js';

// Pure, no-I/O classification of a single already-extracted DOM text string
// into a shape a generated page test can assert on. Static content gets a
// locked exact-text assertion (the strongest guarantee this tool can make);
// content that looks like it was sourced from live data (a price, a
// timestamp, a random-looking id) gets a looser shape/pattern assertion
// instead, so a generated test doesn't flake against a rebuild that renders
// the same KIND of value with a different concrete instance (a different
// live price, "3 minutes ago" vs "5 minutes ago", a freshly-generated uuid).
//
// This is a deliberately narrow, hand-rolled classifier over a handful of
// common shapes — not a general "is this dynamic" oracle. Known, accepted
// risk (see the plan's Verification section): a regex match here is a
// heuristic, and can misclassify genuinely static, load-bearing content
// (a hardcoded price, a version string) as dynamic, silently weakening that
// content's assertion from exact-text to shape-only. There is no fully
// reliable way to tell "this looks like a price because it's live" from
// "this looks like a price because it's a fixed, intentional one" from
// static analysis of the rendered string alone — this is called out
// explicitly as something to manually spot-check against real captures
// (see the plan's Verification section item 7), not a solved problem.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const CURRENCY_PATTERN =
  /^[$€£¥]\s?\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d{1,3}(,\d{3})*(\.\d{1,2})?\s?(USD|EUR|GBP|usd|eur|gbp)$/;

const RELATIVE_TIME_PATTERN = /^(just now|today|yesterday|\d+\s?(second|minute|hour|day|week|month|year)s?\s+ago)$/i;

const NUMBER_PATTERN = /^-?\d+(\.\d+)?%?$/;

export function classifyDomText(rawText: string): Pick<DomTextNode, 'kind' | 'dynamicShape'> {
  const text = rawText.trim();
  if (text.length === 0) {
    return { kind: 'static' };
  }

  const shapeChecks: [RegExp, DynamicShape][] = [
    [UUID_PATTERN, 'uuid'],
    [ISO_DATE_PATTERN, 'iso-date'],
    [CURRENCY_PATTERN, 'currency'],
    [RELATIVE_TIME_PATTERN, 'relative-time'],
    [NUMBER_PATTERN, 'number']
  ];

  for (const [pattern, shape] of shapeChecks) {
    if (pattern.test(text)) {
      return { kind: 'dynamic', dynamicShape: shape };
    }
  }

  return { kind: 'static' };
}
