export const SUPPORTED_LANGUAGES = [
  { name: 'Malayalam', locale: 'ml-IN', script: /[\u0D00-\u0D7F]/u },
  { name: 'Tamil', locale: 'ta-IN', script: /[\u0B80-\u0BFF]/u },
] as const

export type SupportedLocale = (typeof SUPPORTED_LANGUAGES)[number]['locale']
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const DEFAULT_LOCALE: SupportedLocale = 'ml-IN'

export function getLanguageForLocale(locale: SupportedLocale): SupportedLanguage {
  return SUPPORTED_LANGUAGES.find(language => language.locale === locale)!
}
