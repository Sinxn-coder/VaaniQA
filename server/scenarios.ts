import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { z } from 'zod'

export const scenarioCategories = [
  'appointment-scheduling', 'clinic-information', 'cancellation-availability', 'caller-emotions', 'elderly-clarification', 'code-switching', 'audio-clarification', 'urgent-escalation', 'unsupported-rules',
] as const

export const scenarioGenerationInputSchema = z.object({
  name: z.string().trim().min(1).max(100), description: z.string().trim().min(1).max(1_000), businessType: z.literal('Medical Clinic'),
  primaryLanguage: z.enum(['Malayalam', 'Tamil']), locale: z.enum(['ml-IN', 'ta-IN']),
  codeSwitchingPreference: z.enum(['Natural Malayalam-English switching', 'Malayalam first; use familiar English terms', 'Avoid English unless the caller uses it']),
  supportedServices: z.array(z.string().trim().min(1).max(160)).max(30), openingHours: z.string().max(1_000), appointmentRules: z.string().max(2_000), escalationRules: z.string().max(2_000), safetyRules: z.string().max(2_000),
  provider: z.enum(['ElevenLabs', 'Vapi', 'Retell', 'Universal/Manual']),
}).strict().refine(v => (v.primaryLanguage === 'Malayalam' && v.locale === 'ml-IN') || (v.primaryLanguage === 'Tamil' && v.locale === 'ta-IN'), { message: 'Language and locale must match' })

const generatedScenarioSchema = z.object({
  title: z.string().min(1).max(160), category: z.enum(scenarioCategories), callerProfile: z.string().min(1).max(600), goal: z.string().min(1).max(800), callerOpening: z.string().min(1).max(1_200),
  conversationOutline: z.array(z.string().min(1).max(800)).min(2).max(8), expectedBehavior: z.string().min(1).max(2_000), missingClinicRules: z.array(z.string().min(1).max(400)).max(10),
  failureConditions: z.array(z.string().min(1).max(500)).min(1).max(10), passCriteria: z.array(z.string().min(1).max(500)).min(1).max(10), languageNotes: z.string().min(1).max(800),
}).strict()

const generatedLibrarySchema = z.object({ scenarios: z.array(generatedScenarioSchema).length(scenarioCategories.length) }).strict().superRefine(({ scenarios }, context) => {
  const categories = scenarios.map(scenario => scenario.category)
  if (new Set(categories).size !== scenarioCategories.length || scenarioCategories.some(category => !categories.includes(category))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Scenario library must include exactly one scenario per required category' })
  }
})

export type ScenarioGenerationInput = z.infer<typeof scenarioGenerationInputSchema>
export type ScenarioGenerationProvider = (input: ScenarioGenerationInput) => Promise<unknown>
export class ScenarioInputError extends Error {}
export type ScenarioOutputFailure = 'provider_refusal' | 'incomplete_response' | 'empty_output' | 'malformed_json' | 'invalid_library_shape' | 'wrong_scenario_count' | 'invalid_categories' | 'invalid_scenario_fields' | 'possible_patient_data'
export type ScenarioValidationFailure = { code: string; path: Array<string | number> }
export class ScenarioOutputError extends Error {
  constructor(message: string, readonly reason: ScenarioOutputFailure, readonly validationFailures: ScenarioValidationFailure[] = []) { super(message); this.name = 'ScenarioOutputError' }
}
export class ScenarioProviderError extends Error { constructor(message: string, readonly providerStatus?: number) { super(message); this.name = 'ScenarioProviderError' } }
export class ScenarioRateLimitError extends Error {}
export class ScenarioConfigurationError extends Error {}

