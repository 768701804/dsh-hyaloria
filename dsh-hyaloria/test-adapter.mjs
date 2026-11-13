/**
 * dsh-hyaloria 的自测：不联网、不需要 API Key。
 *
 * 起一个本地 mock（OpenAI 形状的 SSE + /models + /api/pricing），然后把
 * 适配器、消息翻译、用量映射、厂商分组、模型列表兜底全跑一遍。
 *
 * 跑法：node test-adapter.mjs
 */

import http from 'node:http'
import assert from 'node:assert/strict'

import { HyaloriaAdapter, toChatMessages, mapUsage, ROUTES, ROUTE } from './lib/adapter.js'
import { vendorKey, dateFromId, sortByVendor } from './lib/catalog.js'
import { listUpstreamModels } from './lib/index.js'

let passed = 0
const cases = []
function test(name, fn) {
  cases.push([name, fn])
}

// ── 1. 消息翻译 ────────────────────────────────────────────
test('system 提到最前，user/assistant/tool 各归各位', () => {
  const messages = toChatMessages({
    system: 'you are tibo',
    messages: [
      { role: 'user', content: [{ type: 'text', text: '你好' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '看一眼' },
          { type: 'tool-call', id: 'call_1', name: 'read', arguments: '{"path":"a.txt"}' },
        ],
      },
      { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: 'file body' }] },
    ],
  })
  assert.equal(messages.length, 4)
  assert.deepEqual(messages[0], { role: 'system', content: 'you are tibo' })
  assert.deepEqual(messages[1], { role: 'user', content: '你好' })
  assert.equal(messages[2].tool_calls[0].id, 'call_1')
  assert.equal(messages[2].tool_calls[0].function.name, 'read')
  assert.deepEqual(messages[3], { role: 'tool', tool_call_id: 'call_1', content: 'file body' })
})

test('空 system 不占位，图片降级成占位文本', () => {
  const messages = toChatMessages({
    system: '   ',
    messages: [{ role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image' }] }],
  })
  assert.equal(messages.length, 1)
  assert.equal(messages[0].content, '看图\n[图片]')
})

// ── 2. 用量映射 ────────────────────────────────────────────
test('cached token 从 input 里扣出来单列', () => {
  const usage = mapUsage({ prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 800 } })
  assert.deepEqual(usage, { inputTokens: 200, outputTokens: 20, totalTokens: 1020, cacheReadTokens: 800 })
})

test('reasoning token 单列，没有就是 undefined', () => {
  assert.equal(mapUsage({ prompt_tokens: 10, completion_tokens: 5 }).reasoningTokens, undefined)
  assert.equal(
    mapUsage({ prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 3 } }).reasoningTokens,
    3,
  )
})

// ── 3. 厂商分组 ────────────────────────────────────────────
test('模型 ID 归到厂商', () => {
  assert.equal(vendorKey('deepseek-v4.1-flash'), 'deepseek')
  assert.equal(vendorKey('GPT 6.1 Sol'), 'openai')
  assert.equal(vendorKey('gemini-nano-banana-2.1'), 'google')
  assert.equal(vendorKey('Hyaloria 5.0 Pro'), 'hyaloria')
  assert.equal(vendorKey('dreamina-seedance-2-5-260628'), 'bytedance')
  assert.equal(vendorKey('openai/gpt-4o'), 'openai')
  assert.equal(vendorKey('some-unknown-thing'), 'some')
})

test('发布日期从 ID 里抠，抠不到给 0', () => {
  assert.equal(dateFromId('dreamina-seedance-2-5-260628'), Date.UTC(2026, 5, 28))
  assert.equal(dateFromId('gpt-4o-2024-08-06'), Date.UTC(2024, 7, 6))
  assert.equal(dateFromId('deepseek-v4.1-flash'), 0)
})

test('同厂挨在一起，pinned 排最前，组内新版本靠上', () => {
  const sorted = sortByVendor(
    [
      { id: 'gpt-image-2.5' },
      { id: 'deepseek-v4.1-flash' },
      { id: 'dreamina-seedance-2-0-260128' },
      { id: 'dreamina-seedance-2-5-260628' },
      { id: 'GPT 6.1 Sol' },
    ],
    ['deepseek', 'openai'],
  )
  assert.deepEqual(sorted.map((m) => m.id), [
    'deepseek-v4.1-flash',
    'GPT 6.1 Sol',
    'gpt-image-2.5',
    'dreamina-seedance-2-5-260628',
    'dreamina-seedance-2-0-260128',
  ])
})

