import { agentConfigurationSchema, defaultAgentConfiguration, scenarioSchema, type AgentConfiguration, type Scenario } from './types'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ScenarioRepository {
  loadConfiguration(): AgentConfiguration
  saveConfiguration(value: AgentConfiguration): void
  loadScenarios(): Scenario[]
  saveScenarios(value: Scenario[]): void
}

const CONFIG_KEY = 'vaaniqa:agent-configuration:v1'
const SCENARIOS_KEY = 'vaaniqa:scenario-library:v1'

export function createScenarioRepository(storage: StorageLike): ScenarioRepository {
  const read = (key: string): unknown => {
    try { const value = storage.getItem(key); return value ? JSON.parse(value) as unknown : null } catch { return null }
  }
  return {
    loadConfiguration() {
      const parsed = agentConfigurationSchema.safeParse(read(CONFIG_KEY))
      return parsed.success ? parsed.data : { ...defaultAgentConfiguration, supportedServices: [] }
    },
    saveConfiguration(value) { storage.setItem(CONFIG_KEY, JSON.stringify(agentConfigurationSchema.parse(value))) },
    loadScenarios() {
      const raw = read(SCENARIOS_KEY)
      if (!Array.isArray(raw)) return []
      return raw.flatMap(item => { const parsed = scenarioSchema.safeParse(item); return parsed.success ? [parsed.data] : [] })
    },
    saveScenarios(value) { storage.setItem(SCENARIOS_KEY, JSON.stringify(value.map(item => scenarioSchema.parse(item)))) },
  }
}

export const browserScenarioRepository = createScenarioRepository({
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
})
