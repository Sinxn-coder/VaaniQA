import type { AgentConfiguration } from '../scenarios/types'

/** Adds only explicitly configured clinic rules; it does not infer or create policies. */
export function buildEvaluationContext(expectedBehavior: string, configuration: AgentConfiguration): string {
  const rules = [
    ...configuration.supportedServices.map(item => `Supported service: ${item}`),
    ...(configuration.openingHours ? [`Opening hours: ${configuration.openingHours}`] : []),
    ...(configuration.appointmentRules ? [`Appointment rules: ${configuration.appointmentRules}`] : []),
    ...(configuration.escalationRules ? [`Escalation rules: ${configuration.escalationRules}`] : []),
    ...(configuration.safetyRules ? [`Safety rules: ${configuration.safetyRules}`] : []),
  ]
  const missingRules = rules.filter(rule => !expectedBehavior.includes(rule))
  if (!missingRules.length) return expectedBehavior
  const separator = expectedBehavior ? '\n\n' : ''
  return `${expectedBehavior}${separator}Clinic rules from Agent Setup:\n${missingRules.join('\n')}`
}
