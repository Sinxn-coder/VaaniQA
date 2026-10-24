import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getAudioUploadError, MAX_AUDIO_UPLOAD_BYTES } from './audioUpload'

test('browser upload validates extension, MIME type, empty files and maximum size', () => {
  assert.equal(getAudioUploadError({ name: 'call.mp3', type: 'audio/mpeg', size: 100 }), null)
  assert.equal(getAudioUploadError({ name: 'call.m4a', type: 'audio/mp4', size: 100 }), null)
  assert.equal(getAudioUploadError({ name: 'call.mp4', type: 'video/mp4', size: 100 }), null)
  assert.match(getAudioUploadError({ name: 'call.wav', type: 'text/plain', size: 100 }) ?? '', /Supported formats/)
  assert.match(getAudioUploadError({ name: 'call.wav', type: 'audio/wav', size: 0 }) ?? '', /empty/)
  assert.match(getAudioUploadError({ name: 'large.wav', type: 'audio/wav', size: MAX_AUDIO_UPLOAD_BYTES + 1 }) ?? '', /25 MB/)
})
