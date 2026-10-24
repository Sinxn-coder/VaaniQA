import { getLanguageForLocale, type SupportedLocale } from './languages'

export type Dimension = 'Language naturalness' | 'Contextual judgment' | 'Vocal delivery'
export type Finding = { dimension: Dimension; score: number | null; status: 'Needs work' | 'Needs review' | 'Strong' | 'Not evaluated'; evidence: string; explanation: string }
export type Evaluation = { overall: number; findings: Finding[]; original: string; expectedBehavior?: string; alternative: string; alternativeRationale?: string; mode: 'DEMO' | 'LIVE'; model?: string; language?: string; locale?: SupportedLocale; uncertainty: string[]; missingEvidence: string[] }

const alternatives: Record<SupportedLocale, string> = {
  'ml-IN': 'തീർച്ചയായും. നിങ്ങളുടെ റീഫണ്ട് 3 മുതൽ 5 പ്രവൃത്തി ദിവസത്തിനുള്ളിൽ ലഭിക്കും. മറ്റെന്തെങ്കിലും സഹായം വേണോ?',
  'ta-IN': 'நிச்சயமாக. உங்கள் பணம் 3 முதல் 5 வேலை நாட்களுக்குள் திரும்ப வரும். வேறு ஏதாவது உதவி வேண்டுமா?',
}

// Deterministic demo signals are not a judgment of idiomatic or human-validated language.
export function evaluateDemo(transcript: string, expected: string, locale: SupportedLocale = 'ml-IN'): Evaluation {
  const selectedLanguage = getLanguageForLocale(locale)
  const language = selectedLanguage.name
  const hasTargetScript = selectedLanguage.script.test(transcript)
  const hasEnglish = /[a-z]/i.test(transcript)
  const issue = transcript.match(/3-5 business days|3 to 5 business days|5-7 working days/i)?.[0]
  const languageEvidence = hasTargetScript && hasEnglish
    ? `${language} script and English are both present; mixed-language use is not treated as an error by this demo.`
    : hasTargetScript
      ? `${language} script is present. Demo rules do not assess idiomatic naturalness.`
      : `No ${language} script was detected. Romanized language and idiomatic naturalness are not assessed by this demo.`
  const contextEvidence = issue ? `“${issue}” may conflict with the expected behavior: ${expected}` : `Response compared against expected behavior: “${expected}”`
  return {
    overall: Math.round(((hasTargetScript ? 72 : 43) + (issue ? 54 : 86)) / 2),
    original: transcript,
    alternative: alternatives[locale],
    mode: 'DEMO',
    language,
    locale,
    uncertainty: [`Demo rules do not assess ${language} idiomatic naturalness or regional variation.`, 'A native-speaker review has not been performed.'],
    missingEvidence: ['Native-speaker assessment', 'Audio recording for vocal delivery'],
    findings: [
      { dimension: 'Language naturalness', score: hasTargetScript ? 72 : 43, status: hasTargetScript ? 'Needs review' : 'Needs work', evidence: languageEvidence, explanation: hasTargetScript && hasEnglish ? `This ${language}-English code-switch is not automatically penalized. Native-speaker review is needed to assess whether the phrasing sounds natural.` : 'Script detection is only a demo signal and cannot establish naturalness. Native-speaker review is needed.' },
      { dimension: 'Contextual judgment', score: issue ? 54 : 86, status: issue ? 'Needs work' : 'Strong', evidence: contextEvidence, explanation: issue ? 'The stated timeline may not follow the expected policy. Confirm the correct refund window before deployment.' : 'No direct conflict with the expected behavior was found by the demo rules.' },
      { dimension: 'Vocal delivery', score: null, status: 'Not evaluated', evidence: 'No audio recording provided.', explanation: 'Upload a recording to evaluate pace, clarity, tone, and turn-taking.' },
    ],
  }
}
