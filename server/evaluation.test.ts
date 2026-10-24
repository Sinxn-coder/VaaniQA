import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createApp } from './app.js'
import { type EvaluationProvider, InvalidModelOutputError, ProviderConfigurationError, ProviderRateLimitError, buildEvaluationInstructions, calculateOverallScore, createOpenAIEvaluationProvider, evaluationInputSchema, findTranscriptEvidenceTurn, modelEvaluationSchema, toUiEvaluation, evaluateConversation } from './evaluation.js'
import { DEFAULT_LOCALE, SUPPORTED_LANGUAGES } from '../src/evaluation/languages.js'
import { evaluateDemo } from '../src/evaluation/demoEvaluator.js'

const validResult = {
  languageNaturalness: { score: 76, evidence: 'Hello', explanation: 'The greeting is natural, though the mixed-language phrase needs review.', uncertainty: ['The target dialect is not specified.'] },
  contextualAppropriateness: { score: 81, evidence: 'Hello', explanation: 'This matches the expected behavior, but the exact policy was not supplied.', uncertainty: [] },
  suggestedAlternative: { wording: 'Your refund is on its way.', rationale: 'Keeps the confirmation concise.' },
  uncertainty: ['No regional preference was provided.'],
  missingEvidence: ['Native-speaker review'],
}
const validInput = { conversation: 'Hello', expectedBehavior: 'Greet the customer', language: 'Malayalam', locale: 'ml-IN' } as const

let server: Server
let baseUrl: string

async function start(provider: EvaluationProvider) {
  const app = createApp(provider)
  server = await new Promise<Server>(resolve => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running))
  })
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
}

