# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**旅图 TripMap** - A local-first PWA for international trip planning. All data stored in IndexedDB, no backend server. Supabase is optional for cloud backup only. UI is in Chinese (zh-CN).

## Tech Stack

- **Framework:** React 19 + TypeScript 6 + Vite 8
- **Styling:** Tailwind CSS 4
- **Data:** Dexie.js (IndexedDB wrapper)
- **Maps:** MapLibre GL JS + OpenFreeMap
- **Testing:** Vitest (unit) + Playwright (E2E)
- **PWA:** vite-plugin-pwa + Workbox

## Common Commands

```bash
# Development
npm run dev              # Start Vite dev server (localhost:5173)
npm run preview          # Preview production build (localhost:4173)

# Build & Quality
npm run build            # TypeScript check + Vite production build
npm run lint             # ESLint

# Testing
npm run test:unit        # Run Vitest unit tests (single run)
npm run test:unit:watch  # Watch mode for unit tests
npm run test:e2e         # Playwright E2E tests (Chromium, mobile viewport 390x844)
npm run test:e2e:ui      # Playwright with UI mode
npm run test:e2e:headed  # Playwright in headed browser

# Run a single test file
npx vitest run src/lib/someFile.test.ts
```

## Architecture

### Routing
- **Hash-based SPA routing** (no React Router) - custom router in `src/lib/routes.ts`
- Routes defined in `src/types.ts` as `RouteId`: `home`, `trip`, `day`, `item`, `tickets`, `settings`, `trip/new`, `trip/edit`, `item/new`, `item/edit`
- All pages except `HomePage` are lazy-loaded via `React.lazy()`

### Data Layer
- **Database:** IndexedDB via Dexie.js (`TravelConsoleDB`)
- **Pattern:** Repository + Tracked Mutations
  - Read queries: `src/db/repositories.ts`
  - Write operations: `src/db/trackedMutations.ts` (triggers auto-backup side effects)
  - Public API: `src/db/index.ts`
- **Entities:** `trips`, `days`, `itineraryItems`, `ticketMetas`, `ticketBlobs`
- **Route cache:** Separate `TripMapRouteCacheDB` database (excluded from backups)

### Key Business Logic (src/lib/)
- `routes.ts` - Hash-based SPA routing with legacy redirect support
- `backup.ts` - Local zip backup (import/export)
- `cloudBackup.ts` - Supabase cloud backup/restore
- `autoSnapshotBackup.ts` - Automatic cloud snapshot logic
- `tripPlanImport.ts` - AI-generated trip plan import (JSON/ZIP)
- `routing.ts` - OpenRouteService polyline generation
- `mapEngine.ts` / `maplibreAdapter.ts` - Map engine abstraction layer

### Ticket Storage
Three modes: `copy` (file blob in IndexedDB), `reference` (metadata only), `external` (URL only)

## Project Structure

```
src/
  App.tsx           # Hash-based router, lazy-loaded pages
  types.ts          # Core domain types (Trip, Day, ItineraryItem, TicketMeta, etc.)
  pages/            # 8 page components (lazy-loaded)
  components/
    cloud/          # Supabase cloud backup UI
    trip/           # Trip-specific views (DayMapView, DayTimelineView, etc.)
    ui/             # Reusable UI primitives (Card, Button, BottomSheet, etc.)
  hooks/            # Custom React hooks
  lib/              # Business logic (37 files, many with co-located tests)
  db/               # Dexie database schema, repositories, mutations
e2e/                # Playwright E2E test specs (mobile-first, Chromium)
docs/               # Documentation (AI import spec, routing, Supabase setup)
examples/           # Example trip-plan.json files
```

## Testing Patterns

- **Unit tests:** Co-located with source files (`*.test.ts` next to source in `src/lib/` and `src/db/`)
- **E2E tests:** Mobile-first (390x844 viewport), Chromium only, single worker
- **Test environment:** `jsdom` + `fake-indexeddb` for browser API mocking

## Environment Variables

