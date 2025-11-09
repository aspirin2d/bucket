# Repository Guidelines

## Project Structure & Module Organization
- `src/index.ts` bootstraps the Hono server, declares routes, and wires middleware; keep cross-cutting concerns (logging, auth, config) here.
- `src/upload.ts` wraps the AliOSS + Postgres helpers; add new storage adapters as sibling modules and expose pure functions for reuse.
- Build artifacts land in `dist/` after `npm run build`; edit only TypeScript sources and regenerate the compiled JS when needed.
- Runtime settings load via `dotenv`; define `.env.example` entries for every new variable and never commit real secrets.

## Build, Test, and Development Commands
- `npm run dev` / `pnpm dev`: `tsx watch src/index.ts` with live reload; ideal for iterating against http://localhost:3000.
- `npm run build`: runs `tsc` for the production bundle; run before publishing a branch to catch type drift.
- `npm start`: executes `node dist/index.js`; mirrors the deployed runtime for final smoke tests.
- Optional: `NODE_ENV=production npm start` to mimic deployment logging/perf constraints.

## Coding Style & Naming Conventions
- TypeScript + ES modules, 2-space indentation, camelCase for variables/functions, PascalCase for DTOs, classes, and Hono handlers.
- Keep modules single-responsibility; colocate helpers beside their consumers and prefer factory functions for stateful clients (OSS, PG) so tests can inject stubs.
- Use async/await with explicit error handling; wrap external calls in `try/catch` that returns typed results or throws `HTTPException`.

## Testing Guidelines
- No automated harness yet; when adding one, place specs under `src/__tests__/` and wire `npm test` to your chosen runner (Vitest or Jest) for predictable CI hooks.
- Until then, PRs must include manual verification steps (curl command + expected payload) and list any required environment data.

## Commit & Pull Request Guidelines
- Workspace ships without visible git history, so adopt Conventional Commits manually: `<type>(scope): imperative summary` (example: `fix(upload): retry on timeout`).
- Keep commits focused, reference issue IDs in the body, and describe DB/schema updates explicitly.
- PR checklist: problem statement, solution overview, test evidence, screenshots/logs for user-facing changes, and a note for every new env var or migration.

## Configuration & Security Notes
- Secrets for AliOSS, Postgres, and signing keys belong in `.env` plus your secret manager; rotate them immediately if they leak into logs.
- Review `upload.ts` when adjusting limits; document max file size, MIME filters, and throttling so on-call agents can reason about failures quickly.
