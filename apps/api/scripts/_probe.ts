import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'

const db = new PGlite({ extensions: { vector } })
await db.exec('CREATE EXTENSION IF NOT EXISTS vector;')
await db.exec(
  'CREATE TABLE t (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(), j jsonb, v vector(3))',
)
const ins = await db.query(
  'INSERT INTO t (j, v) VALUES ($1, $2::vector) RETURNING id, ts, j',
  [JSON.stringify([1, 2]), '[1,2,3]'],
)
console.log('ins rows', ins.rows)
console.log('fields', ins.fields.map((f) => [f.name, f.dataTypeID]))
const sel = await db.query('SELECT * FROM t')
console.log('sel', sel.rows, typeof sel.rows[0].ts, sel.rows[0].ts instanceof Date)
console.log('jsonb type', typeof sel.rows[0].j)
const cmp = await db.query('SELECT * FROM t WHERE (ts, id) < ($1::timestamptz, $2::bigint)', [
  sel.rows[0].ts,
  999,
])
console.log('rowcmp ok', cmp.rows.length)
const trig = await db.query(
  "CREATE TRIGGER trg BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION blogos_forbid_update()",
).then(
  () => 'created',
  (e) => `err ${e.message}`,
)
console.log('trigger', trig)
const bigint = await db.query('SELECT 9007199254740993::bigint AS big')
console.log('bigint row', bigint.rows, typeof bigint.rows[0].big)
await db.close()
