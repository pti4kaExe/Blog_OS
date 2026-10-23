/**
 * Оркестратор LLM: выбор провайдера, одна повторная попытка при ошибке/таймауте,
 * журнал каждого вызова в generation_runs (успех и отказ) и расчёт стоимости.
 *
 * Откат на правила выполняет вызывающий сервис: если ok=false, ответ API
 * собирается правиловым движком с verified_without_ai: true.
 */
import { env } from '../../env.ts'
import { liveString } from '../../lib/liveEnv.ts'
import { insert as insertRun } from '../../repositories/generationRuns.ts'
import { MockProvider } from './mock.ts'
import { OpenAiCompatibleProvider } from './openaiCompatible.ts'
import { LlmUnavailableError, type LlmCallParams, type LlmProvider, type LlmResult, type LlmTaskType } from './types.ts'

export interface LlmCallOptions extends LlmCallParams {
  authorId: number | null
  taskType: LlmTaskType
}

export type LlmOutcome =
  | { ok: true; result: LlmResult; generationRunId: number }
  | { ok: false; errorMessage: string; generationRunId: number }

export function createProvider(): LlmProvider {
  const provider = liveString('LLM_PROVIDER', env.LLM_PROVIDER)
  if (provider === 'deepseek') {
    return new OpenAiCompatibleProvider(
      'deepseek',
      liveString('DEEPSEEK_MODEL', env.DEEPSEEK_MODEL),
      liveString('DEEPSEEK_BASE_URL', env.DEEPSEEK_BASE_URL),
      liveString('DEEPSEEK_API_KEY', env.DEEPSEEK_API_KEY),
    )
  }
  if (provider === 'openai') {
    return new OpenAiCompatibleProvider(
      'openai',
      liveString('OPENAI_MODEL', env.OPENAI_MODEL),
      liveString('OPENAI_BASE_URL', env.OPENAI_BASE_URL),
      liveString('OPENAI_API_KEY', env.OPENAI_API_KEY),
    )
  }
  return new MockProvider()
}

/** Настроен ли провайдер: mock — всегда, реальные — при непустом ключе. */
export function llmConfigured(): boolean {
  const provider = liveString('LLM_PROVIDER', env.LLM_PROVIDER)
  if (provider === 'deepseek') return liveString('DEEPSEEK_API_KEY', env.DEEPSEEK_API_KEY).length > 0
  if (provider === 'openai') return liveString('OPENAI_API_KEY', env.OPENAI_API_KEY).length > 0
  return true
}

function errorText(error: unknown): string {
  if (error instanceof LlmUnavailableError) {
    return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message
  }
  return error instanceof Error ? error.message : String(error)
}

/** Ровно две попытки: один повторный вызов, затем откат на правила. */
export async function callLlm(options: LlmCallOptions): Promise<LlmOutcome> {
  const provider = createProvider()
  const startedAt = Date.now()
  let lastError = 'LLM недоступна'

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await provider.complete({
        system: options.system,
        user: options.user,
        maxTokens: options.maxTokens,
        json: options.json,
        temperature: options.temperature,
      })
      const generationRunId = await insertRun({
        authorId: options.authorId,
        taskType: options.taskType,
        model: result.model,
        tokensInput: result.tokensIn,
        tokensOutput: result.tokensOut,
        tokens: result.tokensIn + result.tokensOut,
        cost: result.cost,
        status: 'success',
        durationMs: Date.now() - startedAt,
      })
      return {
        ok: true,
        result: { ...result, provider: provider.name },
        generationRunId,
      }
    } catch (error) {
      lastError = errorText(error)
    }
  }

  const generationRunId = await insertRun({
    authorId: options.authorId,
    taskType: options.taskType,
    model: provider.model,
    tokensInput: 0,
    tokensOutput: 0,
    tokens: 0,
    cost: 0,
    status: 'failed',
    errorMessage: lastError,
    durationMs: Date.now() - startedAt,
  })
  return { ok: false, errorMessage: lastError, generationRunId }
}

/** Разбор JSON-ответа модели: markdown-обёртки допускаются, мусор — null. */
export function parseJson<T>(text: string): T | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return null
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T
    } catch {
      return null
    }
  }
}
