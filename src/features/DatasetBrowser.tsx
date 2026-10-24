import { useMemo, useState, type FormEvent } from 'react'
import { SCENARIO_CATEGORIES, type ScenarioCategory } from '../scenarios/types'
import { containsObviousPatientIdentifiers } from '../dataset/privacy'
import { canApproveDatasetRecord, canEvaluateDatasetRecord, DATASET_SOURCE_TYPES, getDatasetSourceTypeLabel, parseSpeakerTurns, type DatasetRecord, type DatasetReview, type DatasetSourceType, type NewDatasetRecord } from '../dataset/types'

type Props = {
  records: DatasetRecord[]
  onImport: (draft: NewDatasetRecord) => void
  onReview: (id: string, review: DatasetReview) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onEvaluate: (record: DatasetRecord) => void
  error: string
  storageMode: 'local' | 'supabase'
}

const blank = (): NewDatasetRecord => ({
  provenance: 'authentic-human-conversation', sourceType: 'human-conversation', voiceAgentOriginVerified: false, originVerificationEvidence: '',
  sourceDescription: '', usageRights: 'unknown', licenseStatus: 'unknown', licenseName: '', authorizationEvidence: '', consentStatus: 'unknown',
  language: 'Malayalam', locale: 'ml-IN', codeSwitchingPresent: false, dialectRegister: '', scenarioCategory: 'appointment-scheduling',
  transcript: '', speakerTurns: [], expectedBehavior: '', audioReference: '',
})

function sourceProvenance(sourceType: DatasetSourceType): NewDatasetRecord['provenance'] {
  if (sourceType === 'human-authored-example') return 'human-authored-reference'
  if (sourceType === 'ai-generated-synthetic') return 'ai-generated-synthetic'
  return 'authentic-human-conversation'
}

