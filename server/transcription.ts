import OpenAI, { toFile } from 'openai'

export const MAX_AUDIO_BYTES = 25 * 1_000_000
const supportedTypes: Record<string, string[]> = {
  'audio/mpeg': ['.mp3', '.mpeg', '.mpga'],
  'audio/mp4': ['.mp4', '.m4a'],
  'video/mp4': ['.mp4'],
  'audio/wav': ['.wav'],
  'audio/x-wav': ['.wav'],
  'audio/webm': ['.webm'],
}
export type AudioUpload = { bytes: Buffer; filename: string; contentType: string; locale?: 'ml-IN' | 'ta-IN' }
export type AudioTranscriber = (upload: AudioUpload) => Promise<string>
export class AudioInputError extends Error {}
export class AudioConfigurationError extends Error {}
export class AudioRateLimitError extends Error {}
export class AudioProviderError extends Error {}

export function validateAudioUpload(value: unknown): AudioUpload {
  if (!value || typeof value !== 'object' || !('bytes' in value) || !Buffer.isBuffer(value.bytes) || !('filename' in value) || typeof value.filename !== 'string' || !('contentType' in value) || typeof value.contentType !== 'string') throw new AudioInputError('Missing recording')
  const { bytes, filename, contentType } = value as AudioUpload
  if (bytes.length === 0) throw new AudioInputError('Empty recording')
  if (bytes.length > MAX_AUDIO_BYTES) throw new AudioInputError('Recording too large')
  const safeName = filename.replaceAll('\\', '/').split('/').pop() ?? ''
  const extension = safeName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0]
  const type = contentType.split(';')[0].trim().toLowerCase()
  if (!extension || !supportedTypes[type]?.includes(extension)) throw new AudioInputError('Unsupported recording format')
  const locale = (value as AudioUpload).locale ?? 'ml-IN'
  if (locale !== 'ml-IN' && locale !== 'ta-IN') throw new AudioInputError('Unsupported language')
  return { bytes, filename: safeName.slice(0, 120), contentType: type, locale }
}

export function buildAudioTranscriptionPrompt(locale: 'ml-IN' | 'ta-IN') {
  const language = locale === 'ml-IN' ? 'Malayalam' : 'Tamil'
  return `Transcribe verbatim in ${language}. The recording may contain natural ${language}-English code-switching. Preserve both languages as spoken; do not translate or normalize wording.`
}

export function createOpenAITranscriber(options: { apiKey?: string; transcribe?: (file: File, prompt: string) => Promise<string> } = {}): AudioTranscriber {
  return async raw => {
    const upload = validateAudioUpload(raw)
    if (options.transcribe) return options.transcribe(await toFile(upload.bytes, upload.filename, { type: upload.contentType }), buildAudioTranscriptionPrompt(upload.locale ?? 'ml-IN'))
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
    if (!apiKey) throw new AudioConfigurationError('OpenAI API key is not configured')
    const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 60_000 })
    try {
      const result = await client.audio.transcriptions.create({
        file: await toFile(upload.bytes, upload.filename, { type: upload.contentType }),
        model: 'gpt-transcribe',
        prompt: buildAudioTranscriptionPrompt(upload.locale ?? 'ml-IN'),
      })
      const transcript = typeof result === 'string' ? result : result.text
      if (!transcript?.trim()) throw new AudioProviderError('Transcription returned no text')
      return transcript.trim()
    } catch (error) {
      if (error instanceof AudioProviderError) throw error
      if (error instanceof OpenAI.APIError) {
        if (error.status === 429) throw new AudioRateLimitError('Transcription rate limit reached')
        throw new AudioProviderError('Transcription request failed')
      }
      throw new AudioProviderError('Transcription request failed')
    }
  }
}
