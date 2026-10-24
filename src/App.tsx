import { useEffect, useState } from 'react'
import { evaluateDemo, type Evaluation } from './evaluation/demoEvaluator'
import { DEFAULT_LOCALE, getLanguageForLocale, SUPPORTED_LANGUAGES, type SupportedLocale } from './evaluation/languages'
import { AgentSetup } from './features/AgentSetup'
import { ScenarioLibrary } from './features/ScenarioLibrary'
import { DatasetBrowser } from './features/DatasetBrowser'
import { browserScenarioRepository } from './scenarios/repository'
import { type AgentConfiguration, scenarioSchema, type Scenario } from './scenarios/types'
import { browserDatasetRepository } from './dataset/repository'
import { getDatasetSourceTypeLabel, type DatasetRecord } from './dataset/types'
import { getAudioUploadError } from './evaluation/audioUpload'
import { buildEvaluationContext } from './evaluation/context'

type Page = 'Overview' | 'Test Lab' | 'Agent Setup' | 'Scenario Library' | 'Dataset' | 'Human Review' | 'Integrations'
const initialTranscript = '\u0d28\u0d2e\u0d38\u0d4d\u0d15\u0d3e\u0d30\u0d02. My appointment is next week; can I reschedule it to Friday?'
const nav = [{ name: 'Overview', icon: 'overview' }, { name: 'Agent Setup', icon: 'setup' }, { name: 'Scenario Library', icon: 'scenarios' }, { name: 'Dataset', icon: 'dataset' }, { name: 'Test Lab', icon: 'lab' }, { name: 'Human Review', icon: 'review', count: '12' }, { name: 'Integrations', icon: 'integrations' }] as const

type NavGlyphName = 'overview' | 'setup' | 'scenarios' | 'lab' | 'review' | 'integrations' | 'dataset'
const glyphPaths: Record<NavGlyphName, string> = {
  overview: 'M2.5 2.5h4v4h-4z M9.5 2.5h4v4h-4z M2.5 9.5h4v4h-4z M9.5 9.5h4v4h-4z',
  setup: 'M2 4h12 M2 8h12 M2 12h12 M5 2.5v3 M10 6.5v3 M7 10.5v3',
  scenarios: 'M3 2.5h8a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2z M3 11.5a2 2 0 0 1 2-2h8 M6 5h4 M6 7h4',
  lab: 'M2 8h2l2-4 3.5 8L12 6l1.5 2H14',
  review: 'M2.5 3.5h11v7h-6l-3 2v-2h-2z M5 6h6 M5 8h4',
  integrations: 'M3 3.5h3v3H3z M10 9.5h3v3h-3z M6 5l5 5 M10 3h3v3h-3z M6 5l5-1',
  dataset: 'M2.5 4c0-1 2.5-1.5 5.5-1.5s5.5.5 5.5 1.5-2.5 1.5-5.5 1.5S2.5 5 2.5 4z M2.5 4v4c0 1 2.5 1.5 5.5 1.5s5.5-.5 5.5-1.5V4 M2.5 8v4c0 1 2.5 1.5 5.5 1.5s5.5-.5 5.5-1.5V8',
}
function NavGlyph({ name }: { name: NavGlyphName }) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d={glyphPaths[name]} /></svg>
}

