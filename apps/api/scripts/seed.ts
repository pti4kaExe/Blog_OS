/**
 * Демо-данные BlogOS. Идемпотентно: повторный запуск не создаёт дубли
 * (поиск по естественным ключам: telegram_id, имя канала, (author_id, external_id),
 * (author_id, source_url), (source_id, external_id), title и т.д.).
 *
 *   npm run db:seed
 *
 * На пустой базе (в том числе pglite://memory) сначала применяются миграции.
 * В конце печатаются учётные данные для dev-входа.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_AUTHOR, buildStyleProfile } from '@blogos/engine'
import { query, queryOne, closeDb } from '../src/db.ts'
import { applyMigrations } from '../src/migrations.ts'
import { insert as insertLintReport } from '../src/repositories/lint.ts'
import * as tovRepo from '../src/repositories/tov.ts'
import { runRulesLint } from '../src/services/lint.ts'
import { extractSlang, toneFromAddress } from '../src/services/style.ts'
import { recalcKnowledgeEmbeddings, recalcPostEmbeddings } from '../src/services/embeddings/store.ts'

const ADMIN_TELEGRAM_ID = 100500
const AUTHOR_TELEGRAM_ID = 200600

interface IdRow {
  id: number
}

async function ensureUser(
  telegramId: number,
  name: string,
  role: 'user' | 'admin',
): Promise<number> {
  const existing = await queryOne<IdRow>('SELECT id FROM users WHERE telegram_id = $1', [telegramId])
  if (existing) {
    await query(`UPDATE users SET role = $2 WHERE id = $1 AND role <> $2`, [existing.id, role])
    return Number(existing.id)
  }
  const created = await queryOne<IdRow>(
    `INSERT INTO users (telegram_id, name, role) VALUES ($1, $2, $3) RETURNING id`,
    [telegramId, name, role],
  )
  if (!created) throw new Error('Пользователь не создан')
  return Number(created.id)
}

async function ensureProfile(
  userId: number,
  name: string,
  platform: string,
  description: string,
  settings: Record<string, unknown>,
  monthlyCostLimit: number | null,
): Promise<number> {
  const existing = await queryOne<IdRow>(
    `SELECT id FROM author_profiles WHERE user_id = $1 AND name = $2 AND platform = $3`,
    [userId, name, platform],
  )
  if (existing) return Number(existing.id)
  const created = await queryOne<IdRow>(
    `INSERT INTO author_profiles (user_id, name, platform, description, content_settings, monthly_cost_limit)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
    [userId, name, platform, description, JSON.stringify(settings), monthlyCostLimit],
  )
  if (!created) throw new Error('Канал не создан')
  return Number(created.id)
}

async function ensurePost(
  authorId: number,
  contentType: string,
  text: string,
  externalId: string,
  externalUrl: string,
  publishedAt: string,
): Promise<number> {
  const existing = await queryOne<IdRow>(
    `SELECT id FROM posts WHERE author_id = $1 AND external_id = $2`,
    [authorId, externalId],
  )
  if (existing) return Number(existing.id)
  const created = await queryOne<IdRow>(
    `INSERT INTO posts (author_id, content_type, text, external_id, external_url, published_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [authorId, contentType, text, externalId, externalUrl, publishedAt],
  )
  if (!created) throw new Error('Пост не создан')
  return Number(created.id)
}

async function ensureDraft(
  authorId: number,
  title: string,
  text: string,
  sourceNotes: string | null,
  status: string,
  arc: string | null,
): Promise<number> {
  const existing = await queryOne<IdRow>(
    `SELECT id FROM drafts WHERE author_id = $1 AND title = $2`,
    [authorId, title],
  )
  if (existing) return Number(existing.id)
  const created = await queryOne<IdRow>(
    `INSERT INTO drafts (author_id, title, source_notes, text, status, arc)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [authorId, title, sourceNotes, text, status, arc],
  )
  if (!created) throw new Error('Черновик не создан')
  return Number(created.id)
}

async function ensureSource(
  authorId: number,
  name: string,
  sourceType: string,
  sourceUrl: string,
): Promise<number> {
  const existing = await queryOne<IdRow>(
    `SELECT id FROM sources WHERE author_id = $1 AND source_url = $2`,
    [authorId, sourceUrl],
  )
  if (existing) return Number(existing.id)
  const created = await queryOne<IdRow>(
    `INSERT INTO sources (author_id, name, source_type, source_url) VALUES ($1, $2, $3, $4) RETURNING id`,
    [authorId, name, sourceType, sourceUrl],
  )
  if (!created) throw new Error('Источник не создан')
  return Number(created.id)
}

async function ensureComment(
  sourceId: number,
  externalId: string,
  commenterName: string,
  text: string,
  postedAt: string,
): Promise<number> {
  const existing = await queryOne<IdRow>(
    `SELECT id FROM comments WHERE source_id = $1 AND external_id = $2`,
    [sourceId, externalId],
  )
  if (existing) return Number(existing.id)
  const created = await queryOne<IdRow>(
    `INSERT INTO comments (source_id, external_id, commenter_name, text, posted_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [sourceId, externalId, commenterName, text, postedAt],
  )
  if (!created) throw new Error('Комментарий не создан')
  return Number(created.id)
}

async function ensureResponse(
  commentId: number,
  text: string,
  status: string,
  approvedAt: string | null,
): Promise<number> {
  const existing = await queryOne<IdRow>(
    `SELECT id FROM generated_responses WHERE comment_id = $1 AND response_text = $2`,
    [commentId, text],
  )
  if (existing) return Number(existing.id)
  const created = await queryOne<IdRow>(
    `INSERT INTO generated_responses (comment_id, response_text, status, approved_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [commentId, text, status, approvedAt],
  )
  if (!created) throw new Error('Вариант ответа не создан')
  return Number(created.id)
}

async function ensureKnowledge(
  authorId: number,
  title: string,
  content: string,
): Promise<number> {
  const existing = await queryOne<IdRow>(
    `SELECT id FROM knowledge_base WHERE author_id = $1 AND title = $2`,
    [authorId, title],
  )
  if (existing) return Number(existing.id)
  const created = await queryOne<IdRow>(
    `INSERT INTO knowledge_base (author_id, title, content) VALUES ($1, $2, $3) RETURNING id`,
    [authorId, title, content],
  )
  if (!created) throw new Error('Факт не создан')
  return Number(created.id)
}

interface GoldenSeed {
  text: string
  labels: Array<{ type: string; quote: string }>
}

function withRanges(golden: GoldenSeed): Array<{ type: string; quote: string; start: number; end: number }> {
  return golden.labels.map((label) => {
    const start = golden.text.toLowerCase().indexOf(label.quote.toLowerCase())
    return {
      type: label.type,
      quote: label.quote,
      start: start < 0 ? 0 : start,
      end: start < 0 ? 0 : start + label.quote.length,
    }
  })
}

async function ensureGolden(golden: GoldenSeed, platform: string): Promise<void> {
  const existing = await queryOne<IdRow>('SELECT id FROM golden_dataset WHERE text = $1', [
    golden.text,
  ])
  if (existing) return
  await query(
    `INSERT INTO golden_dataset (text, labels, platform) VALUES ($1, $2::jsonb, $3)`,
    [golden.text, JSON.stringify(withRanges(golden)), platform],
  )
}

export interface SeedResult {
  adminId: number
  authorId: number
  channelIds: Record<string, number>
  goldens: number
  counts: Record<string, number>
}

export async function seed(): Promise<SeedResult> {
  await applyMigrations()

  // ─── Пользователи и каналы: по 2 канала у админа и автора ────────────────────
  const adminId = await ensureUser(ADMIN_TELEGRAM_ID, 'Демо-админ', 'admin')
  const authorId = await ensureUser(AUTHOR_TELEGRAM_ID, 'Демо-автор', 'user')

  const settings = {
    topics: ['ведение блога', 'контент', 'регулярность'],
    language: 'ru',
    target_length: { min: 800, max: 2500 },
  }
  const adminTelegram = await ensureProfile(
    adminId,
    'Админ-канал',
    'telegram',
    'Канал администратора для проверки Evals',
    settings,
    500,
  )
  const adminYoutube = await ensureProfile(
    adminId,
    'Админ-видео',
    'youtube',
    'Видеоканал администратора',
    settings,
    500,
  )
  const authorTelegram = await ensureProfile(
    authorId,
    'Заметки разработчика',
    'telegram',
    'О коде, учёбе и регулярности',
    settings,
    500,
  )
  const authorInstagram = await ensureProfile(
    authorId,
    'Заметки в сторис',
    'instagram',
    'Короткие заметки на бегу',
    settings,
    300,
  )

  // ─── Профиль стиля (tov_profiles 1:1 с каналом) ─────────────────────────────
  const engineProfile = buildStyleProfile(DEMO_AUTHOR.samples)
  if (engineProfile) {
    await tovRepo.upsert(authorTelegram, {
      tone: toneFromAddress(String(engineProfile.address ?? '')),
      slang: extractSlang(DEMO_AUTHOR.samples),
      stop_words: [],
      favorite_phrases: (
        Array.isArray(engineProfile.signaturePhrases) ? engineProfile.signaturePhrases : []
      ).slice(0, 6) as string[],
      metrics: engineProfile,
      analyzed_at: true,
    })
  }

  // ─── Посты: 6 штук на разных площадках ──────────────────────────────────────
  const postIds: number[] = []
  for (let index = 0; index < DEMO_AUTHOR.samples.length; index++) {
    const sample = DEMO_AUTHOR.samples[index]
    if (!sample) continue
    postIds.push(
      await ensurePost(
        authorTelegram,
        'post',
        sample,
        `seed-tg-${index + 1}`,
        `https://t.me/demo_notes/${index + 1}`,
        new Date(Date.UTC(2026, 8, 10 + index, 9, 0, 0)).toISOString(),
      ),
    )
  }
  postIds.push(
    await ensurePost(
      authorInstagram,
      'caption',
      'Короткая заметка: регулярность важнее вдохновения. Проверено на себе за три месяца ведения канала.',
      'seed-ig-1',
      'https://instagram.com/p/seed1',
      new Date(Date.UTC(2026, 8, 20, 12, 0, 0)).toISOString(),
    ),
  )
  postIds.push(
    await ensurePost(
      authorInstagram,
      'caption',
      'Что помогает мне писать каждый день: одна строка заметок утром и одна публикация вечером.',
      'seed-ig-2',
      'https://instagram.com/p/seed2',
      new Date(Date.UTC(2026, 8, 22, 12, 0, 0)).toISOString(),
    ),
  )
  postIds.push(
    await ensurePost(
      adminTelegram,
      'post',
      'Эталонный пост администратора: проверка Evals идёт по независимым эталонам, а не по моим публикациям.',
      'seed-admin-1',
      'https://t.me/admin_demo/1',
      new Date(Date.UTC(2026, 8, 24, 10, 0, 0)).toISOString(),
    ),
  )
  for (const postId of postIds) {
    const post = await queryOne<{ id: number; text: string }>(
      'SELECT id, text FROM posts WHERE id = $1',
      [postId],
    )
    if (post) await recalcPostEmbeddings(Number(post.id), String(post.text))
  }

  // ─── Черновики: один on_check, один ready ───────────────────────────────────
  const draftOnCheck = await ensureDraft(
    authorTelegram,
    'Черновик: план и поток',
    'В современном мире каждый автор обязан вести контент-план. Это очень важно для роста. Выйти на новый уровень без плана невозможно.',
    'план убивает живость\nно без плана нет регулярности',
    'on_check',
    'opinion_breakdown',
  )
  const draftReady = await ensureDraft(
    authorTelegram,
    'Готовый пост: регулярность',
    DEMO_AUTHOR.samples[2] ?? 'Регулярность важнее гениальности. Я пишу два раза в неделю и не пропускаю публикации.',
    null,
    'ready',
    'story_case',
  )

  // ─── 2 отчёта lint по черновикам (правиловый движок) ────────────────────────
  const lintProfile = (engineProfile as Record<string, unknown> | null) ?? null
  for (const draftId of [draftOnCheck, draftReady]) {
    const draft = await queryOne<{ id: number; text: string }>(
      'SELECT id, text FROM drafts WHERE id = $1',
      [draftId],
    )
    if (!draft) continue
    const existing = await queryOne<{ count: number }>(
      'SELECT count(*)::int AS count FROM lint_reports WHERE draft_id = $1',
      [draftId],
    )
    if (Number(existing?.count ?? 0) > 0) continue
    const result = runRulesLint(String(draft.text), lintProfile as never)
    await insertLintReport({
      draftId: Number(draft.id),
      score: result.score,
      issues: result.issues,
      engine: 'rules',
      generationRunId: null,
    })
  }

  // ─── Источники: telegram, instagram, youtube ────────────────────────────────
  const sourceTelegram = await ensureSource(
    authorTelegram,
    'Канал про код',
    'telegram_channel',
    'https://t.me/s/code_demo',
  )
  const sourceInstagram = await ensureSource(
    authorInstagram,
    'Инстаграм автора',
    'instagram',
    'https://instagram.com/p/seed1',
  )
  const sourceYoutube = await ensureSource(
    adminYoutube,
    'Видео про аналитику',
    'youtube',
    'https://www.youtube.com/channel/UCseed_demo_channel',
  )

  // ─── 6 комментариев ─────────────────────────────────────────────────────────
  const commentSeeds = [
    [sourceTelegram, 'seed-tg-c1', 'Марина', 'Второй месяц не могу выйти на регулярность в канале. Как вы удерживаете ритм?', 1],
    [sourceTelegram, 'seed-tg-c2', 'Денис', 'Считаю, что контент-план убивает живость текста. Планирование подходит только корпоративным блогам.', 2],
    [sourceTelegram, 'seed-tg-c3', 'Ольга', 'Как вы понимаете, что черновик готов к публикации? Ищу внятный критерий.', 3],
    [sourceInstagram, 'seed-ig-c1', 'Ирина', 'Где вы берёте идеи для постов, когда в проекте месяц ничего не происходит?', 22],
    [sourceInstagram, 'seed-ig-c2', 'Кирилл', 'Как вы оцениваете качество текста до публикации?', 23],
    [sourceYoutube, 'seed-yt-c1', 'Алексей', 'Как совмещать аналитику и ведение канала без выгорания?', 24],
  ] as const
  const commentIds: number[] = []
  for (const [sourceId, externalId, name, text, day] of commentSeeds) {
    commentIds.push(
      await ensureComment(
        sourceId,
        externalId,
        name,
        text,
        new Date(Date.UTC(2026, 9, day, 11, 0, 0)).toISOString(),
      ),
    )
  }

  // ─── 3 варианта ответа на первый комментарий ────────────────────────────────
  const firstComment = commentIds[0]
  if (firstComment !== undefined) {
    await ensureResponse(
      firstComment,
      'Спасибо за вопрос! В моём опыте сначала я делал это вручную. [дополните: что именно сработало у меня и в каких условиях] А у тебя как это устроено?',
      'generated',
      null,
    )
    await ensureResponse(
      firstComment,
      'Спасибо за вопрос! Я выписал темы, которые меня задевают, и пишу по две в неделю. Это помогло не терять ритм.',
      'pending_approval',
      null,
    )
    await ensureResponse(
      firstComment,
      'Спасибо за вопрос! Регулярность оказалась важнее гениальности: за месяц пришло 300 человек.',
      'approved',
      new Date(Date.UTC(2026, 9, 21, 12, 0, 0)).toISOString(),
    )
  }

  // ─── 5 фактов базы знаний ───────────────────────────────────────────────────
  const knowledgeSeeds = [
    ['Обо мне', 'Работаю в продуктовой аналитике с 2019 года. Веду канал о том, как совмещать аналитику и тексты.'],
    ['О канале', 'Канал «Заметки разработчика» существует с 2023 года. Пишу два раза в неделю о коде, учёбе и регулярности.'],
    ['Темы', 'Основные темы: регулярность в ведении блога, проверка текстов, контент-план без потери живости.'],
    ['Инструменты', 'Для учёта идей использую файл заметок: одна строка на мысль, раз в месяц разбираю заготовки.'],
    ['Метрики', 'Ориентируюсь на подписчиков и отклик в комментариях, а не на лайки. За месяц регулярности пришло 300 человек.'],
  ] as const
  for (const [title, content] of knowledgeSeeds) {
    const knowledgeId = await ensureKnowledge(authorTelegram, title, content)
    await recalcKnowledgeEmbeddings(knowledgeId, content)
  }

  // ─── 10 эталонов golden_dataset с разметкой ────────────────────────────────
  const goldenSeeds: GoldenSeed[] = [
    {
      text: 'Этот способ помогает выйти из зоны комфорта и начать действовать каждый день.',
      labels: [
        { type: 'cliche', quote: 'выйти из зоны комфорта' },
        { type: 'logic', quote: 'каждый' },
      ],
    },
    {
      text: 'Хочу прокачать свой канал и рассказывать о работе каждый день.',
      labels: [{ type: 'cliche', quote: 'прокачать' }],
    },
    {
      text: 'Секрет успеха прост: публикуй каждый день и не сдавайся.',
      labels: [
        { type: 'cliche', quote: 'Секрет успеха' },
        { type: 'logic', quote: 'каждый' },
      ],
    },
    {
      text: 'Лайфхак для авторов: пиши утром, а публикуй вечером, и будет результат.',
      labels: [{ type: 'cliche', quote: 'Лайфхак' }],
    },
    {
      text: 'Я гарантирую, что этот подход даст 100% результат каждому автору.',
      labels: [
        { type: 'logic', quote: 'гарантирую' },
        { type: 'logic', quote: '100%' },
      ],
    },
    {
      text: 'Всегда публикуй только полезный контент, и подписчики придут сами.',
      labels: [
        { type: 'logic', quote: 'Всегда' },
        { type: 'cliche', quote: 'полезный контент' },
      ],
    },
    {
      text: 'Данный подход является очень эффективным для роста канала.',
      labels: [
        { type: 'clarity', quote: 'является' },
        { type: 'clarity', quote: 'очень' },
      ],
    },
    {
      text: 'В рамках проекта мы осуществляем проверку текстов перед публикацией.',
      labels: [
        { type: 'clarity', quote: 'В рамках' },
        { type: 'clarity', quote: 'осуществляем' },
      ],
    },
    {
      text: 'Никто не сможет прокачать канал без регулярности и дисциплины.',
      labels: [
        { type: 'logic', quote: 'Никто' },
        { type: 'cliche', quote: 'прокачать' },
      ],
    },
    {
      text: 'Этот метод сработает у каждого, кто выполняет простые шаги каждый день.',
      labels: [{ type: 'logic', quote: 'сработает у каждого' }],
    },
  ]
  const platforms = ['telegram', 'instagram', 'youtube']
  for (let index = 0; index < goldenSeeds.length; index++) {
    const golden = goldenSeeds[index]
    if (!golden) continue
    await ensureGolden(golden, platforms[index % platforms.length] ?? 'telegram')
  }

  const counts = {
    users: Number((await queryOne<{ c: number }>('SELECT count(*)::int AS c FROM users'))?.c ?? 0),
    author_profiles: Number(
      (await queryOne<{ c: number }>('SELECT count(*)::int AS c FROM author_profiles'))?.c ?? 0,
    ),
    posts: Number((await queryOne<{ c: number }>('SELECT count(*)::int AS c FROM posts'))?.c ?? 0),
    drafts: Number((await queryOne<{ c: number }>('SELECT count(*)::int AS c FROM drafts'))?.c ?? 0),
    lint_reports: Number(
      (await queryOne<{ c: number }>('SELECT count(*)::int AS c FROM lint_reports'))?.c ?? 0,
    ),
    sources: Number((await queryOne<{ c: number }>('SELECT count(*)::int AS c FROM sources'))?.c ?? 0),
    comments: Number(
      (await queryOne<{ c: number }>('SELECT count(*)::int AS c FROM comments'))?.c ?? 0,
    ),
    responses: Number(
      (await queryOne<{ c: number }>('SELECT count(*)::int AS c FROM generated_responses'))?.c ?? 0,
    ),
    knowledge: Number(
      (await queryOne<{ c: number }>('SELECT count(*)::int AS c FROM knowledge_base'))?.c ?? 0,
    ),
    goldens: Number(
      (await queryOne<{ c: number }>('SELECT count(*)::int AS c FROM golden_dataset'))?.c ?? 0,
    ),
    embeddings: Number(
      (await queryOne<{ c: number }>('SELECT count(*)::int AS c FROM embeddings'))?.c ?? 0,
    ),
  }

  return {
    adminId,
    authorId,
    channelIds: {
      adminTelegram,
      adminYoutube,
      authorTelegram,
      authorInstagram,
    },
    goldens: counts.goldens,
    counts,
  }
}

const isMain = (): boolean => {
  const entry = process.argv[1]
  if (!entry) return false
  return resolve(entry).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
}

if (isMain()) {
  try {
    const result = await seed()
    console.log('\nДемо-данные готовы. Учётные данные для dev-входа (DEV_AUTH=1):')
    console.log(`  админ:  POST /auth/telegram {"telegram_id": ${ADMIN_TELEGRAM_ID}, "name": "Демо-админ"}`)
    console.log(`  автор:  POST /auth/telegram {"telegram_id": ${AUTHOR_TELEGRAM_ID}, "name": "Демо-автор"}`)
    console.log(`  каналы: ${JSON.stringify(result.channelIds)}`)
    console.log(`  эталонов golden_dataset: ${result.goldens}`)
    console.log(`  записей: ${JSON.stringify(result.counts)}`)
    console.log('  пример: curl -X POST http://localhost:3001/auth/telegram -H "content-type: application/json" -d \'{"telegram_id":200600,"name":"Демо-автор"}\'')
  } catch (error) {
    console.error('\nСид не выполнен:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  } finally {
    await closeDb()
  }
}
