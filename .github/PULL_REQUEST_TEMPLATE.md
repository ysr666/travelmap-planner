## Summary

-

## Product Direction

- [ ] The change supports the realtime online, AI-first strategy in `docs/PRODUCT_STRATEGY.md`.
- [ ] Shipped behavior is labeled Current; unshipped architecture is labeled Target; old evidence is labeled Historical.
- [ ] Primary UI stays action-oriented and compact; technical sync, Provider, quota, and data-policy detail remains outside the main travel view.
- [ ] UI changes follow `docs/UI_REFACTOR_V3.md` and `docs/DESIGN_SYSTEM.md`, or the deviation is explained below.

## UI Review

- [ ] Not applicable, or the screen has one primary task and one primary action.
- [ ] Not applicable, or no title, trip/date, metric, address, or map-link group is duplicated in one viewport.
- [ ] Not applicable, or AI, map sheets, sticky actions, and bottom navigation do not stack or obscure content.
- [ ] Not applicable, or long Chinese/English content and software-keyboard states were checked from 320px upward.
- [ ] Not applicable, or touch targets, contrast, focus, keyboard, reduced motion, and `200%` text zoom were reviewed.
- [ ] Not applicable, or mobile, tablet, and desktop layout evidence is attached without committing local screenshots.
- [ ] Generated mockups were treated as references; the real component and Golden Screenshot are the final visual evidence.

## Validation

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test:unit`
- [ ] `npm run build`
- [ ] Relevant E2E:
- [ ] `git diff --check`

## Boundary Checklist

- [ ] This PR does not change database schema, cloud semantics, Provider contracts, AI data boundaries, Vault encryption, or ticket/blob storage unless those areas are explicitly in scope.
- [ ] If this PR changes Supabase, D1, Cloudflare, provider proxy, auth, storage, or sync behavior, the migration/config file is committed before any production apply.
- [ ] Database/provider boundary changes were validated in preview/local-safe mode before production.
- [ ] AI can select only registered actions; reversible write plans remain preview + final confirmation.
- [ ] Realtime facts carry source, observation time, and expiry; stale data is not presented as current.
- [ ] No raw provider payloads, tokens, authorization headers, key prefixes, stack traces, PNRs, order numbers, document numbers, or attachment contents are logged or persisted.
- [ ] Screenshots, local env files, local profiles, `.playwright-mcp/`, and agent notes were not staged.

## Rollout Notes

- Production migration/config required: yes / no
- Real provider calls used: yes / no
- If real provider calls were used, operation families and counts:
- Smoke evidence:
