# Validating rebuild-dossier on your own app

Thank you for doing this. You're the first people other than the author to run this tool on a
codebase it has never seen, so what you find, including anything that goes wrong, is exactly
what's needed. Please report failures as fully as successes. A run that breaks is a useful result.

Budget: on a small app (around 10 routes), about **30–45 minutes end to end, roughly 20 of them
hands-on**: setup, answering the case queue, running the checks, and comparing the two apps. In
the two trial runs, `generate_spec` took under 2 minutes and the unattended rebuild 4–16 minutes.
A large app mostly adds waiting: `generate_spec` took about 36 minutes on an 83-route app.

## What the tool does, in one paragraph

`rebuild-dossier` is an MCP server. You point it at an existing app. It reads the code, asks you
about anything ambiguous, and writes a self-contained **rebuild package**: locked interface
contracts, generated tests (mutation-checked, so a test that can't catch a bug gets downgraded),
and hooks that stop a coding agent from editing the spec or building untested contracts ahead
of schedule. A fresh agent session then rebuilds the app from that package alone. The question
you're answering: **does the package let an agent rebuild your app correctly, and do the tests
tell you the truth about whether it did?**

## Before you start

- **An app you know well and are allowed to run locally.** Supported today: **Next.js App Router**
  and **Express**, TypeScript or JavaScript. It should run with `npm install` and `npm run dev`
  (or similar). Small to mid-sized is ideal; tens of routes is fine. If your app is anything else
  (a Vite/React single-page app, the Next.js Pages Router, Python, and so on), say so before you
  start: the tool will find few or no routes, and that run tells us little.
- **Node 20.12+**, a coding agent CLI (**Claude Code** or **OpenAI Codex**, logged in), and
  Chromium for page capture: `npx playwright install chromium`. It prints a large warning about installing your project's
  dependencies first; that's expected here, and safe to ignore.
- **Privacy:** everything runs on your machine. The tool itself makes no LLM calls and has no
  telemetry (your coding agent talks to its own model provider, as it always does); the tool's only
  network traffic is to your app's own local dev server, plus a one-time download of
  its test runner (`vitest`, about 34 MB, from the npm registry) the first time `generate_spec`
  runs on your machine. Two exceptions, both off
  unless you choose them: the optional `crawl_site` tool visits a URL you give it, and an opt-in
  vision classifier needs two environment variables you'd set yourself. Skip both.
- Work on a **copy** of your app, in a **new, empty folder** of its own, not next to your working
  checkout. The package gets written beside the copy, and the rebuilding agent can see whatever
  else sits in that folder. Then run `npm install` in the copy. The mutation check needs the app's
  own dependencies installed to give reliable results.

  ```bash
  mkdir ~/rd-validation && cp -R /path/to/your-app ~/rd-validation/your-app
  cd ~/rd-validation/your-app && npm install
  ```
- **Check the copy actually starts before generating.** Run it the way you normally do (`npm run
  dev`, `node src/index.js`, ...) and make sure it comes up, then stop it. It needs its `.env` (or
  whatever environment variables it reads at startup) and a Node version its dependencies support.
  If the app can't start, every generated test comes back `unrunnable`; `generate_spec` now lists
  the first error for each in `unrunnableReasons`.
- **Express apps:** the tool can only test your routes if the app object is exported. If
  `generate_spec` reports an `apiTestNote` saying no exported app was found, do what it says
  (usually add `module.exports = app;` and wrap `app.listen(...)` in
  `if (require.main === module) { ... }`) *in the copy*. Then delete or move aside the
  `your-app-rebuild/` folder it wrote (it won't overwrite one) and run `generate_spec` again.
  Mention it in your report.

## Steps

**1. Install and connect** (use exactly this version so both validators test the same thing).
Run these **from inside your app's copy**:

```bash
cd ~/rd-validation/your-app
npx rebuild-dossier@0.2.13 --help
```

- **Claude Code:** `claude mcp add rebuild-dossier -- npx -y rebuild-dossier@0.2.13`. This
  registers the tool for the current directory only, which is what you want: it's available while
  you generate the package, and the rebuilding session in step 4 (a different directory) can't
  call it. (If you've ever added `rebuild-dossier` with `--scope user`, remove that first:
  `claude mcp remove rebuild-dossier -s user`.)
- **Codex:** `codex mcp add rebuild-dossier -- npx -y rebuild-dossier@0.2.13`. Codex registers MCP
  servers for every project, so step 4 switches it off for the rebuild session.

**2. Generate the package.** In a session opened *in your app's copy* (`claude` or `codex`), ask it
to call the tools in this order, with the absolute path to your app:

```
ingest_repo({ path: "/Users/you/rd-validation/your-app" })
get_case_queue({ repoPath: "/Users/you/rd-validation/your-app", interactive: true })
```

Answer every case the queue raises using your own knowledge of the app. This is the human
checkpoint, and your answers matter. If you know of real bugs, flag them first with
`flag_known_bug`. Then:

```
generate_spec({ repoPath: "/Users/you/rd-validation/your-app" })
```

It writes the package to a sibling directory, `your-app-rebuild/`. Note how long it took and
anything it reports as weak or unrunnable (with `unrunnableReasons`). Also compare the `routes`
count `ingest_repo` reported with how many routes your app really has; if it missed some, note
which ones in your report and carry on.

**3. Seal the acceptance tests.** Before the rebuild starts, move the held-out tests out of the
package so the rebuilding agent can't read or re-run them:

```bash
cd ~/rd-validation/your-app-rebuild
mv tests/held-out ~/held-out-sealed-$(date +%s)
```

Then move your app's copy away too. The package sits right next to it, so an agent that lists
`..` would find the original source one directory up:

```bash
mv ~/rd-validation/your-app ~/source-hidden-$(date +%s)
```

(This keeps casual access out. An agent with shell access could still go looking, so note in
your report if you see it try. Move the copy back after step 5 if you want it for step 6; your
real working checkout is untouched either way.)

**4. Rebuild, in a fresh top-level session.** This matters: start a new session **in the package
directory** itself. Don't start it from another session's subagent or Agent tool, because the
hooks won't load, and nothing will tell you so.

```bash
cd ~/rd-validation/your-app-rebuild
claude                                                # Claude Code
codex -c mcp_servers.rebuild-dossier.enabled=false    # or Codex, with the tool switched off
```

- **Codex only:** at startup Codex says the project's hooks need review before they can run.
  **Review and trust them.** They are the package's write guard (`.codex/hooks.json`, which runs
  `.claude/hooks/rebuild-guard.mjs`). If you skip or decline this, Codex runs nothing, and nothing
  is guarded; step 5's heartbeat check would then show no file.

First run `/status` and note the model it shows; the report asks for it. Then paste the contents
of `kickoff-prompt.txt` as your only message, and let it work without steering it. Approving
permission prompts isn't steering; approve anything that stays inside the package directory.
(`claude --permission-mode acceptEdits` cuts Claude Code's prompts down.) If it stops to ask you
something, answer briefly and honestly, and write down what it asked.

**5. Check what actually happened**, not what the agent says happened:

```bash
cat .claude/.hook-heartbeat.json        # must exist, count > 0, or the hooks never ran (both CLIs)
npm install                             # if the agent didn't; the checks below need vitest
npx vitest run tests/visible            # the tests the agent could see
mv ~/held-out-sealed-* tests/held-out
npx vitest run tests/held-out           # run once, yourself: the tests it never saw
```

Report counts from the **`Test Files`** line, not `Tests`: a test file whose route was never built
fails to import, and vitest then leaves it out of `Tests` entirely (it can even print
`Tests  no tests`). So "1 failed (1)" under `Test Files` is a held-out result of 0/1. If a folder
has no test files at all (vitest says `No test files found`), report "no visible tests" or "no
held-out tests" rather than a pass count.

**6. Compare against your real app.** This part only you can do. Run the rebuild and the original
side by side and exercise what matters to you: a few real requests, a few pages, an error case,
a missing or invalid input. Where do they behave differently? The tests only check some things,
and you know what they miss.

## What to report

Please open an issue with the **Validation report** template
(https://github.com/Parker-Fawcett/rebuild-dossier/issues/new/choose), or send the same fields by
email. Most useful, in order:

1. **Your app:** framework, rough size (routes/pages), anything unusual (auth, databases, external
   APIs). No code needed.
2. **Where anything broke or confused you:** install, the tools, the case queue, generation. Paste
   errors verbatim.
3. **Numbers:** `generate_spec` time; visible and held-out pass counts (for example "18/20 visible,
   3/9 held-out"); heartbeat count.
4. **Behavioral differences you found in step 6**, especially anything the tests passed but the
   rebuild got wrong. This is the most valuable part of the report.
5. **What the agent did that surprised you:** building things nobody asked for, stopping when it
   shouldn't have, editing tests, claiming success that wasn't real.
6. Optionally, the rebuild package directory zipped, or the session transcript. Only if you're
   comfortable sharing them.

You'll be credited by name (or anonymously, if you prefer) in the paper and the findings log, and
your results will be reported as they come, including anything that makes the tool look bad.