export function DatasetBrowser({ records, onImport, onReview, onApprove, onReject, onEvaluate, error, storageMode }: Props) {
  const [draft, setDraft] = useState<NewDatasetRecord>(blank)
  const [selected, setSelected] = useState('')
  const [collection, setCollection] = useState('all')
  const [category, setCategory] = useState('all')
  const [sourceType, setSourceType] = useState('all')
  const [naturalness, setNaturalness] = useState<DatasetReview['naturalness']>('cannot-assess')
  const [contextualFit, setContextualFit] = useState<DatasetReview['contextualFit']>('cannot-assess')
  const [dialectRegister, setDialectRegister] = useState('')
  const [correction, setCorrection] = useState('')
  const [explanation, setExplanation] = useState('')
  const [confidence, setConfidence] = useState<DatasetReview['confidence']>('medium')
  const [selfReportsFluency, setSelfReportsFluency] = useState(false)
  const [localError, setLocalError] = useState('')

  const visible = useMemo(() => records.filter(record =>
    (collection === 'all' || record.collection === collection) &&
    (category === 'all' || record.scenarioCategory === category) &&
    (sourceType === 'all' || record.sourceType === sourceType)), [records, collection, category, sourceType])
  const active = records.find(record => record.id === selected)
  const setField = <K extends keyof NewDatasetRecord>(key: K, value: NewDatasetRecord[K]) => setDraft(current => ({ ...current, [key]: value }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setLocalError('')
    if (containsObviousPatientIdentifiers(`${draft.transcript}\n${draft.expectedBehavior}`)) {
      setLocalError('This import appears to contain patient or contact identifiers. Redact them before saving.')
      return
    }
    const turns = parseSpeakerTurns(draft.transcript)
    if (!turns) {
      setLocalError('Use at least two speaker-labeled turns, one per line, such as Caller: ... and Agent: ...')
      return
    }
    try { onImport({ ...draft, speakerTurns: turns }); setDraft(blank()) }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Could not save this record.') }
  }

  const review = (event: FormEvent) => {
    event.preventDefault()
    if (!active) return
    try {
      onReview(active.id, { id: crypto.randomUUID(), naturalness, contextualFit, dialectRegister, correction, explanation, confidence, reviewerClaimsNativeFluency: selfReportsFluency, createdAt: new Date().toISOString() })
      setExplanation(''); setCorrection('')
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Could not save review.') }
  }

  return <div className="content dataset-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> REUSABLE EVALUATION DATASET</div><h1>Malayalam dataset</h1><p>Curate conversations with documented rights, turn-level speaker labels, and review status.</p></div><span className="dataset-local-badge">{storageMode === 'supabase' ? 'SAVED TO SUPABASE' : 'LOCAL TO THIS BROWSER'}</span></div>
    <div className="dataset-callout"><strong>Rights and expertise are self-reported.</strong><span>Unknown or unauthorized records stay pending. Synthetic conversations remain separate. Voice-agent origin is labeled only when the importer supplies verification evidence. Do not enter patient identifiers or unnecessary medical details.</span></div>
    <div className="dataset-workspace">
      <form className="panel dataset-import" onSubmit={submit}>
        <div className="panel-heading"><div><span className="step">01</span><div className="heading-copy"><h2>Add a conversation</h2><p>Every transcript line must retain its speaker label. Imports are never approved automatically.</p></div></div></div>
        <label>SOURCE TYPE<select value={draft.sourceType} onChange={event => { const value = event.target.value as DatasetSourceType; setDraft(current => ({ ...current, sourceType: value, provenance: sourceProvenance(value), voiceAgentOriginVerified: false, originVerificationEvidence: '', consentStatus: 'unknown' })) }}>{DATASET_SOURCE_TYPES.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        {draft.sourceType === 'voice-agent-transcript' && <><label>ORIGIN VERIFICATION EVIDENCE<input required maxLength={500} value={draft.originVerificationEvidence} onChange={event => setField('originVerificationEvidence', event.target.value)} placeholder="Reference the export, agent ID, or source document" /></label><label className="dataset-check"><input type="checkbox" required checked={draft.voiceAgentOriginVerified} onChange={event => setField('voiceAgentOriginVerified', event.target.checked)} /> I verified this source attribution; VaaniQA did not independently verify it</label></>}
        <label>SOURCE DESCRIPTION<input required maxLength={500} value={draft.sourceDescription} onChange={event => setField('sourceDescription', event.target.value)} placeholder="Source and origin; do not include personal details" /></label>
        <div className="dataset-form-grid"><label>USAGE RIGHTS<select value={draft.usageRights} onChange={event => setField('usageRights', event.target.value as NewDatasetRecord['usageRights'])}><option value="unknown">Unknown</option><option value="authorized">Authorized</option><option value="unauthorized">Unauthorized</option></select></label><label>LICENSE STATUS<select value={draft.licenseStatus} onChange={event => setField('licenseStatus', event.target.value as NewDatasetRecord['licenseStatus'])}><option value="unknown">Unknown</option><option value="identified">Identified</option><option value="not-applicable">Not applicable</option></select></label></div>
        {draft.licenseStatus === 'identified' && <label>LICENSE NAME<input required maxLength={300} value={draft.licenseName} onChange={event => setField('licenseName', event.target.value)} placeholder="Exact license or source terms" /></label>}
        <label>CONSENT / AUTHORSHIP AUTHORIZATION<select value={draft.consentStatus} onChange={event => setField('consentStatus', event.target.value as NewDatasetRecord['consentStatus'])}><option value="unknown">Unknown</option><option value="consented">Consent documented</option><option value="authorization-documented">Authoring/reuse authorization documented</option><option value="not-consented">Not consented</option></select></label>
        <label>RIGHTS EVIDENCE<input maxLength={500} value={draft.authorizationEvidence} onChange={event => setField('authorizationEvidence', event.target.value)} placeholder="Reference or note; status is not independently verified" /></label>
        <div className="dataset-form-grid"><label>CATEGORY<select value={draft.scenarioCategory} onChange={event => setField('scenarioCategory', event.target.value as ScenarioCategory)}>{SCENARIO_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>DIALECT / REGISTER<input maxLength={400} value={draft.dialectRegister} onChange={event => setField('dialectRegister', event.target.value)} placeholder="Unknown if not known" /></label></div>
        <label>EXPECTED BEHAVIOR AND CLINIC RULES<textarea required maxLength={8000} value={draft.expectedBehavior} onChange={event => setField('expectedBehavior', event.target.value)} placeholder="Only documented, clinic-approved rules and expected behavior" /></label>
        <label>TURN-LABELED ORIGINAL TRANSCRIPT · MALAYALAM / ml-IN<textarea required maxLength={30000} value={draft.transcript} onChange={event => setField('transcript', event.target.value)} placeholder={'Caller: ...\nAgent: ...\nCaller: ...'} /></label>
        <label className="dataset-check"><input type="checkbox" checked={draft.codeSwitchingPresent} onChange={event => setField('codeSwitchingPresent', event.target.checked)} /> Malayalam-English code-switching is present</label>
        <label>OPTIONAL AUDIO REFERENCE<input maxLength={1000} value={draft.audioReference} onChange={event => setField('audioReference', event.target.value)} placeholder="Metadata/reference only; audio is not uploaded" /></label>
        <button className="run-button dataset-submit" type="submit">Add to {draft.sourceType === 'ai-generated-synthetic' ? 'synthetic collection' : 'pending review'}</button>
        {(localError || error) && <p className="dataset-error" role="alert">{localError || error}</p>}
      </form>

      <section className="dataset-library">
        <div className="panel dataset-filters"><div><h2>Browse conversations</h2><p>{records.length} record{records.length === 1 ? '' : 's'} · {storageMode === 'supabase' ? 'Supabase-backed workspace' : 'browser-local storage'}</p></div><div className="dataset-filter-row">
          <label className="sr-only" htmlFor="dataset-collection">Collection</label><select id="dataset-collection" value={collection} onChange={event => setCollection(event.target.value)}><option value="all">All collections</option><option value="approved">Approved</option><option value="pending-review">Pending review</option><option value="synthetic">Synthetic</option><option value="rejected">Rejected</option></select>
          <label className="sr-only" htmlFor="dataset-category">Category</label><select id="dataset-category" value={category} onChange={event => setCategory(event.target.value)}><option value="all">All categories</option>{SCENARIO_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          <label className="sr-only" htmlFor="dataset-source-type">Source type</label><select id="dataset-source-type" value={sourceType} onChange={event => setSourceType(event.target.value)}><option value="all">All source types</option>{DATASET_SOURCE_TYPES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </div></div>
        {visible.length === 0 ? <div className="empty-state dataset-empty"><strong>No conversations in this view.</strong><p>Records are not preloaded. Import a rights-documented source to begin.</p></div> : <div className="dataset-record-list">{visible.map(record => <button className={`dataset-record ${record.id === selected ? 'active' : ''}`} key={record.id} onClick={() => setSelected(record.id)}><span className={`dataset-status status-${record.collection}`}>{record.collection.replace('-', ' ')}</span><strong>{record.sourceDescription}</strong><span className="dataset-badges"><i>{getDatasetSourceTypeLabel(record.sourceType)}</i><i>{SCENARIO_CATEGORIES.find(item => item.id === record.scenarioCategory)?.label}</i><i>{record.locale}{record.codeSwitchingPresent ? ' · Malayalam-English' : ''}</i></span><small>{record.reviewStatus} · {record.reviews.length} review{record.reviews.length === 1 ? '' : 's'}</small></button>)}</div>}
        {active && <article className="panel dataset-detail"><div className="dataset-detail-head"><div><span className={`dataset-status status-${active.collection}`}>{active.collection.replace('-', ' ')}</span><h2>{getDatasetSourceTypeLabel(active.sourceType)}</h2></div><button className="more-button" onClick={() => onReject(active.id)} aria-label="Reject dataset record">Reject</button></div>
          {active.sourceType === 'voice-agent-transcript' && <p className="dataset-rights">Voice-agent origin was verified by the importer using: {active.originVerificationEvidence}. VaaniQA did not independently verify this source.</p>}
          <p className="dataset-rights">Rights: {active.usageRights} · License: {active.licenseStatus}{active.licenseName ? ` (${active.licenseName})` : ''} · Consent/authorization: {active.consentStatus}. These declarations are not independently verified.</p>
          <div className="dataset-rights"><strong>Expected behavior and supplied clinic rules</strong><p>{active.expectedBehavior || 'Not supplied.'}</p></div>
          <blockquote className="dataset-transcript" lang="ml">{active.speakerTurns.length ? active.speakerTurns.map((turn, index) => <span className="transcript-turn" key={`${index}-${turn.speaker}`}><b>Turn {index + 1} · {turn.speaker}:</b> {turn.text}{'\n'}</span>) : active.transcript}</blockquote>
          {active.audioReference && <small>Audio reference metadata: {active.audioReference}</small>}
          {active.reviews.map((item, index) => <div className="dataset-review" key={item.id}><strong>Review {index + 1} · confidence {item.confidence}</strong><span>Naturalness: {item.naturalness} · Contextual fit: {item.contextualFit}</span><span>Dialect/register: {item.dialectRegister || 'Not specified'}</span>{item.correction && <span>Correction: {item.correction}</span>}<span>{item.explanation}</span>{item.reviewerClaimsNativeFluency && <small>Reviewer self-reports Malayalam fluency; expertise is not verified.</small>}</div>)}
          {canEvaluateDatasetRecord(active) ? <div className="dataset-evaluate"><button className="dataset-approve" type="button" onClick={() => onEvaluate(active)}>Use in Test Lab</button><small>Original turn labels and wording, source type, rights status, and review status are carried into the test.</small></div> : <p className="dataset-rights">To evaluate this source, document authorized usage, license status, and the required consent or author reuse permission. Voice-agent transcripts also require source verification evidence.</p>}
          {(active.collection === 'pending-review' || active.collection === 'synthetic') && <form className="dataset-review-form" onSubmit={review}><h3>Human review</h3><div className="dataset-form-grid"><label>Naturalness<select value={naturalness} onChange={event => setNaturalness(event.target.value as DatasetReview['naturalness'])}>{['natural','minor-correction','needs-revision','cannot-assess'].map(value => <option key={value}>{value}</option>)}</select></label><label>Contextual fit<select value={contextualFit} onChange={event => setContextualFit(event.target.value as DatasetReview['contextualFit'])}>{['fits','partially-fits','does-not-fit','cannot-assess'].map(value => <option key={value}>{value}</option>)}</select></label></div><label>Dialect / register<input value={dialectRegister} onChange={event => setDialectRegister(event.target.value)} /></label><label>Suggested correction<textarea value={correction} onChange={event => setCorrection(event.target.value)} /></label><label>Judgment and explanation<textarea required value={explanation} onChange={event => setExplanation(event.target.value)} /></label><div className="dataset-form-grid"><label>Confidence<select value={confidence} onChange={event => setConfidence(event.target.value as DatasetReview['confidence'])}>{['low','medium','high'].map(value => <option key={value}>{value}</option>)}</select></label><label className="dataset-check"><input type="checkbox" checked={selfReportsFluency} onChange={event => setSelfReportsFluency(event.target.checked)} /> I self-report Malayalam fluency (not verified)</label></div><button className="text-button" type="submit">Save review</button></form>}
          {active.collection === 'pending-review' && <button className="dataset-approve" disabled={!canApproveDatasetRecord(active)} onClick={() => onApprove(active.id)}>Approve for reusable evaluation</button>}
          {active.collection === 'synthetic' && <p className="dataset-synthetic-note">Synthetic content remains separate and cannot be approved as authentic or human-authored.</p>}
        </article>}
      </section>
    </div>
  </div>
}
