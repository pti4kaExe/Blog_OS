/**
 * Сборка клиента BlogOS через API Vite.
 *
 * Зачем обёртка, а не `vite build`:
 *  - preload гасит windows-специфичный вызов `net use`, который блокируется
 *    в ограниченной среде (см. scripts/vite-preload.mjs);
 *  - корень проекта задаётся явно, поэтому команда работает из любой папки
 *    монорепо: `npm run build:web` из корня или `npm run build` в apps/web.
 *
 * В обычном окружении обёртка ведёт себя так же, как `vite build`.
 */
import './vite-preload.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { checkWebAssets } from './check-web-assets.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../apps/web')

// Сначала проверка адресов статики: абсолютный `/logo.svg` в JSX ломается
// в подпапке GitHub Pages (был битый логотип в шапке — см. check-web-assets.mjs).
if (checkWebAssets().length > 0) process.exit(1)

const { build } = await import('vite')

try {
  await build({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'info' })
  console.log('\nКлиент собран: apps/web/dist')
} catch (error) {
  console.error('\nСборка клиента не удалась:', error instanceof Error ? error.message : error)
  process.exitCode = 1
}
