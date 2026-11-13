/**
 * OpenAI 兼容适配器：Hyaloria（New-API 形状的聚合网关）。
 *
 * 契约来自 DSH 的 LLM seam（`registerAdapter(providers, adapter)`）：
 *   providerInfo / providerRetryPolicy / imageRequestPricing / imageRequestTarget
 *   / listModels / resolveModel / prepareCall / stream
 *
 * 输出走分块协议：每个 block 先 `block-start`、再喂 delta、最后 `block-end`
 * 带上拼好的整块；收尾先 `usage` 再 `finish`。
 *
 * 这里只做两件事：把 DSH 的 message/工具翻成 Chat Completions 的形状，把
 * 回来的 SSE 翻成 DSH 的分块。不接管路由、不缓存、不重试（重试交给宿主）。
 */

import { attributionHeaders } from './attribution.js'

/** Hyaloria 只有一条路由：https://api.hyaloria.cn/v1，OpenAI 形状。 */
export const ROUTE = 'hyaloria'
export const ROUTES = [ROUTE]
export const ROUTE_LABELS = { [ROUTE]: 'Hyaloria' }

/** 上游大部分是 256K 上下文的大模型；个别小模型会在上游报错，交给上游说。 */
const DEFAULT_CONTEXT = 262144
const DEFAULT_MAX_TOKENS = 8192

function normalizeBase(baseURL) {
  const raw = typeof baseURL === 'string' ? baseURL.trim() : ''
  if (raw === '') return ''
  return raw.replace(/\/+$/, '')
}

function textOf(blocks) {
  if (!Array.isArray(blocks)) return ''
  let out = ''
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') out += block.text
    else if (block.type === 'image') out += (out === '' ? '' : '\n') + '[图片]'
    else if (block.type === 'file') out += (out === '' ? '' : '\n') + '[文件]'
  }
  return out
}

/** DSH 的 message 列表 → Chat Completions 的 messages。 */
export function toChatMessages(options) {
  const messages = []
  const system = typeof options.system === 'string' ? options.system.trim() : ''
  if (system !== '') messages.push({ role: 'system', content: system })
  const history = Array.isArray(options.messages) ? options.messages : []
  for (const message of history) {
    if (message === null || typeof message !== 'object') continue
    const role = message.role
    if (role === 'user') {
      const content = textOf(message.content)
      if (content !== '') messages.push({ role: 'user', content })
    } else if (role === 'system' || role === 'developer') {
      const content = textOf(message.content)
      if (content !== '') messages.push({ role: 'system', content })
    } else if (role === 'assistant') {
      const content = textOf(message.content)
      const calls = Array.isArray(message.content)
        ? message.content.filter((b) => b !== null && typeof b === 'object' && b.type === 'tool-call')
        : []
      const entry = { role: 'assistant', content: content === '' ? null : content }
      if (calls.length > 0) {
        entry.tool_calls = calls.map((call) => ({
          id: String(call.id ?? ''),
          type: 'function',
          function: { name: String(call.name ?? ''), arguments: String(call.arguments ?? '{}') },
        }))
      }
      if (entry.content !== null || entry.tool_calls !== undefined) messages.push(entry)
    } else if (role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: String(message.toolCallId ?? ''),
        content: textOf(message.content),
      })
    }
  }
  return messages
}

function toChatTools(tools) {
  if (!Array.isArray(tools)) return undefined
  const mapped = tools
    .filter((tool) => tool !== null && typeof tool === 'object' && typeof tool.name === 'string' && tool.name !== '')
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        parameters: tool.parameters !== null && typeof tool.parameters === 'object' ? tool.parameters : { type: 'object', properties: {} },
      },
    }))
  return mapped.length > 0 ? mapped : undefined
}

export function mapUsage(usage) {
  if (usage === null || typeof usage !== 'object') return undefined
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens)
  const completion = Number(usage.completion_tokens ?? usage.output_tokens)
  if (!Number.isFinite(prompt) && !Number.isFinite(completion)) return undefined
  const cachedRaw = Number(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens)
  const reasoningRaw = Number(usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens)
  const cached = Number.isFinite(cachedRaw) ? cachedRaw : 0
  const reasoning = Number.isFinite(reasoningRaw) ? reasoningRaw : 0
  const promptTokens = Number.isFinite(prompt) ? prompt : 0
  const completionTokens = Number.isFinite(completion) ? completion : 0
  const out = {
    inputTokens: Math.max(0, promptTokens - cached),
    outputTokens: completionTokens,
    totalTokens: promptTokens + completionTokens,
  }
  if (cached > 0) out.cacheReadTokens = cached
  if (reasoning > 0) out.reasoningTokens = reasoning
  return out
}

export class HyaloriaAdapter {
  /**
   * @param {{ getProvider: (route: string) => {baseURL: string, apiKey: string, models: Array<{id: string, name?: string, contextWindow?: number, maxTokens?: number}>} | undefined }} deps
   */
  constructor(deps) {
    this.deps = deps
  }

