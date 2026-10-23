// Поиск файлов с двойной кодировкой (UTF-8, прочитанный как cp1251).
// Признак: символы из «специального» диапазона cp1251 (0x80–0x9F) и µ/·,
// которые в нормальном русском тексте почти не встречаются.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? '.'
const exts = new Set(['.ts', '.js', '.jsx', '.mjs', '.sql', '.md', '.css', '.json', '.yaml', '.yml', '.html'])
const skip = new Set(['node_modules', 'dist', '.git', '.npm-cache', '.pglite-data', '_scratch', 'coverage'])
const marker = /[\u0402\u0403\u201a\u0453\u2020\u2021\u2030\u0409\u040a\u040c\u040b\u040f\u0452\u2018\u2019\u201c\u201d\u2122\u0459\u045a\u045c\u045b\u045f\u00b5]/g

const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full)
    else if (exts.has(entry.slice(entry.lastIndexOf('.')))) files.push(full)
  }
}
walk(root)

const bad = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const hits = (text.match(marker) ?? []).length
  if (hits > 3) bad.push({ file: relative(root, file), hits })
}
bad.sort((a, b) => b.hits - a.hits)
console.log(`файлов проверено: ${files.length}; с признаками двойной кодировки: ${bad.length}`)
for (const item of bad.slice(0, 40)) console.log(String(item.hits).padStart(5), item.file)
