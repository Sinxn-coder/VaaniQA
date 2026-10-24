import { useEffect, useMemo, useState } from 'react'
import { SCENARIO_CATEGORIES, type AgentConfiguration, type Scenario, type ScenarioCategory, type ScenarioReview } from '../scenarios/types'

export function ScenarioLibrary({ scenarios, configuration, selectedIds, generating, error, onSetup, onGenerate, onToggle, onUpdate, onPrepare }: {
  scenarios: Scenario[]
  configuration: AgentConfiguration
  selectedIds: string[]
  generating: boolean
  error: string
  onSetup: () => void
  onGenerate: () => void
  onToggle: (id: string) => void
  onUpdate: (scenario: Scenario) => void
  onPrepare: () => void
}) {
  const [category, setCategory] = useState<ScenarioCategory | 'all'>('all')
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(scenarios[0]?.id ?? null)
  const [reviewRating, setReviewRating] = useState(0)
  const [correction, setCorrection] = useState('')
  const [dialect, setDialect] = useState('')
  const [reviewExplanation, setReviewExplanation] = useState('')
  useEffect(() => { if (!scenarios.some(s => s.id === activeId)) setActiveId(scenarios[0]?.id ?? null) }, [scenarios, activeId])

  const filtered = useMemo(() => scenarios.filter(scenario => {
    const matchesCategory = category === 'all' || scenario.category === category
    const matchesQuery = !query.trim() || `${scenario.title} ${scenario.goal} ${scenario.callerProfile}`.toLowerCase().includes(query.trim().toLowerCase())
    return matchesCategory && matchesQuery
  }), [scenarios, category, query])
  const active = scenarios.find(scenario => scenario.id === activeId) ?? null
  const save = (patch: Partial<Scenario>) => active && onUpdate({ ...active, ...patch })
  const categoryLabel = (id: ScenarioCategory) => SCENARIO_CATEGORIES.find(item => item.id === id)?.label ?? id
  const addReview = () => {
    if (!active || !reviewRating || !reviewExplanation.trim()) return
    const review: ScenarioReview = { id: crypto.randomUUID(), rating: reviewRating, correctedWording: correction.trim(), dialectRegister: dialect.trim(), explanation: reviewExplanation.trim(), createdAt: new Date().toISOString() }
    onUpdate({ ...active, reviews: [...active.reviews, review], markedForReview: false })
    setReviewRating(0); setCorrection(''); setDialect(''); setReviewExplanation('')
  }

  return <div className="content scenario-library-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> TEST DESIGN</div><h1>Scenario library</h1><p>Synthetic conversations shaped by your clinic’s services and approved rules.</p></div><div className="library-heading-actions"><button className="text-button" onClick={onSetup}>Edit agent setup</button><button className="run-button" onClick={onGenerate} disabled={generating || !configuration.name.trim()}>{generating ? <><span className="spinner" /> Generating…</> : <>Generate scenarios <span>↗</span></>}</button></div></div>
    <div className="library-banner"><span className="library-banner-icon">✳</span><div><strong>AI-generated test content, not real conversations.</strong><p>Clinic policy is only taken from the rules you entered. Missing rules are flagged; no diagnosis or treatment policy is invented.</p></div><span className="language-tag">{configuration.primaryLanguage} · {configuration.locale}</span></div>
    {error && <div className="run-error" role="alert">{error}</div>}
    <div className="library-toolbar"><div className="category-filters"><button className={category === 'all' ? 'filter-active' : ''} onClick={() => setCategory('all')}>All <span>{scenarios.length}</span></button>{SCENARIO_CATEGORIES.map(item => <button key={item.id} className={category === item.id ? 'filter-active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div><div className="library-controls"><input aria-label="Search scenarios" placeholder="Search scenarios" value={query} onChange={e => setQuery(e.target.value)} /><button className="run-button" onClick={onPrepare} disabled={!selectedIds.length}>Prepare test run ({selectedIds.length}) <span>→</span></button></div></div>
    {!scenarios.length ? <div className="library-empty panel"><div className="empty-icon">⌁</div><div><strong>No scenarios yet</strong><p>Save your agent setup, add clinic-approved rules, then generate the first synthetic library.</p></div><button className="text-button" onClick={onSetup}>Review setup</button></div> : <div className="library-layout">
      <section className="scenario-list" aria-label="Scenarios">{filtered.map(scenario => <article key={scenario.id} className={`scenario-list-item ${activeId === scenario.id ? 'active' : ''}`}><label className="scenario-select"><input type="checkbox" checked={selectedIds.includes(scenario.id)} onChange={() => onToggle(scenario.id)} aria-label={`Select ${scenario.title} for test run`} /></label><button className="scenario-list-open" onClick={() => setActiveId(scenario.id)}><span className="scenario-category">{categoryLabel(scenario.category)}</span><strong>{scenario.title}</strong><small>{scenario.goal}</small><span className="provenance-line"><span className="provenance-chip">{scenario.provenance}</span><span className="review-state-chip">{scenario.reviews.length ? `${scenario.reviews.length} human review${scenario.reviews.length === 1 ? '' : 's'} recorded` : scenario.markedForReview ? 'Marked for native review' : 'Not human-reviewed'}</span></span></button></article>)}{!filtered.length && <div className="filter-empty">No scenarios match those filters.</div>}</section>
      {active && <article className="scenario-detail panel"><div className="scenario-detail-head"><div><div className="eyebrow"><span className="eyebrow-line" /> {categoryLabel(active.category).toUpperCase()}</div><h2>{active.title}</h2></div><div className="detail-badges"><span className="provenance-chip">{active.provenance}</span><span className="review-state-chip">{active.reviews.length ? 'Human feedback recorded' : active.markedForReview ? 'Review requested' : 'Not reviewed'}</span></div></div>
        {active.reviews.length > 0 && <div className="review-transparency">Human feedback is recorded; reviewer identity and language expertise are not independently verified.</div>}
        <div className="scenario-detail-grid"><section><h3>Caller and goal</h3><p><b>Context</b>{active.callerProfile}</p><p><b>Goal</b>{active.goal}</p></section><section><h3>Caller opening</h3><textarea lang={configuration.locale.split('-')[0]} value={active.callerOpening} onChange={e => save({ callerOpening: e.target.value })} /><small>Generated opening · edit before use</small></section>
          <section className="detail-full"><h3>Conversation outline</h3><ol>{active.conversationOutline.map((turn, index) => <li key={`${active.id}-turn-${index}`}>{turn}</li>)}</ol></section>
          <section className="detail-full"><h3>Expected agent behavior</h3><textarea value={active.expectedBehavior} onChange={e => save({ expectedBehavior: e.target.value })} /></section>
          <section><h3>Clinic-provided constraints</h3>{active.clinicApprovedConstraints.length ? <ul>{active.clinicApprovedConstraints.map((rule, index) => <li key={`${active.id}-rule-${index}`}>{rule}</li>)}</ul> : <p className="rule-warning">No clinic-approved rules were supplied. Confirm policy before using this scenario.</p>}{active.missingClinicRules.length > 0 && <p className="rule-warning"><b>Missing rules flagged</b>{active.missingClinicRules.join(' · ')}</p>}</section>
          <section><h3>Language and audio</h3><p>{active.languageNotes}</p><span className={active.audioRequired ? 'audio-required' : 'audio-not-required'}>{active.audioRequired ? 'Audio required' : 'Audio not required'}</span></section>
          <section><h3>Failure conditions</h3><textarea value={active.failureConditions.join('\n')} onChange={e => save({ failureConditions: e.target.value.split('\n').filter(Boolean) })} /></section><section><h3>Pass criteria</h3><textarea value={active.passCriteria.join('\n')} onChange={e => save({ passCriteria: e.target.value.split('\n').filter(Boolean) })} /></section>
        </div>
        <div className="scenario-detail-actions"><button className="text-button" onClick={() => save({ markedForReview: !active.markedForReview })}>{active.markedForReview ? 'Remove native review flag' : 'Mark for native-speaker review'}</button><span>{active.audioRequired ? 'Prepare an audio-based manual test.' : 'Preparing a run does not connect or invoke an agent.'}</span></div>
        <section className="native-review"><div><h3>Native-speaker feedback</h3><p>Submit a judgment, wording correction, dialect/register, and your reasoning. Reviews are kept separately to preserve variants and disagreement.</p></div><div className="review-input-grid"><fieldset className="review-rating"><legend>NATURALNESS RATING</legend><div>{[1, 2, 3, 4, 5].map(value => <button type="button" key={value} className={reviewRating === value ? 'rating-selected' : ''} onClick={() => setReviewRating(value)} aria-label={`Rate naturalness ${value} out of 5`}>{value}</button>)}</div></fieldset><label>DIALECT / REGISTER<input value={dialect} onChange={e => setDialect(e.target.value)} placeholder="e.g. Central Kerala; informal, polite" /></label><label className="review-full">CORRECTED WORDING<textarea lang={configuration.locale.split('-')[0]} value={correction} onChange={e => setCorrection(e.target.value)} placeholder="Optional alternative wording" /></label><label className="review-full">WHY THIS SOUNDS NATURAL OR NEEDS CHANGE<textarea value={reviewExplanation} onChange={e => setReviewExplanation(e.target.value)} placeholder="Explain the phrasing, register, or dialect judgment" required /></label></div><div className="review-submit-row"><small>Only submit if you can assess this language variety. Expertise is self-reported and not verified.</small><button className="text-button" disabled={!reviewRating || !reviewExplanation.trim()} onClick={addReview}>Record review</button></div>
          {active.reviews.map((review, index) => <article className="review-entry" key={review.id}><div><strong>Human review {index + 1}</strong><span>{review.rating}/5 · {new Date(review.createdAt).toLocaleString()}</span></div>{review.dialectRegister && <p><b>Dialect / register</b>{review.dialectRegister}</p>}{review.correctedWording && <p lang={configuration.locale.split('-')[0]}><b>Suggested wording</b>{review.correctedWording}</p>}<p><b>Reviewer reasoning</b>{review.explanation}</p></article>)}
        </section>
      </article>}
    </div>}
  </div>
}