Copy `.env.example` to `.env` and configure:
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` - Optional cloud backup
- `VITE_ROUTING_PROVIDER` - Map routing provider
- `VITE_OPENROUTESERVICE_API_KEY` - OpenRouteService API key
- `VITE_GOOGLE_MAPS_API_KEY` - Google Maps API key

## Deployment

- **Target:** Cloudflare Pages (or any static host)
- **Build output:** `dist/`
- **No server required:** Hash routing means no rewrites needed

## Important Notes

- The app does NOT call AI APIs directly. Users generate trip plans externally and import them via JSON/ZIP files (see `docs/AI_IMPORT_SPEC.md`)
- Mobile-first design: UI components include `BottomSheet`, touch-friendly controls, designed for iPhone "Add to Home Screen"
- `npm run build` includes TypeScript type checking before Vite build

## Model Usage Strategy

### Default Model
- **mimo-2.5-pro**: 日常代码开发、重构、逻辑处理（不支持图片输入）

### Image Task Handling

**模型映射**: haiku = mimo-2.5（支持图片输入）

#### Option 1: Independent Image Analysis (Recommended for quick analysis)
Use `/visual-qa` skill for independent image tasks - it automatically uses haiku (mimo-2.5):
```
/visual-qa ./screenshot.png
/visual-qa 这个 UI 布局有什么问题？
```

#### Option 2: Context-Aware Processing (Recommended for tasks needing code context)
Manually switch models when you need to analyze images with code context:
```
/model haiku              # Switch to image-capable model (haiku = mimo-2.5)
[Process image task]
/model mimo-2.5-pro       # Switch back to default model
```

### When to Use Which Approach

| Scenario | Recommended Approach | Reason |
|----------|---------------------|--------|
| Quick screenshot analysis | `/visual-qa` | Independent task, no context needed |
| UI verification | `/visual-qa` | Focused visual analysis |
| Error screenshot + code location | Manual switch | Needs code context |
| Design comparison with implementation | Manual switch | Needs access to current code |
| Photo content recognition | `/visual-qa` | Independent task |

### Automatic Reminders

When attempting to read image files, the system will automatically remind you to choose the appropriate processing method.

## Design System Alignment Tasks

A set of tasks to align the project UI with the Stitch iOS design system is tracked in `.claude/design-system-tasks.md`.

- In a new session, read that file to understand the full task list, dependencies, and execution rules
- Tasks should be executed in ID order, skipping blocked ones
- Design reference HTML files are in `design-reference/` (code.html only, no images)
- **Never read image files or run image-based QA** — code.html is the reference source
- Each task should be planned (EnterPlanMode) before execution, then verified with build + lint + test

## Development Workflow

For complex, multi-step tasks, use the `/company-flow` skill to run the global AI-company coding workflow. This ensures a structured approach with proper quality gates.

### When to Use

- New features requiring multiple files
- Refactoring across components/modules
- Tasks affecting architecture or data layer
- Bug fixes requiring investigation and testing
- Any task estimated at >30 minutes of work

### Workflow Phases

1. **Prompt Optimization** - Clarify requirements, scope, and constraints
2. **Planning** - Architecture review, identify affected files, design approach
3. **Implementation** - Code changes with incremental commits
4. **QA** - Run tests, type checking, linting
5. **Review** - Code review for regressions, quality, and completeness
6. **Memory Note** - Document decisions and lessons learned

### Usage

```
/company-flow <task description>
```

Example:
```
/company-flow Add offline map tile caching for selected regions
```

### Quick Tasks

For simple, single-file changes (bug fixes, typos, minor tweaks), proceed directly without the full workflow.

### Automatic Workflow Hooks

The project includes hooks in `.claude/settings.json` that provide workflow reminders before key operations:

- **Before Edit/Write operations:** Reminds about using `/company-flow` for complex changes
- **Before Agent operations:** Suggests structured workflow for complex tasks

These hooks automatically display tips when working with files, helping ensure complex tasks follow the proper workflow. When you see these reminders, evaluate if the current task warrants the full `/company-flow` workflow.
