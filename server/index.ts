import 'dotenv/config'
import express from 'express'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createViteServer } from 'vite'
import { createOpenAIEvaluationProvider } from './evaluation.js'
import { createApp } from './app.js'
import { createOpenAITranscriber } from './transcription.js'
import { createConfiguredPersistenceStore, databaseUrlConfiguration } from './persistence.js'

const port = Number(process.env.PORT ?? 3001)
const persistenceCheck = databaseUrlConfiguration(process.env.DATABASE_URL)
const persistenceStore = createConfiguredPersistenceStore()
if (process.env.DATABASE_URL && !persistenceCheck.configured) console.warn('DATABASE_URL is present but invalid for the documented Supabase shared-pooler setup; local browser storage remains active.')
const app = createApp(createOpenAIEvaluationProvider(), undefined, createOpenAITranscriber(), persistenceStore)
const httpServer = createHttpServer(app)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('dist'))
  app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: 'dist' }))
} else {
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server: httpServer } }, appType: 'spa' })
  app.use(vite.middlewares)
}

httpServer.listen(port, () => { console.log(`VaaniQA server listening on port ${port}`) })
