import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildEvaluationContext } from './context.js'
import { defaultAgentConfiguration } from '../scenarios/types.js'

test('evaluation context includes configured clinic rules and no invented rules', () => {
  const configuration = {
    ...defaultAgentConfiguration,
    supportedServices: ['General consultation'],
    openingHours: 'Weekdays 9–5',
    appointmentRules: 'Confirm availability before booking.',
    escalationRules: 'Transfer urgent calls to clinic staff.',
    safetyRules: 'Do not give a diagnosis.',
  }
  const context = buildEvaluationContext('Help the caller reschedule.', configuration)
  for (const rule of ['Supported service: General consultation', 'Opening hours: Weekdays 9–5', 'Appointment rules: Confirm availability before booking.', 'Escalation rules: Transfer urgent calls to clinic staff.', 'Safety rules: Do not give a diagnosis.']) assert.ok(context.includes(rule), rule)
  assert.equal(context.includes('prescribe'), false)
})

test('evaluation context does not duplicate rules already supplied by a scenario', () => {
  const expected = 'Expected: reschedule.\n\nClinic rules from Agent Setup:\nAppointment rules: Confirm availability first.'
  const context = buildEvaluationContext(expected, { ...defaultAgentConfiguration, appointmentRules: 'Confirm availability first.' })
  assert.equal(context, expected)
})
