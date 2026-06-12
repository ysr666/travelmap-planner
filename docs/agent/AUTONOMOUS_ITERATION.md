# Autonomous Iteration Runbook

This runbook makes Codex capable of sustained self-directed work while preserving TripMap's safety boundaries.

Use it together with:

- `AGENTS.md`
- `docs/PROJECT_STATUS.md`
- `docs/ROADMAP_V4.md`
- `docs/agent/PHASE_LEDGER.md`

## Trigger Phrases

Use this runbook when the user says any close variant of:

- "continue autonomous iteration"
- "run next phase"
- "long autonomous run"
- "run for 10+ hours"
- "self-plan and execute phases"
- "continue from the phase ledger"

## Operating Model

Autonomous work is a loop of small, verified phases.

1. Git preflight.
2. Read-only planning.
3. Phase execution.
4. Validation.
5. Ledger update.
6. Decide whether the next phase is safe.

Do not treat "long run" as permission to make broad unreviewed architecture changes. A long run means more phase cycles, not looser boundaries.

## Git Preflight

Before planning implementation:

1. Run `git status --short --untracked-files=no`.
2. If tracked changes exist and they were not made by Codex in the current run, perform automatic worktree escalated review instead of stopping immediately.
3. Confirm current branch.
4. If starting on `main`, run `git pull --ff-only`.
5. Do not create an implementation branch until the first phase plan is known.

After the first safe phase is selected, create a `feature/`, `fix/`, or `docs/` branch unless the user instructed otherwise.

Worktree escalated review means:

- Inspect `git status`, `git diff --name-only`, and relevant file diffs.
- Classify changes as current-run, pre-existing unrelated, or conflicting.
- Continue automatically if autonomous work can avoid unrelated files and stage/commit only its own explicit files.
- If files conflict, either choose a different safe phase or report the conflict with exact files and recommended next action.
- Never revert, overwrite, stage, commit, or push user-owned changes unless the user explicitly asks for that exact operation.

## Read-Only Planning Pass

During the read-only pass, do not edit files, stage files, commit, or start provider-backed services.

Read only the relevant context:

- `AGENTS.md`
- `docs/agent/PHASE_LEDGER.md`
- `docs/PROJECT_STATUS.md`
- `docs/ROADMAP_V4.md`
- Relevant source, tests, and docs for the proposed phase
- Recent git history when useful

Produce a phase plan with:

- Phase ID and name
- Goal
- Why this phase is next
- Scope
- No-go areas
- Likely files
- Validation commands
- Risk level: low, medium, or high
- Stop conditions
- Expected next phase if successful

Append the planned phase to `docs/agent/PHASE_LEDGER.md` before editing. Mark it `Status: planned` or `Status: in progress`.

## Phase Selection Priority

Prefer phases in this order:

1. Fix failing build, lint, unit, or relevant E2E tests.
2. Finish explicitly listed roadmap phases from `docs/ROADMAP_V4.md`.
3. Close gaps listed in `docs/PROJECT_STATUS.md`.
4. Improve test coverage around recently changed behavior.
5. Reduce local technical debt only when it unlocks a listed roadmap phase.
6. Documentation updates that keep the autonomous ledger and project state accurate.

Avoid speculative new features unless the roadmap clearly calls for them.

## Long-Run Defaults

When the user explicitly asks for a long run:

- Target up to 8-12 hours of work unless the user gives a different budget.
- Execute multiple bounded phases if each next phase remains safe.
- Re-check `git status --short --untracked-files=no` before each phase.
- Re-run relevant validation after each phase.
- Update `docs/agent/PHASE_LEDGER.md` after each phase.
- Use escalated review before deciding that a protected boundary or worktree issue must stop the run.
- Stop when escalated review finds that the next phase requires real provider/cloud calls, external configuration, irreversible production semantics, unresolved conflicting user changes, or no high-value safe phase remains.

For very large work, prefer 4-8 completed phases over one giant diff.

## Escalated Review And Stop Conditions

Run automatic escalated review before directly modifying work involving:

- IndexedDB schema changes
- Supabase/cloud sync semantics
- Ticket blob storage contracts
- Route cache contracts
- Provider proxy contracts
- AI privacy boundaries
- Real AI/search/route/map/cloud calls
- Secrets, credentials, provider keys, or auth flows
- Billing, quota, or abuse-control production behavior
- Final merge decisions

Escalated review should inspect existing contracts, tests, docs, feature flags, disabled/mock providers, local-only validation paths, rollback risk, and likely production configuration.

After escalated review:

- Continue automatically if the work can be limited to docs, tests, mocks, preview-only UI, local adapters, disabled-by-default code, or safe refactors that preserve the existing contract.
- Prefer preparing local code plus clear setup instructions over blocking on external services.
- If Supabase, Cloudflare, provider env, billing, quota, or secret configuration is needed, document the exact required user action and continue other safe local work.
- Stop only when real credentials, production configuration, cloud writes, provider calls, schema migration execution, irreversible semantics, or a final product/architecture decision is required.

Also use escalated review when:

- Tracked working-tree changes appear that were not made by Codex in the current run.
- The next safe step is ambiguous enough that two reasonable implementations would diverge.
- The repository state suggests the user is actively editing the same files.

For product or architecture questions, make a default decision when it is reversible, consistent with `docs/ROADMAP_V4.md`, and inside existing contracts. Stop before implementation only when the choice changes long-term product direction, protected contracts, data semantics, or user-visible commitments that cannot be cheaply reversed.

## Validation Policy

Default validation follows `AGENTS.md`:

- Code: `npm run build`, `npm run lint`, `npm run test:unit`, relevant E2E, and full E2E when feasible.
- Docs-only: `git diff --check`.
- QA-only: no edits, no staging, no commits.

For UI/E2E work:

- Prefer stable scoped locators.
- Use 390px mobile viewport checks when relevant.
- Avoid assertions on long Chinese paragraphs.
- Do not rely on live provider data.

When validation fails:

- Investigate and repair within the current phase first.
- Re-run the narrowest relevant check after each repair, then the broader phase validation before moving on.
- Stop only when the failure is environmental, external-config-dependent, unrelated to current work, or would require unsafe boundary changes.
- Record failed commands, repair attempts, and residual risk in the phase ledger.

## Commit Policy

For autonomous iteration mode, staging, committing, and pushing are authorized by default.

Default policy:

- Commit at stable phase boundaries.
- Stage explicit files only.
- Use messages like `feat: complete phase 13a trip home map overview` or `docs: record autonomous phase ledger`.
- Do not commit forbidden local artifacts listed in `AGENTS.md`.
- Push only the current feature/fix/docs branch.
- Never push directly to `main` unless the user explicitly asks for that exact action.
- Do not stage, commit, or push unrelated/user-owned changes discovered during worktree escalated review.
- If a phase cannot be committed cleanly because unrelated changes overlap the same files, stop and report exact files plus the safest recovery path.

## Phase Ledger Format

Each phase entry in `docs/agent/PHASE_LEDGER.md` should include:

- Status
- Started / completed dates
- Branch
- Goal
- Scope
- No-go areas
- Files changed
- Validation commands and results
- Known issues
- Follow-up recommendation

The ledger is part of the working state. Keep it concise but specific enough that a future Codex run can resume without rereading the whole repository.

## Final Report

At the end of an autonomous run, report:

- Branch
- Phases completed
- Files changed
- Validation commands and results
- Known issues or skipped checks
- Recommended next phase
- Whether commits/staging/push happened
