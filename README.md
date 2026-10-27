# ConnectAI

ConnectAI is a placement-preparation app for college students. It combines peer messaging with AI-generated mock interviews, saved evaluations, and progress tracking.

## What's implemented

- Public landing page and responsive signed-in workspace.
- Clerk-managed account registration, sign-in, session cookies, profile sync, and protected API routes.
- Registered-user search and private one-to-one conversations with persisted messages, unread counts, and live Server-Sent Events.
- AI interview setup, generated questions, saved answers, AI evaluation, interview history, and printable report view.
- AI interview-preparation assistant.
- Profile bio and privacy controls.
- Dashboard statistics calculated from saved interview and message data.

Google sign-in is provided through Clerk. Enable Google as a sign-in method in the Replit Auth pane before expecting the Google button to appear. Authentication is only for ConnectAI accounts; the app does not access Gmail.

## Project structure

```text
artifacts/connectai/       React + Vite frontend
artifacts/api-server/      Express API, Clerk middleware, AI and chat endpoints
lib/api-spec/              OpenAPI source contract
lib/api-client-react/      Generated React Query hooks
lib/api-zod/               Generated request/response validation
lib/db/src/schema/         PostgreSQL and Drizzle schema
```

## Run in Replit

1. Install workspace packages with `pnpm install`.
2. Provision the app's PostgreSQL database through Replit.
3. Start the `artifacts/api-server: API Server` and `artifacts/connectai: web` workflows. The workflows provide the ports and base paths automatically.
4. Apply the development schema with `pnpm --filter @workspace/db run push`.
5. Check the project with `pnpm run typecheck`.

For changes to the API, edit `lib/api-spec/openapi.yaml` first, then regenerate the API helpers:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## External configuration

### Authentication and Google sign-in

Clerk is provisioned for this Replit app. Use the Replit Auth pane to enable Google SSO. Development and published environments use separate Clerk user stores. Do not add local passwords or copy Google passwords into ConnectAI.

### Gemini AI

The API server reads `GEMINI_API_KEY` from Replit Secrets. The key is server-only and must never be added to frontend code or committed to the repository. The AI endpoints return an explicit error when the provider is unavailable; they do not substitute canned questions or scores.

### Database

The app uses the Replit PostgreSQL database already configured for this project, rather than a separate MongoDB Atlas service. Drizzle schema changes go in `lib/db/src/schema/`; apply development changes with the push command above.

## Environment example

`.env.example` contains placeholder names only. In Replit, Clerk values and `DATABASE_URL` are managed by the platform. Add the Gemini key through Replit Secrets, not by editing a committed `.env` file.

## Scope still to add

The first release does not yet include chat-request approval workflows, blocking/reporting, message editing, voice transcription, or account-wide data deletion. Online status is based on recent authenticated activity and the user's visibility setting. AI scores are estimates based on written responses and are not a measure of personality, confidence, or employability.
