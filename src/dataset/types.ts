import { z } from 'zod'
import { SCENARIO_CATEGORIES, type ScenarioCategory } from '../scenarios/types'

export const DATASET_PROVENANCE = [
  { id: 'authentic-human-conversation', label: 'Authentic human conversation' },
  { id: 'human-authored-reference', label: 'Human-authored reference conversation' },
  { id: 'ai-generated-synthetic', label: 'AI-generated synthetic conversation' },
] as const

export const DATASET_SOURCE_TYPES = [
  { id: 'human-conversation', label: 'Authentic human conversation' },
  { id: 'voice-agent-transcript', label: 'Voice-agent transcript (source verified by importer)' },
  { id: 'human-authored-example', label: 'Human-authored example' },
  { id: 'ai-generated-synthetic', label: 'AI-generated synthetic conversation' },
] as const
export type DatasetSourceType = (typeof DATASET_SOURCE_TYPES)[number]['id']
export type DatasetTranscriptTurn = { speaker: string; text: string }

export type DatasetProvenance = (typeof DATASET_PROVENANCE)[number]['id']
export type DatasetCollection = 'pending-review' | 'approved' | 'synthetic' | 'rejected'
export type DatasetReview = {
  id: string
  naturalness: 'natural' | 'minor-correction' | 'needs-revision' | 'cannot-assess'
  contextualFit: 'fits' | 'partially-fits' | 'does-not-fit' | 'cannot-assess'
  dialectRegister: string
  correction: string
  explanation: string
  confidence: 'low' | 'medium' | 'high'
  reviewerClaimsNativeFluency: boolean
  createdAt: string
}

export type DatasetRecord = {
  id: string
  provenance: DatasetProvenance
  sourceType: DatasetSourceType
  voiceAgentOriginVerified: boolean
  originVerificationEvidence: string
  collection: DatasetCollection
  sourceDescription: string
  usageRights: 'unknown' | 'authorized' | 'unauthorized'
  licenseStatus: 'unknown' | 'identified' | 'not-applicable'
  licenseName: string
  authorizationEvidence: string
  consentStatus: 'unknown' | 'consented' | 'authorization-documented' | 'not-consented'
  language: 'Malayalam'
  locale: 'ml-IN'
  codeSwitchingPresent: boolean
  dialectRegister: string
  scenarioCategory: ScenarioCategory
  transcript: string
  speakerTurns: DatasetTranscriptTurn[]
  expectedBehavior: string
  audioReference: string
  reviewStatus: 'unreviewed' | 'reviewed' | 'rejected'
  reviews: DatasetReview[]
  createdAt: string
}

export const datasetReviewSchema: z.ZodType<DatasetReview> = z.object({
  id: z.string().min(1), naturalness: z.enum(['natural', 'minor-correction', 'needs-revision', 'cannot-assess']), contextualFit: z.enum(['fits', 'partially-fits', 'does-not-fit', 'cannot-assess']),
  dialectRegister: z.string().max(400), correction: z.string().max(4_000), explanation: z.string().min(1).max(3_000), confidence: z.enum(['low', 'medium', 'high']), reviewerClaimsNativeFluency: z.boolean(), createdAt: z.string().min(1),
}).strict()

