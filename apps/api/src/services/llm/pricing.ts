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
  // OpenRouter, бесплатный тариф: цена нулевая по условиям провайдера,
  // а не потому, что модели не нашлось в прайсе.
  'dots-studio/dots-3-note-preview:free': { inputPer1M: 0, outputPer1M: 0 },
  // mock не тратит денег: тесты и демо идут без расходов.
  mock: { inputPer1M: 0, outputPer1M: 0 },
}

const warned = new Set<string>()

/**
 * Цена модели. Если модели нет в прайсе, себестоимость считается нулевой —
 * но это чаще всего ошибка настройки, поэтому один раз пишем предупреждение
 * в лог: иначе лимит monthly_cost_limit молча не остановит расходы.
 */
export function priceFor(model: string): ModelPrice {
  const known = PRICING[model]
  if (known) return known
  // Суффикс :free у OpenRouter означает бесплатную модель — это не «неизвестная».
  if (/:free$/i.test(model)) return { inputPer1M: 0, outputPer1M: 0 }
  if (!warned.has(model)) {
    warned.add(model)
    console.warn(
      `[pricing] нет цены для модели «${model}»: стоимость вызовов считается нулевой, ` +
        'лимит расходов не сработает. Добавьте модель в PRICING (services/llm/pricing.ts).',
    )
  }
  return { inputPer1M: 0, outputPer1M: 0 }
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
