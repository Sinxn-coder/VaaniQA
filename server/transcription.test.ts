import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp } from './app.js'
import { buildAudioTranscriptionPrompt, createOpenAITranscriber, validateAudioUpload, type AudioTranscriber } from './transcription.js'

async function withServer(transcriber: AudioTranscriber | undefined, run: (url: string) => Promise<void>) {
  const app = createApp(async () => ({}), async () => [], transcriber)
  const server = app.listen(0)
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Server did not bind')
  try { await run(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
}

test('recording validation accepts supported audio and rejects unsupported type, extension and size', () => {
  assert.deepEqual(validateAudioUpload({ bytes: Buffer.from('wav'), filename: 'call.wav', contentType: 'audio/wav' }).filename, 'call.wav')
  assert.throws(() => validateAudioUpload({ bytes: Buffer.from('x'), filename: 'call.wav', contentType: 'text/plain' }), /Unsupported/)
  assert.throws(() => validateAudioUpload({ bytes: Buffer.from('x'), filename: 'call.exe', contentType: 'audio/wav' }), /Unsupported/)
  assert.throws(() => validateAudioUpload({ bytes: Buffer.alloc(25 * 1024 * 1024 + 1), filename: 'call.wav', contentType: 'audio/wav' }), /too large/)
})

test('audio route returns a transcript only and declares vocal delivery unevaluated', async () => {
  let seenFilename = '', seenLocale = ''
  const transcriber: AudioTranscriber = async upload => { seenFilename = upload.filename; seenLocale = upload.locale ?? ''; return 'നമസ്കാരം, appointment മാറ്റണം.' }
  await withServer(transcriber, async url => {
    const response = await fetch(`${url}/api/transcriptions`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Audio-Filename': encodeURIComponent('clinic-call.wav'), 'X-Locale': 'ml-IN' }, body: Buffer.from('audio') })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { transcript: 'നമസ്കാരം, appointment മാറ്റണം.', source: 'OPENAI_TRANSCRIPTION', vocalDelivery: 'NOT_EVALUATED' })
    assert.equal(seenFilename, 'clinic-call.wav')
    assert.equal(seenLocale, 'ml-IN')
  })
})

test('audio route handles unsupported files and missing server configuration without provider calls', async () => {
  let calls = 0
  const transcriber: AudioTranscriber = async () => { calls++; return 'text' }
  await withServer(transcriber, async url => {
    const unsupported = await fetch(`${url}/api/transcriptions`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Audio-Filename': 'call.wav' }, body: 'not audio' })
    assert.equal(unsupported.status, 400); assert.equal(calls, 0)
  })
  await withServer(undefined, async url => {
    const missing = await fetch(`${url}/api/transcriptions`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Audio-Filename': 'call.wav' }, body: Buffer.from('audio') })
    assert.equal(missing.status, 503)
    assert.equal(((await missing.json()) as { error: { message: string } }).error.message, 'Audio transcription is not configured on the server.')
  })
})

test('OpenAI transcription adapter validates before invoking its transport', async () => {
  let fileName = '', prompt = ''
  const transcribe = createOpenAITranscriber({ transcribe: async (file, context) => { fileName = file.name; prompt = context; return 'recognized Malayalam-English words' } })
  assert.equal(await transcribe({ bytes: Buffer.from('audio'), filename: 'sample.m4a', contentType: 'audio/mp4' }), 'recognized Malayalam-English words')
  assert.equal(fileName, 'sample.m4a')
  assert.match(prompt, /Malayalam.*English.*code-switching/)
  assert.match(buildAudioTranscriptionPrompt('ta-IN'), /Tamil.*English.*code-switching/)
})