const datasetRecordShape = z.object({
  id: z.string().min(1), provenance: z.enum(['authentic-human-conversation', 'human-authored-reference', 'ai-generated-synthetic']), collection: z.enum(['pending-review', 'approved', 'synthetic', 'rejected']),
  sourceType: z.enum(['human-conversation', 'voice-agent-transcript', 'human-authored-example', 'ai-generated-synthetic']).optional(),
  voiceAgentOriginVerified: z.boolean().optional(), originVerificationEvidence: z.string().max(500).optional(),
  sourceDescription: z.string().min(1).max(500), usageRights: z.enum(['unknown', 'authorized', 'unauthorized']), licenseStatus: z.enum(['unknown', 'identified', 'not-applicable']), licenseName: z.string().max(300), authorizationEvidence: z.string().max(500),
  consentStatus: z.enum(['unknown', 'consented', 'authorization-documented', 'not-consented']), language: z.literal('Malayalam'), locale: z.literal('ml-IN'), codeSwitchingPresent: z.boolean(), dialectRegister: z.string().max(400),
  scenarioCategory: z.enum(SCENARIO_CATEGORIES.map(item => item.id) as [ScenarioCategory, ...ScenarioCategory[]]), transcript: z.string().min(1).max(30_000),
  speakerTurns: z.array(z.object({ speaker: z.string().trim().min(1).max(80), text: z.string().min(1).max(4_000) }).strict()).max(200).optional(), expectedBehavior: z.string().max(8_000).optional(),
  audioReference: z.string().max(1_000), reviewStatus: z.enum(['unreviewed', 'reviewed', 'rejected']), reviews: z.array(datasetReviewSchema).max(500), createdAt: z.string().min(1),
}).strict().superRefine((record, ctx) => {
  const sourceType = record.sourceType ?? inferSourceType(record.provenance)
  const originVerified = record.voiceAgentOriginVerified ?? false
  const originEvidence = record.originVerificationEvidence ?? ''
  const speakerTurns = record.speakerTurns ?? []
  const expectedBehavior = record.expectedBehavior ?? ''
  if (record.licenseStatus === 'identified' && !record.licenseName.trim()) ctx.addIssue({ code: 'custom', path: ['licenseName'], message: 'An identified license must be named' })
  if (sourceType === 'ai-generated-synthetic' && record.collection !== 'synthetic') ctx.addIssue({ code: 'custom', path: ['collection'], message: 'Synthetic content must remain in its separate collection' })
  if (sourceType !== 'ai-generated-synthetic' && record.collection === 'synthetic') ctx.addIssue({ code: 'custom', path: ['collection'], message: 'Only synthetic content may enter the synthetic collection' })
  const expectedProvenance = sourceType === 'human-authored-example' ? 'human-authored-reference' : sourceType === 'ai-generated-synthetic' ? 'ai-generated-synthetic' : 'authentic-human-conversation'
  if (record.provenance !== expectedProvenance) ctx.addIssue({ code: 'custom', path: ['provenance'], message: 'Source type and provenance must agree' })
  if (sourceType === 'voice-agent-transcript' && (!originVerified || !originEvidence.trim())) ctx.addIssue({ code: 'custom', path: ['originVerificationEvidence'], message: 'Voice-agent origin requires importer verification and source evidence' })
  if (sourceType !== 'voice-agent-transcript' && originVerified) ctx.addIssue({ code: 'custom', path: ['voiceAgentOriginVerified'], message: 'Voice-agent origin verification only applies to voice-agent transcripts' })
  if (record.collection === 'approved') {
    if (sourceType === 'ai-generated-synthetic' || record.usageRights !== 'authorized' || record.licenseStatus === 'unknown' || !record.authorizationEvidence.trim() || record.reviewStatus !== 'reviewed' || record.reviews.length === 0) ctx.addIssue({ code: 'custom', path: ['collection'], message: 'Approved examples require documented rights and human review' })
    if ((sourceType === 'human-conversation' || sourceType === 'voice-agent-transcript') && record.consentStatus !== 'consented') ctx.addIssue({ code: 'custom', path: ['consentStatus'], message: 'Human conversations require documented consent' })
    if (sourceType === 'human-authored-example' && record.consentStatus !== 'authorization-documented') ctx.addIssue({ code: 'custom', path: ['consentStatus'], message: 'Human-authored examples require reuse authorization' })
  }
  const sensitiveText = [record.transcript, expectedBehavior, ...speakerTurns.map(turn => `${turn.speaker}: ${turn.text}`)].join('\n')
  if (/\b(?:DOB|date of birth|MRN|medical record number|patient ID|phone number|email address)\s*[:#-]/i.test(sensitiveText) || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(sensitiveText) || /\b\d[\d\s().-]{8,}\d\b/.test(sensitiveText)) ctx.addIssue({ code: 'custom', path: ['transcript'], message: 'Remove obvious patient identifiers before saving' })
})

function inferSourceType(provenance: DatasetProvenance): DatasetSourceType {
  return provenance === 'human-authored-reference' ? 'human-authored-example' : provenance === 'ai-generated-synthetic' ? 'ai-generated-synthetic' : 'human-conversation'
}

export const datasetRecordSchema = datasetRecordShape.transform(record => ({
  ...record,
  sourceType: record.sourceType ?? inferSourceType(record.provenance),
  voiceAgentOriginVerified: record.voiceAgentOriginVerified ?? false,
  originVerificationEvidence: record.originVerificationEvidence ?? '',
  speakerTurns: record.speakerTurns ?? [],
  expectedBehavior: record.expectedBehavior ?? '',
}))

export type NewDatasetRecord = Omit<DatasetRecord, 'id' | 'collection' | 'reviewStatus' | 'reviews' | 'createdAt'>

export function getDatasetProvenanceLabel(provenance: DatasetProvenance) {
  return DATASET_PROVENANCE.find(item => item.id === provenance)!.label
}

export function getDatasetSourceTypeLabel(sourceType: DatasetSourceType) {
  return DATASET_SOURCE_TYPES.find(item => item.id === sourceType)!.label
}

export function parseSpeakerTurns(transcript: string): DatasetTranscriptTurn[] | null {
  const lines = transcript.split(/\r?\n/).filter(line => line.trim().length > 0)
  if (lines.length < 2) return null
  const turns: DatasetTranscriptTurn[] = []
  for (const line of lines) {
    const match = line.match(/^\s*([^:\n]{1,80}):[ \t]*(.*)$/u)
    if (!match || !match[2].trim()) return null
    turns.push({ speaker: match[1].trim(), text: match[2] })
  }
  return turns
}

export function canEvaluateDatasetRecord(record: DatasetRecord): boolean {
  if (record.collection === 'rejected' || record.collection === 'synthetic' || record.provenance === 'ai-generated-synthetic') return false
  if (record.usageRights !== 'authorized' || record.licenseStatus === 'unknown' || !record.authorizationEvidence.trim()) return false
  if (record.sourceType === 'voice-agent-transcript' && (!record.voiceAgentOriginVerified || !record.originVerificationEvidence.trim())) return false
  if (record.provenance === 'authentic-human-conversation') return record.consentStatus === 'consented'
  return record.consentStatus === 'authorization-documented'
}

export function canApproveDatasetRecord(record: DatasetRecord): boolean {
  if (record.provenance === 'ai-generated-synthetic' || record.collection !== 'pending-review') return false
  if (record.usageRights !== 'authorized' || record.licenseStatus === 'unknown' || !record.authorizationEvidence.trim() || record.reviewStatus !== 'reviewed') return false
  if (record.provenance === 'authentic-human-conversation') return record.consentStatus === 'consented'
  return record.consentStatus === 'authorization-documented'
}
