Show HN: rebuild-dossier — reverse-engineers a mutation-tested spec from your existing app

I built an MCP server that reads your app and produces a locked rebuild spec: a CLAUDE.md, .claude/ config, and a mutation-tested test suite. Any coding agent can rebuild against that spec instead of guessing.

The problem: prior research (AgentModernize, arXiv:2605.17535) measured 0% behavioral equivalence for rebuild pipelines with no verified feedback loop, and only 9-19% with a coarse one. The bet behind this tool: locking contracts before running tests, plus a strict one-test-at-a-time retry loop, does better.

The core loop:
- ingest_repo(path) — static analysis only, no LLM call. Routes, package.json, build config, existing tests, structural smell detectors.
- crawl_site(url) — headless Playwright crawl of reachable routes.
- flag_known_bug(description) — free text, stored verbatim. Always overrides auto-resolve.
- get_case_queue() / resolve_case(id) — the ambiguity queue. Surfaces open questions via MCP elicitation.
- generate_spec() — only callable once the case queue is empty. Writes CLAUDE.md, .claude/rules/, spec/contracts/, tests/visible/, tests/held-out/, and kickoff-prompt.txt to a clean sibling directory. Never into the original repo.

A non-negotiable rule: auto-resolving an ambiguity requires both signal agreement AND evidence someone actually decided. Silent agreement alone never becomes an auto-resolution.

Install: npx rebuild-dossier@latest --help

Backed by arXiv paper: https://arxiv.org/abs/2608.23616

Does not rebuild your app. It produces the spec a coding agent consumes to do that. Does not claim behavioral equivalence. See docs/v0-findings.md for what worked, what broke, and what is still open.

https://github.com/Parker-Fawcett/rebuild-dossier
