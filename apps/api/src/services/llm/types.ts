/** Общий интерфейс LLM-провайдеров и типы вызовов. */
export type LlmTaskType =
  | 'narrative_generate'
  | 'lint'
  | 'tov_analyze'
  | 'response_generate'
  | 'embeddings'

export interface LlmCallParams {
  system: string
  user: string
  maxTokens?: number
  json?: boolean
  temperature?: number
}

export interface LlmResult {
  text: string
  tokensIn: number
  tokensOut: number
  cost: number
  model: string
  provider: string
}

export interface ProviderResult {
  text: string
  tokensIn: number
  tokensOut: number
  cost: number
  model: string
}

export interface LlmProvider {
  readonly name: string
  readonly model: string
  complete(params: LlmCallParams): Promise<ProviderResult>
}

/** Провайдер недоступен: таймаут, сеть, отсутствие ключа. Повод откатиться на правила. */
export class LlmUnavailableError extends Error {
  override readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'LlmUnavailableError'
    this.cause = cause
  }
}
