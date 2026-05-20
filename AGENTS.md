# TripMap Agent Workflow

## Default execution mode

At the start of every non-trivial task, ask the user to choose one mode unless the user already specified it:

1. **Codex Solo**
   - Codex plans, implements, tests, and commits the whole task.
   - Use this for high-risk architecture, data model, sync, map lifecycle, AI privacy, or complex debugging.

2. **Codex Lead + Claude Worker**
   - Codex remains the lead engineer.
   - Codex owns planning, architecture, risk control, final review, QA interpretation, and merge decision.
   - Claude Code may be invoked from the terminal as a scoped worker for low-risk subtasks.
   - Codex must write Claude's task prompt directly and make it extremely specific.

If the task is small and low-risk, Codex may still choose Codex Solo after briefly explaining why.

## Codex Lead responsibilities

When using Codex Lead + Claude Worker mode, Codex must:

- First understand the whole task and define the acceptance criteria.
- Identify which parts are safe to delegate.
- Keep high-risk logic under Codex control.
- Write Claude worker prompts with exact file scope, no-go rules, tests, and return format.
- Review Claude's reported diff and test results.
- Correct Claude if it broadens scope or changes unrelated files.
- Run or require final build/lint/unit/e2e before accepting.
- Make the final decision to commit, merge, or ask for rework.

## What Codex may delegate to Claude Code

Delegate only low-risk, well-bounded work such as:

- UI component extraction
- small styling polish after Codex has already defined the exact visual target and allowed files
- empty state copy
- stable test selectors
- straightforward E2E updates
- unit test additions
- docs sync
- repetitive refactors
- running build/lint/unit/e2e and summarizing failures
- mechanical migration to existing shared classes or primitives, for example replacing repeated input classes with an existing `FIELD_INPUT_CLASS`
- grep/text based code audits, for example listing hardcoded colors, old class patterns, missing test ids, or files that still import a deprecated helper
- narrow bug reproduction and failure summarization, when the expected behavior and commands are explicitly provided

Claude Code should be treated as a narrow implementation worker or second-pass checker, not as a product/design decision maker. Codex remains responsible for deciding whether the result is actually good for TripMap.

## What Codex must NOT delegate without explicit user approval

Do not delegate these decisions to Claude Code:

- IndexedDB schema or migration
- zip backup/restore format
- Supabase/cloud sync protocol
- conflict resolution logic
- canonical route structure
- MapLibre lifecycle
- ORS/route cache behavior
- timezone/plain-date semantics
- AI privacy/data-scope boundaries
- external API key handling
- new dependencies
- final merge decision
- visual direction, design taste, screenshot review, visual QA interpretation, or deciding whether a page "feels right"

For UI work, Claude may make mechanical class or component edits only after Codex has specified the desired pattern. Claude must not be asked to perform open-ended visual audit work, compare screenshots, judge layout quality, choose visual hierarchy, or decide the final look and feel.

## Effective Claude Worker usage

Prefer Claude for tasks that are concrete, textual, and easy to verify by diff or tests:

- **Test maintenance**: add stable selectors, update brittle E2E locators, add no-horizontal-overflow checks, or add unit tests for pure helpers.
- **Mechanical UI migration**: apply an already-approved shared primitive or class constant to a specified file set.
- **Static code search**: report remaining occurrences of a class pattern, deprecated helper, hardcoded color, or missing test id. This is a code/text audit, not a visual audit.
- **Docs sync**: update README or internal workflow docs to match behavior that Codex has already confirmed.
- **Failure triage**: run a specified command, summarize failing files/tests, and identify the smallest likely area to inspect.
- **Repetitive refactors**: rename a local helper, extract a small component, or remove duplicated low-risk code inside an allowed file scope.

Do not use Claude for tasks that require holistic judgement or protected-area ownership:

- visual critique or screenshot-based acceptance
- final UX/design direction
- deciding what content to remove or de-emphasize
- protected storage, sync, map, route, AI privacy, schema, or service-worker changes
- broad "polish this page" work without exact file scope and class/component targets

