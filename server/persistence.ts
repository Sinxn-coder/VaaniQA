import { Pool, type PoolConfig } from 'pg'
import { z } from 'zod'

export type PersistencePool = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
  end?: () => Promise<void>
}

export type WorkspaceSnapshot = {
  configuration: unknown | null
  scenarios: unknown[]
  datasetRecords: unknown[]
  evaluations: Record<string, unknown>[]
}

export interface PersistenceStore {
  loadWorkspace(): Promise<WorkspaceSnapshot>
  saveWorkspace(configuration: unknown, scenarios: unknown[]): Promise<void>
  saveDataset(records: unknown[]): Promise<void>
  saveEvaluation(value: z.infer<typeof evaluationSummarySchema>): Promise<void>
  updateEvaluationStatus(id: string, status: 'pending-native-review' | 'reviewed'): Promise<void>
  addEvaluationReview(value: z.infer<typeof evaluationReviewSchema>): Promise<void>
  close?(): Promise<void>
}

const evaluationSummarySchema = z.object({
  id: z.string().uuid(), mode: z.enum(['DEMO', 'LIVE']), model: z.string().max(120).nullable(), language: z.string().max(40), locale: z.enum(['ml-IN', 'ta-IN']),
  overallScore: z.number().int().min(0).max(100), findings: z.array(z.object({ dimension: z.enum(['Language naturalness', 'Contextual judgment', 'Vocal delivery']), score: z.number().int().min(0).max(100).nullable(), status: z.enum(['Needs work', 'Needs review', 'Strong', 'Not evaluated']) }).strict()).max(3),
}).strict()
const evaluationReviewSchema = z.object({
  id: z.string().uuid(), evaluationId: z.string().uuid(), naturalnessRating: z.number().int().min(1).max(5), notes: z.string().max(2000),
}).strict()
const datasetAnnotationSchema = z.object({
  id: z.string().min(1).max(160), naturalness: z.enum(['natural', 'minor-correction', 'needs-revision', 'cannot-assess']), contextualFit: z.enum(['fits', 'partially-fits', 'does-not-fit', 'cannot-assess']), dialectRegister: z.string().max(400), correction: z.string().max(4000), explanation: z.string().min(1).max(3000), confidence: z.enum(['low', 'medium', 'high']), reviewerClaimsNativeFluency: z.boolean(), createdAt: z.string().min(1),
}).strict()
const datasetRecordBaseSchema = z.object({
  id: z.string().min(1).max(160), provenance: z.enum(['authentic-human-conversation', 'human-authored-reference', 'ai-generated-synthetic']), collection: z.enum(['pending-review', 'approved', 'synthetic', 'rejected']),
  sourceType: z.enum(['human-conversation', 'voice-agent-transcript', 'human-authored-example', 'ai-generated-synthetic']).default('human-conversation'), voiceAgentOriginVerified: z.boolean().default(false), originVerificationEvidence: z.string().max(500).default(''),
  sourceDescription: z.string().min(1).max(500), usageRights: z.enum(['unknown', 'authorized', 'unauthorized']), licenseStatus: z.enum(['unknown', 'identified', 'not-applicable']), licenseName: z.string().max(300), authorizationEvidence: z.string().max(500),
  consentStatus: z.enum(['unknown', 'consented', 'authorization-documented', 'not-consented']), language: z.literal('Malayalam'), locale: z.literal('ml-IN'), codeSwitchingPresent: z.boolean(), dialectRegister: z.string().max(400), scenarioCategory: z.string().min(1).max(100),
  transcript: z.string().min(1).max(30000), speakerTurns: z.array(z.object({ speaker: z.string().trim().min(1).max(80), text: z.string().min(1).max(4000) }).strict()).max(200).default([]), expectedBehavior: z.string().max(8000).default(''),
  audioReference: z.string().max(1000), reviewStatus: z.enum(['unreviewed', 'reviewed', 'rejected']), reviews: z.array(datasetAnnotationSchema).max(500), createdAt: z.string().min(1),
}).strict().superRefine((record, ctx) => {
  if (record.licenseStatus === 'identified' && !record.licenseName.trim()) ctx.addIssue({ code: 'custom', path: ['licenseName'], message: 'An identified license must be named.' })
  const expectedProvenance = record.sourceType === 'human-authored-example' ? 'human-authored-reference' : record.sourceType === 'ai-generated-synthetic' ? 'ai-generated-synthetic' : 'authentic-human-conversation'
  if (record.provenance !== expectedProvenance) ctx.addIssue({ code: 'custom', path: ['provenance'], message: 'Source type and provenance must agree.' })
  if (record.sourceType === 'voice-agent-transcript' && (!record.voiceAgentOriginVerified || !record.originVerificationEvidence.trim())) ctx.addIssue({ code: 'custom', path: ['originVerificationEvidence'], message: 'Voice-agent origin requires importer verification and source evidence.' })
  if (record.sourceType !== 'voice-agent-transcript' && record.voiceAgentOriginVerified) ctx.addIssue({ code: 'custom', path: ['voiceAgentOriginVerified'], message: 'Voice-agent verification applies only to voice-agent transcripts.' })
  if (record.sourceType === 'ai-generated-synthetic' && record.collection !== 'synthetic') ctx.addIssue({ code: 'custom', path: ['collection'], message: 'Synthetic content must remain separate.' })
  if (record.sourceType !== 'ai-generated-synthetic' && record.collection === 'synthetic') ctx.addIssue({ code: 'custom', path: ['collection'], message: 'Only synthetic content may enter the synthetic collection.' })
  if (record.collection === 'approved') {
    if (record.sourceType === 'ai-generated-synthetic' || record.usageRights !== 'authorized' || record.licenseStatus === 'unknown' || !record.authorizationEvidence.trim() || record.reviewStatus !== 'reviewed' || record.reviews.length === 0) ctx.addIssue({ code: 'custom', path: ['collection'], message: 'Approved examples require documented rights and human review.' })
    if ((record.sourceType === 'human-conversation' || record.sourceType === 'voice-agent-transcript') && record.consentStatus !== 'consented') ctx.addIssue({ code: 'custom', path: ['consentStatus'], message: 'Human conversations require documented consent.' })
    if (record.sourceType === 'human-authored-example' && record.consentStatus !== 'authorization-documented') ctx.addIssue({ code: 'custom', path: ['consentStatus'], message: 'Human-authored examples require reuse authorization.' })
  }
  const sensitiveText = [record.transcript, record.expectedBehavior, ...record.speakerTurns.map(turn => `${turn.speaker}: ${turn.text}`)].join('\n')
  if (/\b(?:DOB|date of birth|MRN|medical record number|patient ID|phone number|email address)\s*[:#-]/i.test(sensitiveText) || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(sensitiveText) || /\b\d[\d\s().-]{8,}\d\b/.test(sensitiveText)) ctx.addIssue({ code: 'custom', path: ['transcript'], message: 'Remove obvious patient identifiers before saving.' })
})
const datasetRecordSchema = z.preprocess(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  const inferred = record.provenance === 'human-authored-reference' ? 'human-authored-example' : record.provenance === 'ai-generated-synthetic' ? 'ai-generated-synthetic' : 'human-conversation'
  return { ...record, sourceType: record.sourceType ?? inferred }
}, datasetRecordBaseSchema)
const datasetRecordsSchema = z.array(datasetRecordSchema).max(500)

export function createPostgresPersistenceStore(pool: PersistencePool): PersistenceStore {
  return {
    async loadWorkspace() {
      const [config, scenarios, records, annotations, evaluations] = await Promise.all([
        pool.query('select payload from vaaniqa.agent_configurations where id = $1', ['default']),
        pool.query('select payload from vaaniqa.scenarios order by id'),
        pool.query('select id, payload from vaaniqa.dataset_records order by created_at desc'),
        pool.query('select dataset_record_id, payload from vaaniqa.dataset_review_annotations order by created_at'),
        pool.query('select id, mode, model, language, locale, overall_score, findings, review_status, created_at from vaaniqa.evaluation_results order by created_at desc limit 100'),
      ])
      const reviewMap = new Map<string, unknown[]>()
      for (const item of annotations.rows) {
        const key = String(item.dataset_record_id)
        reviewMap.set(key, [...(reviewMap.get(key) ?? []), item.payload])
      }
      const datasetRecords = records.rows.map(row => {
        const record = row.payload as Record<string, unknown>
        return { ...record, reviews: reviewMap.get(String(row.id)) ?? [] }
      })
      return { configuration: config.rows[0]?.payload ?? null, scenarios: scenarios.rows.map(row => row.payload), datasetRecords, evaluations: evaluations.rows }
    },
    async saveWorkspace(configuration, scenarios) {
      await pool.query('insert into vaaniqa.agent_configurations (id, payload) values ($1, $2::jsonb) on conflict (id) do update set payload = excluded.payload, updated_at = now()', ['default', JSON.stringify(configuration)])
      await pool.query('insert into vaaniqa.scenario_libraries (id, agent_configuration_id) values ($1, $2) on conflict (id) do update set updated_at = now()', ['default', 'default'])
      const keep = scenarios.map(value => String((value as { id?: unknown }).id)).filter(Boolean)
      if (keep.length) await pool.query('delete from vaaniqa.scenarios where library_id = $1 and not (id = any($2::text[]))', ['default', keep])
      else await pool.query('delete from vaaniqa.scenarios where library_id = $1', ['default'])
      for (const scenario of scenarios) {
        const value = scenario as { id: string; category: string; provenance: string }
        await pool.query('insert into vaaniqa.scenarios (id, library_id, category, provenance, payload) values ($1,$2,$3,$4,$5::jsonb) on conflict (id) do update set category=excluded.category, provenance=excluded.provenance, payload=excluded.payload, updated_at=now()', [value.id, 'default', value.category, value.provenance, JSON.stringify(scenario)])
      }
    },
    async saveDataset(input) {
      const records = datasetRecordsSchema.parse(input)
      for (const raw of records) {
        const record = raw as unknown as Record<string, unknown>
        const reviews = record.reviews as Record<string, unknown>[]
        const payload = { ...record, reviews: undefined }
        await pool.query('insert into vaaniqa.dataset_records (id, provenance, collection, locale, scenario_category, payload) values ($1,$2,$3,$4,$5,$6::jsonb) on conflict (id) do update set provenance=excluded.provenance, collection=excluded.collection, locale=excluded.locale, scenario_category=excluded.scenario_category, payload=excluded.payload, updated_at=now()', [record.id, record.provenance, record.collection, record.locale, record.scenarioCategory, JSON.stringify(payload)])
        for (const reviewRaw of reviews) {
          const review = reviewRaw as Record<string, unknown>
          await pool.query('insert into vaaniqa.dataset_review_annotations (id,dataset_record_id,naturalness,contextual_fit,dialect_register,correction,explanation,confidence,reviewer_claims_native_fluency,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) on conflict (id) do nothing', [review.id, record.id, review.naturalness, review.contextualFit, review.dialectRegister, review.correction, review.explanation, review.confidence, review.reviewerClaimsNativeFluency, JSON.stringify(review)])
        }
      }
    },
    async saveEvaluation(input) {
      const value = evaluationSummarySchema.parse(input)
      await pool.query('insert into vaaniqa.evaluation_results (id,mode,model,language,locale,overall_score,findings) values ($1,$2,$3,$4,$5,$6,$7::jsonb) on conflict (id) do update set mode=excluded.mode,model=excluded.model,language=excluded.language,locale=excluded.locale,overall_score=excluded.overall_score,findings=excluded.findings,updated_at=now()', [value.id, value.mode, value.model, value.language, value.locale, value.overallScore, JSON.stringify(value.findings)])
    },
    async updateEvaluationStatus(id, status) {
      await pool.query('update vaaniqa.evaluation_results set review_status=$2,updated_at=now() where id=$1', [id, status])
    },
    async addEvaluationReview(input) {
      const value = evaluationReviewSchema.parse(input)
      await pool.query('insert into vaaniqa.evaluation_reviews (id,evaluation_id,naturalness_rating,notes,reviewer_expertise_verified) values ($1,$2,$3,$4,false)', [value.id, value.evaluationId, value.naturalnessRating, value.notes])
      await this.updateEvaluationStatus(value.evaluationId, 'reviewed')
    },
    async close() { await pool.end?.() },
  }
}

export function databaseUrlConfiguration(value: string | undefined): { configured: boolean; reason?: string } {
  if (!value?.trim()) return { configured: false }
  try {
    const url = new URL(value)
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return { configured: false, reason: 'invalid' }
    if (!url.hostname.includes('pooler.supabase.com')) return { configured: false, reason: 'not_shared_pooler' }
    if (!['5432', '6543'].includes(url.port)) return { configured: false, reason: 'unsupported_port' }
    if (url.searchParams.get('sslmode') !== 'require') return { configured: false, reason: 'ssl_required' }
    return { configured: true }
  } catch { return { configured: false, reason: 'invalid' } }
}

export function createConfiguredPersistenceStore(env = process.env, PoolCtor: new (config: PoolConfig) => PersistencePool = Pool): PersistenceStore | undefined {
  const check = databaseUrlConfiguration(env.DATABASE_URL)
  if (!check.configured) return undefined
  const connectionUrl = new URL(env.DATABASE_URL!)
  // pg-connection-string currently treats sslmode=require as verify-full unless
  // libpq compatibility is enabled. Supabase documents require as TLS without CA
  // validation, so preserve that documented behavior instead of silently failing.
  connectionUrl.searchParams.set('uselibpqcompat', 'true')
  return createPostgresPersistenceStore(new PoolCtor({ connectionString: connectionUrl.toString(), max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000, application_name: 'VaaniQA-local-MVP' }))
}

export function isLocalPersistenceRequest(remoteAddress = '', origin: string | undefined, host: string | undefined): boolean {
  const loopback = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1'
  if (!loopback) return false
  if (!origin) return true
  try { return new URL(origin).host === host && ['http:', 'https:'].includes(new URL(origin).protocol) } catch { return false }
}

export const persistenceSchemas = { evaluationSummarySchema, evaluationReviewSchema, datasetRecordsSchema }
