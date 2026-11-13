/**
 * dsh-hyaloria —— 宿主半。
 *
 * 做三件事：
 *   1. 把 Hyaloria（https://api.hyaloria.cn/v1）注册成一条模型路由
 *      （`ctx.llm.registerAdapter`）；
 *   2. 管配置（Base URL / API Key / Model），落盘在 <DSH_HOME>/hyaloria/config.json；
 *   3. 给设置页开同源 HTTP 接口：读状态、保存、测试连接、拉模型列表。
 *
 * 密钥只在这里存与用，任何回给浏览器的响应都只给掩码。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { HyaloriaAdapter } from './adapter.js'
import { attributionHeaders } from './attribution.js'
import { sortByVendor, vendorKey, vendorLabel } from './catalog.js'

export const name = 'hyaloria'
// 只硬依赖 llm：headless 之类没有 web 服务的装配里，模型路由照样要能注册。
export const inject = ['llm']

const API_PREFIX = '/api/hyaloria'

/** 首选路由名。 */
export const ROUTE = 'hyaloria'
/** 撞车时的备选路由名（同一个上游，另一条路名）。 */
export const ALT_ROUTE = 'HYALORIA'
export const CANDIDATE_ROUTES = [ROUTE, ALT_ROUTE]

/** 旧版本用过的路由名 → 现在的新名字。读配置时做一次搬家。 */
const LEGACY_ROUTES = { 'hyaloria-oai': ALT_ROUTE }

/** 官方网关（内置，用户不用填）。 */
const BASE = {
  origin: 'https://api.hyaloria.cn',
  baseURL: 'https://api.hyaloria.cn/v1',
  model: 'deepseek-v4.1-flash',
  hint: '在 api.hyaloria.cn 的「令牌」页建一个令牌，复制 sk- 开头的 key',
}

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  return path.join(os.homedir(), '.dsh')
}

function stateDir() {
  return path.join(dshHome(), 'hyaloria')
}

function statePath() {
  return path.join(stateDir(), 'config.json')
}

/**
 * 真正注册出去的路由名。
 *
 * `registerAdapter` 对已占用的 provider 是 all-or-nothing 抛 DUPLICATE_ADAPTER，
 * 而 profile 的 cordis.patch.yml 里完全可能已经有别人配过一条叫 `hyaloria` 的
 * 路由（llm-pi-ai 就是这么用的）。硬抢会把对方的适配器顶掉，所以撞上就退到
 * `hyaloria-oai`，两条并存。
 */
let activeRoute = ROUTE

/** 每个候选路由各留一份配置，切换时不丢已填的 key。 */
function blankProvider() {
  return { baseURL: BASE.baseURL, apiKey: '', models: [{ id: BASE.model }] }
}

const config = { providers: {} }
for (const route of CANDIDATE_ROUTES) config.providers[route] = blankProvider()

function presetOf(route) {
  if (!CANDIDATE_ROUTES.includes(route)) return undefined
  return {
    route,
    label: route === ROUTE ? 'Hyaloria' : 'Hyaloria (OpenAI 兼容)',
    baseURL: BASE.baseURL,
    model: BASE.model,
    hint: BASE.hint,
  }
}

function ensureDir() {
  try {
    mkdirSync(stateDir(), { recursive: true })
  } catch {
    // 目录建不出来时仍然可以先跑，保存时才报错
  }
}

function loadConfig() {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8'))
    const providers = parsed?.providers
    if (providers === null || typeof providers !== 'object') return
    // 旧版本把备选路由叫 hyaloria-oai，配置里可能还留着那个键。
    for (const [legacy, next] of Object.entries(LEGACY_ROUTES)) {
      const old = providers[legacy]
      if (providers[next] === undefined && old !== null && typeof old === 'object') providers[next] = old
    }
    const stored =
      typeof parsed?.activeRoute === 'string' ? (LEGACY_ROUTES[parsed.activeRoute] ?? parsed.activeRoute) : ''
    if (CANDIDATE_ROUTES.includes(stored)) activeRoute = stored
    for (const route of CANDIDATE_ROUTES) {
      const row = providers[route]
      if (row === null || typeof row !== 'object') continue
      const target = config.providers[route]
      if (typeof row.baseURL === 'string' && row.baseURL.trim() !== '') target.baseURL = row.baseURL
      if (typeof row.apiKey === 'string') target.apiKey = row.apiKey
      if (Array.isArray(row.models)) {
        const models = row.models
          .filter((m) => m !== null && typeof m === 'object' && typeof m.id === 'string' && m.id.trim() !== '')
          .map((m) => ({
            id: String(m.id).trim(),
            ...(typeof m.name === 'string' && m.name !== '' ? { name: m.name } : {}),
            ...(Number.isFinite(m.contextWindow) ? { contextWindow: m.contextWindow } : {}),
            ...(Number.isFinite(m.maxTokens) ? { maxTokens: m.maxTokens } : {}),
          }))
        if (models.length > 0) target.models = models
      }
    }
  } catch {
    // 读不到 / 坏了就按预设跑，别让插件整个挂掉
  }
}