  providerInfo(provider) {
    return { id: provider, name: ROUTE_LABELS[provider] ?? provider }
  }

  // 省略：交给宿主的默认重试策略，免得和内核版本里的调度字段对不上。
  providerRetryPolicy() {
    return undefined
  }

  imageRequestPricing() {
    return undefined
  }

  imageRequestTarget(_provider, _model, image) {
    return { width: image.width, height: image.height, maxBytes: 4 * 1024 * 1024 }
  }

  // 对外暴露 config.models 里的整份名单 —— 那就是面板「获取可用模型」里勾选出来的一组。
  // 勾一个就只有一条，勾五个就有五条；勾选集由 /save 落盘，config.model 恒等于第一条。
  async listModels(provider) {
    const config = this.deps.getProvider(provider)
    if (config === undefined || config === null) return []
    const rows = Array.isArray(config.models) ? config.models : []
    const wanted = typeof config.model === 'string' ? config.model.trim() : ''
    // 当前模型排第一：宿主的会话模型菜单拿第一条当默认选中项。
    const seen = new Set()
    const ordered = rows
      .filter((row) => {
        if (row === null || typeof row !== 'object' || typeof row.id !== 'string') return false
        const id = row.id.trim()
        if (id === '' || seen.has(id)) return false
        seen.add(id)
        return true
      })
      .sort((left, right) => (right.id.trim() === wanted ? 1 : 0) - (left.id.trim() === wanted ? 1 : 0))
    return ordered.map((row) => {
      const id = row.id.trim()
      const name = typeof row.name === 'string' && row.name !== '' ? row.name : id
      return { provider, id, name, inputModalities: ['text'] }
    })
  }

  async resolveModel(provider, model, signal) {
    signal?.throwIfAborted?.()
    const config = this.deps.getProvider(provider)
    const rows = Array.isArray(config?.models) ? config.models : []
    const row = rows.find((candidate) => candidate?.id === model)
    const contextWindow = Number.isFinite(row?.contextWindow) && row.contextWindow > 0 ? row.contextWindow : DEFAULT_CONTEXT
    const maxTokens = Number.isFinite(row?.maxTokens) && row.maxTokens > 0 ? row.maxTokens : DEFAULT_MAX_TOKENS
    return {
      provider,
      id: model,
      name: typeof row?.name === 'string' && row.name !== '' ? row.name : model,
      inputModalities: ['text'],
      context: { contextWindow },
      defaultMaxTokens: Math.min(maxTokens, contextWindow),
    }
  }

  async prepareCall(provider, model, signal) {
    return { model: await this.resolveModel(provider, model, signal), stream: (options) => this.stream(options) }
  }

  stream(options) {
    return this.run(options)
  }

