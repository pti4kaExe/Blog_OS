/**
 * Провайдер, совместимый с OpenAI chat/completions: DeepSeek и OpenAI.
 * Один адаптер закрывает оба (docs/DECISIONS.md, решение № 6).
 * Таймаут — LLM_TIMEOUT_MS, отмена — AbortController.
 *
 * Поля объявлены явно, а не через parameter properties: Node запускает .ts
 * в strip-only режиме и не поддерживает такой синтаксис (erasableSyntaxOnly).
 */
import { env } from '../../env.ts'
import { costFor, estimateTokens } from './pricing.ts'
import { LlmUnavailableError, type LlmCallParams, type LlmProvider, type ProviderResult } from './types.ts'

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: 'deepseek' | 'openai'
  readonly model: string
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(name: 'deepseek' | 'openai', model: string, baseUrl: string, apiKey: string) {
    this.name = name
    this.model = model
    this.baseUrl = baseUrl
    this.apiKey = apiKey
  }

  async complete(params: LlmCallParams): Promise<ProviderResult> {
    if (!this.apiKey) throw new LlmUnavailableError(`Ключ ${this.name} не задан`)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), env.LLM_TIMEOUT_MS)
    try {
      const body: Record<string, unknown> = {
        model: this.model,
        messages: [
          { role: 'system', content: params.system },
          { role: 'user', content: params.user },
        ],
        // Пол: рассуждающие модели (например dots-3-note-preview) тратят лимит
        // токенов на reasoning, и при маленьком max_tokens финальный ответ
        // обрезается до пустой строки. Пол задаётся LLM_MAX_TOKENS_FLOOR.
        max_tokens: Math.max(params.maxTokens ?? 1200, env.LLM_MAX_TOKENS_FLOOR),
        temperature: params.temperature ?? 0.2,
      }
      if (params.json) body.response_format = { type: 'json_object' }

      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new LlmUnavailableError(
          `${this.name}: HTTP ${response.status} ${detail.slice(0, 200)}`,
        )
      }

      const data = (await response.json()) as {
        choices?: Array<{
          finish_reason?: string
          message?: { content?: unknown; refusal?: unknown }
        }>
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          completion_tokens_details?: { reasoning_tokens?: number }
        }
      }
      const choice = data.choices?.[0]
      if (choice?.message?.refusal) {
        throw new LlmUnavailableError(`${this.name}: модель отказалась отвечать (refusal)`, undefined, {
          retryable: false,
        })
      }
      const text = choice?.message?.content
      if (typeof text !== 'string' || text.length === 0) {
        // Пустой ответ у рассуждающих моделей — обычно исчерпанный лимит токенов:
        // reasoning съёл весь бюджет, а на ответ ничего не осталось.
        const reasoning = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0
        const overLimit = choice?.finish_reason === 'length'
        throw new LlmUnavailableError(
          `${this.name}: пустой ответ модели (finish_reason=${choice?.finish_reason ?? '—'}, ` +
            `reasoning_tokens=${reasoning}). Поднимите LLM_MAX_TOKENS_FLOOR или выберите ` +
            'модель без рассуждений',
          undefined,
          { retryable: !overLimit },
        )
      }

      const tokensIn = Number(
        data.usage?.prompt_tokens ?? estimateTokens(params.system + params.user),
      )
      const tokensOut = Number(data.usage?.completion_tokens ?? estimateTokens(text))
      return {
        text,
        tokensIn: Number.isFinite(tokensIn) ? tokensIn : 0,
        tokensOut: Number.isFinite(tokensOut) ? tokensOut : 0,
        cost: costFor(this.model, tokensIn, tokensOut),
        model: this.model,
      }
    } catch (error) {
      if (error instanceof LlmUnavailableError) throw error
      if ((error as { name?: string }).name === 'AbortError') {
        throw new LlmUnavailableError(`${this.name}: таймаут ${env.LLM_TIMEOUT_MS} мс`, error)
      }
      throw new LlmUnavailableError(
        `${this.name}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      )
    } finally {
      clearTimeout(timer)
    }
  }
}
