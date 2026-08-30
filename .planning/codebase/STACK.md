# Technology Stack

**Analysis Date:** 2026-05-04

## Languages

**Primary:**
- TypeScript ^5.8 — all app code under `src/` (`tsconfig.json:25`)
  - `target: ES2017`, `module: esnext`, `moduleResolution: bundler`, `strict: true`, `jsx: preserve`
  - Path alias `@/*` → `./src/*` (`tsconfig.json:17`)

**Secondary:**
- SQL — `schema.sql`, `migrate-multi-tenant.sql`, `migrate-session-date.sql` (Postgres / Supabase)
- CSS — single global stylesheet at `src/app/globals.css` (1206 lines, custom CSS variables, Tailwind imported via `@import "tailwindcss"`)

## Runtime

**Environment:**
- Node.js — version not pinned (no `.nvmrc`, no `engines` field in `package.json`)
- Next.js server runtime (App Router); routes default to Node runtime — no `export const runtime = "edge"` anywhere in `src/`

**Package Manager:**
- npm — `package-lock.json` present (89 KB), no `pnpm-lock.yaml` / `yarn.lock` / `bun.lockb`

## Frameworks

**Core:**
- Next.js ^15.3.0 — App Router, used for pages, API routes, and middleware (`src/middleware.ts`)
- React ^19.1.0 / React DOM ^19.1.0 — all components are functional with hooks; client components marked `"use client"` (e.g. `src/app/page.tsx:1`)

**Styling:**
- Tailwind CSS ^4.1.0 via `@tailwindcss/postcss` ^4.1.0 (`postcss.config.mjs:1-5`)
- Almost all styling is hand-rolled CSS classes + CSS variables in `src/app/globals.css` (dark trading theme: `--bg-0` … `--gold`, `--bull`, `--bear`, `--blue`). Auth pages use heavy inline `style={{}}` blocks rather than Tailwind utilities.

**Testing:**
- None detected — no `jest.config.*`, `vitest.config.*`, `playwright.config.*`, no `__tests__/` directories, no `*.test.*` / `*.spec.*` files, no test scripts in `package.json`.

**Build/Dev:**
- `next dev` / `next build` / `next start` (`package.json:5-9`) — no custom build scripts, no lint script defined
- TypeScript incremental build artifact `tsconfig.tsbuildinfo` is committed (113 KB) — likely unintentional; should be gitignored

**Linting/Formatting:**
- No ESLint config (`.eslintrc*` / `eslint.config.*` absent)
- No Prettier config (`.prettierrc*` absent)
- No Biome config
- One inline `// eslint-disable-next-line @typescript-eslint/no-explicit-any` at `src/app/api/es-price/route.ts:33` suggests ESLint *was* expected at some point, but no config currently exists

## Key Dependencies

**Critical:**
- `@supabase/ssr` ^0.6.1 — cookie-based SSR auth client (used in `middleware.ts`, `lib/supabase-server.ts`, `lib/supabase-browser.ts`, `auth/callback/route.ts`)
- `@supabase/supabase-js` ^2.104.0 — used only for the admin (service-role) client in `lib/supabase-server.ts:31`
- `openai` ^4.79.0 — TL;DR generation in `lib/generate-tldr.ts:111`. Calls `chat.completions.create` with `model: "gpt-5.5"`, `reasoning_effort: "high"`, `max_completion_tokens: 16000`, `response_format: { type: "json_object" }`. Recent commit `5b1d908` swapped this from Anthropic.
- `yahoo-finance2` ^3.14.0 — live ES futures quote in `src/app/api/es-price/route.ts` (`yf.quote("ES=F")`)

**Infrastructure:**
- `next.config.ts` declares `serverExternalPackages: ["yahoo-finance2", "openai"]` — keeps these out of the client bundle and webpack tracing

**Dev/Types:**
- `@types/node` ^22, `@types/react` ^19.1, `@types/react-dom` ^19.1, `typescript` ^5.8 — only types/typescript in devDependencies; no test, lint, or formatter tooling

## Configuration

**Environment variables (`.env.example`):**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`

**Used in code but missing from `.env.example`:**
- `OPENAI_API_KEY` — read in `lib/generate-tldr.ts:105`. Falls back to logging an error and returning `null` when unset, so TL;DR silently degrades. **Flag: `.env.example` is out of date.**

**Build config:**
- `next.config.ts` — single option (`serverExternalPackages`)
- `tsconfig.json` — standard Next.js + path alias
- `postcss.config.mjs` — only Tailwind plugin

## Platform Requirements

**Development:**
- Node + npm; no version pinning so contributors can drift

**Production:**
- Render (per `CLAUDE.md`); deployment artifacts not in repo (no `render.yaml`, `Dockerfile`, or `vercel.json`)
- The `auth/callback/route.ts:11-15` explicitly handles `x-forwarded-host` / `x-forwarded-proto` "because Render proxies internally on localhost" — concrete confirmation of the deployment target

## Divergence from CLAUDE.md

- CLAUDE.md says the app uses "email/password" auth — code also wires up Google OAuth (`src/app/login/page.tsx:31-39`, `src/app/signup/page.tsx:28-36`).
- CLAUDE.md lists `lib/supabase.ts` as a single file with three clients — actual code splits into `lib/supabase-browser.ts` and `lib/supabase-server.ts` (the latter exports both `createServerSupabase` and `createAdminSupabase`).
- CLAUDE.md does not mention OpenAI, `yahoo-finance2`, the `/api/tldr` route, the `/api/es-price` route, the `useESPrice` hook, the TldrTab, the `headline` field, or `tldr` JSONB column on `plans`. All are present in code.

---

*Stack analysis: 2026-05-04*
