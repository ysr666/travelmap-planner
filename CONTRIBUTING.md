# Contributing to TripMap

## Development Setup

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run unit tests
npm run test:unit

# Run E2E tests
npx playwright test

# Build for production
npm run build

# Lint
npm run lint
```

## Project Structure

```
src/
├── components/          # React components
│   ├── ui/             # Base UI components (Button, Card, etc.)
│   ├── trip/           # Trip-related components
│   ├── cloud/          # Cloud sync components
│   └── ai/             # AI-related components
├── pages/              # Page components
├── lib/                # Utility libraries
│   ├── ai/             # AI draft and import logic
│   └── ...             # Other utilities
├── db/                 # IndexedDB repositories
├── hooks/              # React hooks
└── types.ts            # TypeScript types
e2e/                    # Playwright E2E tests
docs/                   # Documentation
```

## Testing

### Unit Tests

Unit tests use Vitest and React Testing Library. Run with:

```bash
npm run test:unit
```

Test files are co-located with source files: `Component.test.tsx` next to `Component.tsx`.

### E2E Tests

E2E tests use Playwright. Run with:

```bash
npx playwright test
```

E2E tests are in the `e2e/` directory and run against a 390x844 mobile viewport.

### Writing Tests

- Mock external dependencies with `vi.mock()`
- Use `vi.hoisted()` for mock setup
- Use `act()` for async rendering
- Use `createRoot` from `react-dom/client`
- Set `IS_REACT_ACT_ENVIRONMENT = true` in `beforeEach`

## Code Style

- TypeScript strict mode
- ESLint for linting
- Tailwind CSS for styling
- Mobile-first responsive design (390px base)
- Touch targets must be ≥44px (WCAG 2.5.8)

## UI And Product Design

- Read `docs/UI_REFACTOR_V3.md` and `docs/DESIGN_SYSTEM.md` before changing App Shell, navigation, AI UI, Trip, Day, Map, Item, Ticket, Inbox, Search, Settings, or shared UI primitives.
- Treat UI V3 as Target until the relevant component, tests, responsive screenshots, and E2E are merged.
- Bottom navigation is for top-level destinations only; commands such as AI, Search, Add, and Delete belong in a toolbar, content control, menu, or modal.
- Keep one primary task and one primary action per screen. Do not repeat the page title, trip name, date, metrics, address, or map links in one viewport.
- Use cards only for independent records, dialogs, or framed tools. Prefer spacing, grouping, typography, and dividers for normal page sections.
- Use Lucide React icons and accessible labels. Do not add emoji controls, hand-drawn SVGs, or a second icon library when Lucide has an equivalent.
- Test `320x568`, `390x844`, `430x932`, `768x1024`, and `1440x900` when the change affects shared layout.
- Check long Chinese/English text, software keyboard, light/dark mode, loading, empty, error, offline, stale, and partial-success states.
- AI writes remain preview plus final confirmation. UI simplification must not bypass schema, risk, idempotency, stale-state, or permission checks.
- Generated ImageGen, Stitch, or Figma screens are design references; real React components and approved Golden Screenshots are the final implementation evidence.

## Architecture

- **Online-first target**: Supabase/Postgres is the target account source of truth, with Realtime subscriptions and server revisions.
- **Edge cache**: IndexedDB supports fast startup, weak-network outbox, and emergency reads.
- **AI-first**: User intent enters the versioned Action Gateway; models may select only registered semantic actions.
- **Realtime facts**: Place, route, transit, weather, flight, rail, ticket, and search data carry source and freshness.
- **PWA resilience**: Service workers preserve the shell and selected cached resources without pretending network-only features are current.
- **Provider proxy**: AI and realtime providers stay behind authenticated server-side contracts.

## Commit Messages

Use conventional commits:

```
feat: add new feature
fix: fix bug
docs: update documentation
test: add tests
refactor: refactor code
style: formatting changes
chore: maintenance tasks
```

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Run `npm run test:unit` and `npx playwright test`
4. Run `npm run lint` and `npm run build`
5. Submit a pull request

## Key Principles

- **Mobile-first**: Design for 390px viewport
- **Online-first**: Design the complete path for authenticated, connected users.
- **Graceful degradation**: Preserve recent data and queued changes when connectivity is unavailable.
- **Action-oriented AI**: Prefer completed actions and compact results over explanatory answer panels.
- **Accessible**: Follow WCAG guidelines
- **Adaptive**: Use bottom navigation on compact screens, rail/top navigation on tablets, and sidebar/master-detail layouts on desktop.
- **Type-safe**: Use TypeScript strictly
- **Test-covered**: Write tests for new features