// ── 4. mock 上游 ───────────────────────────────────────────
function sse(events) {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
}

async function withServer(handler, fn) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function collect(adapter, options) {
  const events = []
  for await (const event of adapter.stream(options)) events.push(event)
  return events
}

test('流：文本 + 工具调用 + usage + finish，块的顺序对', async () => {
  await withServer(async (req, res) => {
    assert.equal(req.headers['user-agent'].startsWith('deepseek-harness'), true)
    assert.equal(req.headers.authorization, 'Bearer sk-test')
    const body = JSON.parse(await new Promise((resolve) => {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
      })
      req.on('end', () => resolve(raw))
    }))
    assert.equal(body.stream, true)
    assert.equal(body.stream_options.include_usage, true)
    assert.equal(body.tools[0].function.name, 'read')
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(
      sse([
        { choices: [{ delta: { reasoning_content: '想一想…' }, finish_reason: null }] },
        { choices: [{ delta: { content: '你好' }, finish_reason: null }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'read', arguments: '{"pa' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.txt"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 120, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 20 } } },
      ]),
    )
  }, async (base) => {
    const adapter = new HyaloriaAdapter({
      getProvider: () => ({ baseURL: base, apiKey: 'sk-test', models: [{ id: 'test-model' }] }),
    })
    const events = await collect(adapter, {
      provider: ROUTE,
      model: 'test-model',
      system: 'sys',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      tools: [{ name: 'read', description: 'read a file', parameters: { type: 'object', properties: {} } }],
    })
    const kinds = events.map((e) => e.type)
    assert.deepEqual(kinds, [
      'block-start', 'reasoning-delta',
      'block-start', 'text-delta',
      'block-start', 'tool-call-delta', 'tool-call-delta',
      'block-end', 'block-end', 'block-end',
      'usage', 'finish',
    ])
    const ends = events.filter((e) => e.type === 'block-end')
    assert.equal(ends[0].block.text, '想一想…')
    assert.equal(ends[1].block.text, '你好')
    assert.deepEqual(ends[2].block, { type: 'tool-call', id: 'call_9', name: 'read', arguments: '{"path":"a.txt"}' })
    assert.deepEqual(events.at(-1).reason, { kind: 'tool-calls' })
    const usage = events.find((e) => e.type === 'usage')
    assert.deepEqual(usage.usage, { inputTokens: 100, outputTokens: 9, totalTokens: 129, cacheReadTokens: 20 })
  })
})

test('流：没 key / 没 baseURL 立刻 finish 报错且不发请求', async () => {
  const adapter = new HyaloriaAdapter({ getProvider: () => ({ baseURL: '', apiKey: '' }) })
  const events = await collect(adapter, { provider: ROUTE, model: 'm', messages: [] })
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'finish')
  assert.equal(events[0].reason.failure.code, 'CONFIG')
})

test('流：HTTP 402 带余额提示，401 归到凭据', async () => {
  await withServer((req, res) => {
    res.writeHead(402, { 'content-type': 'application/json' })
    res.end('{"error":{"message":"quota"}}')
  }, async (base) => {
    const adapter = new HyaloriaAdapter({ getProvider: () => ({ baseURL: base, apiKey: 'k', models: [] }) })
    const events = await collect(adapter, { provider: ROUTE, model: 'm', messages: [] })
    assert.equal(events.at(-1).reason.failure.code, 'INSUFFICIENT_QUOTA')
    assert.match(events.at(-1).reason.failure.message, /余额|额度/)
  })
  await withServer((req, res) => {
    res.writeHead(401)
    res.end('{"error":{"message":"Invalid token"}}')
  }, async (base) => {
    const adapter = new HyaloriaAdapter({ getProvider: () => ({ baseURL: base, apiKey: 'k', models: [] }) })
    const events = await collect(adapter, { provider: ROUTE, model: 'm', messages: [] })
    assert.equal(events.at(-1).reason.failure.code, 'INVALID_CREDENTIAL')
  })
})

test('流：截断的 tool arguments 不当可执行调用', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read', arguments: '{"path":"a' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'length' }] },
    ]))
  }, async (base) => {
    const adapter = new HyaloriaAdapter({ getProvider: () => ({ baseURL: base, apiKey: 'k', models: [] }) })
    const events = await collect(adapter, { provider: ROUTE, model: 'm', messages: [], maxTokens: 4 })
    assert.deepEqual(events.at(-1).reason, { kind: 'max-tokens' })
  })
})

