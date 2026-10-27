# ConnectAI

ConnectAI helps college students prepare for placement interviews with peer messaging, AI mock interviews, saved feedback, and progress tracking.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/connectai run dev` — run the web app (workflow supplies `PORT` and `BASE_PATH`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required managed env: `DATABASE_URL`, Clerk keys, and `GEMINI_API_KEY`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Auth: Replit-managed Clerk; browser API calls use same-origin session cookies
- AI: Gemini API through the server-side `@google/genai` client
- Live chat updates: authenticated Server-Sent Events

## Where things live
- `artifacts/connectai` — React + Vite user-facing app
- `artifacts/api-server` — shared Express API and Clerk middleware
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db/src/schema/connectai.ts` — persistent user, conversation, message, and interview models

## Architecture decisions
- PostgreSQL is the app database; do not add a second database for the initial product.
- Clerk session cookies authenticate web requests; never add browser-side bearer tokens.
- Gemini calls stay on the API server and use `GEMINI_API_KEY` from Replit Secrets.
- Interview scores must be generated from saved answers and presented as estimates, not as objective measures of a person.

## Product
The audience is college students preparing for job placements. The product combines peer support with practice interviews, saved feedback, and learning progress.

## User preferences
Keep the code beginner-friendly and document setup steps in plain language. Prioritize a real, demonstrable full-stack app over a static mockup.

## Gotchas
- Enable Google SSO in the Replit Auth pane for Google sign-in; the app never accesses Gmail.
- Run API codegen after changing OpenAPI, then run the API server typecheck.
- Development and published Clerk accounts are separate.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
