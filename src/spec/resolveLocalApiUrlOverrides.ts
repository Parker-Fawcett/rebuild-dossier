import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Real, live-triggered finding (a live re-verification run against
// catchandtrade, not a hypothetical): a target app can hardcode a
// NEXT_PUBLIC_* env var to an absolute `http://localhost:<fixed-port>` value
// in its own .env.development (baked into the client bundle at `next dev`
// start time — Next.js inlines every NEXT_PUBLIC_* var it can find at build
// time, not just the ones it happens to read at runtime). This tool's own
// dev server picks a fresh random port every run (see the port constant in
// generatePageTests.ts/nextDevServerBoilerplate.ts) specifically to avoid
// collisions — so a page's own client-side fetch call reading that baked-in
// value targets a fixed, likely-wrong-or-unreachable origin regardless of
// which port THIS run's dev server actually landed on, silently breaking any
// content that depends on it. Never surfaced before this was traced, because
// the auth-gate storageState fix (see generatePageTests.ts's
// resolveAuthStorageState) was the first thing to get capture far enough
// past a login wall to reach a page whose real content depends on this kind
// of client fetch at all.
//
// Fixed the same way as the storageState origin remap: not by fixing the
// app's own hardcoded value, but by overriding it for THIS run specifically —
// process.env values passed to a spawned `next dev` child always take
// precedence over whatever a .env file would otherwise set (standard
// dotenv/Next.js precedence), so passing the override via the spawn's own
// `env` option is sufficient; nothing needs to be parsed or rewritten in the
// target app's own files.
//
// Deliberately conservative: only NEXT_PUBLIC_* keys (the one Next.js
// convention for a var actually inlined into the client bundle — a
// server-only var never needs this, since server-side code executes inside
// this same spawned process, not a separately-addressed client bundle) whose
// EXISTING value already points at localhost/127.0.0.1 are touched. A value
// pointing anywhere else (a real staging/production host, for instance) is
// left completely untouched — rewriting that would be actively wrong, not
// just unhelpful, and there is no way to distinguish "this should track my
// own dev server" from "this is an intentional external target" other than
// the value already being a local one.
const CANDIDATE_ENV_FILENAMES = ['.env', '.env.local', '.env.development', '.env.development.local'];
const NEXT_PUBLIC_LOCALHOST_URL_PATTERN = /^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=\s*["']?(https?:\/\/(?:localhost|127\.0\.0\.1):\d+)/;

export function resolveLocalApiUrlOverrides(repoPath: string, baseUrl: string): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const filename of CANDIDATE_ENV_FILENAMES) {
    const filePath = join(repoPath, filename);
    if (!existsSync(filePath)) continue;
    for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
      const match = line.match(NEXT_PUBLIC_LOCALHOST_URL_PATTERN);
      if (match) overrides[match[1]!] = baseUrl;
    }
  }
  return overrides;
}
