/**
 * Проверка адресов статики в исходниках клиента.
 *
 * Сайт живёт и в корне домена (Vercel, локально), и в подпапке
 * (`/Blog_OS/` на GitHub Pages). Поэтому `src="/logo.svg"` и `href="/help"`
 * в JSX — ошибка: браузер ищет файл в корне домена, получает 404 и рисует
 * битую картинку. Правильно — `import.meta.env.BASE_URL` или импорт ассета.
 *
 * Модуль вызывается сборкой клиента (scripts/build-web.mjs), чтобы такая
 * ошибка не уехала на прод: история — битый логотип в шапке на Pages.
 * Запуск вручную: `node scripts/check-web-assets.mjs`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Путь считаем от файла скрипта, а не от cwd: npm запускает сборку из apps/web.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = resolve(ROOT, 'apps/web/src')

/** Абсолютный путь к статике или странице в атрибуте JSX. */
const PATTERN = /\b(?:src|href)\s*=\s*["']\/(?!\/)/g

export function findAbsoluteAssetPaths(dir = SRC) {
  const problems = []

  function walk(current) {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(jsx?|tsx?)$/.test(entry)) continue
      const lines = readFileSync(full, 'utf8').split('\n')
      lines.forEach((line, index) => {
        const trimmed = line.trim()
        // Комментарии не считаем: в них путь упоминается как пояснение.
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
        PATTERN.lastIndex = 0
        if (PATTERN.test(line)) {
          problems.push(`${full}:${index + 1}: ${trimmed.slice(0, 120)}`)
        }
      })
    }
  }

  walk(dir)
  return problems
}

/**
 * Возвращает список проблем; пустой список — всё в порядке.
 * Не завершает процесс, чтобы вызывающий сам решил, что делать.
 */
export function checkWebAssets() {
  const problems = findAbsoluteAssetPaths()
  if (problems.length === 0) {
    console.log('Адреса статики в клиенте относительны к базе сборки — ок.')
    return problems
  }
  console.error('Найдены абсолютные адреса статики — на GitHub Pages они дадут 404:')
  for (const problem of problems) console.error('  ' + problem)
  console.error('Замените на `${import.meta.env.BASE_URL}<файл>` или импортируйте ассет.')
  return problems
}

// Прямой запуск (не импорт) — проверяем и выходим с кодом ошибки при находках.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(checkWebAssets().length === 0 ? 0 : 1)
}
