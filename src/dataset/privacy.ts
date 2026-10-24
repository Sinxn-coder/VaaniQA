const sensitiveTextPatterns = [
  /\b(?:DOB|date of birth|MRN|medical record number|patient ID|phone number|email address)\s*[:#-]/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b\d[\d\s().-]{8,}\d\b/,
]

export function containsObviousPatientIdentifiers(transcript: string): boolean {
  return sensitiveTextPatterns.some(pattern => pattern.test(transcript))
}
