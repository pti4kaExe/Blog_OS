import { tovAddress, tovMetricRows, tovRhythm, tovStats, tovSummary, tovTags } from '../lib/tov.js'
import { Metric, Tag } from './ui.jsx'
import { Reveal, Stagger } from './ui/Motion.jsx'
import VoiceRhythm from './ui/VoiceRhythm.jsx'

/**
 * Карточка профиля Tone of Voice — одна на оба режима.
 *
 * Раньше её рисовали два разных экрана: `StyleStep` в локальном режиме и
 * `CloudStyleStep` в облачном. Данные одни и те же (сервер хранит в
 * `tov_profiles.metrics` ровно ту карточку, которую считает движок), а
 * выглядели они по-разному: в локальной была строка «как вы пишете» и
 * частые связки, в облачной — стоп-слова и свои словечки, и ни в одной
 * не было всего сразу.
 *
 * Компонент принимает профиль в любом из двух видов — `lib/tov.js` умеет
 * читать и карточку движка, и серверный объект с `metrics` внутри.
 * Блоки, для которых данных нет, просто не рисуются.
 *
 * Характеристики входят каскадом по смысловым группам, а не по строкам
 * (раздел 06): группа — это одна мысль о голосе автора, и появляться она
 * должна целиком. Каскад играет один раз, при появлении профиля.
 */
export default function TovCard({ profile, tone, slang = [], stopWords = [], phrases = [] }) {
  const summary = tovSummary(profile)
  const metrics = tovMetricRows(profile)
  const tags = tovTags(profile)
  const stats = tovStats(profile)
  const rhythm = tovRhythm(profile)

  /* Обращение приходит либо полем `tone` (сервер), либо `address`
     внутри метрик (движок) — `tovAddress` читает оба. */
  const address = tone || tovAddress(profile)
  const lexicon = [...slang, ...phrases]

  return (
    <Stagger>
      {summary && (
        <Reveal as="p" style={{ marginTop: 0 }}>
          <strong>Как вы пишете:</strong> {summary}
        </Reveal>
      )}

      {rhythm && (
        <Reveal>
          <VoiceRhythm
            rhythm={rhythm}
            label={rhythm.long
              ? 'Ритм фраз: развёрнутые предложения с заметными перепадами длины'
              : 'Ритм фраз: короткие предложения, ровный темп'}
          />
        </Reveal>
      )}

      {metrics.length > 0 && (
        <Reveal className="metrics" style={{ marginBottom: 14 }}>
          {metrics.slice(0, 6).map((row) => (
            <Metric key={row.key} value={row.value} label={row.label} />
          ))}
        </Reveal>
      )}

      {(address || lexicon.length > 0) && (
        <Reveal>
          <h3>Тон и лексика</h3>
          <div className="tags" style={{ marginBottom: 12 }}>
            {address && <Tag>обращение: {address}</Tag>}
            {slang.map((word) => <Tag key={`slang-${word}`}>{word}</Tag>)}
            {phrases.map((phrase) => <Tag key={`phrase-${phrase}`}>{phrase}</Tag>)}
          </div>
        </Reveal>
      )}

      {stopWords.length > 0 && (
        <Reveal>
          <h3>Стоп-слова</h3>
          <div className="tags" style={{ marginBottom: 12 }}>
            {stopWords.map((word) => <Tag key={`stop-${word}`} kind="warn">{word}</Tag>)}
          </div>
        </Reveal>
      )}

      {tags.topics.length > 0 && (
        <Reveal>
          <h3>Ваши темы</h3>
          <div className="tags" style={{ marginBottom: 12 }}>
            {tags.topics.map((topic) => <Tag key={topic}>{topic}</Tag>)}
          </div>
        </Reveal>
      )}

      {tags.phrases.length > 0 && (
        <Reveal>
          <h3>Частые связки</h3>
          <div className="tags" style={{ marginBottom: 12 }}>
            {tags.phrases.map((phrase) => <Tag key={phrase}>{phrase}</Tag>)}
          </div>
        </Reveal>
      )}

      {stats && <Reveal as="p" className="faint" style={{ marginBottom: 14 }}>{stats}</Reveal>}
    </Stagger>
  )
}
