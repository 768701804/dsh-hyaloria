/**
 * 上游请求的身份头（DSH 0.2.1-rc.5 的 LlmAdapter 契约要求）。
 *
 * rc.5 的 `LlmAdapter` 文档原话：Every provider HTTP request must include
 * `attributionHeaders()`。官方实现是 `user-agent: <product>/<version> (+<url>)`；
 * 省略不发送是违约的，所以这一份头单独拎出来，适配器、拉模型列表、测试连接三个
 * 出口共用一份，避免各写各的漂移。
 *
 * 版本号的来源分三级：运行时解析 @deepseek-ai/dsh-llm 的版本 → 环境变量
 * DSH_VERSION → 都没有就只报产品名 + 本插件版本（仍是一个合法的自报身份）。
 *
 * 本文件不 import 任何 @deepseek-ai 包：解析不到时也不能让插件挂掉。
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PRODUCT = 'deepseek-harness'
export const PRODUCT_URL = 'https://github.com/deepseek-ai/deepseek-harness'

function pluginVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const raw = readFileSync(path.join(here, '..', 'package.json'), 'utf8')
    const version = JSON.parse(raw)?.version
    return typeof version === 'string' && version !== '' ? version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export const PLUGIN_VERSION = pluginVersion()

export function harnessVersion() {
  const fromEnv = process.env.DSH_VERSION
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  for (const pkg of ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh']) {
    try {
      const require = createRequire(import.meta.url)
      const manifest = require(`${pkg}/package.json`)
      if (typeof manifest?.version === 'string' && manifest.version !== '') return manifest.version
    } catch {
      // profile 里没有这个包是常态，继续降级
    }
  }
  return ''
}

const HARNESS_VERSION = harnessVersion()

export function attributionHeaders(extra) {
  const product = HARNESS_VERSION === ''
    ? `${PRODUCT} (+${PRODUCT_URL}) dsh-hyaloria/${PLUGIN_VERSION}`
    : `${PRODUCT}/${HARNESS_VERSION} (+${PRODUCT_URL})`
  return { 'user-agent': product, ...(extra ?? {}) }
}