async function stop() {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

before(async () => { await start(async () => validResult) })
after(stop)

test('response schema validates separate evidence-backed dimensions and uncertainty', () => {
  const parsed = modelEvaluationSchema.safeParse(validResult)
  assert.equal(parsed.success, true)
  assert.equal(modelEvaluationSchema.safeParse({ ...validResult, languageNaturalness: validResult.contextualAppropriateness }).success, true)
  assert.equal(modelEvaluationSchema.safeParse({ ...validResult, extra: 'unexpected' }).success, false)
})

test('model scores accept only integer values from 0 through 100', () => {
  const withScores = (language: number, context: number) => ({
    ...validResult,
    languageNaturalness: { ...validResult.languageNaturalness, score: language },
    contextualAppropriateness: { ...validResult.contextualAppropriateness, score: context },
  })
  assert.equal(modelEvaluationSchema.safeParse(withScores(0, 100)).success, true)
  assert.equal(modelEvaluationSchema.safeParse(withScores(-1, 50)).success, false)
  assert.equal(modelEvaluationSchema.safeParse(withScores(50, 101)).success, false)
  assert.equal(modelEvaluationSchema.safeParse(withScores(4.5, 50)).success, false)
})

test('UI mapping preserves dimension scores without rescaling or fallback values', () => {
  const fourPointLookingScores = {
    ...validResult,
    languageNaturalness: { ...validResult.languageNaturalness, score: 4 },
    contextualAppropriateness: { ...validResult.contextualAppropriateness, score: 4 },
  }
  const mapped = toUiEvaluation(fourPointLookingScores, 'Sample conversation', 'gpt-4.1-mini', 'Malayalam', 'ml-IN')
  assert.equal(mapped.findings[0].score, 4)
  assert.equal(mapped.findings[1].score, 4)
  assert.equal(mapped.overall, 4)
})

test('overall quality is the rounded mean of the two dimension scores', () => {
  assert.equal(calculateOverallScore(27, 84), 56)
  assert.equal(calculateOverallScore(72, 91), 82)
})

test('Malayalam is the first supported language and the default locale', () => {
  assert.equal(SUPPORTED_LANGUAGES[0].name, 'Malayalam')
  assert.equal(DEFAULT_LOCALE, 'ml-IN')
  const demo = evaluateDemo('നമസ്കാരം! I can help.', 'Greet and offer help.', DEFAULT_LOCALE)
  assert.equal(demo.locale, 'ml-IN')
  assert.equal(demo.findings[0].status, 'Needs review')
  assert.match(demo.findings[0].evidence, /not treated as an error/)
})

test('selected language and locale reach the evaluator and model instructions', async () => {
  let received: { language: string; locale: string } | undefined
  await stop()
  await start(async input => { received = input; return validResult })
  const response = await fetch(`${baseUrl}/api/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...validInput, language: 'Tamil', locale: 'ta-IN' }) })
  assert.equal(response.status, 200)
  assert.deepEqual(received, { ...validInput, language: 'Tamil', locale: 'ta-IN' })
  const body = await response.json() as { evaluation: { language: string; locale: string } }
  assert.deepEqual({ language: body.evaluation.language, locale: body.evaluation.locale }, { language: 'Tamil', locale: 'ta-IN' })
  const instruction = buildEvaluationInstructions('Malayalam', 'ml-IN')
  assert.match(instruction, /Malayalam \(ml-IN\)/)
  assert.match(instruction, /do not penalize English words by themselves/i)
  assert.match(instruction, /integer score from 0 to 100/i)
})

test('Malayalam improvement instructions preserve source wording and avoid unsupported quality claims', () => {
  const instruction = buildEvaluationInstructions('Malayalam', 'ml-IN')
  assert.match(instruction, /natural, conversational Malayalam/i)
  assert.match(instruction, /Familiar Malayalam-English code-switching/i)
  assert.match(instruction, /malformed tokens that join Malayalam and Latin scripts/i)
  assert.match(instruction, /literal translations that sound unnatural/i)
  assert.match(instruction, /Keep the original conversation unchanged/i)
  assert.match(instruction, /has not been reviewed by a native speaker/i)
  assert.match(instruction, /cannot guarantee native-level quality/i)
})

test('evaluation rejects malformed mixed-script suggestions and unsupported review claims', async () => {
  await assert.rejects(() => evaluateConversation(validInput, async () => ({
    ...validResult, suggestedAlternative: { ...validResult.suggestedAlternative, wording: '\u0d28\u0d2e\u0d38\u0d4d\u0d15\u0d3e\u0d30\u0d02appointment' },
  })), InvalidModelOutputError)
  await assert.rejects(() => evaluateConversation(validInput, async () => ({
    ...validResult, suggestedAlternative: { ...validResult.suggestedAlternative, rationale: 'Validated by native speakers.' },
  })), InvalidModelOutputError)
  await assert.rejects(() => evaluateConversation(validInput, async () => ({
    ...validResult, suggestedAlternative: { ...validResult.suggestedAlternative, rationale: 'Native reviewers have approved this wording.' },
  })), InvalidModelOutputError)
  const codeSwitched = await evaluateConversation(validInput, async () => ({
    ...validResult, suggestedAlternative: { ...validResult.suggestedAlternative, wording: '\u0d28\u0d2e\u0d38\u0d4d\u0d15\u0d3e\u0d30\u0d02, appointment.' },
  }))
  assert.match(codeSwitched.suggestedAlternative.wording, /appointment/)
})

test('evaluation rejects missing or unsupported transcript evidence', async () => {
  await assert.rejects(() => evaluateConversation(validInput, async () => ({
    ...validResult, languageNaturalness: { ...validResult.languageNaturalness, evidence: '' },
  })), InvalidModelOutputError)
  await assert.rejects(() => evaluateConversation(validInput, async () => ({
    ...validResult, contextualAppropriateness: { ...validResult.contextualAppropriateness, evidence: 'The caller confirms a refund.' },
  })), InvalidModelOutputError)
})

test('evaluation retries one transient invalid provider result', async () => {
  let attempts = 0
  const evaluated = await evaluateConversation(validInput, async () => {
    attempts += 1
    return attempts === 1 ? { malformed: true } : validResult
  })
  assert.equal(attempts, 2)
  assert.deepEqual(evaluated, validResult)
})

test('evaluation keeps the source separate and adds a turn reference for exact evidence', async () => {
  const conversation = ' \nCaller: Hello, can you help?\nAgent: Yes, I can help. \t'
  const input = { ...validInput, conversation }
  let providerConversation = ''
  const evaluated = await evaluateConversation(input, async received => {
    providerConversation = received.conversation
    return { ...validResult, contextualAppropriateness: { ...validResult.contextualAppropriateness, evidence: 'Yes, I can help.' } }
  })
  const mapped = toUiEvaluation(evaluated, conversation, 'gpt-4.1-mini', 'Malayalam', 'ml-IN')
  assert.equal(providerConversation, conversation)
  assert.equal(mapped.original, conversation)
  assert.equal(mapped.alternative, validResult.suggestedAlternative.wording)
  assert.equal(mapped.findings[0].evidence, 'Turn 1 · Caller: Hello')
  assert.equal(mapped.findings[1].evidence.endsWith('Agent: Yes, I can help.'), true)
  assert.deepEqual(findTranscriptEvidenceTurn(conversation, 'Yes, I can help.'), { turn: 2, speaker: 'Agent' })
  assert.deepEqual(findTranscriptEvidenceTurn(conversation, 'Caller: Hello, can you help?'), { turn: 1, speaker: 'Caller' })
  const labeledEvidence = toUiEvaluation({
    ...evaluated,
    languageNaturalness: { ...evaluated.languageNaturalness, evidence: 'Caller: Hello, can you help?' },
    contextualAppropriateness: { ...evaluated.contextualAppropriateness, evidence: 'Agent: Yes, I can help.' },
  }, conversation, 'gpt-4.1-mini', 'Malayalam', 'ml-IN')
  assert.equal(labeledEvidence.findings[0].evidence.startsWith('Turn 1 '), true)
  assert.equal(labeledEvidence.findings[1].evidence.startsWith('Turn 2 '), true)
})

test('evaluation input rejects whitespace-only transcript but preserves other whitespace', () => {
  const conversation = '\n  Caller: hello  \n'
  const parsed = evaluationInputSchema.parse({ ...validInput, conversation })
  assert.equal(parsed.conversation, conversation)
  assert.equal(evaluationInputSchema.safeParse({ ...validInput, conversation: ' \n\t ' }).success, false)
})

test('evaluation API returns the transcript source byte-for-byte as submitted', async () => {
  await stop()
  await start(async () => validResult)
  const conversation = ' \nCaller: Hello\nAgent: Yes. \t'
  const response = await fetch(`${baseUrl}/api/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...validInput, conversation }) })
  assert.equal(response.status, 200)
  const body = await response.json() as { evaluation: { original: string } }
  assert.equal(body.evaluation.original, conversation)
})