function saveConfig() {
  ensureDir()
  const payload = { activeRoute, providers: config.providers }
  writeFileSync(statePath(), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function mask(key) {
  if (typeof key !== 'string' || key === '') return ''
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}${'*'.repeat(Math.min(24, key.length - 8))}${key.slice(-4)}`
}

function providerFor(route) {
  if (!CANDIDATE_ROUTES.includes(route)) return undefined
  const row = config.providers[route]
  if (row === undefined || row === null) return undefined
  return {
    baseURL: row.baseURL,
    apiKey: row.apiKey,
    models: Array.isArray(row.models) ? row.models : [],
  }
}

function stateOf(route) {
  const row = config.providers[route]
  const models = Array.isArray(row?.models) ? row.models : []
  return {
    route,
    label: 'Hyaloria',
    active: route === activeRoute,
    // 协议由插件自己决定（只实现 OpenAI 兼容），面板据此显示，不用手选。
    api: 'openai',
    apiLabel: 'OpenAI 兼容',
    // 端点是内置官网还是用户改过 —— 面板标一个「官方」。
    official: isOfficial(row?.baseURL),
    baseURL: row?.baseURL ?? '',
    model: models[0]?.id ?? '',
    models: models.map((m) => {
      const key = vendorKey(m.id)
      return { id: m.id, ...(m.name ? { name: m.name } : {}), vendor: key, vendorLabel: vendorLabel(key) }
    }),
    hasKey: typeof row?.apiKey === 'string' && row.apiKey !== '',
    keyMasked: mask(row?.apiKey ?? ''),
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('请求体不是 JSON')
  }
}

function normalizeBase(baseURL) {
  const raw = typeof baseURL === 'string' ? baseURL.trim() : ''
  return raw === '' ? '' : raw.replace(/\/+$/, '')
}

/** New-API 的额度单位：500000 = 1 美元。 */
const QUOTA_PER_USD = 500000

function originOf(baseURL) {
  return normalizeBase(baseURL).replace(/\/v\d+$/, '')
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function num(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function moneyText(usd) {
  if (!Number.isFinite(usd)) return ''
  return usd >= 100 || usd <= -100 ? `$${usd.toFixed(0)}` : `$${usd.toFixed(2)}`
}

/**
 * 查余额。两条路按可靠性排队：
 *   1. `GET {origin}/api/user/self`：New-API 自己的用户额度（quota / used_quota），最准；
 *   2. `GET {origin}/v1/dashboard/billing/subscription|usage`：OpenAI 形状的兜底，
 *      `hard_limit_usd - total_usage/100` 就是剩余。
 * 两条都失败时把两边的失败原因拼回去，免得面板只显示一句「失败」看不出是 key 还是网关。
 */
async function fetchQuota({ baseURL, apiKey }) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (key === '') throw new Error('API Key 是空的')
  const origin = originOf(baseURL)
  const headers = { authorization: `Bearer ${key}`, accept: 'application/json' }
  const problems = []

  try {
    const res = await fetch(`${origin}/api/user/self`, { headers })
    const text = await res.text()
    if (res.ok) {
      const row = parseJson(text)?.data ?? null
      const quota = num(row?.quota)
      const used = num(row?.used_quota)
      if (quota !== null) {
        return {
          ok: true,
          source: 'self',
          remain: quota,
          used,
          remainText: moneyText(quota / QUOTA_PER_USD),
          usedText: moneyText(used === null ? NaN : used / QUOTA_PER_USD),
          unit: `1 美元 = ${QUOTA_PER_USD} 额度`,
        }
      }
      problems.push('/api/user/self 里没有 quota 字段')
    } else {
      problems.push(`/api/user/self → HTTP ${res.status}`)
    }
  } catch (error) {
    problems.push(`/api/user/self → ${String(error?.message ?? error)}`)
  }

  try {
    const [subRes, useRes] = await Promise.all([
      fetch(`${origin}/v1/dashboard/billing/subscription`, { headers }),
      fetch(`${origin}/v1/dashboard/billing/usage`, { headers }),
    ])
    const sub = subRes.ok ? parseJson(await subRes.text()) : null
    const usage = useRes.ok ? parseJson(await useRes.text()) : null
    const limit = num(sub?.hard_limit_usd) ?? num(sub?.system_hard_limit_usd)
    const usedCents = num(usage?.total_usage)
    if (limit !== null) {
      const usedUsd = usedCents === null ? null : usedCents / 100
      const remainUsd = usedUsd === null ? null : limit - usedUsd
      return {
        ok: true,
        source: 'billing',
        remain: remainUsd === null ? null : Math.round(remainUsd * QUOTA_PER_USD),
        used: usedUsd === null ? null : Math.round(usedUsd * QUOTA_PER_USD),
        remainText: moneyText(remainUsd),
        usedText: moneyText(usedUsd),
        unit: 'USD',
      }
    }
    problems.push('/v1/dashboard/billing/subscription 里没有 hard_limit_usd')
  } catch (error) {
    problems.push(`billing → ${String(error?.message ?? error)}`)
  }

  throw new Error(problems.join('；'))
}

function isOfficial(baseURL) {
  return originOf(baseURL ?? '') === BASE.origin
}

function pickModel(route, requested) {
  if (typeof requested === 'string' && requested.trim() !== '') return requested.trim()
  const saved = config.providers[route]?.models?.[0]?.id
  if (typeof saved === 'string' && saved !== '') return saved
  return BASE.model
}

/**
 * 拉上游模型列表。
 *
 * 两条路，按可靠性排队：
 *   1. `GET {base}/models`：要 key，返回 New-API 的 data[].id 全量清单；
 *   2. `GET {origin}/api/pricing`：**不要 key**，返回 model_name / tags /
 *      supported_endpoint_types。key 还没配、或者 /models 被拒时用它兜底，
 *      免得设置页上「获取模型」永远是空的。
 *
 * 结果标两个东西：`tag`（对话 / 图像生成 / 视频生成，来自 pricing 的 tags）与
 * `chat`（能不能走 /chat/completions——只看 openai 端点类型）。
 */
export async function listUpstreamModels({ baseURL, apiKey }) {
  const base = normalizeBase(baseURL)
  if (base === '') throw new Error('Base URL 是空的')

  const tags = new Map()
  const origin = (() => {
    try {
      return new URL(base).origin
    } catch {
      return ''
    }
  })()

  if (origin !== '') {
    try {
      const pricing = await fetch(`${origin}/api/pricing`, { headers: attributionHeaders({ accept: 'application/json' }) })
      if (pricing.ok) {
        const parsed = await pricing.json()
        for (const row of Array.isArray(parsed?.data) ? parsed.data : []) {
          const id = typeof row?.model_name === 'string' ? row.model_name.trim() : ''
          if (id === '') continue
          const endpoints = Array.isArray(row?.supported_endpoint_types) ? row.supported_endpoint_types : []
          tags.set(id, { tag: typeof row?.tags === 'string' ? row.tags : '', chat: endpoints.includes('openai') })
        }
      }
    } catch {
      // pricing 拿不到不算失败，继续走 /models
    }
  }

  const ids = []
  if (apiKey !== '') {
    const response = await fetch(`${base}/models`, {
      headers: attributionHeaders({ authorization: `Bearer ${apiKey}`, accept: 'application/json' }),
    })
    const text = await response.text()
    if (!response.ok) {
      if (tags.size === 0) throw new Error(`HTTP ${response.status}${text === '' ? '' : `：${text.slice(0, 300)}`}`)
    } else {
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error('模型列表不是 JSON（这个端点可能不支持 GET /models）')
      }
      const rows = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : []
      for (const row of rows) {
        const id = typeof row === 'string' ? row : row?.id
        if (typeof id !== 'string' || id.trim() === '') continue
        if (row !== null && typeof row === 'object' && row.status === 'Shutdown') continue
        ids.push(id.trim())
      }
    }
  }

  if (ids.length === 0) for (const id of tags.keys()) ids.push(id)
  if (ids.length === 0) throw new Error(apiKey === '' ? '还没填 API Key，上游也不给公开清单' : '上游给的模型列表是空的')

  const models = []
  const seen = new Set()
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const meta = tags.get(id)
    models.push({
      id,
      ...(meta?.tag ? { tag: meta.tag } : {}),
      ...(meta === undefined ? {} : { chat: meta.chat }),
    })
  }
  // 对话类排前面，画图/视频的在后面——模型菜单先给能聊天的。
  models.sort((a, b) => Number(b.chat === true) - Number(a.chat === true))
  return sortByVendor(models, ['deepseek', 'openai', 'google', 'anthropic'])
}

/** 真发一次最小请求——比只拉模型列表更能证明「这条路是通的」。 */
async function testConnection({ baseURL, apiKey, model }) {
  const base = normalizeBase(baseURL)
  if (base === '') throw new Error('Base URL 是空的')
  if (apiKey === '') throw new Error('API Key 是空的')
  if (model === '') throw new Error('Model 是空的')
  const started = Date.now()
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: attributionHeaders({ 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }),
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
  })
  const text = await response.text()
  const elapsed = Date.now() - started
  if (!response.ok) throw new Error(`HTTP ${response.status}${text === '' ? '' : `：${text.slice(0, 400)}`}`)
  let echoed = ''
  try {
    echoed = JSON.parse(text)?.model ?? ''
  } catch {
    echoed = ''
  }
  return { elapsedMs: elapsed, model: echoed === '' ? model : echoed }
}

/** 已经有人占了这个 provider 吗？ */
function routeTaken(ctx, route) {
  try {
    const providers = ctx.llm.listProviders?.()
    if (Array.isArray(providers)) return providers.some((info) => info?.id === route)
  } catch {
    // listProviders 在旧版本里可能没有，退到 try/catch 注册
  }
  return false
}

function register(ctx) {
  const adapter = new HyaloriaAdapter({ getProvider: providerFor })

  // 先看谁空着：`registerAdapter` 撞上已占用的 provider 会抛 DUPLICATE_ADAPTER，
  // 而且是在 ctx.effect 里抛——能不能同步 catch 回来看版本，所以先查一遍更稳。
  const order = activeRoute === ROUTE ? [ROUTE, ALT_ROUTE] : [ALT_ROUTE, ROUTE]
  const free = order.filter((route) => !routeTaken(ctx, route))
  if (free.length === 0) {
    throw new Error(`hyaloria: ${ROUTE} 与 ${ALT_ROUTE} 都已被别的插件占用，换一条路由名再装`)
  }
  let lastError
  for (const route of free) {
    try {
      const handle = ctx.llm.registerAdapter([route], adapter)
      if (route !== activeRoute) {
        activeRoute = route
        saveConfig()
      }
      return handle
    } catch (error) {
      lastError = error
      if (String(error?.code ?? '') !== 'DUPLICATE_ADAPTER') throw error
    }
  }
  throw lastError ?? new Error('hyaloria: 注册路由失败')
}

export function apply(ctx) {
  loadConfig()
  ensureDir()

  const handle = register(ctx)
  ctx.effect?.(() => () => {
    try {
      handle?.dispose?.()
    } catch {
      // 卸载时的注销失败不该拖垮整个 profile
    }
  }, 'hyaloria: adapter')

  const registerApi = (server) => server.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req, res) => {
      const route = (req.url ?? '').split('?')[0].slice(API_PREFIX.length) || '/'
      const asRoute = (value) => {
        const candidate = typeof value === 'string' && value !== '' ? value : activeRoute
        return CANDIDATE_ROUTES.includes(candidate) ? candidate : ''
      }
      try {
        if (route === '/state' && req.method === 'GET') {
          return sendJson(res, 200, {
            providers: CANDIDATE_ROUTES.map((r) => stateOf(r)),
            activeRoute,
            presets: CANDIDATE_ROUTES.map((r) => presetOf(r)),
            statePath: statePath(),
          })
        }

        if (route === '/save' && req.method === 'POST') {
          const body = await readBody(req)
          const target = asRoute(body?.route)
          if (target === '') return sendJson(res, 400, { error: `未知路由 ${body?.route}` })
          const row = config.providers[target]
          if (typeof body.baseURL === 'string' && body.baseURL.trim() !== '') row.baseURL = normalizeBase(body.baseURL)
          if (typeof body.apiKey === 'string' && body.apiKey !== '') row.apiKey = body.apiKey.trim()
          if (body.clearKey === true) row.apiKey = ''
          if (typeof body.model === 'string' && body.model.trim() !== '') {
            const id = body.model.trim()
            const existing = row.models.find((m) => m.id === id)
            const contextWindow = Number.isFinite(body.contextWindow) ? body.contextWindow : existing?.contextWindow
            const maxTokens = Number.isFinite(body.maxTokens) ? body.maxTokens : existing?.maxTokens
            // 面板会把整份上游列表一起带过来：选中的排第一，其余原样保留。
            // 只写选中那条的话，每选一次列表就被砍成一条（下拉里永远只剩「1 个」）。
            const pool = Array.isArray(body.models) && body.models.length > 0 ? body.models : row.models
            const known = pool
              .map((m) => (typeof m === 'string' ? { id: m } : m))
              .filter((m) => m !== null && typeof m === 'object' && typeof m.id === 'string' && m.id.trim() !== '')
              .map((m) => ({
                id: String(m.id).trim(),
                ...(typeof m.name === 'string' && m.name !== '' ? { name: m.name } : {}),
              }))
            row.models = [
              {
                id,
                ...(typeof body.modelName === 'string' && body.modelName !== '' ? { name: body.modelName } : {}),
                ...(Number.isFinite(contextWindow) ? { contextWindow } : {}),
                ...(Number.isFinite(maxTokens) ? { maxTokens } : {}),
              },
              ...known.filter((m) => m.id !== id),
            ]
          }
          saveConfig()
          try {
            ctx.emit?.('llm/adapters-updated')
          } catch {
            // 事件名在旧版本里可能不存在
          }
          return sendJson(res, 200, { ok: true, provider: stateOf(target) })
        }

        if (route === '/models' && req.method === 'POST') {
          const body = await readBody(req)
          const target = asRoute(body?.route)
          if (target === '') return sendJson(res, 400, { error: `未知路由 ${body?.route}` })
          const row = config.providers[target]
          const baseURL = typeof body.baseURL === 'string' && body.baseURL.trim() !== '' ? body.baseURL : row.baseURL
          const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() !== '' ? body.apiKey.trim() : row.apiKey
          try {
            const models = await listUpstreamModels({ baseURL, apiKey })
            const normalized = (Array.isArray(models) ? models : [])
              .filter((m) => m !== null && typeof m === 'object' && typeof m.id === 'string' && m.id.trim() !== '')
              .map((m) => ({
                id: String(m.id).trim(),
                ...(typeof m.name === 'string' && m.name !== '' ? { name: m.name } : {}),
              }))
            // 这里只「首次播种」：本地一条模型都没有时把上游全量存进去。
            // 已经有勾选集（可能是子集）就不覆写，否则面板每刷新一次就把勾选冲回全量。
            // 勾选集的落盘走 /save（体里带 models），别在这里改。
            if (normalized.length > 0 && row.models.length === 0) {
              row.models = normalized
              saveConfig()
            }
            const known = new Map(row.models.map((m) => [m.id, m]))
            const enriched = normalized.map((m) => (known.has(m.id) ? { ...known.get(m.id), ...m } : m))
            return sendJson(res, 200, { ok: true, models: enriched, count: enriched.length })
          } catch (error) {
            return sendJson(res, 200, { ok: false, error: String(error?.message ?? error) })
          }
        }

        if (route === '/test' && req.method === 'POST') {
          const body = await readBody(req)
          const target = asRoute(body?.route)
          if (target === '') return sendJson(res, 400, { error: `未知路由 ${body?.route}` })
          const row = config.providers[target]
          const baseURL = typeof body.baseURL === 'string' && body.baseURL.trim() !== '' ? body.baseURL : row.baseURL
          const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() !== '' ? body.apiKey.trim() : row.apiKey
          const model = pickModel(target, body.model)
          try {
            const result = await testConnection({ baseURL, apiKey, model })
            return sendJson(res, 200, { ok: true, ...result })
          } catch (error) {
            return sendJson(res, 200, { ok: false, error: String(error?.message ?? error) })
          }
        }

        if (route === '/quota' && (req.method === 'GET' || req.method === 'POST')) {
          const query = new URLSearchParams(((req.url ?? '').split('?')[1]) ?? '')
          const asked = req.method === 'POST' ? (await readBody(req))?.route : query.get('route')
          const target = asRoute(asked)
          if (target === '') return sendJson(res, 400, { error: '未知路由' })
          const row = config.providers[target]
          try {
            const quota = await fetchQuota({ baseURL: row.baseURL, apiKey: row.apiKey })
            return sendJson(res, 200, { ...quota, route: target })
          } catch (error) {
            return sendJson(res, 200, { ok: false, route: target, error: String(error?.message ?? error) })
          }
        }

        return sendJson(res, 404, { error: `没有这个接口：${route}` })
      } catch (error) {
        return sendJson(res, 500, { error: String(error?.message ?? error) })
      }
    },
  })

  // webServer 可能比本插件晚就绪；用 inject fiber 挂，别在 apply 当场读一次。
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer'], (scoped) => {
        registerApi(scoped.webServer)
      })
    } catch {
      if (ctx.webServer !== undefined) registerApi(ctx.webServer)
    }
  } else if (ctx.webServer !== undefined) {
    registerApi(ctx.webServer)
  }
}
