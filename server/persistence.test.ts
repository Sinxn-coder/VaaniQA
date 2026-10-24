import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createConfiguredPersistenceStore, createPostgresPersistenceStore, databaseUrlConfiguration, isLocalPersistenceRequest, persistenceSchemas, type PersistencePool } from './persistence.js'
import type { PoolConfig } from 'pg'

test('DATABASE_URL accepts only TLS Supabase shared-pooler URLs and never returns credentials', () => {
  const result = databaseUrlConfiguration('postgresql://postgres.project:do-not-print@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require')
  assert.deepEqual(result, { configured: true })
  assert.deepEqual(databaseUrlConfiguration(undefined), { configured: false })
  assert.deepEqual(databaseUrlConfiguration('postgresql://user:secret@db.example.com:5432/postgres?sslmode=require'), { configured: false, reason: 'not_shared_pooler' })
  assert.deepEqual(databaseUrlConfiguration('postgres://x:y@aws-0.pooler.supabase.com:5432/postgres'), { configured: false, reason: 'ssl_required' })
})

test('configured pg pool preserves Supabase sslmode=require semantics', () => {
  let captured = ''
  class CapturingPool implements PersistencePool {
    constructor(config: PoolConfig) { captured = String(config.connectionString) }
    async query() { return { rows: [] } }
  }
  const store = createConfiguredPersistenceStore({ DATABASE_URL: 'postgresql://postgres.projectref:sample-secret@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=require' }, CapturingPool)
  assert.ok(store)
  const connection = new URL(captured)
  assert.equal(connection.searchParams.get('sslmode'), 'require')
  assert.equal(connection.searchParams.get('uselibpqcompat'), 'true')
  assert.equal(connection.password, 'sample-secret')
})

test('local persistence boundary rejects non-loopback callers and mismatched origins', () => {
  assert.equal(isLocalPersistenceRequest('127.0.0.1', 'http://localhost:3000', 'localhost:3000'), true)
  assert.equal(isLocalPersistenceRequest('::1', undefined, 'localhost:3000'), true)
  assert.equal(isLocalPersistenceRequest('10.0.0.2', undefined, 'localhost:3000'), false)
  assert.equal(isLocalPersistenceRequest('127.0.0.1', 'https://other.example', 'localhost:3000'), false)
})

test('evaluation persistence schema accepts summary metadata and rejects transcript-bearing payloads', () => {
  const summary = { id: '25d5dddf-006f-4e9c-a2df-3f3199c60c2e', mode: 'DEMO', model: null, language: 'Malayalam', locale: 'ml-IN', overallScore: 78, findings: [{ dimension: 'Language naturalness', score: 70, status: 'Needs review' }] }
  assert.equal(persistenceSchemas.evaluationSummarySchema.safeParse(summary).success, true)
  assert.equal(persistenceSchemas.evaluationSummarySchema.safeParse({ ...summary, transcript: 'sensitive text' }).success, false)
  assert.equal(persistenceSchemas.evaluationSummarySchema.safeParse({ ...summary, overallScore: 101 }).success, false)
})

