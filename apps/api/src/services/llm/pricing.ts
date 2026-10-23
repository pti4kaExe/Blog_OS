/**
 * Прайс моделей: рубли за 1 млн токенов.
 *
 * ВНИМАНИЕ: сверить с прайсом провайдера при подключении ключа
 * (docs/DECISIONS.md, «Что осталось открытым»: стоимость вызова и тариф).
 * Значения ниже — оценка по публичным ценам на момент реализации;
 * они влияют только на отчётность и лимит monthly_cost_limit.
 */
export interface ModelPrice {
  inputPer1M: number
  outputPer1M: number
}

export const PRICING: Record<string, ModelPrice> = {
  'deepseek-chat': { inputPer1M: 24, outputPer1M: 96 },
  'gpt-4o-mini': { inputPer1M: 14, outputPer1M: 55 },
  // mock не тратит денег: тесты и демо идут без расходов.
  mock: { inputPer1M: 0, outputPer1M: 0 },
}

export function priceFor(model: string): ModelPrice {
  return PRICING[model] ?? { inputPer1M: 0, outputPer1M: 0 }
}

/** Стоимость вызова в рублях, округлённая до 6 знаков (numeric(12,6)). */
export function costFor(model: string, tokensIn: number, tokensOut: number): number {
  const price = priceFor(model)
  const cost = (tokensIn * price.inputPer1M + tokensOut * price.outputPer1M) / 1_000_000
  return Math.round(cost * 1_000_000) / 1_000_000
}

/** Оценка токенов, если провайдер их не вернул. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(String(text).length / 4))
}