function App() {
  const [page, setPage] = useState<Page>('Test Lab')
  const [configuration, setConfiguration] = useState<AgentConfiguration>(() => browserScenarioRepository.loadConfiguration())
  const [scenarios, setScenarios] = useState<Scenario[]>(() => browserScenarioRepository.loadScenarios())
  const [datasetRecords, setDatasetRecords] = useState<DatasetRecord[]>(() => browserDatasetRepository.loadRecords())
  const [importedDatasetRecord, setImportedDatasetRecord] = useState<DatasetRecord | null>(null)
  const [datasetTranscriptEdited, setDatasetTranscriptEdited] = useState(false)
  const [datasetError, setDatasetError] = useState('')
  const persistDataset = (operation: () => unknown) => {
    try {
      operation()
      const records = browserDatasetRepository.loadRecords()
      setDatasetRecords(records); setDatasetError('')
      if (persistenceMode === 'supabase') void fetch('/api/persistence/dataset', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records }) }).then(response => { if (!response.ok) throw new Error() }).catch(() => setPersistenceNotice('Dataset could not be saved to Supabase; your browser copy remains available.'))
    }
    catch (error) { setDatasetError(error instanceof Error ? error.message : 'Could not update local dataset.') }
  }
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([])
  const [preparedScenarios, setPreparedScenarios] = useState<Scenario[]>([])
  const [scenarioError, setScenarioError] = useState('')
  const [generatingScenarios, setGeneratingScenarios] = useState(false)
  const [setupSaved, setSetupSaved] = useState(true)
  const [transcript, setTranscript] = useState(initialTranscript)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [audioError, setAudioError] = useState('')
  const [audioStatus, setAudioStatus] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const [syntheticSample, setSyntheticSample] = useState(true)
  const [expected, setExpected] = useState('Follow only the clinic-approved rescheduling rules; if availability or policy is unknown, ask clinic staff instead of promising a slot.')
  const [locale, setLocale] = useState<SupportedLocale>(DEFAULT_LOCALE)
  const language = getLanguageForLocale(locale)
  const [result, setResult] = useState<Evaluation | null>(null)
  const [running, setRunning] = useState(false)
  const [mode, setMode] = useState<'DEMO' | 'LIVE'>('DEMO')
  const [runError, setRunError] = useState('')
  const [activeTab, setActiveTab] = useState<'comparison' | 'transcript'>('comparison')
  const [reviewTarget, setReviewTarget] = useState<Evaluation | null>(null)
  const [persistenceMode, setPersistenceMode] = useState<'checking' | 'local' | 'supabase'>('checking')
  const [persistenceNotice, setPersistenceNotice] = useState('')
  const [resultId, setResultId] = useState('')

  const saveEvaluationMetadata = (id: string, evaluation: Evaluation) => {
    if (persistenceMode !== 'supabase') return
    const summary = { id, mode: evaluation.mode, model: evaluation.model ?? null, language: evaluation.language ?? 'Malayalam', locale: evaluation.locale ?? locale, overallScore: evaluation.overall, findings: evaluation.findings.map(item => ({ dimension: item.dimension, score: item.score, status: item.status })) }
    void fetch('/api/persistence/evaluations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(summary) })
      .then(response => { if (!response.ok) throw new Error(); setPersistenceNotice('') })
      .catch(() => setPersistenceNotice('Evaluation metadata could not be saved; conversation text was not stored.'))
  }

  const saveRemoteWorkspace = (nextConfiguration = configuration, nextScenarios = scenarios) => {
    if (persistenceMode !== 'supabase') return
    void fetch('/api/persistence/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configuration: nextConfiguration, scenarios: nextScenarios }) })
      .then(response => { if (!response.ok) throw new Error(); setPersistenceNotice('') })
      .catch(() => setPersistenceNotice('Supabase save failed. Your browser copy is still available.'))
  }

  useEffect(() => {
    let active = true
    void fetch('/api/persistence/status').then(response => response.json()).then(async (status: { mode?: string }) => {
      if (!active) return
      if (status.mode !== 'supabase') { setPersistenceMode('local'); return }
      try {
        const response = await fetch('/api/persistence/bootstrap')
        if (!response.ok) throw new Error()
        const snapshot = await response.json() as { configuration?: AgentConfiguration | null; scenarios?: Scenario[]; datasetRecords?: DatasetRecord[] }
        if (!active) return
        if (snapshot.configuration) { browserScenarioRepository.saveConfiguration(snapshot.configuration); setConfiguration(snapshot.configuration) }
        if (snapshot.scenarios) { browserScenarioRepository.saveScenarios(snapshot.scenarios); setScenarios(snapshot.scenarios) }
        if (snapshot.datasetRecords) { browserDatasetRepository.replaceRecords(snapshot.datasetRecords); setDatasetRecords(snapshot.datasetRecords) }
        setPersistenceMode('supabase')
        setPersistenceNotice('')
      } catch { if (active) { setPersistenceMode('local'); setPersistenceNotice('Supabase is configured but unavailable. Using this browser’s saved copy.') } }
    }).catch(() => { if (active) setPersistenceMode('local') })
    return () => { active = false }
  }, [])

  const updateConfiguration = (value: AgentConfiguration) => {
    setConfiguration(value)
    setSetupSaved(false)
    try { browserScenarioRepository.saveConfiguration(value); setSetupSaved(true); saveRemoteWorkspace(value) }
    catch { setScenarioError('Could not save setup in this browser. Check local storage availability.') }
  }

  const updateScenario = (value: Scenario) => setScenarios(current => {
    const updated = current.map(scenario => scenario.id === value.id ? value : scenario)
    try { browserScenarioRepository.saveScenarios(updated); saveRemoteWorkspace(configuration, updated) }
    catch { setScenarioError('Could not save the scenario in this browser. Check local storage availability.') }
    return updated
  })

  const generateScenarios = async () => {
    setGeneratingScenarios(true)
    setScenarioError('')
    try {
      browserScenarioRepository.saveConfiguration(configuration)
      const response = await fetch('/api/scenarios/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...configuration, agentId: undefined }) })
      const body = await response.json() as { scenarios?: unknown; error?: { message?: string } }
      if (!response.ok || !Array.isArray(body.scenarios)) throw new Error(body.error?.message || `Scenario generation failed (${response.status}).`)
      const generated = body.scenarios.map(item => scenarioSchema.parse(item))
      const combined = [...scenarios, ...generated]
      browserScenarioRepository.saveScenarios(combined)
      setScenarios(combined)
      saveRemoteWorkspace(configuration, combined)
      setPage('Scenario Library')
    } catch (error) {
      setScenarioError(error instanceof Error ? error.message : 'Scenario generation failed. Please try again.')
    } finally { setGeneratingScenarios(false) }
  }

  const prepareTestRun = () => {
    const selected = scenarios.filter(scenario => selectedScenarioIds.includes(scenario.id))
    if (!selected.length) return
    setPreparedScenarios(selected)
    setImportedDatasetRecord(null)
    setDatasetTranscriptEdited(false)
    setTranscript('')
    setSyntheticSample(false)
    setExpected(selected.map((scenario, index) => `Scenario ${index + 1}: ${scenario.title}\nExpected behavior: ${scenario.expectedBehavior}\nPass criteria: ${scenario.passCriteria.join('; ')}\nClinic rules: ${scenario.clinicApprovedConstraints.join('; ') || 'No approved clinic rules supplied.'}`).join('\n\n').slice(0, 7_500))
    setLocale(configuration.locale)
    setResult(null)
    setRunError('')
    setPage('Test Lab')
  }

  const evaluateDatasetConversation = (record: DatasetRecord) => {
    const expectedBehavior = buildEvaluationContext(record.expectedBehavior, configuration)
    setTranscript(record.transcript)
    setExpected(expectedBehavior)
    setImportedDatasetRecord(record)
    setDatasetTranscriptEdited(false)
    setPreparedScenarios([])
    setSyntheticSample(false)
    setAudioFile(null)
    setLocale(record.locale)
    setResult(null)
    setRunError(expectedBehavior.length > 8_000 ? 'The selected conversation’s expected behavior and clinic rules exceed 8,000 characters. Shorten them before running.' : '')
    setPage('Test Lab')
  }

  const chooseAudio = (file: File | undefined) => {
    setAudioError(''); setAudioStatus('')
    if (!file) { setAudioFile(null); return }
    const issue = getAudioUploadError(file)
    if (issue) { setAudioFile(null); setAudioError(issue); return }
    setAudioFile(file)
  }

  const transcribeAudio = async () => {
    if (!audioFile) return
    setTranscribing(true); setAudioError(''); setAudioStatus('')
    try {
      const response = await fetch('/api/transcriptions', { method: 'POST', headers: { 'Content-Type': audioFile.type, 'X-Audio-Filename': encodeURIComponent(audioFile.name), 'X-Locale': locale }, body: audioFile })
      const body = await response.json() as { transcript?: string; error?: { message?: string }; vocalDelivery?: string }
      if (!response.ok || !body.transcript) throw new Error(body.error?.message || `Transcription failed (${response.status}).`)
      setTranscript(body.transcript); setImportedDatasetRecord(null); setDatasetTranscriptEdited(false); setSyntheticSample(false); setAudioFile(null); setMode('LIVE'); const picker = document.getElementById('audio-recording') as HTMLInputElement | null; if (picker) picker.value = ''; setResult(null); setRunError('')
      setAudioStatus('OpenAI transcription complete. Review the text before evaluation; vocal delivery was not analyzed.')
    } catch (error) { setAudioError(error instanceof Error ? error.message : 'Recording transcription failed.') }
    finally { setTranscribing(false) }
  }

  const runEvaluation = () => {
    const evaluationContext = buildEvaluationContext(expected, configuration)
    if (!transcript.trim() || !evaluationContext.trim()) {
      setRunError('Add both a conversation and expected behavior before evaluating.')
      return
    }
    if (transcript.length > 30_000 || evaluationContext.length > 8_000) {
      setRunError('Keep the conversation within 30,000 characters and expected behavior within 8,000 characters.')
      return
    }
    setRunning(true)
    setResult(null)
    setResultId('')
    setRunError('')
    const evaluate = async () => {
      try {
        if (mode === 'DEMO') {
          await new Promise(resolve => window.setTimeout(resolve, 400))
          const evaluated = { ...evaluateDemo(transcript, evaluationContext, locale), expectedBehavior: evaluationContext }
          setResult(evaluated)
          const id = crypto.randomUUID(); setResultId(id); saveEvaluationMetadata(id, evaluated)
        } else {
          const response = await fetch('/api/evaluations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation: transcript, expectedBehavior: evaluationContext, language: language.name, locale }) })
          const body = await response.json() as { evaluation?: Evaluation; error?: { message?: string } }
          if (!response.ok || !body.evaluation) throw new Error(body.error?.message || `Evaluation failed (${response.status}).`)
          const evaluated = { ...body.evaluation, expectedBehavior: evaluationContext }
          setResult(evaluated)
          const id = crypto.randomUUID(); setResultId(id); saveEvaluationMetadata(id, evaluated)
        }
        window.setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
      } catch (error) {
        setRunError(error instanceof Error ? error.message : 'Evaluation failed. Please try again.')
      } finally { setRunning(false) }
    }
    void evaluate()
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#home" onClick={e => { e.preventDefault(); setPage('Overview') }}><span className="brand-mark">v<span>.</span></span><span>vaani<span className="brand-light">qa</span><small>VOICE QUALITY PLATFORM</small></span></a>
      <div className="workspace-label">WORKSPACE</div><button className="workspace"><span className="workspace-avatar">S</span><span>Studio North<small>Free workspace</small></span><span className="chevron">⌄</span></button>
      <div className="nav-label">PLATFORM</div><nav aria-label="Main navigation">{nav.map(item => <button key={item.name} className={`nav-item ${page === item.name ? 'selected' : ''}`} aria-label={item.name} title={item.name} onClick={() => setPage(item.name)}><span className="nav-icon"><NavGlyph name={item.icon} /></span><span>{item.name}</span>{'count' in item && <span className="nav-count">{item.count}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="usage"><div className="usage-head"><span>Monthly evaluations</span><span>68 / 100</span></div><div className="usage-track"><span /></div><button className="upgrade">Upgrade plan <span>↗</span></button></div><button className="profile"><span className="profile-avatar">AM</span><span>Alex Morgan<small>Admin</small></span><span className="profile-more">···</span></button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> {page}</div><div className="top-actions"><span className={`environment ${mode === 'LIVE' ? 'live-environment' : ''}`}><i /> {mode === 'LIVE' ? 'Live OpenAI' : 'Demo environment'}</span><span className="persistence-indicator" title="Persistence location">{persistenceMode === 'supabase' ? 'Supabase saved' : persistenceMode === 'checking' ? 'Checking storage…' : 'Local only'}</span><button className="icon-button" aria-label="Help">?</button><span className="top-avatar">AM</span></div></header>
      {persistenceNotice && <div className="persistence-notice" role="status">{persistenceNotice}</div>}
      {page === 'Agent Setup' ? <AgentSetup configuration={configuration} onChange={updateConfiguration} onSave={() => { try { browserScenarioRepository.saveConfiguration(configuration); setSetupSaved(true); setScenarioError(''); saveRemoteWorkspace(configuration) } catch { setScenarioError('Could not save setup in this browser.') } }} onGenerate={generateScenarios} saved={setupSaved} error={scenarioError} generating={generatingScenarios} /> : page === 'Scenario Library' ? <ScenarioLibrary scenarios={scenarios} configuration={configuration} selectedIds={selectedScenarioIds} generating={generatingScenarios} error={scenarioError} onSetup={() => setPage('Agent Setup')} onGenerate={generateScenarios} onToggle={id => setSelectedScenarioIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])} onUpdate={updateScenario} onPrepare={prepareTestRun} /> : page === 'Dataset' ? <DatasetBrowser records={datasetRecords} error={datasetError} storageMode={persistenceMode === 'supabase' ? 'supabase' : 'local'} onImport={draft => persistDataset(() => browserDatasetRepository.importRecord(draft))} onReview={(id, review) => persistDataset(() => browserDatasetRepository.addReview(id, review))} onApprove={id => persistDataset(() => browserDatasetRepository.approveRecord(id))} onReject={id => persistDataset(() => browserDatasetRepository.rejectRecord(id))} onEvaluate={evaluateDatasetConversation} /> : page === 'Test Lab' ? <div className="content">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> QUALITY WORKSPACE</div><h1>Test Lab</h1><p>See how naturally conversations communicate, one at a time.</p></div><button className="text-button" onClick={() => { setTranscript(''); setExpected(''); setResult(null); setImportedDatasetRecord(null); setDatasetTranscriptEdited(false); setPreparedScenarios([]); setSyntheticSample(false); setAudioFile(null) }}>＋ New test</button></div>
        <div className="scenario-row"><div className="scenario-left"><span className="scenario-dot" /><span className="scenario-title">{preparedScenarios.length ? `${preparedScenarios.length} scenario${preparedScenarios.length === 1 ? '' : 's'} prepared` : 'Manual transcript import'}</span><label className="sr-only" htmlFor="evaluation-language">Evaluation language</label><select id="evaluation-language" className="language-select" aria-label="Evaluation language" value={locale} onChange={event => { setLocale(event.target.value as SupportedLocale); setResult(null); setRunError('') }}>{SUPPORTED_LANGUAGES.map(option => <option value={option.locale} key={option.locale}>{option.name} · {option.locale}</option>)}</select></div><div className="scenario-right"><span className="autosave"><i /> All changes saved</span><button className="more-button" aria-label="More options">···</button></div></div>
        <div className="prepared-run-note agent-source-note"><strong>{configuration.name} · {configuration.provider === 'Universal/Manual' ? 'Manual/import mode' : `${configuration.provider} selected · not connected`}</strong><span>{configuration.agentId?.trim() ? `Agent ID ${configuration.agentId} is saved for reference only.` : ''} Paste a transcript or transcribe a recording; no agent has been invoked.</span><button onClick={() => setPage('Agent Setup')}>Agent setup</button></div>
        {importedDatasetRecord && <div className="prepared-run-note dataset-test-source"><strong>{getDatasetSourceTypeLabel(importedDatasetRecord.sourceType)} · rights: {importedDatasetRecord.usageRights} · review: {importedDatasetRecord.reviewStatus}</strong><span>{importedDatasetRecord.sourceDescription}{importedDatasetRecord.sourceType === 'voice-agent-transcript' ? ` · origin evidence supplied: ${importedDatasetRecord.originVerificationEvidence} (not independently verified)` : ''}{datasetTranscriptEdited ? ' · Transcript edited after import; attribution is retained.' : ''}</span></div>}
        {syntheticSample && <div className="prepared-run-note synthetic-sample-note"><strong>Synthetic demo sample · not a real conversation.</strong><span>Replace it with your imported transcript or prepare a selected scenario before evaluation.</span><button onClick={() => { setTranscript(''); setExpected(''); setSyntheticSample(false) }}>Clear sample</button></div>} 
        {preparedScenarios.length > 0 && <div className="prepared-run-note"><strong>Manual test prepared; no voice agent was invoked.</strong><span>Paste a real agent response below to evaluate it against the selected scenarios.</span><button onClick={() => setPreparedScenarios([])}>Clear</button></div>}
        <div className="input-grid"><section className="panel editor-panel"><div className="panel-heading"><div><span className="step">01</span><div className="heading-copy"><h2>Conversation</h2><p>Paste an imported transcript or sample conversation. No provider is connected in this MVP.</p></div></div><span className="optional">REQUIRED</span></div><label htmlFor="transcript">TURN-LABELED TRANSCRIPT OR SAMPLE CONVERSATION <span>· {transcript.length} characters</span></label><textarea id="transcript" lang={locale.split('-')[0]} maxLength={30000} value={transcript} onChange={e => { setTranscript(e.target.value); if (importedDatasetRecord) setDatasetTranscriptEdited(true); setSyntheticSample(false) }} placeholder="Paste an imported transcript or sample conversation..." /><div className="field-footer"><span className="language-chip"><span lang={locale.split('-')[0]}>{locale === 'ml-IN' ? 'അ' : 'அ'}</span> {language.name} <span className="muted">({locale})</span></span><span>Text input · No audio</span></div></section>
          <section className="panel editor-panel"><div className="panel-heading"><div><span className="step">02</span><div className="heading-copy"><h2>Expected behavior</h2><p>What should the agent understand and do?</p></div></div><span className="optional">RECOMMENDED</span></div><label htmlFor="expected">SCENARIO CONTEXT</label><textarea className="context-area" id="expected" maxLength={8000} value={expected} onChange={e => setExpected(e.target.value)} placeholder="Describe the correct answer or policy..." /><div className="field-footer"><span className="language-chip"><span>✳</span> Evaluation context</span><span>{expected.length} characters</span></div></section></div>
        <section className="panel recording-panel"><div><div className="eyebrow"><span className="eyebrow-line"/> RECORDING IMPORT</div><h2>Transcribe an existing call</h2><p>Supported audio is sent to OpenAI for transcription only. Do not upload patient information unless authorized. Review the transcript before evaluation; vocal delivery remains not evaluated.</p></div><label className="audio-picker">Choose recording<input id="audio-recording" type="file" accept=".mp3,.mp4,.m4a,.mpeg,.mpga,.wav,.webm,audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/webm" onChange={event => chooseAudio(event.currentTarget.files?.[0])}/></label>{audioFile && <div className="selected-audio"><strong>{audioFile.name}</strong><span>{(audioFile.size / 1024 / 1024).toFixed(2)} MB</span><button className="text-button" onClick={() => { setAudioFile(null); const picker = document.getElementById('audio-recording') as HTMLInputElement | null; if (picker) picker.value = '' }}>Remove</button><button className="run-button" onClick={transcribeAudio} disabled={transcribing}>{transcribing ? 'Transcribing…' : 'Transcribe recording'}</button></div>}{audioError && <p className="run-error" role="alert">{audioError}</p>}{audioStatus && <p className="audio-status" role="status">{audioStatus}</p>}<p className="audio-limit">MP3, MP4/M4A, MPEG, MPGA, WAV or WebM · up to 25 MB. Files are processed in memory and sent server-to-provider for transcription.</p></section>
        <div className="run-row"><div className="run-controls"><div className="mode-switch" role="group" aria-label="Evaluation mode"><button className={mode === 'DEMO' ? 'selected' : ''} onClick={() => { setMode('DEMO'); setResult(null); setRunError('') }}>Demo</button><button className={mode === 'LIVE' ? 'selected' : ''} onClick={() => { setMode('LIVE'); setResult(null); setRunError('') }}>Live OpenAI</button></div><div className="run-note"><span className="spark">✳</span> Language + context<span className="run-separator">·</span> <span className="audio-note">Audio required for vocal delivery</span></div></div><button className="run-button" onClick={runEvaluation} disabled={running || !transcript.trim()}>{running ? <><span className="spinner" /> Evaluating…</> : <>Run {mode === 'LIVE' ? 'live' : 'demo'} evaluation <span>↗</span></>}</button></div>
        {runError && <div className="run-error" role="alert">{runError}</div>}
        {!result ? <div className="empty-state"><div className="empty-icon"><NavGlyph name="lab" /></div><div><strong>Your next conversation, understood.</strong><p>Run an evaluation to see evidence-backed findings across language, context, and delivery.</p></div><span className="empty-shortcut">Enter</span></div> : <Results result={result} activeTab={activeTab} setActiveTab={setActiveTab} onFlag={() => { setReviewTarget(result); setPage('Human Review'); if (persistenceMode === 'supabase' && resultId) void fetch(`/api/persistence/evaluations/${resultId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'pending-native-review' }) }).catch(() => setPersistenceNotice('Review status could not be saved.')) }} />}
        <footer className="footnote"><span>VAANIQA <span className="foot-dot">·</span> BUILT FOR EVERY VOICE</span><span>Demo results use transparent rules. They are not live model evaluations.</span></footer>
      </div> : <SecondaryPage page={page as 'Overview' | 'Human Review' | 'Integrations'} setPage={setPage} reviewTarget={reviewTarget} onRecordReview={(rating, notes) => { if (persistenceMode === 'supabase' && resultId) void fetch(`/api/persistence/evaluations/${resultId}/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naturalnessRating: rating, notes }) }).then(response => { if (!response.ok) throw new Error() }).catch(() => setPersistenceNotice('Review could not be saved; no transcript was stored.')) }} />}
    </main>
  </div>
}

function Results({ result, activeTab, setActiveTab, onFlag }: { result: Evaluation; activeTab: 'comparison' | 'transcript'; setActiveTab: (tab: 'comparison' | 'transcript') => void; onFlag: () => void }) {
  return <section className="results" id="results"><div className="results-top"><div><div className="eyebrow"><span className="eyebrow-line" /> EVALUATION RESULTS <span className={result.mode === 'LIVE' ? 'live-badge' : 'demo-badge'}>{result.mode === 'LIVE' ? `LIVE · ${result.model ?? 'OPENAI'}` : 'DEMO'}</span></div><h2>{result.mode === 'LIVE' ? 'Model assessment, with room for review.' : 'Room to sound more like home.'}</h2><p>{result.mode === 'LIVE' ? 'OpenAI assessment of the supplied text. Native-speaker validation is not implied.' : 'Here’s what stood out in this conversation.'}</p></div><button className="export-button" onClick={() => window.print()}>Export report <span>↗</span></button></div>
    <div className="score-strip"><div className="overall-score"><span className="score-number">{result.overall}</span><span className="score-outof">/ 100</span><div><strong>Overall quality</strong><small>Needs attention</small></div></div><div className="score-dimensions">{result.findings.map((f, i) => <div className="mini-score" key={f.dimension}><span className="mini-index">0{i + 1}</span><span>{f.dimension}</span><span className={`mini-value ${f.score === null ? 'unrated' : ''}`}>{f.score === null ? '—' : f.score}</span></div>)}</div></div>
    <div className="evaluation-context-grid"><article><span>EXPECTED BEHAVIOR</span><p>{result.expectedBehavior || 'Not supplied.'}</p></article><article><span>OBSERVED CONVERSATION</span><p>{result.original}</p></article></div>
    <div className="finding-grid">{result.findings.map((f, i) => <article className={`finding-card ${f.score === null ? 'muted-card' : ''}`} key={f.dimension}><div className="finding-meta"><span className="finding-index">0{i + 1} / 03</span><span className={`finding-status ${f.score === null ? 'status-muted' : f.status === 'Strong' ? 'status-good' : 'status-warn'}`}><i />{f.status}</span></div><h3>{f.dimension}</h3>{f.score !== null ? <div className="finding-score">{f.score}<span> / 100</span></div> : <div className="no-score">Awaiting audio</div>}<div className="score-bar"><span style={{ width: `${f.score ?? 0}%` }} /></div><div className="evidence-label">{f.score === null ? 'WHAT’S NEEDED' : 'EVIDENCE'}</div><blockquote>{f.evidence}</blockquote><p className="finding-explanation">{f.explanation}</p></article>)}</div>
    <p className="dimension-limits">Current evaluator scores language naturalness and contextual judgment. Task completion and safety concerns are discussed within context; they are not scored as separate dimensions. Model findings are estimates and native-speaker validation is pending.</p>
    <div className="comparison panel"><div className="comparison-head"><div><div className="eyebrow"><span className="eyebrow-line" /> IMPROVEMENT SUGGESTION</div><h3>Keep the meaning. Find a more natural voice.</h3><p>Suggested wording requires native-speaker review.</p></div><div className="tab-switch"><button className={activeTab === 'comparison' ? 'active' : ''} onClick={() => setActiveTab('comparison')}>Compare</button><button className={activeTab === 'transcript' ? 'active' : ''} onClick={() => setActiveTab('transcript')}>Original</button></div></div>{activeTab === 'comparison' ? <div className="compare-columns"><div className="response"><div className="response-label"><span className="response-dot original-dot" /> ORIGINAL RESPONSE</div><p>{result.original}</p></div><div className="compare-arrow">→</div><div className="response suggested"><div className="response-label"><span className="response-dot" /> SUGGESTED ALTERNATIVE <span className="review-tag">REVIEW</span></div><p lang={result.locale?.split('-')[0] ?? 'ml'}>{result.alternative}</p>{result.alternativeRationale && <small>{result.alternativeRationale}</small>}<small>{result.mode === 'DEMO' ? 'Demo suggestion · Have a native speaker verify before use' : 'OpenAI suggestion · Not native-speaker validated'}</small></div></div> : <div className="transcript-view"><span className="response-label">ORIGINAL RESPONSE</span><p>{result.original}</p></div>}<div className="review-prompt"><span className="review-icon">✳</span><span><strong>Native speaker? Your judgment improves the signal.</strong><small>Rate naturalness and share a correction for this response.</small></span><button onClick={onFlag}>Flag for native-speaker review <span>→</span></button></div></div>
    <div className="result-disclaimer"><span>i</span> {result.mode === 'DEMO' ? 'Demo evaluation uses transparent text rules; it is not a live model result.' : 'OpenAI model estimate from text only; language naturalness is not native-speaker validation.'} Vocal delivery was not evaluated.{(result.uncertainty?.length ?? 0) > 0 && ` Uncertainty: ${result.uncertainty.join(' ')}`}</div>
    {result.missingEvidence.length > 0 && <div className="missing-evidence"><strong>Missing evidence</strong><span>{result.missingEvidence.join(' · ')}</span></div>}
  </section>
}

function SecondaryPage({ page, setPage, reviewTarget, onRecordReview }: { page: 'Overview' | 'Human Review' | 'Integrations'; setPage: (page: Page) => void; reviewTarget: Evaluation | null; onRecordReview: (rating: number, notes: string) => void }) {
  const [rating, setRating] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [reviewNotes, setReviewNotes] = useState('')

  const configs = {
    Overview: { label: 'YOUR WORKSPACE', title: 'Voice quality, at a glance.', desc: 'A clear view of what your agents sound like to the people who matter.' },
    'Human Review': { label: 'NATIVE SPEAKER PROGRAM', title: 'Human Review', desc: 'Bring native-speaker judgment into your evaluation loop.' },
    Integrations: { label: 'CONNECT YOUR STACK', title: 'Integrations', desc: 'Connect the systems that power your voice agents.' },
    'Test Lab': { label: 'QUALITY WORKSPACE', title: 'Test Lab', desc: '' },
  }
  const c = configs[page]
  return <div className="content secondary"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> {c.label}</div><h1>{c.title}</h1><p>{c.desc}</p></div>{page === 'Overview' && <button className="run-button" onClick={() => setPage('Test Lab')}>New evaluation <span>↗</span></button>}</div>
    {page === 'Overview' && <><div className="overview-kpis"><div className="kpi panel"><span>CONVERSATIONS EVALUATED</span><strong>248</strong><small>↑ 18% <span>vs. last month</span></small></div><div className="kpi panel"><span>AVERAGE QUALITY</span><strong>76<span className="kpi-unit">/100</span></strong><small className="lime">↑ 4.2 pts <span>vs. last month</span></small></div><div className="kpi panel"><span>NEEDS HUMAN REVIEW</span><strong>12</strong><small>Across 3 languages</small></div><div className="kpi panel"><span>LANGUAGES TESTED</span><strong>04</strong><small>Tamil, Hindi, Telugu +1</small></div></div><section className="panel overview-table"><div className="table-head"><div><h2>Recent evaluations</h2><p>The latest signals from your voice agents.</p></div><button className="quiet-button">View all →</button></div>{[['Tamil · Refund status', 'Needs attention', '64', '2 min ago'], ['Hindi · Appointment booking', 'Looking good', '88', '1 hour ago'], ['Telugu · Order tracking', 'Needs attention', '71', '3 hours ago']].map(row => <div className="table-row" key={row[0]}><span className="table-language"><span className="table-dot" />{row[0]}</span><span className={row[1] === 'Looking good' ? 'table-good' : 'table-warn'}>{row[1]}</span><strong>{row[2]}<small> / 100</small></strong><span className="table-time">{row[3]}</span></div>)}</section></>}
    {page === 'Human Review' && (reviewTarget ? <section className="panel review-card flagged-review"><div className="review-card-head"><div><span className="tag">Flagged for native-speaker review</span><span className="review-date">Current session only · not yet reviewed</span></div></div><div className="review-context"><strong>CONVERSATION</strong><span>{reviewTarget.original}</span></div><div className="review-context"><strong>EVALUATION</strong><span>{reviewTarget.mode === 'LIVE' ? `OpenAI ${reviewTarget.model ?? 'result'}` : 'Local demo result'} · {reviewTarget.locale ?? 'ml-IN'} · no native-speaker validation</span></div><div className="rating-block"><strong>Rate Malayalam naturalness</strong><p>Human review is separate from the model estimate. Preserve dialect and register differences.</p><div className="rating-options">{[1,2,3,4,5].map(value => <button key={value} onClick={() => setRating(value)} className={rating === value ? 'rating-selected' : ''} aria-label={`Rate naturalness ${value} out of 5`}>{value}</button>)}</div><label className="review-label" htmlFor="review-notes">CORRECTION OR DIALECT NOTES <span>OPTIONAL</span></label><textarea id="review-notes" value={reviewNotes} onChange={event => setReviewNotes(event.target.value)} placeholder="Suggested wording, dialect/register, or reason for disagreement" /></div><div className="review-actions"><span>{submitted ? 'Review noted in this session; no reviewer expertise was verified.' : rating ? `Rating selected: ${rating} / 5` : 'No human review has been submitted.'}</span><button className="run-button" disabled={!rating || submitted} onClick={() => { onRecordReview(rating, reviewNotes); setSubmitted(true) }}>{submitted ? 'Recorded' : 'Record review'}</button></div>{submitted && reviewNotes && <p className="review-session-notes">Reviewer notes: {reviewNotes}</p>}<p className="integration-foot">This review is saved only when Supabase is configured; otherwise it remains in memory until reload. It does not mark the result as human-validated.</p></section> : <div className="empty-state"><div><strong>No result flagged in this session.</strong><p>Run an evaluation, then choose “Flag for native-speaker review” in its result.</p></div></div>)}    {page === 'Integrations' && <><div className="integration-note"><span>↗</span><div><strong>Provider connections are coming soon.</strong><p>VaaniQA is designed to evaluate conversations from the voice platforms you already use.</p></div><span className="coming-soon">IN DEVELOPMENT</span></div><div className="integration-list">{[['✳', 'OpenAI', 'Server-side evaluation adapter', 'Planned'], ['◈', 'Supabase', 'Optional server-only MVP persistence', 'Optional'], ['API', 'Bring your own', 'Webhook endpoint for any voice provider', 'Planned']].map(x => <div className="integration-row panel" key={x[1]}><span className="integration-icon">{x[0]}</span><div><strong>{x[1]}</strong><small>{x[2]}</small></div><span className="planned-tag">{x[3]}</span><button className="disabled-connect" disabled>Configure</button></div>)}</div><p className="integration-foot">API keys stay on your server. No provider credentials are collected in this demo.</p></>}
  </div>
}

export default App
