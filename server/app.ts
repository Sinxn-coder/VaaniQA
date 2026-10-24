import express, { type NextFunction, type Request, type Response } from 'express'
import { evaluateConversation, type EvaluationProvider, InputValidationError, InvalidModelOutputError, ProviderConfigurationError, ProviderError, ProviderRateLimitError, toUiEvaluation } from './evaluation.js'
import { createOpenAIScenarioProvider, generateScenarioLibrary, ScenarioConfigurationError, ScenarioInputError, ScenarioOutputError, ScenarioProviderError, ScenarioRateLimitError, type ScenarioGenerationProvider } from './scenarios.js'
import { AudioConfigurationError, AudioInputError, AudioProviderError, AudioRateLimitError, MAX_AUDIO_BYTES, type AudioTranscriber, validateAudioUpload } from './transcription.js'
import { isLocalPersistenceRequest, persistenceSchemas, type PersistenceStore } from './persistence.js'
import { randomUUID } from 'node:crypto'

export function createApp(provider: EvaluationProvider, scenarioProvider: ScenarioGenerationProvider = createOpenAIScenarioProvider(), audioTranscriber?: AudioTranscriber, persistenceStore?: PersistenceStore) {
  const app = express()
  const windowMs = 60_000
  const maxRequests = 20
  const buckets = new Map<string, { start: number; count: number }>()

  app.disable('x-powered-by')
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    const key = req.ip ?? 'unknown'
    let bucket = buckets.get(key)
    if (!bucket || now - bucket.start >= windowMs) {
      bucket = { start: now, count: 0 }
      buckets.set(key, bucket)
    }
    bucket.count += 1
    res.setHeader('RateLimit-Limit', maxRequests)
    res.setHeader('RateLimit-Remaining', Math.max(0, maxRequests - bucket.count))
    if (bucket.count > maxRequests) {
      res.setHeader('Retry-After', Math.ceil((bucket.start + windowMs - now) / 1000))
      res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' } })
      return
    }
    if (buckets.size > 1_000) for (const [ip, value] of buckets) if (now - value.start >= windowMs) buckets.delete(ip)
    next()
  })
  app.use(express.json({ limit: '128kb', strict: true }))

  app.use('/api/persistence', (req, res, next) => {
    if (!isLocalPersistenceRequest(req.socket.remoteAddress ?? '', req.header('origin'), req.header('host'))) {
      res.status(403).json({ error: { code: 'local_only', message: 'Persistence is available only from the local development app.' } })
      return
    }
    next()
  })
  app.get('/api/persistence/status', (_req, res) => res.json({ mode: persistenceStore ? 'supabase' : 'local' }))
  app.get('/api/persistence/bootstrap', async (_req, res) => {
    if (!persistenceStore) { res.status(503).json({ error: { code: 'not_configured', message: 'Supabase persistence is not configured; using this browser storage.' } }); return }
    try { res.json(await persistenceStore.loadWorkspace()) }
    catch { res.status(503).json({ error: { code: 'unavailable', message: 'Supabase could not load saved workspace data.' } }) }
  })
  app.put('/api/persistence/workspace', async (req, res) => {
    if (!persistenceStore) { res.status(503).json({ error: { code: 'not_configured', message: 'Supabase persistence is not configured.' } }); return }
    const body = req.body as { configuration?: unknown; scenarios?: unknown }
    if (!body || typeof body.configuration !== 'object' || !Array.isArray(body.scenarios) || body.scenarios.length > 500) { res.status(400).json({ error: { code: 'invalid_input', message: 'Workspace data is invalid.' } }); return }
    try { await persistenceStore.saveWorkspace(body.configuration, body.scenarios); res.json({ saved: true }) }
    catch { res.status(503).json({ error: { code: 'unavailable', message: 'Supabase could not save workspace data.' } }) }
  })
  app.put('/api/persistence/dataset', async (req, res) => {
    if (!persistenceStore) { res.status(503).json({ error: { code: 'not_configured', message: 'Supabase persistence is not configured.' } }); return }
    const parsed = persistenceSchemas.datasetRecordsSchema.safeParse(req.body?.records)
    if (!parsed.success) { res.status(400).json({ error: { code: 'invalid_input', message: 'Dataset data is invalid, missing documented usage rights, or contains obvious patient identifiers.' } }); return }
    try { await persistenceStore.saveDataset(parsed.data); res.json({ saved: true }) }
    catch { res.status(503).json({ error: { code: 'unavailable', message: 'Supabase could not save dataset records.' } }) }
  })
  app.post('/api/persistence/evaluations', async (req, res) => {
    if (!persistenceStore) { res.status(503).json({ error: { code: 'not_configured', message: 'Supabase persistence is not configured.' } }); return }
    const parsed = persistenceSchemas.evaluationSummarySchema.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: { code: 'invalid_input', message: 'Evaluation summary is invalid.' } }); return }
    try { await persistenceStore.saveEvaluation(parsed.data); res.json({ saved: true }) }
    catch { res.status(503).json({ error: { code: 'unavailable', message: 'Supabase could not save evaluation metadata.' } }) }
  })
  app.patch('/api/persistence/evaluations/:id/status', async (req, res) => {
    if (!persistenceStore) { res.status(503).json({ error: { code: 'not_configured', message: 'Supabase persistence is not configured.' } }); return }
    const status = req.body?.status
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id) || !['pending-native-review', 'reviewed'].includes(status)) { res.status(400).json({ error: { code: 'invalid_input', message: 'Review status is invalid.' } }); return }
    try { await persistenceStore.updateEvaluationStatus(req.params.id, status); res.json({ saved: true }) }
    catch { res.status(503).json({ error: { code: 'unavailable', message: 'Supabase could not update review status.' } }) }
  })
  app.post('/api/persistence/evaluations/:id/reviews', async (req, res) => {
    if (!persistenceStore) { res.status(503).json({ error: { code: 'not_configured', message: 'Supabase persistence is not configured.' } }); return }
    const parsed = persistenceSchemas.evaluationReviewSchema.safeParse({ ...req.body, evaluationId: req.params.id, id: randomUUID() })
    if (!parsed.success || /\b(?:ssn|patient\s*id|medical\s*record|phone|email)\b/i.test(parsed.success ? parsed.data.notes : '')) { res.status(400).json({ error: { code: 'invalid_input', message: 'Review data is invalid or may contain personal information.' } }); return }
    try { await persistenceStore.addEvaluationReview(parsed.data); res.json({ saved: true }) }
    catch { res.status(503).json({ error: { code: 'unavailable', message: 'Supabase could not save the review.' } }) }
  })

  app.post('/api/evaluations', async (req, res) => {
    try {
      const data = await evaluateConversation(req.body, provider)
      const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'
      res.json({ evaluation: toUiEvaluation(data, req.body.conversation, model, req.body.language, req.body.locale) })
    } catch (error) {
      if (error instanceof InputValidationError) {
        res.status(400).json({ error: { code: 'invalid_input', message: 'Provide a conversation and expected behavior within the supported length limits.' } })
      } else if (error instanceof ProviderConfigurationError) {
        res.status(503).json({ error: { code: 'not_configured', message: 'Live evaluation is not configured on the server.' } })
      } else if (error instanceof ProviderRateLimitError) {
        res.status(429).json({ error: { code: 'provider_rate_limited', message: 'The evaluation provider is rate limited. Try again shortly.' } })
      } else if (error instanceof InvalidModelOutputError) {
        res.status(502).json({ error: { code: 'invalid_provider_output', message: 'The evaluation provider returned an invalid result. Please try again.' } })
      } else if (error instanceof ProviderError) {
        res.status(502).json({ error: { code: 'provider_error', message: 'The evaluation provider could not complete this request.' } })
      } else {
        res.status(500).json({ error: { code: 'server_error', message: 'The request could not be completed.' } })
      }
    }
  })

  app.post('/api/transcriptions', express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }), async (req, res) => {
    try {
      if (!audioTranscriber) throw new AudioConfigurationError('Audio transcription is not configured')
      const encodedName = req.header('x-audio-filename') ?? ''
      let filename = ''
      try { filename = decodeURIComponent(encodedName) } catch { throw new AudioInputError('Invalid filename') }
      const upload = validateAudioUpload({ bytes: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), filename, contentType: req.header('content-type') ?? '', locale: req.header('x-locale') ?? 'ml-IN' })
      const transcript = await audioTranscriber(upload)
      res.json({ transcript, source: 'OPENAI_TRANSCRIPTION', vocalDelivery: 'NOT_EVALUATED' })
    } catch (error) {
      if (error instanceof AudioInputError) res.status(400).json({ error: { code: 'invalid_audio', message: 'Choose a supported audio file and try again.' } })
      else if (error instanceof AudioConfigurationError) res.status(503).json({ error: { code: 'not_configured', message: 'Audio transcription is not configured on the server.' } })
      else if (error instanceof AudioRateLimitError) res.status(429).json({ error: { code: 'provider_rate_limited', message: 'Transcription is rate limited. Try again shortly.' } })
      else if (error instanceof AudioProviderError) res.status(502).json({ error: { code: 'provider_error', message: 'The transcription provider could not complete this request.' } })
      else res.status(500).json({ error: { code: 'server_error', message: 'The recording could not be transcribed.' } })
    }
  })

  app.post('/api/scenarios/generate', async (req, res) => {
    try {
      const scenarios = await generateScenarioLibrary(req.body, scenarioProvider)
      res.json({ scenarios })
    } catch (error) {
      if (error instanceof ScenarioInputError) {
        res.status(400).json({ error: { code: 'invalid_setup', message: 'Check the agent setup fields and remove any patient-identifying information before generation.' } })
      } else if (error instanceof ScenarioConfigurationError) {
        res.status(503).json({ error: { code: 'not_configured', message: 'Scenario generation is not configured on the server.' } })
      } else if (error instanceof ScenarioRateLimitError) {
        res.status(429).json({ error: { code: 'provider_rate_limited', message: 'The scenario provider is rate limited. Try again shortly.' } })
      } else if (error instanceof ScenarioOutputError) {
        res.status(502).json({ error: { code: `scenario_${error.reason}`, message: error.message } })
      } else if (error instanceof ScenarioProviderError) {
        res.status(502).json({ error: { code: 'scenario_provider_error', message: error.providerStatus ? `OpenAI scenario generation failed (HTTP ${error.providerStatus}). Try again or check server configuration.` : error.message } })
      } else {
        res.status(500).json({ error: { code: 'server_error', message: 'Scenario generation could not be completed.' } })
      }
    }
  })

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 500
    if (status === 413) {
      res.status(413).json({ error: { code: 'payload_too_large', message: _req.path === '/api/transcriptions' ? 'Recording exceeds the 25 MB limit.' : 'Request body exceeds the 128 KB limit.' } })
      return
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: { code: 'invalid_json', message: 'The request body must be valid JSON.' } })
      return
    }
    res.status(500).json({ error: { code: 'server_error', message: 'The request could not be completed.' } })
  })
  return app
}
