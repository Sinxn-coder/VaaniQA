# Integration seams

The demo evaluator remains local and explicitly labeled. Live OpenAI text evaluation is served by `POST /api/evaluations` through the official OpenAI SDK on the Node server. `OPENAI_API_KEY` and `OPENAI_MODEL` are server environment variables; no credentials enter browser bundles. The request uses `store: false`, and VaaniQA does not persist request content.

Optional Supabase persistence uses the server-only `DATABASE_URL` with `pg`; no Supabase client or database credential is included in the browser bundle. Apply the versioned migration under `supabase/migrations/` before configuring the shared-pooler URL. Without that URL, the app remains on its browser-local repositories. Database access is local-development only and has no authentication; do not expose the server to a network. See the root README for setup and limitations.

No voice-provider modification or native-speaker validation is performed by these integrations.
