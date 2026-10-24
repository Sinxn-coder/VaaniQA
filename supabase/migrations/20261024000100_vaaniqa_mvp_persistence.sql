-- Private, server-only VaaniQA MVP data. The browser Data API receives no grants.
create schema if not exists vaaniqa;
revoke all on schema vaaniqa from public;
revoke all on schema vaaniqa from anon, authenticated, service_role;
grant usage, create on schema vaaniqa to postgres;

create table if not exists vaaniqa.agent_configurations (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists vaaniqa.scenario_libraries (
  id text primary key,
  agent_configuration_id text not null references vaaniqa.agent_configurations(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create table if not exists vaaniqa.scenarios (
  id text primary key,
  library_id text not null references vaaniqa.scenario_libraries(id) on delete cascade,
  category text not null,
  provenance text not null check (provenance in ('AI-generated', 'Human-authored')),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists vaaniqa.evaluation_results (
  id uuid primary key,
  mode text not null check (mode in ('DEMO', 'LIVE')),
  model text,
  language text not null,
  locale text not null check (locale in ('ml-IN', 'ta-IN')),
  overall_score smallint not null check (overall_score between 0 and 100),
  findings jsonb not null,
  review_status text not null default 'not-reviewed'
    check (review_status in ('not-reviewed', 'pending-native-review', 'reviewed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vaaniqa.evaluation_reviews (
  id uuid primary key,
  evaluation_id uuid not null references vaaniqa.evaluation_results(id) on delete cascade,
  naturalness_rating smallint not null check (naturalness_rating between 1 and 5),
  notes text not null default '',
  reviewer_expertise_verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists vaaniqa.dataset_records (
  id text primary key,
  provenance text not null check (provenance in (
    'authentic-human-conversation', 'human-authored-reference', 'ai-generated-synthetic'
  )),
  collection text not null check (collection in ('pending-review', 'approved', 'synthetic', 'rejected')),
  locale text not null check (locale = 'ml-IN'),
  scenario_category text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((provenance = 'ai-generated-synthetic' and collection = 'synthetic') or
    (provenance <> 'ai-generated-synthetic' and collection <> 'synthetic')),
  check (collection <> 'approved' or (
    provenance <> 'ai-generated-synthetic' and
    payload->>'usageRights' = 'authorized' and
    payload->>'licenseStatus' <> 'unknown' and
    length(trim(coalesce(payload->>'authorizationEvidence', ''))) > 0 and
    payload->>'reviewStatus' = 'reviewed' and
    (provenance <> 'authentic-human-conversation' or payload->>'consentStatus' = 'consented') and
    (provenance <> 'human-authored-reference' or payload->>'consentStatus' = 'authorization-documented')
  ))
);

create table if not exists vaaniqa.dataset_review_annotations (
  id text primary key,
  dataset_record_id text not null references vaaniqa.dataset_records(id) on delete cascade,
  naturalness text not null,
  contextual_fit text not null,
  dialect_register text not null default '',
  correction text not null default '',
  explanation text not null,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  reviewer_claims_native_fluency boolean not null default false,
  created_at timestamptz not null default now(),
  payload jsonb not null
);

create index if not exists scenarios_library_idx on vaaniqa.scenarios(library_id);
create index if not exists dataset_collection_category_idx on vaaniqa.dataset_records(collection, scenario_category);
create index if not exists dataset_review_parent_idx on vaaniqa.dataset_review_annotations(dataset_record_id, created_at);
create index if not exists evaluation_review_status_idx on vaaniqa.evaluation_results(review_status, created_at desc);

-- RLS is enabled even though these tables are in a private schema. No Data API role
-- receives schema or table privileges and there are deliberately no allow policies.
alter table vaaniqa.agent_configurations enable row level security;
alter table vaaniqa.scenario_libraries enable row level security;
alter table vaaniqa.scenarios enable row level security;
alter table vaaniqa.evaluation_results enable row level security;
alter table vaaniqa.evaluation_reviews enable row level security;
alter table vaaniqa.dataset_records enable row level security;
alter table vaaniqa.dataset_review_annotations enable row level security;

revoke all on all tables in schema vaaniqa from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema vaaniqa
  revoke all on tables from public, anon, authenticated, service_role;
