import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDatasetRepository, DatasetApprovalError, type DatasetRepository } from './repository'
import type { StorageLike } from '../scenarios/repository'
import { canEvaluateDatasetRecord, datasetRecordSchema, parseSpeakerTurns, type NewDatasetRecord, type DatasetReview } from './types'

class MemoryStorage implements StorageLike {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}
const draft: NewDatasetRecord = { provenance: 'authentic-human-conversation', sourceType: 'human-conversation', voiceAgentOriginVerified: false, originVerificationEvidence: '', sourceDescription: 'User-authorized research sample', usageRights: 'unknown', licenseStatus: 'unknown', licenseName: '', authorizationEvidence: '', consentStatus: 'unknown', language: 'Malayalam', locale: 'ml-IN', codeSwitchingPresent: true, dialectRegister: '', scenarioCategory: 'code-switching', transcript: 'Caller: Namaskaram, appointment venam.\nAgent: Sure, help cheyyam.', speakerTurns: [{ speaker: 'Caller', text: 'Namaskaram, appointment venam.' }, { speaker: 'Agent', text: 'Sure, help cheyyam.' }], expectedBehavior: 'Follow the supplied clinic appointment rules.', audioReference: '' }
const review = (id: string, naturalness: DatasetReview['naturalness']): DatasetReview => ({ id, naturalness, contextualFit: 'fits', dialectRegister: 'unspecified', correction: '', explanation: 'Human assessment for test.', confidence: 'medium', reviewerClaimsNativeFluency: false, createdAt: '2026-01-01T00:00:00.000Z' })
function setup(): DatasetRepository { return createDatasetRepository(new MemoryStorage(), (() => { let i = 0; return () => `id-${++i}` })()) }

test('imports stay pending with unknown rights; unauthorized records cannot be approved', () => {
  const repo = setup(), record = repo.importRecord(draft)
  assert.equal(record.collection, 'pending-review'); assert.equal(record.locale, 'ml-IN'); assert.equal(record.codeSwitchingPresent, true)
  repo.addReview(record.id, review('r1', 'natural'))
  assert.throws(() => repo.approveRecord(record.id), DatasetApprovalError)
  const denied = repo.importRecord({ ...draft, usageRights: 'unauthorized', licenseStatus: 'not-applicable', consentStatus: 'consented' })
  repo.addReview(denied.id, review('r2', 'natural'))
  assert.throws(() => repo.approveRecord(denied.id), /Usage rights/)
})

test('approved collection requires explicit rights, license, authorization and human review', () => {
  const noEvidenceRepo = setup(), noEvidence = noEvidenceRepo.importRecord({ ...draft, usageRights: 'authorized', licenseStatus: 'not-applicable', consentStatus: 'consented' })
  noEvidenceRepo.addReview(noEvidence.id, review('r0', 'natural'))
  assert.throws(() => noEvidenceRepo.approveRecord(noEvidence.id), /Authorization evidence/)
  const repo = setup(), record = repo.importRecord({ ...draft, usageRights: 'authorized', licenseStatus: 'identified', licenseName: 'Example license supplied by user', consentStatus: 'consented', authorizationEvidence: 'User supplied authorization reference' })
  assert.throws(() => repo.approveRecord(record.id), /human review/)
  repo.addReview(record.id, review('r1', 'natural'))
  assert.equal(repo.approveRecord(record.id).collection, 'approved')
})

test('synthetic records remain separate and review disagreement is preserved', () => {
  const repo = setup(), record = repo.importRecord({ ...draft, provenance: 'ai-generated-synthetic', sourceType: 'ai-generated-synthetic' })
  assert.equal(record.collection, 'synthetic')
  assert.throws(() => repo.approveRecord(record.id), /Synthetic records/)
  const pending = repo.importRecord(draft)
  repo.addReview(pending.id, review('r1', 'natural'))
  repo.addReview(pending.id, review('r2', 'needs-revision'))
  assert.deepEqual(repo.loadRecords().find(r => r.id === pending.id)?.reviews.map(r => r.naturalness), ['natural', 'needs-revision'])
})

test('malformed local records are ignored without logging their content', () => {
  const storage = new MemoryStorage(); storage.setItem('vaaniqa:reusable-dataset:v1', JSON.stringify([{ transcript: 'private transcript' }]))
  assert.deepEqual(createDatasetRepository(storage).loadRecords(), [])
})

test('multi-turn imports preserve exact labeled wording and stay distinct by source type', () => {
  const original = 'Caller: Namaskaram, appointment venam.\nAgent: Sure, help cheyyam.'
  assert.deepEqual(parseSpeakerTurns(original), [
    { speaker: 'Caller', text: 'Namaskaram, appointment venam.' },
    { speaker: 'Agent', text: 'Sure, help cheyyam.' },
  ])
  assert.equal(parseSpeakerTurns('Only one line without a speaker'), null)
  const repo = setup()
  const voiceTranscript = repo.importRecord({ ...draft, provenance: 'authentic-human-conversation', sourceType: 'voice-agent-transcript', voiceAgentOriginVerified: true, originVerificationEvidence: 'Provider export record supplied by importer', usageRights: 'authorized', licenseStatus: 'not-applicable', authorizationEvidence: 'Reuse permission reference supplied', consentStatus: 'consented', expectedBehavior: 'Follow the supplied clinic rules.' })
  assert.equal(voiceTranscript.sourceType, 'voice-agent-transcript')
  assert.equal(voiceTranscript.transcript, original)
  assert.deepEqual(voiceTranscript.speakerTurns, parseSpeakerTurns(original))
  assert.equal(canEvaluateDatasetRecord(voiceTranscript), true)
  assert.equal(datasetRecordSchema.safeParse({ ...voiceTranscript, voiceAgentOriginVerified: false }).success, false)
})

test('old saved dataset entries receive compatible defaults and provenance is not fabricated', () => {
  const oldRecord = repoRecordForMigration()
  const parsed = datasetRecordSchema.safeParse(oldRecord)
  assert.equal(parsed.success, true)
  if (parsed.success) {
    assert.equal(parsed.data.sourceType, 'human-authored-example')
    assert.deepEqual(parsed.data.speakerTurns, [])
    assert.equal(parsed.data.expectedBehavior, '')
  }
})

function repoRecordForMigration() {
  const { sourceType: _sourceType, voiceAgentOriginVerified: _verified, originVerificationEvidence: _evidence, speakerTurns: _turns, expectedBehavior: _expected, ...oldDraft } = {
    ...draft, id: 'old-record', provenance: 'human-authored-reference' as const, collection: 'pending-review' as const, reviewStatus: 'unreviewed' as const, reviews: [], createdAt: '2026-10-24T00:00:00.000Z',
  }
  return oldDraft
}
