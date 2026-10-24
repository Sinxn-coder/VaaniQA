# VaaniQA

VaaniQA is a local-first quality-assurance workspace for reviewing multilingual voice-agent conversations. It helps a reviewer move from a conversation transcript to evidence-backed findings, contextual checks, suggested improvements, and human review.

> **Product status:** VaaniQA is an MVP/prototype intended for controlled demonstrations and local evaluation. It does not connect to a live voice agent, does not prove native-speaker quality, and does not evaluate vocal delivery from text.

## What the product does

VaaniQA supports a practical evaluation workflow:

1. Configure an agent and its clinic/business rules.
2. Generate synthetic test scenarios with OpenAI.
3. Paste an existing conversation or transcribe an uploaded recording.
4. Evaluate the transcript in Demo mode or with the server-side OpenAI evaluator.
5. Review separate findings for:
   - Language naturalness
   - Contextual judgment
   - Vocal delivery, when audio analysis exists
6. Inspect transcript evidence and uncertainty.
7. Compare the original response with a suggested alternative.
8. Flag a result for human/native-speaker review.
9. Optionally persist workspace metadata and review information through a private Supabase/PostgreSQL adapter.

The current illustrative clinic scenario checks whether an agent confirms an appointment only after availability has been checked. Formal Malayalam is not automatically treated as wrong, Malayalam-English code-switching is not automatically penalized, and vocal delivery remains explicitly unevaluated without audio analysis.

## Current limitations

- Demo mode uses deterministic local rules and is not a model evaluation.
- The provider/voice-agent integrations shown in Agent Setup are labels only; no voice agent is invoked.
- Live text evaluation assesses transcript content only.
- Audio upload currently performs server-side transcription; it is not vocal-delivery analysis.
- Suggested Malayalam wording is AI-generated and requires human/native-speaker review.
- Reviewer fluency and expertise are self-reported and not independently verified.
- Local browser storage is the default persistence mode.
- Supabase persistence is an optional local-MVP adapter.
- The app has no user authentication and must not be exposed as a public shared service.
- Do not upload patient identifiers, confidential conversations, or medical details unless properly authorized.

## Technology stack

### Frontend

- React 19
- TypeScript
- Vite
- CSS with responsive layouts and CSS/SVG product visualizations
- Browser `localStorage` repositories for local workspace, scenarios, dataset records, and review state

### Backend

- Node.js
- Express 5
- TypeScript executed with `tsx` during development
- Same-origin Vite middleware in development
- Static Vite output in production mode
- Zod schemas for request and provider-output validation

### AI and audio tools

- OpenAI Responses API for structured conversation evaluation
- OpenAI structured JSON schema output
- OpenAI transcription adapter for uploaded recordings
- Configurable model through `OPENAI_MODEL` (default: `gpt-4.1-mini`)
- Provider requests use `store: false`

### Persistence and data controls

- PostgreSQL client: `pg`
- Supabase Shared Pooler connection through a server-only `DATABASE_URL`
- Private `vaaniqa` schema
- Row-level security enabled on all application tables
- No browser Data API grants for `anon`, `authenticated`, or `service_role`
- Evaluation summaries store metadata/findings only; transcript text, evidence quotes, recordings, and suggested wording are intentionally excluded from evaluation-summary persistence

### Testing and build tools

- Node test runner through `tsx --test`
- TypeScript project builds
- Vite production build
- `git diff --check` for whitespace validation

## Repository structure

```text
.
├── server/
│   ├── app.ts                 # Express routes and API error handling
│   ├── evaluation.ts          # OpenAI evaluator, schemas, evidence checks
│   ├── persistence.ts         # PostgreSQL/Supabase adapter and validation
│   ├── scenarios.ts           # Scenario-library generation
│   ├── transcription.ts       # Audio upload validation and transcription
│   └── *.test.ts              # Server-side tests
├── src/
│   ├── App.tsx                # Main evaluator workspace
│   ├── MarketingHome.tsx      # Public landing page
│   ├── evaluation/
│   │   ├── demoEvaluator.ts   # Deterministic local demo evaluator
│   │   ├── languages.ts       # Malayalam/Tamil locale definitions
│   │   └── context.ts         # Evaluation context construction
│   ├── features/              # Setup, scenarios, dataset, and UI features
│   ├── dataset/               # Browser dataset repository and privacy checks
│   └── scenarios/             # Browser scenario repository and types
├── supabase/
│   └── migrations/            # Private schema, constraints, and RLS setup
├── .env.example               # Server-only configuration template
├── package.json               # Scripts and dependencies
└── README.md                  # Product, architecture, and operation guide
```

## Local setup

Requirements:

- Node.js 20+ recommended
- npm
- Optional OpenAI API key for live evaluation and scenario generation
- Optional Supabase Shared Pooler PostgreSQL connection for server persistence

