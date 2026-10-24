import { z } from 'zod'
import type { SupportedLocale } from '../evaluation/languages'

export const SCENARIO_CATEGORIES = [
  { id: 'appointment-scheduling', label: 'Appointment booking & rescheduling' },
  { id: 'clinic-information', label: 'Opening hours, location & services' },
  { id: 'cancellation-availability', label: 'Cancellations & unavailable appointments' },
  { id: 'caller-emotions', label: 'Anxious or frustrated callers' },
  { id: 'elderly-clarification', label: 'Elderly callers & clarification' },
  { id: 'code-switching', label: 'Malayalam-English code-switching' },
  { id: 'audio-clarification', label: 'Noise, interruptions & misunderstood speech' },
  { id: 'urgent-escalation', label: 'Urgent symptoms & escalation' },
  { id: 'unsupported-rules', label: 'Unsupported requests & rule conflicts' },
] as const

export type ScenarioCategory = (typeof SCENARIO_CATEGORIES)[number]['id']
export type ProviderChoice = 'ElevenLabs' | 'Vapi' | 'Retell' | 'Universal/Manual'
export type AgentConfiguration = {
  name: string
  agentId?: string
  description: string
  businessType: 'Medical Clinic'
  primaryLanguage: 'Malayalam' | 'Tamil'
  locale: SupportedLocale
  codeSwitchingPreference: 'Natural Malayalam-English switching' | 'Malayalam first; use familiar English terms' | 'Avoid English unless the caller uses it'
  supportedServices: string[]
  openingHours: string
  appointmentRules: string
  escalationRules: string
  safetyRules: string
  provider: ProviderChoice
}

export type ScenarioReview = {
  id: string
  rating: number
  correctedWording: string
  dialectRegister: string
  explanation: string
  createdAt: string
}

export type Scenario = {
  id: string
  title: string
  category: ScenarioCategory
  callerProfile: string
  goal: string
  callerOpening: string
  conversationOutline: string[]
  expectedBehavior: string
  clinicApprovedConstraints: string[]
  missingClinicRules: string[]
  failureConditions: string[]
  passCriteria: string[]
  languageNotes: string
  audioRequired: boolean
  provenance: 'AI-generated' | 'Human-authored'
  markedForReview: boolean
  reviews: ScenarioReview[]
  createdAt: string
}

export const agentConfigurationSchema = z.object({
  name: z.string().min(1).max(100), agentId: z.string().max(200).optional(), description: z.string().min(1).max(1_000), businessType: z.literal('Medical Clinic'),
  primaryLanguage: z.enum(['Malayalam', 'Tamil']), locale: z.enum(['ml-IN', 'ta-IN']),
  codeSwitchingPreference: z.enum(['Natural Malayalam-English switching', 'Malayalam first; use familiar English terms', 'Avoid English unless the caller uses it']),
  supportedServices: z.array(z.string().max(160)).max(30), openingHours: z.string().max(1_000), appointmentRules: z.string().max(2_000), escalationRules: z.string().max(2_000), safetyRules: z.string().max(2_000),
  provider: z.enum(['ElevenLabs', 'Vapi', 'Retell', 'Universal/Manual']),
}).strict().refine(v => (v.primaryLanguage === 'Malayalam' && v.locale === 'ml-IN') || (v.primaryLanguage === 'Tamil' && v.locale === 'ta-IN'), { message: 'Language and locale must match' })

export const scenarioReviewSchema = z.object({ id: z.string(), rating: z.number().int().min(1).max(5), correctedWording: z.string().max(2_000), dialectRegister: z.string().max(300), explanation: z.string().min(1).max(2_000), createdAt: z.string() }).strict()
export const scenarioSchema: z.ZodType<Scenario> = z.object({
  id: z.string(), title: z.string().min(1).max(160), category: z.enum(SCENARIO_CATEGORIES.map(c => c.id) as [ScenarioCategory, ...ScenarioCategory[]]),
  callerProfile: z.string().min(1).max(600), goal: z.string().min(1).max(800), callerOpening: z.string().min(1).max(1_200), conversationOutline: z.array(z.string().min(1).max(800)).min(2).max(8),
  expectedBehavior: z.string().min(1).max(2_000), clinicApprovedConstraints: z.array(z.string().max(500)).max(20), missingClinicRules: z.array(z.string().min(1).max(400)).max(10),
  failureConditions: z.array(z.string().min(1).max(500)).min(1).max(10), passCriteria: z.array(z.string().min(1).max(500)).min(1).max(10), languageNotes: z.string().min(1).max(800), audioRequired: z.boolean(),
  provenance: z.enum(['AI-generated', 'Human-authored']), markedForReview: z.boolean(), reviews: z.array(scenarioReviewSchema).max(100), createdAt: z.string(),
}).strict()

export const defaultAgentConfiguration: AgentConfiguration = {
  name: 'Clinic Voice Agent', agentId: '', description: 'Voice assistant for appointment and clinic information calls.', businessType: 'Medical Clinic',
  primaryLanguage: 'Malayalam', locale: 'ml-IN', codeSwitchingPreference: 'Natural Malayalam-English switching', supportedServices: [], openingHours: '', appointmentRules: '', escalationRules: '', safetyRules: '', provider: 'Universal/Manual',
}
