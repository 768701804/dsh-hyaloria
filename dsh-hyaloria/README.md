# dsh-hyaloria

把 [Hyaloria](https://api.hyaloria.cn/)（New-API 形状的 OpenAI 兼容聚合网关）接进 DeepSeek Harness：
一条模型路由 + 一个「模型接入」设置页。

蓝本是同工作区的 `dsh-llm-gateway`，结构照搬：宿主半走 `ctx.llm.registerAdapter`，
浏览器半是手写的 `__ModuleLoader__` bundle，配置落盘在 `<DSH_HOME>/hyaloria/config.json`。

---

## 装

在 profile 目录（`~/.dsh/profiles/desktop`）里：

```
pnpm add link:<插件所在目录>
```

再把 `dsh-hyaloria` 加进 `package.json` 的 `dsh.profile.bundles`（插件包已被 `dsh-web` 的
客户端模块扫描认到才会把设置页面板 serv 给浏览器，所以那行必须是**裸包名**）。

装完刷新页面 → 设置 → Hyaloria。

---

## 第一次配

面板从上到下四步：

1. **快速预设** 选 `Hyaloria` —— Base URL 与 Model 自动填好
   （`https://api.hyaloria.cn/v1` / `deepseek-v4.1-flash`）。
2. **API Key** 粘贴 `sk-` 开头的那串。在 api.hyaloria.cn 的「令牌」页新建。
3. **测试连接** —— 真发一次 `max_tokens: 1` 的 `/chat/completions`，
   回 `连接成功 · 模型 xxx · 823ms` 才算通。只拉到模型列表不算通。
4. **保存** —— 输入框行尾的模型菜单里就会出现 `Hyaloria` 分组。

「获取模型」按钮有两条路，按可靠性排队：

| 路径 | 要不要 key | 给的字段 |
| --- | --- | --- |
| `GET /v1/models` | 要 | New-API 的全量 `data[].id` |
| `GET /api/pricing` | **不要** | `model_name` / `tags`（对话·图像生成·视频生成）/ `supported_endpoint_types` |

所以 key 还没填也点得动，只是清单来自公开的 pricing。结果按厂商分组（DeepSeek / OpenAI GPT /
Gemini / 字节即梦 …），**能聊天的排前面**，画图和视频的标 `【非对话】`——别在对话里选到
`gpt-image-2.5`，那玩意儿回的是图不是字。

---

## 面板上看不到的几处

- **身份头**：每条上游请求都带 `user-agent: deepseek-harness/<v> (+<repo>)`。这是 rc.5 的
  `LlmAdapter` 契约要求，省略算违约——`lib/attribution.js` 单独拎出来三个出口共用一份。
- **密钥只出掩码**：所有回给浏览器的响应里 key 都是 `sk-a********wxyz` 形状，明文只活在
  宿主进程和 `config.json` 里。面板上留空就是「不修改」，点「清空 Key」才会真删。
- **重试交给宿主**：`providerRetryPolicy()` 返回 `undefined`，用内核默认策略，
  免得和版本里的调度字段对不上。
- **截断的工具调用不当真**：`arguments` 拼不成合法 JSON 时把 `finish` 降成 `max-tokens`，
  让装配器丢掉这个半截调用，而不是拿它去执行。

---

## 错误码怎么读

| `finish.reason.failure.code` | 含义 | 怎么办 |
| --- | --- | --- |
| `CONFIG` | Base URL 或 Key 空着 | 回设置页填 |
| `INVALID_CREDENTIAL` | 401 / 403 | Key 错了或过期，重新建令牌 |
| `INSUFFICIENT_QUOTA` | 402 | 上游余额/额度不足，去控制台充值 |
| `RATE_LIMIT` | 429 | 撞限流，等一会儿 |
| `SERVER` | 其它 4xx/5xx | 看 message 里带的上游原文 |
| `TRANSPORT` | 连不上、或流读到一半断了 | 先测连接；稳定复现就贴 message |

---

## 自测

```
cd <插件所在目录>
node test-adapter.mjs
```

15 条，不联网、不需要 key：起一个本地 mock（SSE + `/v1/models` + `/api/pricing`），
把消息翻译、用量映射、厂商分组、块顺序、截断调用、错误码、模型列表兜底全跑一遍。
当前 15/15。

---

## 文件

```
lib/index.js        宿主半：注册路由 + 配置落盘 + /api/hyaloria/{state,save,models,test}
lib/adapter.js      OpenAI 兼容适配器：消息翻译 / SSE → 分块 / 用量 / finish 原因
lib/client.js       浏览器半：settings.section 面板（无构建，手写 bundle）
lib/catalog.js      厂商分组 + 从模型 ID 抠发布日期
lib/attribution.js  上游身份头（三个出口共用）
cordis.patch.yml    bundle 补丁层
test-adapter.mjs    自测
```
