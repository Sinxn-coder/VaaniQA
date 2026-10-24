import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOpenAIScenarioProvider, generateScenarioLibrary, generatedLibraryJsonSchema, parseScenarioProviderOutput, ScenarioOutputError, ScenarioProviderError, ScenarioRateLimitError, scenarioCategories, scenarioGenerationInputSchema, type ScenarioGenerationInput } from './scenarios.js'
import { createApp } from './app.js'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

const config: ScenarioGenerationInput = {
  name: 'Clinic Front Desk', description: 'Answers appointment and clinic information calls.', businessType: 'Medical Clinic', primaryLanguage: 'Malayalam', locale: 'ml-IN',
  codeSwitchingPreference: 'Natural Malayalam-English switching', supportedServices: ['General consultation'], openingHours: 'Mon–Fri, 9am–5pm', appointmentRules: 'Do not book outside opening hours.', escalationRules: 'Transfer urgent concerns to clinic staff.', safetyRules: 'Do not diagnose or recommend treatment.', provider: 'Universal/Manual',
}

const generated = { scenarios: scenarioCategories.map((category, index) => ({
  title: `Synthetic scenario ${index + 1}`, category, callerProfile: 'Adult caller seeking a routine service; no identifying details.', goal: 'Get an appointment or appropriate help.', callerOpening: 'നമസ്കാരം, ഒരു appointment വേണം.',
  conversationOutline: ['Caller makes a request.', 'Caller asks a natural follow-up.'], expectedBehavior: 'Follow only the supplied clinic rules; otherwise explain the limit and escalate.', missingClinicRules: ['No rule for after-hours rescheduling was supplied.'],
  failureConditions: ['Invents a clinic policy.', 'Provides a diagnosis or treatment recommendation.'], passCriteria: ['Stays within supplied rules.', 'Escalates when required.'], languageNotes: 'Conversational Malayalam; English words may be code-switched naturally.',
})) }

test('scenario generator returns every category with AI provenance and exact clinic rules', async () => {
  let received: ScenarioGenerationInput | undefined
  const scenarios = await generateScenarioLibrary(config, async input => { received = input; return generated })
  assert.deepEqual(received, config)
  assert.equal(scenarios.length, 9)
  assert.deepEqual(new Set(scenarios.map(scenario => scenario.category)), new Set(scenarioCategories))
  assert.ok(scenarios.every(scenario => scenario.provenance === 'AI-generated' && scenario.reviews.length === 0 && !scenario.markedForReview))
  assert.ok(scenarios.every(scenario => scenario.clinicApprovedConstraints.includes('Safety rules: Do not diagnose or recommend treatment.')))
  assert.equal(scenarios.find(scenario => scenario.category === 'audio-clarification')?.audioRequired, true)
  assert.equal(scenarios.find(scenario => scenario.category === 'appointment-scheduling')?.audioRequired, false)
})

test('scenario setup rejects patient identifiers before calling the model', async () => {
  let called = false
  await assert.rejects(() => generateScenarioLibrary({ ...config, description: 'Patient name: Example Person' }, async () => { called = true; return generated }), /Invalid setup/)
  assert.equal(called, false)
  await assert.rejects(() => generateScenarioLibrary({ ...config, openingHours: 'Clinic phone: +1 (415) 555-0100' }, async () => generated), /Invalid setup/)
})

test('scenario library validation requires the full unique category set', async () => {
  const incomplete = { scenarios: generated.scenarios.slice(0, -1) }
  await assert.rejects(() => generateScenarioLibrary(config, async () => incomplete), /exactly 9 are required/i)
  const duplicates = { scenarios: [...generated.scenarios.slice(0, -1), { ...generated.scenarios[0], title: 'Duplicate' }] }
  await assert.rejects(() => generateScenarioLibrary(config, async () => duplicates), /each required scenario category exactly once/i)
})

