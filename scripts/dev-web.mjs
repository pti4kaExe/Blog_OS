/**
 * Dev-сервер клиента BlogOS через API Vite (см. комментарий в build-web.mjs).
 *
 *   npm run dev:web            → http://localhost:5173
 *   npm run dev:web -- 5174    → другой порт
 */
import './vite-preload.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../apps/web')

const portArg = process.argv.slice(2).find((arg) => /^\d+$/.test(arg))
const port = Number(portArg ?? process.env.PORT ?? 5173)
const previewMode = process.argv.includes('--preview')

const { createServer, preview } = await import('vite')

if (previewMode) {
  const server = await preview({
    root,
    configFile: resolve(root, 'vite.config.js'),
    preview: { port, host: '127.0.0.1' },
  })
  server.printUrls()
  process.exit(0)
}

const server = await createServer({
  root,
  configFile: resolve(root, 'vite.config.js'),
  server: { port, host: '127.0.0.1', strictPort: false },
})

await server.listen()
server.printUrls()

const shutdown = async () => {
  await server.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
