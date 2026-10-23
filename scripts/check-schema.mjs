// Проверка схемы: 17 внешних ключей, каскады, обнуление, неизменяемость отчёта.
process.env.DATABASE_URL = 'pglite://memory'
const { query, exec, closeDb } = await import('../apps/api/src/db.ts')
const { readFileSync, readdirSync } = await import('node:fs')

const dir = 'db/sql'
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  await exec(readFileSync(`${dir}/${file}`, 'utf8'))
  console.log('применён', file)
}

const fks = await query(`
  select tc.table_name, kcu.column_name, ccu.table_name as ref, rc.delete_rule
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
  join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
  where tc.constraint_type = 'FOREIGN KEY' order by 1, 2
`)
console.log(`\nFK: ${fks.length}`)
for (const f of fks) console.log(' ', `${f.table_name}.${f.column_name} -> ${f.ref} [${f.delete_rule}]`)

const tables = await query(
  `select count(*)::int as c from information_schema.tables where table_schema='public' and table_name <> '_migrations'`,
)
console.log(`\nтаблиц: ${tables[0].c}`)

// Наполнение для проверки поведения ссылок
await query("insert into users(telegram_id,name,role) values (1,'admin','admin'), (2,'author','user')")
await query("insert into author_profiles(user_id,name,platform) values (2,'канал','telegram')")
const profile = await query('select id from author_profiles limit 1')
const pid = profile[0].id
await query("insert into posts(author_id,content_type,text) values ($1,'post','пост')", [pid])
const post = await query('select id from posts limit 1')
const postId = post[0].id
await query("insert into drafts(author_id,text,status) values ($1,'текст','ready')", [pid])
const draft = await query('select id from drafts limit 1')
const draftId = draft[0].id
await query(
  "insert into generation_runs(author_id,task_type,model,status) values ($1,'lint','deepseek-chat','success')",
  [pid],
)
const run = await query('select id from generation_runs limit 1')
const runId = run[0].id
await query('insert into lint_reports(draft_id,generation_run_id,score) values ($1,$2,50)', [draftId, runId])

// (а) обычный UPDATE запрещён
try {
  await query('update lint_reports set score = 60')
  console.log('\n[a] UPDATE score: НЕ запрещён — дефект')
} catch (e) {
  console.log('\n[a] UPDATE score запрещён:', e.code, e.message)
}

// (б) удаление вызова обнуляет ссылку
await query('delete from generation_runs where id = $1', [runId])
const after = await query('select generation_run_id, score from lint_reports')
console.log('[b] после удаления вызова:', JSON.stringify(after[0]))

// (в) подмена ссылки на другой несуществующий/иной id запрещена
await query("insert into generation_runs(author_id,task_type,model,status) values ($1,'lint','m','success')", [pid])
const run2 = await query("select id from generation_runs where model='m' limit 1")
try {
  await query('update lint_reports set generation_run_id = $1', [run2[0].id])
  console.log('[c] подмена ссылки: НЕ запрещена — дефект')
} catch (e) {
  console.log('[c] подмена ссылки запрещена:', e.code)
}

// удаление поста обнуляет published_post_id, черновик остаётся
await query('update drafts set published_post_id = $1 where id = $2', [postId, draftId])
await query('delete from posts where id = $1', [postId])
const draftAfter = await query('select published_post_id, status from drafts where id = $1', [draftId])
console.log('[d] черновик после удаления поста:', JSON.stringify(draftAfter[0]))

// удаление канала обнуляет author_id в журнале, запись остаётся
await query('delete from author_profiles where id = $1', [pid])
const runsAfter = await query('select count(*)::int as c, count(author_id)::int as with_author from generation_runs')
console.log('[e] журнал после удаления канала:', JSON.stringify(runsAfter[0]))

await closeDb()