test('流：provider 报 error 事件时直接 finish', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(sse([{ error: { message: 'model not found' } }]))
  }, async (base) => {
    const adapter = new HyaloriaAdapter({ getProvider: () => ({ baseURL: base, apiKey: 'k', models: [] }) })
    const events = await collect(adapter, { provider: ROUTE, model: 'm', messages: [] })
    assert.equal(events.at(-1).reason.kind, 'error')
    assert.match(events.at(-1).reason.failure.message, /model not found/)
  })
})

// ── 5. 模型列表：/models 优先，/api/pricing 兜底 ────────────
test('有 key：拉 /v1/models，chat 标记来自 pricing', async () => {
  await withServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        data: [
          { id: 'dreamina-seedance-2-5-260628' },
          { id: 'deepseek-v4.1-flash' },
          { id: 'retired-model', status: 'Shutdown' },
        ],
      }))
      return
    }
    if (req.url === '/api/pricing') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        data: [
          { model_name: 'deepseek-v4.1-flash', tags: '对话', supported_endpoint_types: ['openai'] },
          { model_name: 'dreamina-seedance-2-5-260628', tags: '视频生成', supported_endpoint_types: ['openai-video'] },
        ],
      }))
      return
    }
    res.writeHead(404)
    res.end()
  }, async (base) => {
    const models = await listUpstreamModels({ baseURL: `${base}/v1`, apiKey: 'k' })
    assert.deepEqual(models.map((m) => m.id), ['deepseek-v4.1-flash', 'dreamina-seedance-2-5-260628'])
    assert.equal(models[0].chat, true)
    assert.equal(models[0].tag, '对话')
    assert.equal(models[1].chat, false)
    assert.equal(models[1].vendor, 'bytedance')
  })
})

test('没 key：/models 401 时回落到 pricing 的公开清单', async () => {
  await withServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end('{"error":{"message":"Invalid token"}}')
      return
    }
    if (req.url === '/api/pricing') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        data: [{ model_name: 'Hyaloria 5.0 Pro', tags: '对话', supported_endpoint_types: ['openai'] }],
      }))
      return
    }
    res.writeHead(404)
    res.end()
  }, async (base) => {
    const models = await listUpstreamModels({ baseURL: `${base}/v1`, apiKey: '' })
    assert.deepEqual(models.map((m) => m.id), ['Hyaloria 5.0 Pro'])
    assert.equal(models[0].vendor, 'hyaloria')
  })
})

test('resolveModel / listModels 走配置表，缺字段用默认值', async () => {
  const adapter = new HyaloriaAdapter({
    getProvider: () => ({ baseURL: 'http://x/v1', apiKey: 'k', model: 'b', models: [{ id: 'a' }, { id: 'b', name: 'Bee' }, { id: 'a' }] }),
  })
  assert.deepEqual(ROUTES, [ROUTE])
  assert.deepEqual(adapter.providerInfo(ROUTE), { id: 'hyaloria', name: 'Hyaloria' })
  // 新契约：config.models 就是面板里勾选的那一组，整份对外列（重复 id 只留一条）；
  // config.model 那一条排第一，宿主的会话模型菜单拿第一条当默认选中项。
  const list = await adapter.listModels(ROUTE)
  assert.deepEqual(list.map((m) => m.id), ['b', 'a'])
  assert.equal(list[0].name, 'Bee')
  const fallback = new HyaloriaAdapter({
    getProvider: () => ({ baseURL: 'http://x/v1', apiKey: 'k', models: [{ id: 'a' }, { id: 'b' }] }),
  })
  assert.deepEqual((await fallback.listModels(ROUTE)).map((m) => m.id), ['a', 'b'])
  const resolved = await adapter.resolveModel(ROUTE, 'a')
  assert.equal(resolved.context.contextWindow, 262144)
  assert.equal(resolved.defaultMaxTokens, 8192)
  assert.equal(resolved.inputModalities[0], 'text')
})

// ── 跑 ────────────────────────────────────────────────────
for (const [name, fn] of cases) {
  try {
    await fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    console.error(`  FAIL ${name}`)
    console.error(`       ${error && error.message ? error.message : error}`)
    process.exitCode = 1
  }
}
console.log(`\n${passed}/${cases.length} passed`)