  async * run(options) {
    const provider = String(options.provider ?? '')
    const model = String(options.model ?? '')
    const config = this.deps.getProvider(provider)
    const baseURL = normalizeBase(config?.baseURL)
    const apiKey = typeof config?.apiKey === 'string' ? config.apiKey : ''

    const emitFailure = (message, code, status) => ({ type: 'finish', reason: { kind: 'error', failure: { message, code, ...(status === undefined ? {} : { status }) } } })

    if (baseURL === '') {
      yield emitFailure(`路由 ${provider} 还没填 Base URL（设置 → 模型接入）`, 'CONFIG')
      return
    }
    if (apiKey === '') {
      yield emitFailure(`路由 ${provider} 还没填 API Key（设置 → 模型接入）`, 'INVALID_CREDENTIAL')
      return
    }
    if (options.signal?.aborted === true) {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'request aborted', code: 'ABORTED' } } }
      return
    }

    const body = {
      model,
      messages: toChatMessages(options),
      stream: true,
      stream_options: { include_usage: true },
    }
    const tools = toChatTools(options.tools)
    if (tools !== undefined) body.tools = tools
    if (Number.isFinite(options.temperature)) body.temperature = options.temperature
    if (Number.isFinite(options.maxTokens) && options.maxTokens > 0) body.max_tokens = Math.floor(options.maxTokens)
    if (Array.isArray(options.stop) && options.stop.length > 0) body.stop = options.stop.slice(0, 4)

    const headers = attributionHeaders({
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      accept: 'text/event-stream',
    })

    let response
    try {
      response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      })
    } catch (error) {
      const aborted = options.signal?.aborted === true
      yield { type: 'finish', reason: aborted
        ? { kind: 'aborted', failure: { message: 'request aborted', code: 'ABORTED' } }
        : { kind: 'error', failure: { message: `连不上 ${baseURL}：${error?.message ?? error}`, code: 'TRANSPORT' } } }
      return
    }

    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 600)
      } catch {
        detail = ''
      }
      const label = ROUTE_LABELS[provider] ?? provider
      const code = response.status === 401 || response.status === 403 ? 'INVALID_CREDENTIAL'
        : response.status === 429 ? 'RATE_LIMIT'
        : response.status === 402 ? 'INSUFFICIENT_QUOTA'
        : 'SERVER'
      const hint = response.status === 402 ? '（上游余额或额度不足，去 hyaloria 控制台充值/换令牌）' : ''
      yield emitFailure(`${label} 返回 HTTP ${response.status}${hint}${detail === '' ? '' : `：${detail}`}`, code, response.status)
      return
    }

    const blocks = new Map()
    let nextIndex = 0
    let finishReason = ''
    let usage
    let sawToolCall = false

    const open = (key, kind) => {
      const existing = blocks.get(key)
      if (existing !== undefined) return existing
      const block = { index: nextIndex++, kind, text: '', args: '', id: '', name: '', started: false }
      blocks.set(key, block)
      return block
    }
    const startOf = (block) => {
      if (block.started) return undefined
      block.started = true
      return { type: 'block-start', index: block.index, blockType: block.kind }
    }

    const decoder = new TextDecoder()
    let buffer = ''
    try {
      if (response.body === null || response.body === undefined) throw new Error('响应没有 body')
      for await (const part of response.body) {
        buffer += decoder.decode(part, { stream: true })
        let newline
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '' || payload === '[DONE]') continue
          let event
          try {
            event = JSON.parse(payload)
          } catch {
            continue
          }
          if (event?.error !== undefined && event?.choices === undefined) {
            yield emitFailure(String(event.error?.message ?? event.error ?? '上游报错'), 'SERVER')
            return
          }
          if (event?.usage !== undefined) usage = event.usage
          const choice = Array.isArray(event?.choices) ? event.choices[0] : undefined
          if (choice === undefined) continue
          if (typeof choice.finish_reason === 'string' && choice.finish_reason !== '') finishReason = choice.finish_reason
          const delta = choice.delta ?? {}
          const reasoning = delta.reasoning_content ?? delta.reasoning
          if (typeof reasoning === 'string' && reasoning !== '') {
            const block = open('reasoning', 'reasoning')
            const start = startOf(block)
            if (start !== undefined) yield start
            block.text += reasoning
            yield { type: 'reasoning-delta', index: block.index, text: reasoning }
          }
          if (typeof delta.content === 'string' && delta.content !== '') {
            const block = open('text', 'text')
            const start = startOf(block)
            if (start !== undefined) yield start
            block.text += delta.content
            yield { type: 'text-delta', index: block.index, text: delta.content }
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const call of delta.tool_calls) {
              const slot = Number.isInteger(call?.index) ? call.index : 0
              const block = open(`tool:${slot}`, 'tool-call')
              const start = startOf(block)
              if (start !== undefined) yield start
              const previous = { id: block.id, name: block.name }
              if (typeof call?.id === 'string' && call.id !== '') block.id = call.id
              const name = call?.function?.name
              if (typeof name === 'string' && name !== '') block.name = name
              sawToolCall = true
              const args = call?.function?.arguments
              if (typeof args === 'string' && args !== '') {
                block.args += args
                const nameField = block.name !== '' ? { name: block.name } : {}
                yield { type: 'tool-call-delta', index: block.index, id: block.id ?? '', ...nameField, argumentsDelta: args }
              } else if (block.name !== previous.name || block.id !== previous.id) {
                const nameField = block.name !== '' ? { name: block.name } : {}
                yield { type: 'tool-call-delta', index: block.index, id: block.id ?? '', ...nameField, argumentsDelta: '' }
              }
            }
          }
        }
      }
    } catch (error) {
      const aborted = options.signal?.aborted === true
      for (const block of blocks.values()) {
        if (block.kind === 'text' && block.text !== '') yield { type: 'block-end', index: block.index, block: { type: 'text', text: block.text } }
        else if (block.kind === 'reasoning' && block.text !== '') yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } }
      }
      yield { type: 'finish', reason: aborted
        ? { kind: 'aborted', failure: { message: 'request aborted', code: 'ABORTED' } }
        : { kind: 'error', failure: { message: `读取 ${provider} 的流时断了：${error?.message ?? error}`, code: 'TRANSPORT' } } }
      return
    }

    for (const block of blocks.values()) {
      if (block.kind === 'text' && block.text !== '') {
        yield { type: 'block-end', index: block.index, block: { type: 'text', text: block.text } }
      } else if (block.kind === 'reasoning' && block.text !== '') {
        yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } }
      } else if (block.kind === 'tool-call') {
        let args = block.args
        if (args === '') args = '{}'
        else {
          try {
            JSON.parse(args)
          } catch {
            // 截断的 JSON 不当作可执行调用：降级成 max-tokens，让装配器丢掉它
            finishReason = 'length'
          }
        }
        yield {
          type: 'block-end',
          index: block.index,
          block: { type: 'tool-call', id: block.id ?? '', name: block.name ?? '', arguments: args },
        }
      }
    }

    const mappedUsage = mapUsage(usage)
    if (mappedUsage !== undefined) yield { type: 'usage', usage: mappedUsage }

    const reason = sawToolCall && finishReason !== 'length'
      ? { kind: 'tool-calls' }
      : finishReason === 'length'
        ? { kind: 'max-tokens' }
        : { kind: 'stop' }
    yield { type: 'finish', reason }
  }
}
