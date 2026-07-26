# Ziren auth and assistant gateway

This service owns user sessions, desktop access tokens, and the public gateway
to the private Ziren AI service. Browser and desktop clients must call
`/api/assistant/*` here instead of calling the AI service directly.

It also owns the shared Ziren profile used by the website and desktop app:

- avatar, status and bio;
- real command statistics and derived achievements;
- opt-in public profiles and community ticker;
- explicit consent flags for activity tracking and future AI context.

Public profile and community visibility are disabled by default. Activity
events are ignored unless the user explicitly enables activity tracking.

## Required production configuration

Copy `.env.example` into the platform configuration and set real values for:

- `DATABASE_URL`
- `SESSION_SECRET`
- `AI_SERVICE_URL`
- `AI_INTERNAL_TOKEN`
- Cloudinary credentials when avatar uploads are enabled

`AI_INTERNAL_TOKEN` must be a long random value and must exactly match the
value configured in `ziren-ai-service`. It must never be included in desktop or
web client code. One way to generate it is:

```bash
openssl rand -hex 32
```

Set `CORS_ALLOWED_ORIGINS` to the production website and the Tauri origins that
are actually used by the desktop application. Do not use `*`.

## Deployment order

1. Configure the same `AI_INTERNAL_TOKEN` in both backend services.
2. Deploy this service with `AI_SERVICE_URL` pointing to the currently running
   AI service. The old AI service safely ignores the additional internal header.
3. Deploy `ziren-ai-service` and verify that `/health` returns `status: ok`.
4. Verify web login, desktop login, `/api/desktop/me`, assistant chat, and
   desktop logout.

Deploying the gateway first avoids an outage: once the new AI service starts,
it immediately rejects requests that do not carry the internal token.

The AI service intentionally rejects every non-health request that does not
carry the internal token. The gateway derives the user ID from the verified web
session or desktop bearer token and never trusts a client-supplied user ID.

## Profile and activity endpoints

- `GET /api/community/members` returns only real users who enabled community
  visibility. It never returns email addresses.
- `GET /community/:id` returns a public profile only when that user enabled it.
- `GET /api/desktop/me` returns the shared profile, real statistics,
  achievements, and consent settings.
- `POST /api/desktop/activity` accepts a small allowlist of structured events
  and stores them only when activity tracking is enabled. It records feature
  IDs instead of raw recognized speech.

The `ai_context_enabled` preference only marks whether stored safe events may be
used in a future Melissa context bridge. This service does not send those
events to the AI service yet.

## Melissa story endpoints

- `GET /api/assistant/story` returns the authenticated user's current season,
  prologue step, relationship state and spoiler-safe Chronicle nodes.
- `POST /api/assistant/story/choices` records the next available prologue
  choice. Choices are ordered and cannot be silently overwritten.
- Story state is stored in `melissa_story_states`; the append-only choice log is
  stored in `melissa_story_events`.
- The assistant gateway builds a compact story context and sends it to the AI
  service with chat requests. The full story bible is never sent per message.

## Local checks

```bash
npm test
node --check server.js
npm audit --omit=dev
```
