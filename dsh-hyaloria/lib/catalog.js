/**
 * 模型目录里的小标签与厂商分组。
 *
 * Hyaloria 是 New-API 形状的聚合网关，模型 ID 很杂：`deepseek-v4.1-flash`、
 * `GPT 6.1 Sol`（带空格）、`gemini-nano-banana-pro`、`dreamina-seedance-2-5-260628`。
 * 所以这里只做两件事：
 *   1. 把 ID 归到一家厂商，下拉里按厂商分块；
 *   2. 从 ID 里抠发布日期，组内越新越靠上。
 *
 * 价格标签从上游 `/api/pricing` 拿（tags 字段：对话 / 图像生成 / 视频生成），
 * 拿不到就不打标签——不猜。
 */

const VENDOR_ALIAS = {
  deepseek: 'deepseek',
  'deepseek-ai': 'deepseek',
  gpt: 'openai',
  openai: 'openai',
  o1: 'openai',
  o3: 'openai',
  o4: 'openai',
  chatgpt: 'openai',
  gemini: 'google',
  google: 'google',
  claude: 'anthropic',
  anthropic: 'anthropic',
  qwen: 'qwen',
  'tongyi-mai': 'qwen',
  glm: 'glm',
  zhipu: 'glm',
  thudm: 'glm',
  kimi: 'kimi',
  moonshot: 'kimi',
  moonshotai: 'kimi',
  minimax: 'minimax',
  mimo: 'mimo',
  grok: 'xai',
  xai: 'xai',
  doubao: 'doubao',
  bytedance: 'bytedance',
  seedream: 'bytedance',
  'dreamina-seedance': 'bytedance',
  dreamina: 'bytedance',
  hyaloria: 'hyaloria',
  kling: 'kling',
  vidu: 'vidu',
  runway: 'runway',
}

const VENDOR_LABEL = {
  deepseek: 'DeepSeek',
  openai: 'OpenAI GPT',
  google: 'Gemini (Google)',
  anthropic: 'Claude (Anthropic)',
  qwen: '通义千问 Qwen',
  glm: '智谱 GLM',
  kimi: 'Kimi (Moonshot)',
  minimax: 'MiniMax',
  mimo: 'MiMo (Xiaomi)',
  xai: 'Grok (xAI)',
  doubao: '豆包 Doubao',
  bytedance: '字节 / 即梦',
  hyaloria: 'Hyaloria 自研',
  kling: '可灵 Kling',
  vidu: 'Vidu',
  runway: 'Runway',
  other: '其他 Other',
}

/** `GPT 6.1 Sol` / `gemini-nano-banana-2.1` / `deepseek-v4.1-flash` → 厂商 key。 */
export function vendorKey(modelId) {
  if (typeof modelId !== 'string' || modelId === '') return 'other'
  const id = modelId.trim()
  let head
  if (id.includes('/')) {
    const parts = id.split('/')
    head = parts.length > 2 ? parts[parts.length - 2] : parts[0]
  } else {
    const match = id.match(/^[A-Za-z]+/)
    head = match ? match[0] : id
  }
  const first = head.toLowerCase()
  if (VENDOR_ALIAS[first] !== undefined) {
    // `dreamina-seedance-2-5` 这类前缀是两段拼起来的，先按整段查，再按第二段查
    if (first === 'dreamina') {
      const second = id.split(/[-_ ]/)[1]?.toLowerCase() ?? ''
      if (VENDOR_ALIAS[second] !== undefined) return VENDOR_ALIAS[second]
    }
    return VENDOR_ALIAS[first]
  }
  const trimmed = first.replace(/[0-9]+$/, '')
  return trimmed === '' ? 'other' : trimmed
}

export function vendorLabel(key) {
  return VENDOR_LABEL[key] ?? key
}

/** 从 ID 里抠发布日期（毫秒）；抠不到返回 0。 */
export function dateFromId(modelId) {
  if (typeof modelId !== 'string' || modelId === '') return 0
  const build = (y, m, d) => {
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return 0
    return Date.UTC(y, m - 1, d)
  }
  let m = modelId.match(/(20\d{2})[-_ .](0[1-9]|1[0-2])[-_ .](0[1-9]|[12]\d|3[01])(?!\d)/)
  if (m) return build(+m[1], +m[2], +m[3])
  m = modelId.match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/)
  if (m) return build(+m[1], +m[2], +m[3])
  m = modelId.match(/(?:^|[-_ ])(2[0-9])(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?=$|[-_ ])/)
  if (m) return build(2000 + +m[1], +m[2], +m[3])
  m = modelId.match(/[-_ ]([0-9]{2})([0-9]{2})$/)
  if (m) {
    const a = +m[1]
    const b = +m[2]
    if (a >= 24 && a <= 40 && b >= 1 && b <= 12) return build(2000 + a, b, 1)
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) return build(2025, a, b)
  }
  return 0
}

/**
 * 按厂商分组排好：同家挨在一起，组间按模型数量排，组内按发布日期倒序。
 * `pinnedFirst` 里的厂商（默认 对话类）排到最前面，免得模型下拉一打开
 * 先看到一排画图的。
 */
export function sortByVendor(models, pinnedFirst = []) {
  const buckets = new Map()
  for (const item of models) {
    const key = vendorKey(item.id)
    const created = Number(item.created) > 0 ? Number(item.created) * 1000 : 0
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push({ ...item, vendor: key, vendorLabel: vendorLabel(key), sortDate: dateFromId(item.id) || created })
  }
  const groups = [...buckets.entries()]
    .map(([key, items]) => ({ key, items }))
    .sort((a, b) => {
      const pa = pinnedFirst.indexOf(a.key)
      const pb = pinnedFirst.indexOf(b.key)
      if (pa !== pb) return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb)
      return b.items.length - a.items.length || a.key.localeCompare(b.key)
    })
  const out = []
  for (const group of groups) {
    group.items.sort((a, b) => b.sortDate - a.sortDate || a.id.localeCompare(b.id))
    out.push(...group.items)
  }
  return out
}