test('evaluation input accepts long labeled conversations up to the documented limit', () => {
  assert.equal(evaluationInputSchema.safeParse({ ...validInput, conversation: `Caller: ${'x'.repeat(29_992)}` }).success, true)
  assert.equal(evaluationInputSchema.safeParse({ ...validInput, conversation: `Caller: ${'x'.repeat(29_993)}` }).success, false)
})

test('missing input returns 400 and does not call the provider', async () => {
  let called = false
  await stop()
  await start(async () => { called = true; return validResult })
  const response = await fetch(`${baseUrl}/api/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation: '' }) })
  assert.equal(response.status, 400)
  assert.equal(called, false)
})

test('live evaluation fails safely when no API key is configured', async () => {
  const provider = createOpenAIEvaluationProvider({ apiKey: '' })
  await assert.rejects(() => provider(validInput), ProviderConfigurationError)
})

test('live endpoint reports missing OpenAI configuration without returning a fake result', async () => {
  await stop()
  await start(createOpenAIEvaluationProvider({ apiKey: '' }))
  const response = await fetch(`${baseUrl}/api/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validInput) })
  assert.equal(response.status, 503)
  const body = await response.json() as { error: { code: string; message: string }; evaluation?: unknown }
  assert.equal(body.error.code, 'not_configured')
  assert.match(body.error.message, /not configured on the server/i)
  assert.equal(body.evaluation, undefined)
})

test('invalid model output is rejected with a safe 502 response', async () => {
  await stop()
  await start(async () => ({ ...validResult, contextualAppropriateness: { score: 120 } }))
  const response = await fetch(`${baseUrl}/api/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validInput) })
  assert.equal(response.status, 502)
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'invalid_provider_output')
})

test('provider failures return safe errors and provider rate limits return 429', async () => {
  await stop()
  await start(async () => { throw new Error('private provider details') })
  const failure = await fetch(`${baseUrl}/api/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validInput) })
  assert.equal(failure.status, 502)
  assert.doesNotMatch(await failure.text(), /private provider details/)

  await stop()
  await start(async () => { throw new ProviderRateLimitError('private rate-limit details') })
  const limited = await fetch(`${baseUrl}/api/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validInput) })
  assert.equal(limited.status, 429)
  assert.ok(limited.headers.get('retry-after') || (await limited.json() as { error: { code: string } }).error.code === 'provider_rate_limited')
})

test('API request rate limit returns 429 with Retry-After', async () => {
  await stop()
  await start(async () => validResult)
  let last: Response | undefined
  for (let index = 0; index < 21; index += 1) {
    last = await fetch(`${baseUrl}/api/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validInput) })
  }
  assert.equal(last?.status, 429)
  assert.ok(Number(last?.headers.get('retry-after')) > 0)
})

test('successful response is marked live and delivery is explicitly unevaluated', async () => {
  await stop()
  await start(async () => validResult)
  const response = await fetch(`${baseUrl}/api/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validInput) })
  assert.equal(response.status, 200)
  const body = await response.json() as { evaluation: { mode: string; findings: Array<{ dimension: string; score: number | null; status: string }> } }
  assert.equal(body.evaluation.mode, 'LIVE')
  assert.deepEqual(body.evaluation.findings.slice(0, 2).map(finding => finding.dimension), ['Language naturalness', 'Contextual judgment'])
  assert.deepEqual(body.evaluation.findings[2], { dimension: 'Vocal delivery', score: null, status: 'Not evaluated', evidence: 'No audio recording provided.', explanation: 'Upload a recording and use a supported audio evaluation path to evaluate vocal delivery.' })
})