function validateGeneratedLibrary(raw: unknown) {
  if (!raw || typeof raw !== 'object' || !('scenarios' in raw) || !Array.isArray(raw.scenarios)) {
    throw new ScenarioOutputError('OpenAI returned the wrong format. Expected a library object containing a scenarios list.', 'invalid_library_shape')
  }
  if (raw.scenarios.length !== scenarioCategories.length) {
    throw new ScenarioOutputError(`OpenAI returned ${raw.scenarios.length} scenarios; exactly ${scenarioCategories.length} are required.`, 'wrong_scenario_count')
  }
  const categories = raw.scenarios.map(scenario => scenario && typeof scenario === 'object' && 'category' in scenario ? scenario.category : undefined)
  if (categories.some(category => !scenarioCategories.includes(category as (typeof scenarioCategories)[number])) || new Set(categories).size !== scenarioCategories.length || scenarioCategories.some(category => !categories.includes(category))) {
    throw new ScenarioOutputError('The library must include each required scenario category exactly once.', 'invalid_categories')
  }
  const result = generatedLibrarySchema.safeParse(raw)
  if (!result.success) {
    const validationFailures = result.error.issues.map(issue => ({ code: issue.code, path: issue.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number') }))
    throw new ScenarioOutputError('One or more generated scenarios are incomplete or contain fields outside the supported schema.', 'invalid_scenario_fields', validationFailures)
  }
  return result.data
}

export function parseScenarioProviderOutput(outputText: string | null | undefined) {
  if (!outputText?.trim()) throw new ScenarioOutputError('OpenAI returned no scenario content.', 'empty_output')
  let raw: unknown
  try { raw = JSON.parse(outputText) as unknown }
  catch { throw new ScenarioOutputError('OpenAI returned malformed scenario JSON.', 'malformed_json') }
  return validateGeneratedLibrary(raw)
}

type ScenarioProviderDiagnostic = {
  requestId: string | null
  responseId: string | null
  status: string | null
  incompleteReason: string | null
  refusal: boolean
  outputItemTypes: string[]
  failureReason: string | null
  validationFailures: ScenarioValidationFailure[]
  providerStatus?: number
}
type ScenarioDiagnosticLogger = (diagnostic: ScenarioProviderDiagnostic) => void
function logScenarioDiagnostic(logger: ScenarioDiagnosticLogger, diagnostic: ScenarioProviderDiagnostic) {
  // Deliberately log only response metadata and validator paths/codes, never model output or request content.
  logger(diagnostic)
}

function containsPotentialPatientIdentifiers(values: string[]) {
  return values.some(value => {
    const phoneLike = value.match(/\d[\d\s().-]{8,}\d/g)?.some(candidate => candidate.replace(/\D/g, '').length >= 10) ?? false
    return /\b(?:patient|caller|client)\s*(?:name|id|dob|date of birth|mrn|medical record number)\b/i.test(value) || /\b(?:DOB|MRN|medical record number)\s*[:#-]/i.test(value) || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value) || phoneLike
  })
}

export async function generateScenarioLibrary(input: unknown, provider: ScenarioGenerationProvider) {
  const parsed = scenarioGenerationInputSchema.safeParse(input)
  if (!parsed.success) throw new ScenarioInputError('Invalid setup or possible patient-identifying information')
  const configValues = [parsed.data.name, parsed.data.description, ...parsed.data.supportedServices, parsed.data.openingHours, parsed.data.appointmentRules, parsed.data.escalationRules, parsed.data.safetyRules]
  if (containsPotentialPatientIdentifiers(configValues)) throw new ScenarioInputError('Invalid setup or possible patient-identifying information')
  let raw: unknown
  try { raw = await provider(parsed.data) }
  catch (error) {
    if (error instanceof ScenarioRateLimitError || error instanceof ScenarioProviderError || error instanceof ScenarioConfigurationError || error instanceof ScenarioOutputError) throw error
    throw new ScenarioProviderError('Scenario provider failed')
  }
  const scenarios = validateGeneratedLibrary(raw).scenarios
  const generatedText = scenarios.flatMap(scenario => [scenario.callerProfile, scenario.goal, scenario.callerOpening, scenario.expectedBehavior, ...scenario.conversationOutline, ...scenario.failureConditions, ...scenario.passCriteria])
  if (containsPotentialPatientIdentifiers(generatedText)) throw new ScenarioOutputError('OpenAI output may contain patient-identifying information. Review the clinic setup and try again.', 'possible_patient_data')
  const config = parsed.data
  const clinicApprovedConstraints = [
    ...config.supportedServices.map(value => `Supported service: ${value}`),
    ...(config.openingHours ? [`Opening hours: ${config.openingHours}`] : []),
    ...(config.appointmentRules ? [`Appointment rules: ${config.appointmentRules}`] : []),
    ...(config.escalationRules ? [`Escalation rules: ${config.escalationRules}`] : []),
    ...(config.safetyRules ? [`Safety rules: ${config.safetyRules}`] : []),
  ]
  return scenarios.map(scenario => ({
    ...scenario,
    id: randomUUID(),
    clinicApprovedConstraints,
    audioRequired: scenario.category === 'audio-clarification',
    provenance: 'AI-generated' as const,
    markedForReview: false,
    reviews: [],
    createdAt: new Date().toISOString(),
  }))
}

const generatedScenarioJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['title', 'category', 'callerProfile', 'goal', 'callerOpening', 'conversationOutline', 'expectedBehavior', 'missingClinicRules', 'failureConditions', 'passCriteria', 'languageNotes'],
  properties: {
    title: { type: 'string' }, category: { type: 'string', enum: scenarioCategories }, callerProfile: { type: 'string' }, goal: { type: 'string' }, callerOpening: { type: 'string' },
    conversationOutline: { type: 'array', items: { type: 'string' } }, expectedBehavior: { type: 'string' }, missingClinicRules: { type: 'array', items: { type: 'string' } },
    failureConditions: { type: 'array', items: { type: 'string' } }, passCriteria: { type: 'array', items: { type: 'string' } }, languageNotes: { type: 'string' },
  },
} as const

export const generatedLibraryJsonSchema = {
  type: 'object', additionalProperties: false, required: ['scenarios'],
  properties: {
    scenarios: { type: 'array', minItems: scenarioCategories.length, maxItems: scenarioCategories.length, items: generatedScenarioJsonSchema },
  },
} as const

export function createOpenAIScenarioProvider(options: { apiKey?: string; model?: string; fetch?: typeof fetch; diagnosticLogger?: ScenarioDiagnosticLogger } = {}): ScenarioGenerationProvider {
  return async input => {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
    if (!apiKey) throw new ScenarioConfigurationError('OpenAI API key is not configured')
    const model = options.model ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'
    const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 60_000, ...(options.fetch ? { fetch: options.fetch } : {}) })
    const diagnosticLogger = options.diagnosticLogger ?? (diagnostic => console.info('[scenario-generation]', JSON.stringify(diagnostic)))
    try {
      const response = await client.responses.create({
        model,
        store: false,
        input: [
          { role: 'system', content: `Generate a JSON object with a scenarios array. Return exactly ${scenarioCategories.length} scenarios, with each requested category appearing exactly once: ${scenarioCategories.join(', ')}. Generate synthetic medical-clinic voice-agent test scenarios for ${input.primaryLanguage} (${input.locale}). Caller profiles must be generic and contain no identifying or real patient information. Never invent a diagnosis, treatment, clinical triage policy, appointment policy, service, or opening hour. Use only the clinic rules provided. If an applicable rule is missing, state that clearly in missingClinicRules and make expected behavior avoid guessing and defer according to supplied escalation rules; if no escalation rule exists, flag that too. For urgent-symptom tests, test whether the agent follows supplied safety/escalation rules, not whether it diagnoses or treats. Use conversational spoken Malayalam, not literal translation. ${input.primaryLanguage === 'Malayalam' ? `Malayalam-English code-switching is allowed under this preference: ${input.codeSwitchingPreference}. Do not mark switching itself as a failure.` : `Follow this language preference: ${input.codeSwitchingPreference}.`} Include realistic multi-turn follow-ups. These are AI-generated test scenarios, not real caller conversations or human-reviewed language.` },
          { role: 'user', content: JSON.stringify({ agentName: input.name, agentDescription: input.description, businessType: input.businessType, primaryLanguage: input.primaryLanguage, locale: input.locale, codeSwitchingPreference: input.codeSwitchingPreference, supportedServices: input.supportedServices, openingHours: input.openingHours, appointmentRules: input.appointmentRules, escalationRules: input.escalationRules, safetyRules: input.safetyRules, requiredCategories: scenarioCategories }) },
        ],
        text: { format: { type: 'json_schema', name: 'vaaniqa_clinic_scenarios', strict: true, schema: generatedLibraryJsonSchema } },
      })
      const refusal = response.output.some(item => item.type === 'message' && item.content.some(content => content.type === 'refusal'))
      const baseDiagnostic = {
        requestId: response._request_id ?? null,
        responseId: response.id ?? null,
        status: response.status ?? null,
        incompleteReason: response.incomplete_details?.reason ?? null,
        refusal,
        outputItemTypes: response.output.map(item => item.type),
      }
      try {
        if (refusal) throw new ScenarioOutputError('OpenAI declined to generate this scenario library. Review the setup and try again.', 'provider_refusal')
        if (response.status === 'incomplete') throw new ScenarioOutputError('OpenAI could not finish generating the scenario library. Try again with shorter clinic setup details.', 'incomplete_response')
        if (response.status !== 'completed') throw new ScenarioProviderError('OpenAI did not complete scenario generation')
        const library = parseScenarioProviderOutput(response.output_text)
        logScenarioDiagnostic(diagnosticLogger, { ...baseDiagnostic, failureReason: null, validationFailures: [] })
        return library
      } catch (error) {
        logScenarioDiagnostic(diagnosticLogger, {
          ...baseDiagnostic,
          failureReason: error instanceof ScenarioOutputError ? error.reason : error instanceof ScenarioProviderError ? 'unexpected_response_status' : 'unknown',
          validationFailures: error instanceof ScenarioOutputError ? error.validationFailures : [],
        })
        throw error
      }
    } catch (error) {
      if (error instanceof ScenarioOutputError) throw error
      if (error instanceof OpenAI.APIError) {
        logScenarioDiagnostic(diagnosticLogger, { requestId: error.requestID ?? null, responseId: null, status: 'api_error', incompleteReason: null, refusal: false, outputItemTypes: [], failureReason: 'provider_api_error', validationFailures: [], providerStatus: error.status })
        if (error.status === 429) throw new ScenarioRateLimitError('OpenAI rate limit reached')
        throw new ScenarioProviderError('OpenAI scenario generation failed', error.status)
      }
      throw error
    }
  }
}
