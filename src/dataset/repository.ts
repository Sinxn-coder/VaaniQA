import type { StorageLike } from '../scenarios/repository'
import { datasetRecordSchema, datasetReviewSchema, type DatasetRecord, type DatasetReview, type NewDatasetRecord } from './types'

const DATASET_KEY = 'vaaniqa:reusable-dataset:v1'

export class DatasetApprovalError extends Error {}
export class DatasetRecordNotFoundError extends Error {}

export interface DatasetRepository {
  loadRecords(): DatasetRecord[]
  replaceRecords(records: unknown[]): void
  importRecord(draft: NewDatasetRecord): DatasetRecord
  addReview(recordId: string, review: DatasetReview): DatasetRecord
  approveRecord(recordId: string): DatasetRecord
  rejectRecord(recordId: string): DatasetRecord
}

export function createDatasetRepository(storage: StorageLike, createId: () => string = () => globalThis.crypto.randomUUID()): DatasetRepository {
  const load = (): DatasetRecord[] => {
    try {
      const raw = storage.getItem(DATASET_KEY)
      if (!raw) return []
      const value: unknown = JSON.parse(raw)
      if (!Array.isArray(value)) return []
      return value.flatMap(item => { const parsed = datasetRecordSchema.safeParse(item); return parsed.success ? [parsed.data] : [] })
    } catch { return [] }
  }
  const save = (records: DatasetRecord[]) => storage.setItem(DATASET_KEY, JSON.stringify(records.map(record => datasetRecordSchema.parse(record))))
  const update = (recordId: string, transform: (record: DatasetRecord) => DatasetRecord) => {
    const records = load()
    const index = records.findIndex(record => record.id === recordId)
    if (index < 0) throw new DatasetRecordNotFoundError('Dataset record not found')
    records[index] = transform(records[index])
    save(records)
    return records[index]
  }
  return {
    loadRecords: load,
    replaceRecords(records) { save(records.map(record => datasetRecordSchema.parse(record))) },
    importRecord(draft) {
      const collection = draft.provenance === 'ai-generated-synthetic' ? 'synthetic' : 'pending-review'
      const record = datasetRecordSchema.parse({ ...draft, id: createId(), collection, reviewStatus: 'unreviewed', reviews: [], createdAt: new Date().toISOString() })
      save([...load(), record])
      return record
    },
    addReview(recordId, review) {
      return update(recordId, record => {
        if (record.collection === 'rejected') throw new DatasetApprovalError('Rejected records cannot receive further reviews')
        return { ...record, reviews: [...record.reviews, datasetReviewSchema.parse(review)], reviewStatus: 'reviewed' }
      })
    },
    approveRecord(recordId) {
      return update(recordId, record => {
        if (record.provenance === 'ai-generated-synthetic') throw new DatasetApprovalError('Synthetic records remain in the separate synthetic collection')
        if (record.usageRights !== 'authorized') throw new DatasetApprovalError('Usage rights must be explicitly authorized')
        if (record.licenseStatus === 'unknown') throw new DatasetApprovalError('License status must be documented')
        if (!record.authorizationEvidence.trim()) throw new DatasetApprovalError('Authorization evidence must be documented')
        if (record.provenance === 'authentic-human-conversation' && record.consentStatus !== 'consented') throw new DatasetApprovalError('Consent must be documented for authentic conversations')
        if (record.provenance === 'human-authored-reference' && record.consentStatus !== 'authorization-documented') throw new DatasetApprovalError('Authoring and reuse authorization must be documented')
        if (record.reviewStatus !== 'reviewed' || record.reviews.length === 0) throw new DatasetApprovalError('At least one human review must be recorded before approval')
        return { ...record, collection: 'approved' }
      })
    },
    rejectRecord(recordId) { return update(recordId, record => ({ ...record, collection: 'rejected', reviewStatus: 'rejected' })) },
  }
}

export const browserDatasetRepository = createDatasetRepository({
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
})
