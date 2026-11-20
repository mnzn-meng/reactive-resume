# Reactive Resume: agent instructions

This is the index for coding agents. It holds hard rules and pointers; detail lives in the linked files. Agent
reference docs are in `.agents/docs/` (start at its `README.md`).
Scripts and config win when a doc disagrees with them.

<!-- caveman-begin -->

Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:

- Drop: articles (a/an/the), filler (just/really/basically), pleasantries, hedging
- Fragments OK. Short synonyms. Technical terms exact. Code unchanged.
- Pattern: [thing] [action] [reason]. [next step].
- Not: "Sure! I'd be happy to help you with that."
- Yes: "Bug in auth middleware. Fix:"

Switch level: /caveman lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra
Stop: "stop caveman" or "normal mode"

Auto-Clarity: drop caveman for security warnings, irreversible actions, user confused. Resume after.

Boundaries: code/commits/PRs written normal.
<!-- caveman-end -->

## Hard rules

- Check `git status --short` before editing and preserve unrelated changes. Set work aside with a WIP commit; plain
  `git stash` shares one stack across every worktree.
- Never add AI attribution, AI co-author trailers or session links to commits or PRs. Commits follow Conventional
  Commits (enforced by the commit-msg hook).
- Keep credentials, personal resume data and production identifiers out of source, logs, fixtures and PRs.
- Ticket notes (delivery logs, handoffs, review results) go on the Linear issue as a comment, never into repo files.

## Specs and review

- Tickets: Linear team `RX` (`RX-<n>`); public reports: GitHub issues. How to read them: `.agents/docs/issue-tracker.md`.
- Review rules: `CODING_STANDARDS.md`. Decision records: `.agents/docs/decisions/`.
- Runbooks (container publishing, Turbo remote cache): `.agents/docs/runbooks/`.

## Environment

- Node 26 (`.nvmrc`). This machine's default may be newer; run commands as `mise exec node@26 -- <cmd>` when
  `node -v` isn't 26. pnpm version: root `packageManager`.
- Setup: `.env.local`, `compose.dev.yml` and the scripts below. Local Postgres, Redis and SeaweedFS come from
  `compose.dev.yml`; host-run code uses `localhost`, containers use service names.
- Root `.env` is auto-loaded by `packages/env`; root dev and `db:*` scripts load `.env.local` through `dotenvx`; tests,
  builds and `pnpm start` load neither, so export what they need or use the scripts below.

## Commands

```sh
pnpm check:affected                              # changed packages: typecheck, tests (DB suites included), boundaries, lint, format
pnpm test:db exec -- pnpm --filter @reactive-resume/api test   # DB suites on per-worktree databases, no silent skips
pnpm test:e2e:local --build [spec]               # Playwright on a per-worktree DB, port and storage
pnpm lingui:extract                              # web and PDF catalogs; run before building
pnpm lingui:check                                # catalogs match source (CI gate)
pnpm locales:diff [--base <ref>]                 # lost translations, placeholder/tag mismatches vs base
pnpm ci:logs [run or job URL]                    # failure blocks from a CI run, even while it's still running
pnpm check:agent-docs                            # paths named in agent docs exist, AGENTS.md size, no ignored files tracked
```

- One package: `pnpm --filter <name> test [file]` (paths relative to the package; no extra `--`). Package names come
  from each `package.json`: apps are `web` and `server`; shared packages are `@reactive-resume/<name>`.
- `--filter <pkg> exec vp test run <file> -t "<name>"` runs one test. Most scripts use `--passWithNoTests`, so a green
  run with zero tests proves nothing.
- `check:affected` compares against `TURBO_SCM_BASE` (default `origin/main`; fetch first if stale) and needs the local
  Postgres from `compose.dev.yml`, because it runs tests through `test:db exec`.
- Send long-running output to a log file and read it with `tail` or `rg`; find background jobs with `pgrep -f <tag>`,
  not a full `ps` listing.

## Ownership map

| Area                                        | Owner                                               |
| ------------------------------------------- | --------------------------------------------------- |
| Web routes and workflows                    | `apps/web/src/routes`, `apps/web/src/features`      |
| Server HTTP, startup, static pages, OpenAPI | `apps/server/src/{http,rpc,openapi,static,startup}` |
| API routers and business logic              | `packages/api/src/features/<feature>`               |
| API input/output DTOs                       | `packages/api/src/dto/<feature>.ts`                 |
| Auth                                        | `packages/auth` (Better Auth)                       |
| DB schema and client                        | `packages/db/src/schema/<area>.ts`                  |
| Server env validation                       | `packages/env/src/server.ts`                        |
| Resume, template and application schemas    | `packages/schema`                                   |
| Pure resume behaviour (JSON Patch, icons)   | `packages/resume`                                   |
| PDF rendering                               | `packages/pdf` (templates through `src/forme`)      |
| PDF.js viewer and canvas UI                 | `apps/web/src/features/resume/preview`              |
| DOCX export                                 | `packages/docx`                                     |
| Generic UI primitives and styles            | `packages/ui`                                       |
| Other support packages                      | `packages/{fonts,email,import,ai,utils,config}`     |
| Dev-only scripts                            | `tooling/`, never `packages/`                       |

