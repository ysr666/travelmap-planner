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

## Architecture

- **Offline-first**: All data stored in IndexedDB
- **PWA**: Service worker for offline support
- **Cloud sync**: Optional Supabase sync
- **AI integration**: Provider proxy pattern for AI features

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
- **Offline-capable**: Features should work without network
- **Accessible**: Follow WCAG guidelines
- **Type-safe**: Use TypeScript strictly
- **Test-covered**: Write tests for new features
