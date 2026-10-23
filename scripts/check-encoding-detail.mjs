// Точная проверка: печатает строки с подозрительными символами,
// чтобы отличить настоящую двойную кодировку от легитимных «…», «·», «„».
import { readFileSync } from 'node:fs'

const files = process.argv.slice(2)
const marker = /[\u0402\u0403\u201a\u0453\u2020\u2021\u2030\u0409\u040a\u040c\u040b\u040f\u0452\u2018\u2019\u201c\u201d\u2022\u2122\u0459\u045a\u045c\u045b\u045f\u00b5\u00b7]/g

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  const hits = []
  lines.forEach((line, index) => {
    const found = line.match(marker)
    if (found) hits.push(`  ${index + 1}: [${[...new Set(found)].join('')}] ${line.trim().slice(0, 110)}`)
  })
  console.log(`\n=== ${file} — строк с маркерами: ${hits.length}`)
  console.log(hits.slice(0, 8).join('\n'))
}
