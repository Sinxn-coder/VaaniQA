import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createScenarioRepository, type StorageLike } from './repository'
import { defaultAgentConfiguration, type Scenario } from './types'

class MemoryStorage implements StorageLike {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const sample: Scenario = {
  id: 'case-1', title: 'Booking request', category: 'appointment-scheduling', callerProfile: 'Adult caller booking for self.', goal: 'Book an appointment.', callerOpening: 'നമസ്കാരം, appointment വേണം.',
  conversationOutline: ['Caller asks for a time.', 'Caller asks about availability.'], expectedBehavior: 'Use clinic rules.', clinicApprovedConstraints: [], missingClinicRules: ['Booking window not supplied.'], failureConditions: ['Invents a policy.'], passCriteria: ['Flags missing rule.'], languageNotes: 'Malayalam-English may be natural.', audioRequired: false,
  provenance: 'AI-generated', markedForReview: false, reviews: [
    { id: 'review-1', rating: 3, correctedWording: 'Alternative', dialectRegister: 'Central Kerala, polite', explanation: 'A dialect-specific phrasing preference.', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'review-2', rating: 5, correctedWording: 'A different valid variant', dialectRegister: 'Northern Kerala, informal', explanation: 'This variant sounds natural in another register.', createdAt: '2026-01-02T00:00:00.000Z' },
  ], createdAt: '2026-01-01T00:00:00.000Z',
}

test('default clinic setup starts with Malayalam ml-IN', () => {
  assert.equal(defaultAgentConfiguration.primaryLanguage, 'Malayalam')
  assert.equal(defaultAgentConfiguration.locale, 'ml-IN')
})

test('local repository persists setup, scenarios, and separate review variants', () => {
  const storage = new MemoryStorage()
  const repository = createScenarioRepository(storage)
  repository.saveConfiguration({ ...defaultAgentConfiguration, name: 'Local clinic', provider: 'Vapi', agentId: 'agent-demo-01' })
  repository.saveScenarios([sample])
  const reloaded = createScenarioRepository(storage)
  assert.equal(reloaded.loadConfiguration().name, 'Local clinic')
  assert.equal(reloaded.loadConfiguration().agentId, 'agent-demo-01')
  assert.equal(reloaded.loadConfiguration().provider, 'Vapi')
  const scenarios = reloaded.loadScenarios()
  assert.equal(scenarios.length, 1)
  assert.equal(scenarios[0].reviews.length, 2)
  assert.equal(scenarios[0].reviews[0].correctedWording, 'Alternative')
  assert.equal(scenarios[0].reviews[0].dialectRegister, 'Central Kerala, polite')
  assert.equal(scenarios[0].reviews[1].correctedWording, 'A different valid variant')
  assert.equal(scenarios[0].reviews[1].rating, 5)
})

test('repository falls back safely on corrupt or invalid local values', () => {
  const storage = new MemoryStorage()
  storage.values.set('vaaniqa:agent-configuration:v1', '{broken json')
  storage.values.set('vaaniqa:scenario-library:v1', JSON.stringify([{ id: 'bad' }]))
  const repository = createScenarioRepository(storage)
  assert.equal(repository.loadConfiguration().locale, 'ml-IN')
  assert.deepEqual(repository.loadScenarios(), [])
})