Details behind those rows:

- Never hand-edit `apps/web/src/routeTree.gen.ts`; it is generated from the file routes.
- The app's HTML shells and SEO live in `apps/server/src/static/web.ts`.
- API routes use `protectedProcedure` from `packages/api/src/context.ts`; a feature's `router.ts` delegates to its
  `service.ts`. The Drizzle config is `packages/db/drizzle.config.ts`, SQL in `migrations/`.
- Auth lives in `packages/auth`; `apps/server/src/http/auth.ts` only delegates to it.
- Schema fixtures: `defaultResumeData` in `packages/schema/src/resume/default.ts`, `sampleResumeData` in
  `packages/schema/src/resume/sample.ts`.
- The PDF.js viewer and ATS checker are `apps/web/src/features/{resume/preview,ats-checker}`; they never import
  `packages/pdf`. Shared filtering lives in `packages/pdf/src/templates/shared/filtering.ts`.
- UI styles are in `packages/ui/src/styles/`; web design rules are in `apps/web/DESIGN.md`.

`packages/utils` takes a helper only when no domain package owns it: JSON Patch belongs in `@reactive-resume/resume`,
DOCX builders in `@reactive-resume/docx`.

## Package boundaries

`pnpm exec turbo boundaries` enforces them. Import other workspaces by package name and export map, never through a
`src` path or path alias. Runtime-specific code sits behind explicit subpaths (`@reactive-resume/pdf/browser`,
`@reactive-resume/pdf/server`, `@reactive-resume/env/server`); root exports stay environment-neutral. Wildcard exports
are only for file-like leaf surfaces (`@reactive-resume/ui/components/*`, `@reactive-resume/ui/hooks/*`, schema model
files).

## Changes that touch several places

- **Resume data shape**: `packages/schema/src/resume/*`, then DTOs, importers, PDF rendering, then the web forms.
- **New DB column or table**: `packages/db/src/schema/*`, then `pnpm db:generate`. Also check the feature's `crud.ts`
  update allow-list, the account export in `packages/api/src/features/auth`, and the DTO. To rebase a branch's
  migration onto a newer `main`, delete the branch's migration folder and regenerate it so its snapshot chains on.
- **API contract change**: the spec is generated at runtime at `/api/openapi/spec.json`; run
  `pnpm --filter server test src/openapi` (it counts schemas).
- **New env var**: `packages/env/src/server.ts`, `.env.example`, and `turbo.json` (`globalPassThroughEnv` plus the
  test-task `env` arrays; Turbo's strict env mode hides unlisted variables). Deployment aliases:
  `packages/env/src/deployment.ts`.
- **User-facing strings**: Lingui macros for the copy, then `pnpm lingui:extract` (both apps); the
  `.agents/skills/fill-translations` skill covers the rest of the workflow. Glossary: root `GLOSSARY.md`.
- **New template**: `packages/schema/src/templates.ts`, `packages/pdf/src/templates/index.ts`, source in
  `packages/pdf/src/templates/<name>/`, previews under `apps/web/public/templates/` (command in `apps/web/DESIGN.md`).
- **Public marketing route**: the TanStack route plus its server fallback and SEO in `apps/server/src/static/web.ts`;
  Vite's dev fallback hides production 404s.
- **Career or workspace behaviour**: the ownership table above names where it lives; keep the notes in `.agents/docs/`
  current.

## Finish checks

- After edits: `pnpm exec vp lint --fix <paths>`, then `pnpm exec vp fmt <paths>` (keep side-effect import order).
- Before handing off: `pnpm check:affected` (or `pnpm lint:agent` and `pnpm format:check` plus the package tests you
  touched), DB suites through `pnpm test:db exec`, and the production build for runtime or bundling changes. Report
  skipped checks and failures as they are.
- `pnpm check` mutates files (translations, lint fixes, formatting); review its diff.
- Lint and format rules live in `vite.config.ts`. A suppression names its rule and the reason.

## Gotchas

- `drizzle-kit` reads `DATABASE_URL` from the environment only; run it through the root `db:*` scripts.
- Startup applies migrations and verifies the schema; `STRICT_SCHEMA_CHECK=true` makes drift fatal.
- `.env.example` ships SeaweedFS S3 defaults: run SeaweedFS or set `STORAGE_BACKEND=local`.
- Without SMTP no email is sent. Production logs only the recipient and subject; `pnpm dev` prints the full email,
  links included.
- Vercel module-loading failures: bundle CommonJS server dependencies through `bundledInteropPackages` in
  `apps/server/vite.config.ts`; Vercel's service builder drops their pnpm links.
- Playwright starts `node apps/server/dist/index.mjs` directly; build first, and keep that direct command.
- Deployment smoke tests create and delete accounts; run them only against a dedicated test installation.
- CodeRabbit is not set up for automatic reviews; don't wait for it.