## Claude Worker prompt requirements

Every Claude worker task must be concrete, narrow, and checkable.

A Claude worker prompt must include:

- Goal
- Current branch and expected state
- Allowed files
- Forbidden files/areas
- Exact implementation steps or constraints
- No-go rules
- Tests to run
- Whether Claude may commit
- Required return format

Claude worker prompts must not be vague. Avoid prompts like "polish this page" or "fix tests".

Use specific prompts like:

- "Only edit `e2e/item-detail.spec.ts` to restore direct tickets route navigation."
- "Only add dark-mode classes to these UI primitives: Button, Card, EmptyState."
- "Do not modify schema, routes, cloud sync, map cache, or unrelated tests."
- "Only replace repeated input/select/textarea Tailwind classes in `src/pages/TripFormPage.tsx` with the existing exported field class constants. Do not change labels, handlers, validation, navigation, or tests."
- "Only search for remaining `bg-white/90` and `shadow-[...]` usages under `src/pages`; report file paths and surrounding component names. Do not edit files."

## Terminal use of Claude Code

If Claude Code is available in the terminal, Codex may invoke it as a worker using headless mode.

For this project, the local Claude Code command/wrapper is `cclaude`. Do not use `claudecode`.

Before invoking Claude, Codex should check availability:

    command -v cclaude
    cclaude --help

When supported by the installed `cclaude`, prefer auto mode with review-oriented permissions: fast enough to avoid repeated approvals, but still requiring Codex to inspect the diff before accepting the work.

Preferred pattern:

    cat > /tmp/claude-worker-task.md <<'EOF'
    <very specific worker prompt>
    EOF

    cclaude -p "$(cat /tmp/claude-worker-task.md)" \
      --permission-mode acceptEdits \
      --output-format text

Codex must inspect Claude's result before accepting it.

If Claude changes files, Codex must run:

    git status --short
    git diff --stat
    git diff --name-only

Then Codex must verify that Claude only touched allowed files.

If Claude touched forbidden files or broadened scope, Codex must stop and either revert those changes or ask the user before continuing.

## Branch rules

- Do not let one AI pre-create branches for another AI.
- Whoever actually executes a task creates and checks out its own branch.
- Do not use git worktree unless the user explicitly asks.
- Do not switch branches if tracked changes exist.
- Do not use `git add .`.
- Stage only explicit project files.
- Never stage or commit:
  - `output/`
  - screenshots
  - `.playwright-mcp/`
  - `CLAUDE.md`
  - `.env.local`
  - `.qa.local`
  - local profiles
  - agent notes

## Default validation

For code changes, run unless explicitly scoped smaller:

    npm run build
    npm run lint
    npm run test:unit
    npm run test:e2e

For UI changes, also check 390px mobile layout when practical.

## Project-specific protected areas

Treat these as high-risk and do not modify casually:

- IndexedDB schema
- ticket meta/blob separation
- zip backup/restore format
- Supabase cloud snapshot and conflict prompts
- timezone/plain-date handling
- canonical hash routes
- MapLibre lifecycle
- ORS/route cache keys and payloads
- PWA/service worker
- AI privacy/data boundary

## Reporting format

Every task report should include:

- Mode used: Codex Solo or Codex Lead + Claude Worker
- Branch
- Changed files
- What was delegated to Claude, if anything
- What Codex reviewed or corrected
- Tests run
- Commit hash
- Remaining risks

## TripMap task routing guideline

Use **Codex Solo** by default for:

- architecture planning
- schema/data model work
- cloud sync/conflict logic
- route/cache/ORS logic
- MapLibre lifecycle changes
- timezone/plain-date handling
- AI privacy/data boundary
- complex debugging
- final PR/diff review

Use **Codex Lead + Claude Worker** when:

- the overall task needs Codex judgement
- but some subtasks are safe, mechanical, and well-bounded
- such as UI primitive styling, test selectors, docs sync, unit tests, or small E2E fixes

Codex must never treat Claude output as final without review.