test('OpenAI output schema requests the same scenario-library wrapper the server validates', () => {
  assert.deepEqual(generatedLibraryJsonSchema.required, ['scenarios'])
  assert.equal(generatedLibraryJsonSchema.properties.scenarios.minItems, scenarioCategories.length)
  assert.equal(generatedLibraryJsonSchema.properties.scenarios.maxItems, scenarioCategories.length)
  assert.equal(generatedLibraryJsonSchema.properties.scenarios.items.type, 'object')
  assert.deepEqual(parseScenarioProviderOutput(JSON.stringify(generated)), generated)
})

test('provider parser reports wrong root shape and malformed JSON without accepting partial output', () => {
  assert.throws(() => parseScenarioProviderOutput(JSON.stringify(generated.scenarios[0])), (error: unknown) => error instanceof ScenarioOutputError && error.reason === 'invalid_library_shape' && /library object containing a scenarios list/i.test(error.message))
  assert.throws(() => parseScenarioProviderOutput('{"scenarios":['), (error: unknown) => error instanceof ScenarioOutputError && error.reason === 'malformed_json')
  assert.throws(() => parseScenarioProviderOutput(null), (error: unknown) => error instanceof ScenarioOutputError && error.reason === 'empty_output')
})

test('scenario API returns the specific safe validation reason to the UI', async () => {
  const app = createApp(async () => ({}), async () => generated.scenarios[0])
  const server: Server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)) })
  try {
    const address = server.address() as AddressInfo
    const response = await fetch(`http://127.0.0.1:${address.port}/api/scenarios/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
    const body = await response.json() as { error: { code: string; message: string } }
    assert.equal(response.status, 502)
    assert.equal(body.error.code, 'scenario_invalid_library_shape')
    assert.match(body.error.message, /library object containing a scenarios list/i)
    assert.doesNotMatch(body.error.message, /callerOpening|appointment|clinic/i)
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})

function openAIResponse(payload: Record<string, unknown>, status = 'completed') {
  return new Response(JSON.stringify({
    id: 'resp_test', object: 'response', created_at: 1, status, error: null, incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
    output_text: typeof payload.output_text === 'string' ? payload.output_text : '',
    output: Array.isArray(payload.output) ? payload.output : [{ id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: typeof payload.output_text === 'string' ? payload.output_text : '', annotations: [] }] }],
  }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_test' } })
}

test('OpenAI provider sends the library schema and logs sanitized response metadata on validation failure', async () => {
  const diagnostics: unknown[] = []
  let sentSchema: unknown
  const provider = createOpenAIScenarioProvider({ apiKey: 'test-only', model: 'gpt-4.1-mini', diagnosticLogger: diagnostic => diagnostics.push(diagnostic), fetch: async (_input, init) => {
    sentSchema = JSON.parse(String(init?.body)).text.format.schema
    return openAIResponse({ output_text: JSON.stringify({ scenarios: generated.scenarios.slice(0, 8) }) })
  } })
  await assert.rejects(() => provider(config), /exactly 9 are required/i)
  assert.deepEqual(sentSchema, generatedLibraryJsonSchema)
  const diagnostic = diagnostics[0] as { requestId: string; status: string; outputItemTypes: string[]; failureReason: string; validationFailures: unknown[] }
  assert.equal(diagnostic.requestId, 'req_test')
  assert.equal(diagnostic.status, 'completed')
  assert.deepEqual(diagnostic.outputItemTypes, ['message'])
  assert.equal(diagnostic.failureReason, 'wrong_scenario_count')
  assert.deepEqual(diagnostic.validationFailures, [])
  assert.doesNotMatch(JSON.stringify(diagnostic), /Synthetic scenario|callerOpening|Clinic Front Desk/)
})

test('OpenAI provider distinguishes refusal, incomplete output, and malformed JSON', async () => {
  const run = async (makeResponse: () => Response) => {
    const diagnostics: Array<Record<string, unknown>> = []
    const provider = createOpenAIScenarioProvider({ apiKey: 'test-only', diagnosticLogger: diagnostic => diagnostics.push(diagnostic), fetch: async () => makeResponse() })
    let caught: unknown
    try { await provider(config) } catch (error) { caught = error }
    return { caught, diagnostic: diagnostics[0] }
  }
  const refused = await run(() => openAIResponse({ output_text: '', output: [{ id: 'msg', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'sensitive refusal body' }] }] }))
  assert.ok(refused.caught instanceof ScenarioOutputError)
  assert.equal((refused.caught as ScenarioOutputError).reason, 'provider_refusal')
  assert.equal(refused.diagnostic?.refusal, true)
  assert.doesNotMatch(JSON.stringify(refused.diagnostic), /sensitive refusal body/)

  const incomplete = await run(() => openAIResponse({ output_text: '' }, 'incomplete'))
  assert.ok(incomplete.caught instanceof ScenarioOutputError)
  assert.equal((incomplete.caught as ScenarioOutputError).reason, 'incomplete_response')
  assert.equal(incomplete.diagnostic?.incompleteReason, 'max_output_tokens')

  const malformed = await run(() => openAIResponse({ output_text: '{bad json' }))
  assert.ok(malformed.caught instanceof ScenarioOutputError)
  assert.equal((malformed.caught as ScenarioOutputError).reason, 'malformed_json')
})

test('OpenAI provider reports schema paths without logging generated values', async () => {
  const diagnostics: Array<Record<string, unknown>> = []
  const invalid = structuredClone(generated)
  delete (invalid.scenarios[0] as Partial<typeof invalid.scenarios[number]>).title
  const provider = createOpenAIScenarioProvider({ apiKey: 'test-only', diagnosticLogger: diagnostic => diagnostics.push(diagnostic), fetch: async () => openAIResponse({ output_text: JSON.stringify(invalid) }) })
  await assert.rejects(() => provider(config), (error: unknown) => error instanceof ScenarioOutputError && error.reason === 'invalid_scenario_fields')
  assert.deepEqual(diagnostics[0]?.validationFailures, [{ code: 'invalid_type', path: ['scenarios', 0, 'title'] }])
  assert.doesNotMatch(JSON.stringify(diagnostics), /Synthetic scenario|routine service|callerOpening/)
})

test('OpenAI HTTP failures are classified and logged without provider response bodies', async () => {
  const run = async (status: number) => {
    const diagnostics: Array<Record<string, unknown>> = []
    const provider = createOpenAIScenarioProvider({ apiKey: 'test-only', diagnosticLogger: diagnostic => diagnostics.push(diagnostic), fetch: async () => new Response(JSON.stringify({ error: { message: 'sensitive provider response body' } }), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req_failed' } }) })
    let caught: unknown
    try { await provider(config) } catch (error) { caught = error }
    return { caught, diagnostics }
  }
  const failed = await run(500)
  assert.ok(failed.caught instanceof ScenarioProviderError)
  assert.equal((failed.caught as ScenarioProviderError).providerStatus, 500)
  assert.doesNotMatch(JSON.stringify(failed.diagnostics), /sensitive provider response body/)
  const limited = await run(429)
  assert.ok(limited.caught instanceof ScenarioRateLimitError)
  assert.equal(limited.diagnostics[0]?.providerStatus, 429)
})

test('scenario API reports distinct refusal and provider failure codes', async () => {
  for (const [provider, code] of [
    [async () => { throw new ScenarioOutputError('OpenAI declined to generate this scenario library. Review the setup and try again.', 'provider_refusal') }, 'scenario_provider_refusal'],
    [async () => { throw new ScenarioProviderError('OpenAI scenario generation failed', 500) }, 'scenario_provider_error'],
  ] as const) {
    const app = createApp(async () => ({}), provider)
    const server: Server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)) })
    try {
      const address = server.address() as AddressInfo
      const response = await fetch(`http://127.0.0.1:${address.port}/api/scenarios/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
      const body = await response.json() as { error: { code: string; message: string } }
      assert.equal(response.status, 502)
      assert.equal(body.error.code, code)
      assert.doesNotMatch(body.error.message, /sensitive|transcript|authorization/i)
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  }
})

test('scenario config validates locale pairs and provider options', () => {
  assert.equal(scenarioGenerationInputSchema.safeParse(config).success, true)
  assert.equal(scenarioGenerationInputSchema.safeParse({ ...config, locale: 'ta-IN' }).success, false)
  assert.equal(scenarioGenerationInputSchema.safeParse({ ...config, provider: 'Unknown' }).success, false)
})
