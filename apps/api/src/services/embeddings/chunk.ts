/**
 * Разбиение текста на чанки для RAG: ~800 символов с перекрытием 100.
 * Перекрытие сохраняет смысл на границе чанков при поиске.
 */
export const CHUNK_SIZE = 800
export const CHUNK_OVERLAP = 100

export function chunkText(text: string): string[] {
  const clean = String(text ?? '').trim()
  if (!clean) return []
  if (clean.length <= CHUNK_SIZE) return [clean]

  const chunks: string[] = []
  let start = 0
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_SIZE, clean.length)
    if (end < clean.length) {
      const space = clean.lastIndexOf(' ', end)
      if (space > start + Math.floor(CHUNK_SIZE / 2)) end = space
    }
    const chunk = clean.slice(start, end).trim()
    if (chunk) chunks.push(chunk)
    if (end >= clean.length) break
    const next = end - CHUNK_OVERLAP
    start = next > start ? next : end
  }
  return chunks
}
