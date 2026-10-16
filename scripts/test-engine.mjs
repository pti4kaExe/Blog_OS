/**
 * Проверка движков без браузера: граничные случаи и основной сценарий.
 * Запуск: npm run test:engine
 */
import { buildStyleProfile, compareToProfile } from '../src/engine/styleProfile.js'
import { buildPost, suggestArc, splitFragments, ARCS } from '../src/engine/narrative.js'
import { lint, applyFixes, scoreText } from '../src/engine/anticringe.js'
import { rankDiscussions, draftComment, hasGaps } from '../src/engine/radar.js'
import { DEMO_AUTHOR, DEMO_DISCUSSIONS } from '../src/engine/demoData.js'

let passed = 0
let failed = 0
const check = (name, condition, extra = '') => {
  if (condition) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name} ${extra}`) }
}

console.log('\n— граничные значения —')
const WEIRD = ['', '   ', '\n\n\n', 'а', '123 456', '🔥🔥🔥', '?!..', 'a'.repeat(5000), 'Привет! '.repeat(400)]
for (const input of WEIRD) {
  const label = JSON.stringify(input.slice(0, 12))
  try {
    buildStyleProfile([input])
    const post = buildPost(input, null)
    if (post.ok) { post.text.length } // eslint-disable-line no-unused-expressions
    const report = lint(input, null)
    if (!report.empty) applyFixes(input, report.issues)
    rankDiscussions(DEMO_DISCUSSIONS, null)
    check(`не падает на ${label}`, true)
  } catch (e) {
    check(`не падает на ${label}`, false, e.message)
  }
}

console.log('\n— профиль стиля —')
check('мало текста → null', buildStyleProfile(['коротко']) === null)
check('пустой массив → null', buildStyleProfile([]) === null)
const profile = buildStyleProfile(DEMO_AUTHOR.samples)
check('профиль построен', Boolean(profile))
check('обращение на «ты» распознано', profile.address === 'ты', profile.address)
check('личный голос найден', profile.firstPersonPer100Words > 3, String(profile.firstPersonPer100Words))
check('темы извлечены', profile.topTerms.length >= 5)
check('сравнение с профилем работает', compareToProfile('Я пишу короткие посты.', profile).length === 6)

console.log('\n— Narrative Engine —')
check('одна строка → отказ с причиной', buildPost('только одна мысль', profile).ok === false)
const arcs = {
  story: 'полгода назад я не понимал, зачем веду канал\nписал, когда было настроение\nподписчики почти не приходили, за квартал 40 человек\nпотом я сел и выписал все темы\nза первый месяц пришло 300 подписчиков',
  problem: 'авторы теряют время на редактуру, потому что правят по вкусу\nнет критерия, когда текст готов\nмешает то, что каждый видит своё\nможно завести чек-лист из пяти пунктов\nобсуждение правок сократилось вдвое',
  opinion: 'ai-тексты заполнили ленту и читать стало нечего\nглавная претензия не к качеству, а к отсутствию позиции\nавтор должен отвечать за то, что написал\nинструмент не виноват, вопрос в том, кто держит руку',
}
for (const [expected, notes] of Object.entries(arcs)) {
  check(`арка «${ARCS[expected].label}» выбрана автоматически`, suggestArc(splitFragments(notes)) === expected, suggestArc(splitFragments(notes)))
}
for (const key of Object.keys(ARCS)) {
  const post = buildPost(arcs.story, profile, key)
  check(`арка ${key}: ни одна заметка не потеряна`, post.coverage.used === post.coverage.total, `${post.coverage.used}/${post.coverage.total}`)
  check(`арка ${key}: заголовок не является связкой`, !post.additions.some((a) => a.text.startsWith(post.title)))
  check(`арка ${key}: есть текст`, post.text.length > 50)
}

console.log('\n— AntiCringe —')
const clean = 'Я перестал писать посты по вдохновению. Полгода канал стоял.\nПотом я завёл файл с темами.\nСейчас пишу два раза в неделю и не жду настроения.'
const cringe = `Друзья, всем привет! Сегодня хочу поделиться с вами секретом успеха 🔥🔥🔥
Ни для кого не секрет, что вам нужно выйти из зоны комфорта, чтобы прокачать канал!
Данный подход является осуществлением изменения вашего мышления, которое гарантированно работает у всех!
Все авторы всегда делают одну ошибку. 87% каналов умирают в первый месяц.
Поэтому нужно писать каждый день без воды.
Писать каждый день не нужно, это выгорание.
Это самый лучший метод. Сохраняйте, чтобы не потерять! Ставьте лайк!`
const cleanReport = lint(clean, profile)
const cringeReport = lint(cringe, profile)
check('чистый текст получает высокую оценку', cleanReport.score >= 80, String(cleanReport.score))
check('кринжовый текст получает низкую оценку', cringeReport.score <= 35, String(cringeReport.score))
check('найдены клише', cringeReport.issues.some((i) => i.category === 'cliche'))
check('найдено противоречие', cringeReport.issues.some((i) => i.ruleId === 'logic:contradiction'))
check('найдено обещание результата', cringeReport.issues.some((i) => i.ruleId.startsWith('guarantee')))
check('найден канцелярит', cringeReport.issues.some((i) => i.ruleId.startsWith('bureau')))
check('замечания не пересекаются', noOverlaps(cringeReport.issues))
const fixed = applyFixes(cringe, cringeReport.issues)
const afterReport = lint(fixed.text, profile)
check('автоправки повышают оценку', afterReport.score > cringeReport.score, `${cringeReport.score} → ${afterReport.score}`)
check('автоправки не ломают текст', !/\s[,.!?]|[,;:]\s*[.!?]|\.\./.test(fixed.text), fixed.text.slice(0, 120))
check('каждое предложение начинается с заглавной', fixed.text.split(/(?<=[.!?])\s+/).every((s) => !/^[а-яё]/.test(s.trim())))
check('именительный «вы» не правится автоматически',
  lint('Вы получаете результат.', profile).issues.filter((i) => i.ruleId === 'tov:address').every((i) => i.fix === undefined))
check('id замечаний стабильны между проверками',
  lint(cringe, profile).issues.map((i) => i.id).join() === cringeReport.issues.map((i) => i.id).join())
check('пересчёт оценки без скрытых замечаний работает',
  scoreText(cringeReport.issues.slice(0, 3), cringeReport.metrics.words).score > cringeReport.score)

console.log('\n— CommentRadar —')
const ranked = rankDiscussions(DEMO_DISCUSSIONS, profile)
check('лента отсортирована по релевантности', ranked.every((d, i) => i === 0 || ranked[i - 1].matchScore >= d.matchScore))
check('нерелевантное обсуждение внизу', ranked[ranked.length - 1].matchScore < 20, String(ranked[ranked.length - 1].matchScore))
check('у лидера есть совпавшие темы', ranked[0].matchedTerms.length > 0)
const drafts = ranked.slice(0, 6).map((d) => draftComment(d, profile))
check('черновик опирается на пост автора', drafts.every((d) => d.evidence !== null))
check('черновик оставляет пропуск для автора', drafts.every((d) => hasGaps(d.text)))
check('черновики проходят собственный линтер', drafts.every((d) => lint(d.text, profile).score >= 80))
check('без профиля радар не падает', rankDiscussions(DEMO_DISCUSSIONS, null).length === DEMO_DISCUSSIONS.length)

function noOverlaps(issues) {
  const ranged = issues.filter((i) => i.start !== null).sort((a, b) => a.start - b.start)
  return ranged.every((issue, i) => i === 0 || ranged[i - 1].end <= issue.start)
}

console.log(`\nИтог: ${passed} пройдено, ${failed} провалено\n`)
process.exit(failed ? 1 : 0)
