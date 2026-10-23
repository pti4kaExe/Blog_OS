/** Общие zod-схемы маршрутов: значения enum и структуры из docs/API.md. */
import { z } from 'zod'

export const platformSchema = z.enum(['telegram', 'instagram', 'youtube'])

export const contentTypeSchema = z.enum([
  'post',
  'caption',
  'reels_script',
  'video_script',
  'video_description',
])

export const draftStatusSchema = z.enum(['draft', 'on_check', 'ready', 'published'])
export const draftOriginSchema = z.enum(['author', 'narrative_engine'])

export const sourceTypeSchema = z.enum([
  'telegram_channel',
  'telegram_chat',
  'instagram',
  'youtube',
  'manual',
])

export const responseStatusSchema = z.enum([
  'generated',
  'pending_approval',
  'approved',
  'rejected',
  'sent',
])

export const taskTypeSchema = z.enum([
  'narrative_generate',
  'lint',
  'tov_analyze',
  'response_generate',
  'embeddings',
])

export const runStatusSchema = z.enum(['pending', 'success', 'failed'])

export const toneSchema = z.enum(['ты', 'вы', 'смешанное'])

export const contentSettingsSchema = z
  .object({
    topics: z.array(z.string()).optional(),
    language: z.string().min(1).optional(),
    target_length: z
      .object({
        min: z.number().int().nonnegative(),
        max: z.number().int().positive(),
      })
      .refine((value) => value.min <= value.max, {
        message: 'target_length.min должен быть ≤ target_length.max',
      })
      .optional(),
  })
  .passthrough()
  .nullable()

export const goldenLabelSchema = z.object({
  type: z.string().min(1),
  quote: z.string().optional(),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
})

/** Явный AI-запрос: при 100% лимита отвечаем 402 вместо тихого отката. */
export const strictAiSchema = z.boolean().optional()

export function strictAiOf(body: { strict_ai?: boolean } | null | undefined): boolean {
  return body?.strict_ai === true
}
