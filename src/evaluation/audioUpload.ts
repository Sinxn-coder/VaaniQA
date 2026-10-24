export const MAX_AUDIO_UPLOAD_BYTES = 25 * 1_000_000
const supportedExtensions: Record<string, string[]> = { 'audio/mpeg': ['.mp3', '.mpeg', '.mpga'], 'audio/mp4': ['.mp4', '.m4a'], 'video/mp4': ['.mp4'], 'audio/wav': ['.wav'], 'audio/x-wav': ['.wav'], 'audio/webm': ['.webm'] }

export function getAudioUploadError(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (file.size <= 0) return 'The selected recording is empty.'
  if (file.size > MAX_AUDIO_UPLOAD_BYTES) return 'Choose a recording smaller than 25 MB.'
  const extension = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0]
  if (!extension || !supportedExtensions[file.type.toLowerCase()]?.includes(extension)) return 'Supported formats: MP3, MP4/M4A, MPEG, MPGA, WAV, and WebM.'
  return null
}