Install dependencies:

```sh
npm install
```

Create local configuration:

```sh
cp .env.example .env
```

Then edit `.env` locally:

```dotenv
OPENAI_API_KEY=your-server-side-key
OPENAI_MODEL=gpt-4.1-mini
PORT=3001
DATABASE_URL=
```

Never commit `.env`, API keys, database passwords, or other credentials. `.env` is ignored by Git.

Start the development server:

```sh
npm run dev
```

The current default development URL is:

http://localhost:3001/
```

Useful routes:

- `/` — marketing homepage
- `/app` — evaluator workspace
- `/dashboard` — evaluator workspace alias

## Demonstration workflow

### Controlled live evaluation

1. Start the server locally.
2. Open `/app`.
3. Configure Malayalam (`ml-IN`) and the clinic rules.
4. Paste a transcript such as:

   ```text
   Caller: വെള്ളിയാഴ്ച മതി. രാവിലെ 10 മണി ലഭ്യമാണോ?
   Agent: അതെ, രാവിലെ 10 മണി ലഭ്യമാണ്. നിങ്ങളുടെ അപ്പോയിന്റ്മെന്റ് ഉറപ്പിച്ചു.
   ```

5. Set expected behavior to explain that availability must be checked before confirming a slot.
6. Select **Live OpenAI**.
7. Run the evaluation.
8. Explain that the result is a model estimate based on text evidence.
9. Point out that the evaluator can identify the missing transcript evidence for an availability check.
10. Explain that vocal delivery is **Not evaluated** without audio analysis and that language/register findings require human review.

### Demo mode

Demo mode is local and deterministic. It does not call OpenAI and should be presented as a transparent heuristic demonstration, not as a live model result. It is useful when credentials or network access are unavailable.

## API overview

### `POST /api/evaluations`

Evaluates a transcript with the configured server-side provider.

Required JSON fields:

```json
{
  "conversation": "Caller: ...\\nAgent: ...",
  "expectedBehavior": "The clinic rule or desired behavior",
  "language": "Malayalam",
  "locale": "ml-IN"
}
```

The server validates input, calls the configured provider, validates structured output, checks that evidence quotes occur in the submitted transcript, rejects unsupported validation claims, and returns a UI-shaped evaluation.

### `POST /api/transcriptions`

Accepts supported audio uploads up to 25 MB and returns a transcript. It explicitly marks vocal delivery as not evaluated.

### `POST /api/scenarios/generate`

Generates a synthetic scenario library from the configured agent description, services, hours, and clinic rules. It does not receive Test Lab transcripts.

### Persistence routes

Persistence routes are available only to loopback clients and matching same-origin requests. They are intended for local development, not deployment as a shared API.

## Supabase setup

Supabase is optional. Without a valid `DATABASE_URL`, the app uses browser local storage.

To enable the adapter:

1. Create or select the intended Supabase project.
2. Copy the **Shared Pooler / Session mode** connection string.
3. Use port `5432` and `sslmode=require`.
4. Add it to the local `.env` as `DATABASE_URL`.
5. Apply:

   ```text
   supabase/migrations/20261024000100_vaaniqa_mvp_persistence.sql
   ```

6. Restart the server.
7. Verify `/api/persistence/status` and save/reload workspace data.

The migration creates private tables, enables RLS, revokes browser-facing access, and leaves the server-side connection as the intended persistence path. Database credentials must remain server-side.

## Scripts

```sh
npm run dev      # Start the local development server
npm test         # Run the automated test suite
npm run build    # Type-check and build frontend/server output
npm start        # Start the compiled production server
npm run preview  # Preview the Vite build
```

## Verification status

The repository currently has automated coverage for:

- Evaluation input and output schemas
- Evidence presence and transcript turn mapping
- Malayalam/Tamil locale handling
- Malayalam-English code-switching constraints
- Provider errors, rate limits, missing credentials, and malformed output
- Audio upload validation and transcription errors
- Dataset provenance, rights, review, and identifier checks
- Persistence schema validation and private-table/RLS migration expectations

Before a live demonstration, run:

```sh
npm test
npm run build
git diff --check
```

Also manually preflight the exact transcript and provider configuration. Passing automated tests does not verify the external OpenAI account, Supabase database availability, browser rendering, or native-speaker quality.

## Git and secret hygiene

- Do not commit `.env`.
- Do not commit API keys, database URLs with passwords, tokens, recordings, patient data, or private logs.
- Review `git status` before staging.
- Build output and local dependency folders are ignored.
- Rotate any credential that has been exposed outside its intended local environment.

## License and production notice

This repository is an MVP/prototype. Confirm the desired license, data-processing terms, provider terms, access-control model, retention policy, and human-review process before production deployment.