test('store uses parameterized SQL and persists metadata, review status, and disagreement annotations separately', async () => {
  const calls: { sql: string; values?: unknown[] }[] = []
  const pool: PersistencePool = { async query(sql, values) { calls.push({ sql, values }); return { rows: [] } } }
  const store = createPostgresPersistenceStore(pool)
  await store.saveWorkspace({ name: 'Demo', locale: 'ml-IN' }, [{ id: 'case-1', category: 'code-switching', provenance: 'AI-generated' }])
  await store.saveDataset([{ id: 'record-1', provenance: 'authentic-human-conversation', sourceType: 'voice-agent-transcript', voiceAgentOriginVerified: true, originVerificationEvidence: 'Importer-supplied export reference', collection: 'pending-review', sourceDescription: 'Demo reference', usageRights: 'unknown', licenseStatus: 'unknown', licenseName: '', authorizationEvidence: '', consentStatus: 'unknown', language: 'Malayalam', locale: 'ml-IN', codeSwitchingPresent: true, dialectRegister: '', scenarioCategory: 'code-switching', transcript: 'Caller: sample text\nAgent: sample reply', speakerTurns: [{ speaker: 'Caller', text: 'sample text' }, { speaker: 'Agent', text: 'sample reply' }], expectedBehavior: 'Follow only the supplied clinic rules.', audioReference: '', reviewStatus: 'reviewed', createdAt: '2026-10-24', reviews: [
    { id: 'review-a', naturalness: 'natural', contextualFit: 'fits', dialectRegister: '', correction: '', explanation: 'Reviewer A', confidence: 'high', reviewerClaimsNativeFluency: false, createdAt: '2026-10-24' },
    { id: 'review-b', naturalness: 'minor-correction', contextualFit: 'fits', dialectRegister: 'regional variant', correction: 'alternate', explanation: 'Reviewer B', confidence: 'medium', reviewerClaimsNativeFluency: false, createdAt: '2026-10-24' },
  ] }])
  const summary = { id: '25d5dddf-006f-4e9c-a2df-3f3199c60c2e', mode: 'DEMO' as const, model: null, language: 'Malayalam', locale: 'ml-IN' as const, overallScore: 78, findings: [{ dimension: 'Language naturalness', score: 70, status: 'Needs review' }] }
  await store.saveEvaluation(summary)
  await store.updateEvaluationStatus(summary.id, 'pending-native-review')
  assert.equal(calls.some(call => call.sql.includes('dataset_review_annotations') && call.values?.[0] === 'review-a'), true)
  assert.equal(calls.some(call => call.sql.includes('dataset_review_annotations') && call.values?.[0] === 'review-b'), true)
  assert.equal(calls.some(call => call.sql.includes('update vaaniqa.evaluation_results') && call.values?.[1] === 'pending-native-review'), true)
  assert.ok(calls.every(call => call.sql.includes('$') || call.sql.startsWith('select')))
  const savedDatasetRecord = calls.find(call => call.sql.includes('insert into vaaniqa.dataset_records'))
  const savedDatasetPayload = JSON.parse(String(savedDatasetRecord?.values?.[5])) as Record<string, unknown>
  assert.equal(savedDatasetPayload.sourceType, 'voice-agent-transcript')
  assert.equal(savedDatasetPayload.transcript, 'Caller: sample text\nAgent: sample reply')
  assert.equal((savedDatasetPayload.speakerTurns as Array<{ speaker: string }>)[1].speaker, 'Agent')
  assert.equal(savedDatasetPayload.expectedBehavior, 'Follow only the supplied clinic rules.')
  const storedEvaluation = calls.find(call => call.sql.includes('insert into vaaniqa.evaluation_results'))
  assert.equal(JSON.stringify(storedEvaluation?.values).includes('sensitive transcript'), false)
})

test('dataset persistence keeps unknown rights pending and rejects unauthorized approved rows and obvious identifiers', () => {
  const record = { id: 'record-1', provenance: 'human-authored-reference', collection: 'pending-review', sourceDescription: 'Import', usageRights: 'unknown', licenseStatus: 'unknown', licenseName: '', authorizationEvidence: '', consentStatus: 'unknown', language: 'Malayalam', locale: 'ml-IN', codeSwitchingPresent: true, dialectRegister: '', scenarioCategory: 'code-switching', transcript: 'നമസ്കാരം, appointment വേണം.', audioReference: '', reviewStatus: 'unreviewed', reviews: [], createdAt: '2026-10-24' }
  assert.equal(persistenceSchemas.datasetRecordsSchema.safeParse([record]).success, true)
  assert.equal(persistenceSchemas.datasetRecordsSchema.safeParse([{ ...record, collection: 'approved' }]).success, false)
  assert.equal(persistenceSchemas.datasetRecordsSchema.safeParse([{ ...record, transcript: 'Patient ID: 123456789' }]).success, false)
  const importedVoiceTranscript = { ...record, provenance: 'authentic-human-conversation', sourceType: 'voice-agent-transcript', voiceAgentOriginVerified: true, originVerificationEvidence: 'Importer-supplied source export reference', speakerTurns: [{ speaker: 'Caller', text: 'Hello' }, { speaker: 'Agent', text: 'How can I help?' }], transcript: 'Caller: Hello\nAgent: How can I help?', expectedBehavior: 'Follow only the supplied clinic rules.' }
  assert.equal(persistenceSchemas.datasetRecordsSchema.safeParse([importedVoiceTranscript]).success, true)
  assert.equal(persistenceSchemas.datasetRecordsSchema.safeParse([{ ...importedVoiceTranscript, voiceAgentOriginVerified: false }]).success, false)
})

test('migration enables RLS on every private table and grants no Data API access', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261024000100_vaaniqa_mvp_persistence.sql', import.meta.url), 'utf8')
  const tables = ['agent_configurations', 'scenario_libraries', 'scenarios', 'evaluation_results', 'evaluation_reviews', 'dataset_records', 'dataset_review_annotations']
  for (const table of tables) assert.match(sql, new RegExp(`alter table vaaniqa\\.${table} enable row level security`, 'i'))
  assert.match(sql, /revoke all on all tables in schema vaaniqa from public, anon, authenticated, service_role/i)
  assert.match(sql, /revoke all on schema vaaniqa from anon, authenticated, service_role/i)
  assert.doesNotMatch(sql, /create policy/i)
})
