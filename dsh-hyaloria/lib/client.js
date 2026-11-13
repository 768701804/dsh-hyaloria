/**
 * dsh-hyaloria —— 浏览器半侧（手写的 __ModuleLoader__ bundle，不需要构建工具）。
 *
 * 会话头部状态座（slot: conversation.session.header.utilities）：路由 / 协议 / 端点 / Key 与额度；设置页面板已下线。
 * 面板里有：路由 / 协议 / 端点 / Key / 模型数、额度、测试连接、刷新、保存 Key。
 *
 * 与宿主只走同源 HTTP（/api/hyaloria/*），不走 RPC：失败模式最少。
 */

window.__ModuleLoader__.load({
  id: 'dsh-hyaloria',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useRef = React.useRef
    var useCallback = React.useCallback

    var API = '/api/hyaloria'
    var NS = 'dsh-hyaloria'

    function readJson(res) {
      return res.text().then(function (text) {
        var data = null
        try {
          data = text === '' ? null : JSON.parse(text)
        } catch (e) {
          data = null
        }
        if (!res.ok) {
          var msg = data && data.error ? data.error : 'HTTP ' + res.status
          var err = new Error(msg)
          err.status = res.status
          throw err
        }
        return data
      })
    }

    function apiGet(path) {
      return fetch(API + path, { cache: 'no-store' }).then(readJson)
    }

    function apiPost(path, body) {
      return fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      }).then(readJson)
    }

    var CSS = [
      '.hy-root{display:flex;flex-direction:column;gap:14px;color:var(--dsh-text,#1f2329);}',
      '.hy-title{font-size:15px;font-weight:600;margin:0;}',
      '.hy-desc{font-size:12px;line-height:1.7;color:var(--dsh-text-secondary,#6b7280);margin:0;}',
      '.hy-panel{border:1px solid var(--dsh-border,#e5e7eb);border-radius:10px;padding:16px;background:var(--dsh-surface,#fff);}',
      '.hy-row{display:flex;align-items:center;gap:10px;margin:0 0 10px;}',
      '.hy-row:last-child{margin-bottom:0;}',
      '.hy-label{width:78px;flex:0 0 78px;text-align:right;font-size:13px;color:var(--dsh-text-secondary,#6b7280);}',
      '.hy-field{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:10px;}',
      '.hy-input,.hy-select{height:32px;padding:0 10px;font-size:13px;border:1px solid var(--dsh-border,#d0d5dd);border-radius:6px;background:var(--dsh-input,#fff);color:inherit;min-width:0;flex:1 1 auto;}',
      '.hy-input:focus,.hy-select:focus{outline:2px solid var(--dsh-accent,#4d6bfe33);border-color:var(--dsh-accent,#4d6bfe);}',
      '.hy-btn{height:32px;padding:0 14px;font-size:13px;border-radius:6px;border:1px solid var(--dsh-border,#d0d5dd);background:var(--dsh-surface,#f7f8fa);color:inherit;cursor:pointer;white-space:nowrap;}',
      '.hy-btn:hover:not(:disabled){border-color:var(--dsh-accent,#4d6bfe);color:var(--dsh-accent,#4d6bfe);}',
      '.hy-btn:disabled{opacity:.55;cursor:not-allowed;}',
      '.hy-btn.primary{background:#5b6ef5;border-color:#5b6ef5;color:#fff;}',
      '.hy-btn.primary:hover:not(:disabled){background:#4a5ce0;color:#fff;}',
      '.hy-hint{font-size:12px;color:var(--dsh-text-tertiary,#9aa1ac);}',
      '.hy-divider{height:1px;background:var(--dsh-border,#eceef2);margin:14px 0;}',
      '.hy-kicker{font-size:12px;font-weight:600;color:var(--dsh-text-secondary,#6b7280);letter-spacing:.04em;margin:0 0 10px;}',
      '.hy-status{font-size:12px;line-height:1.6;padding:8px 10px;border-radius:6px;margin-top:10px;}',
      '.hy-status.ok{background:#ecfdf3;color:#067647;}',
      '.hy-status.err{background:#fef3f2;color:#b42318;}',
      '.hy-status.info{background:#eff4ff;color:#3538cd;}',
      '.hy-foot{display:flex;align-items:center;gap:10px;justify-content:flex-end;}',
      '.hy-path{font-size:11px;color:var(--dsh-text-tertiary,#9aa1ac);word-break:break-all;}',
      '.dshhy-seat{display:inline-flex;align-items:center;gap:5px;height:22px;max-height:22px;padding:0;margin:0;font:inherit;font-size:11.5px;line-height:1;white-space:nowrap;vertical-align:middle;color:inherit;background:transparent;border:0;cursor:pointer;opacity:.8;}',
      '.dshhy-seat:hover{opacity:1;}',
      '.dshhy-seat, .dshhy-seat span{font-size:11.5px!important;line-height:1!important;font-family:inherit!important;font-weight:400!important;letter-spacing:normal!important;color:inherit!important;}',
      '.dshhy-seat:hover,.dshhy-seat:focus,.dshhy-seat:active,.dshhy-seat:focus-visible{background:transparent!important;border:0!important;box-shadow:none!important;outline:none!important;}',
      '.dshhy-dot{width:7px;height:7px;border-radius:50%;background:rgba(128,128,128,.55);flex:none;}',
      '.dshhy-dot[data-state="on"]{background:#30a46c;box-shadow:0 0 5px rgba(48,164,108,.8);}',
      '.dshhy-dot[data-state="warn"]{background:#f5a623;box-shadow:0 0 5px rgba(245,166,35,.8);}',
      '.dshhy-dot[data-state="off"]{background:#e5484d;}',
      '.dshhy-muted{font-size:11.5px;opacity:1;}',
      '.dshhy-panel{position:fixed;z-index:2147483000;width:296px;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:10px 11px;border-radius:11px;background:rgba(23,25,30,.985);border:1px solid rgba(128,128,128,.34);box-shadow:0 16px 42px rgba(0,0,0,.5);color:#e6e9ef;font-size:12px;}',
      '.dshhy-head{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;}',
      '.dshhy-kv{display:grid;grid-template-columns:34px 1fr;gap:4px 8px;font-size:11.5px;line-height:1.5;}',
      '.dshhy-k{color:rgba(230,233,239,.55);}',
      '.dshhy-v{word-break:break-all;}',
      '.dshhy-note{font-size:11px;line-height:1.5;padding:6px 8px;border-radius:6px;}',
      '.dshhy-note.ok{background:rgba(70,200,130,.16);color:#7fd6a4;}',
      '.dshhy-note.err{background:rgba(255,90,90,.14);color:#ff9a9a;}',
      '.dshhy-actions{display:flex;gap:6px;}',
      '.dshhy-btn{flex:1 1 auto;height:26px;border-radius:7px;border:1px solid rgba(128,128,128,.4);background:rgba(255,255,255,.07);color:#e6e9ef;font:inherit;font-size:11.5px;cursor:pointer;}',
      '.dshhy-btn:hover:not(:disabled){border-color:rgba(120,170,255,.7);}',
      '.dshhy-btn:disabled{opacity:.5;cursor:not-allowed;}',
      '.dshhy-foot{font-size:10.5px;color:rgba(230,233,239,.45);}',
      '.dshhy-form{display:flex;gap:6px;align-items:center;}',
      '.dshhy-input{flex:1 1 auto;min-width:0;height:26px;border-radius:7px;border:1px solid rgba(128,128,128,.4);background:rgba(0,0,0,.32);color:#e6e9ef;font:inherit;font-size:11.5px;padding:0 8px;box-sizing:border-box;}',
      '.dshhy-input::placeholder{color:rgba(230,233,239,.42);}',
      '.dshhy-btn-save{flex:0 0 auto;width:56px;}',
      '.dshhy-quota{font-size:11.5px;line-height:1.5;padding:6px 8px;border-radius:6px;background:rgba(255,255,255,.06);color:#cfe3ff;}',
      '.dshhy-select{width:100%;max-width:100%;min-width:0;height:23px;border-radius:6px;border:1px solid rgba(128,128,128,.4);background:rgba(255,255,255,.08);color:#e6e9ef;font:inherit;font-size:11.5px;padding:0 3px;color-scheme:dark;}',
      '.dshhy-select option{background:#17191e;color:#e6e9ef;}',
      '.dshhy-select option:checked{background:#2a3a55;color:#eaf3ff;}',
      '.dshhy-select:disabled{opacity:.6;}',
      '.dshhy-modelrow{display:flex;align-items:center;gap:6px;}',
      '.dshhy-modelrow .dshhy-select{flex:1 1 auto;}',
      '.dshhy-apply{flex:0 0 auto;height:23px;padding:0 8px;border-radius:6px;border:1px solid rgba(128,128,128,.4);background:rgba(255,255,255,.07);color:#e6e9ef;font:inherit;font-size:11px;cursor:pointer;white-space:nowrap;}',
      '.dshhy-apply:hover:not(:disabled){border-color:rgba(120,170,255,.7);}',
      '.dshhy-apply:disabled{opacity:.5;cursor:not-allowed;}',
      '.dshhy-modelline{display:flex;flex-direction:column;align-items:stretch;gap:5px;min-width:0;position:relative;}',
      '.dshhy-modelname{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dshhy-trigger{display:flex;align-items:center;justify-content:space-between;gap:6px;height:23px;padding:0 7px;border-radius:6px;border:1px solid rgba(128,128,128,.4);background:rgba(255,255,255,.06);color:#cfe3ff;font:inherit;font-size:11px;cursor:pointer;white-space:nowrap;}',
      '.dshhy-trigger:hover{border-color:rgba(120,170,255,.7);}',
      '.dshhy-caret{font-size:9px;line-height:1;opacity:.75;transition:transform .12s ease;}',
      '.dshhy-caret[data-open="true"]{transform:rotate(180deg);}',
      '.dshhy-drop{position:absolute;left:-42px;right:-11px;top:calc(100% + 5px);z-index:9;display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:8px;border:1px solid rgba(128,128,128,.45);background:#14171c;box-shadow:0 14px 32px rgba(0,0,0,.55);}',
      '.dshhy-drop-search{display:flex;align-items:center;gap:6px;}',
      '.dshhy-drop-search input{flex:1 1 auto;min-width:0;height:24px;border-radius:6px;border:1px solid rgba(128,128,128,.4);background:rgba(0,0,0,.35);color:#e6e9ef;font:inherit;font-size:11px;padding:0 7px;box-sizing:border-box;}',
      '.dshhy-drop-search input::placeholder{color:rgba(230,233,239,.4);}',
      '.dshhy-clearall{border:0;background:none;color:#7fb0ff;font:inherit;font-size:10.5px;cursor:pointer;white-space:nowrap;padding:0;}',
      '.dshhy-list{max-height:184px;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:1px;padding-right:2px;}',
      '.dshhy-item{display:flex;align-items:center;gap:7px;padding:4px 5px;border-radius:5px;cursor:pointer;font-size:11px;}',
      '.dshhy-item:hover{background:rgba(255,255,255,.07);}',
      '.dshhy-item input{flex:none;margin:0;accent-color:#3f7fe0;}',
      '.dshhy-item span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dshhy-drop-empty{font-size:10.5px;line-height:1.5;color:rgba(230,233,239,.55);padding:6px 4px;}',
      '.dshhy-drop-foot{display:flex;justify-content:flex-end;gap:6px;}',
      '.dshhy-drop-btn{height:24px;padding:0 10px;border-radius:6px;border:1px solid rgba(128,128,128,.45);background:rgba(255,255,255,.07);color:#e6e9ef;font:inherit;font-size:11px;cursor:pointer;}',
      '.dshhy-drop-btn.primary{background:#2f6fd0;border-color:#2f6fd0;color:#fff;}',
      '.dshhy-drop-btn:disabled{opacity:.55;cursor:not-allowed;}',
    ].join('\n')

    function HyaloriaSection() {
      var stateRef = useRef(null)
      var [loading, setLoading] = useState(true)
      var [route, setRoute] = useState('hyaloria')
      var [baseURL, setBaseURL] = useState('')
      var [model, setModel] = useState('')
      var [apiKey, setApiKey] = useState('')
      var [keyMasked, setKeyMasked] = useState('')
      var [hasKey, setHasKey] = useState(false)
      var [models, setModels] = useState([])
      var [presets, setPresets] = useState([])
      var [statePath, setStatePath] = useState('')
      var [showKey, setShowKey] = useState(false)
      var [busy, setBusy] = useState('')
      var [message, setMessage] = useState(null)
      var [loadError, setLoadError] = useState('')

      var applyRoute = useCallback(function (nextRoute, data) {
        var source = data || (stateRef.current ? stateRef.current.providers : [])
        var row = null
        for (var i = 0; i < source.length; i += 1) {
          if (source[i].route === nextRoute) {
            row = source[i]
            break
          }
        }
        setRoute(nextRoute)
        setBaseURL(row ? row.baseURL : '')
        setModel(row && row.model ? row.model : '')
        setApiKey('')
        setHasKey(row ? row.hasKey === true : false)
        setKeyMasked(row ? row.keyMasked || '' : '')
        setModels(row && Array.isArray(row.models) ? row.models : [])
      }, [])

      var load = useCallback(function () {
        setLoading(true)
        setLoadError('')
        return apiGet('/state')
          .then(function (data) {
            var list = data && Array.isArray(data.providers) ? data.providers : []
            stateRef.current = { providers: list, activeRoute: data && data.activeRoute ? data.activeRoute : '' }
            setPresets(data && Array.isArray(data.presets) ? data.presets : [])
            setStatePath(data && data.statePath ? data.statePath : '')
            var active = data && data.activeRoute ? data.activeRoute : ''
            var preferred = active !== '' ? active : list.length > 0 ? list[0].route : 'hyaloria'
            applyRoute(preferred, list)
            setLoading(false)
          })
          .catch(function (error) {
            setLoading(false)
            setLoadError(String(error && error.message ? error.message : error))
          })
      }, [applyRoute])

      useEffect(function () {
        load()
      }, [load])

      var presetFor = function (target) {
        for (var i = 0; i < presets.length; i += 1) {
          if (presets[i].route === target) return presets[i]
        }
        return null
      }

      var onPresetChange = function (event) {
        var next = event.target.value
        applyRoute(next)
        var preset = presetFor(next)
        if (preset) {
          setBaseURL(preset.baseURL || '')
          setModel(preset.model || '')
          setModels(preset.model ? [{ id: preset.model }] : [])
        }
        setMessage({ kind: 'info', text: '已按预设填入 Base URL 与 Model，填上 API Key 再点「测试连接」' })
      }

      var onTest = function () {
        setBusy('test')
        setMessage({ kind: 'info', text: '正在用当前参数发一次最小请求…' })
        apiPost('/test', { route: route, baseURL: baseURL, apiKey: apiKey, model: model })
          .then(function (result) {
            if (result && result.ok) {
              setMessage({ kind: 'ok', text: '连接成功 · 模型 ' + (result.model || model) + ' · ' + result.elapsedMs + 'ms' })
            } else {
              setMessage({ kind: 'err', text: '连接失败 · ' + String((result && result.error) || '未知错误') })
            }
          })
          .catch(function (error) {
            setMessage({ kind: 'err', text: '连接失败 · ' + String(error && error.message ? error.message : error) })
          })
          .then(function () {
            setBusy('')
          })
      }

      var onFetchModels = function () {
        setBusy('models')
        setMessage({ kind: 'info', text: '正在拉模型列表…' })
        apiPost('/models', { route: route, baseURL: baseURL, apiKey: apiKey })
          .then(function (result) {
            if (result && result.ok && Array.isArray(result.models) && result.models.length > 0) {
              setModels(result.models)
              var chatCount = 0
              var groupNames = []
              var groupSeen = {}
              for (var i = 0; i < result.models.length; i += 1) {
                if (result.models[i].chat === true) chatCount += 1
                var gname = result.models[i].vendorLabel || result.models[i].vendor
                if (!gname || groupSeen[gname]) continue
                groupSeen[gname] = true
                groupNames.push(gname)
              }
              if (groupNames.length > 4) groupNames = groupNames.slice(0, 4).concat('等 ' + Object.keys(groupSeen).length + ' 组')
              setMessage({
                kind: 'ok',
                text: '拉到 ' + result.models.length + ' 个模型（可对话 ' + chatCount + '），已按厂商分组：' + groupNames.join(' / ') + '，选一个再保存',
              })
            } else {
              setMessage({ kind: 'err', text: '拉取失败 · ' + String((result && result.error) || '这个端点没给模型列表，可以手填模型 ID') })
            }
          })
          .catch(function (error) {
            setMessage({ kind: 'err', text: '拉取失败 · ' + String(error && error.message ? error.message : error) })
          })
          .then(function () {
            setBusy('')
          })
      }

      var onSave = function () {
        setBusy('save')
        setMessage({ kind: 'info', text: '保存中…' })
        apiPost('/save', { route: route, baseURL: baseURL, model: model, apiKey: apiKey })
          .then(function (result) {
            if (result && result.provider) {
              var list = (stateRef.current ? stateRef.current.providers : []).map(function (row) {
                return row.route === result.provider.route ? result.provider : row
              })
              stateRef.current = { providers: list }
              setHasKey(result.provider.hasKey === true)
              setKeyMasked(result.provider.keyMasked || '')
              setApiKey('')
              setMessage({ kind: 'ok', text: '已保存 · 在输入框的模型菜单里选「Hyaloria」下的模型就能用了' })
            } else {
              setMessage({ kind: 'ok', text: '已保存' })
            }
          })
          .catch(function (error) {
            setMessage({ kind: 'err', text: '保存失败 · ' + String(error && error.message ? error.message : error) })
          })
          .then(function () {
            setBusy('')
          })
      }

      if (loading) {
        return h('div', { className: 'hy-root' }, h('p', { className: 'hy-desc' }, '读取配置中…'))
      }

      if (loadError !== '') {
        return h(
          'div',
          { className: 'hy-root' },
          h('div', { className: 'hy-status err' }, '读不到配置：' + loadError),
          h('button', { className: 'hy-btn', onClick: load }, '重试'),
        )
      }

      var preset = presetFor(route)
      var keyPlaceholder = hasKey ? '已保存 ' + keyMasked + '（留空即不修改）' : '粘贴 API Key（sk- 开头）'

      var modelGroups = []
      var seenGroup = {}
      for (var mi = 0; mi < models.length; mi += 1) {
        var item = models[mi]
        var groupKey = item.vendor || 'other'
        if (!seenGroup[groupKey]) {
          seenGroup[groupKey] = { label: item.vendorLabel || '其他', items: [] }
          modelGroups.push(seenGroup[groupKey])
        }
        var suffix = []
        if (item.tag) suffix.push(item.tag)
        if (item.chat === false) suffix.push('非对话')
        seenGroup[groupKey].items.push({
          id: item.id,
          text: suffix.length > 0 ? item.id + ' 【' + suffix.join('·') + '】' : item.id,
        })
      }

      return h(
        'div',
        { className: 'hy-root' },
        h('h3', { className: 'hy-title' }, '模型接入'),
        h(
          'p',
          { className: 'hy-desc' },
          '把 Hyaloria（api.hyaloria.cn）接进 DSH：填好 Base URL、Model、API Key 保存后，输入框行尾的模型菜单里就会出现 Hyaloria 分组。',
        ),
        h(
          'div',
          { className: 'hy-panel' },
          h(
            'div',
            { className: 'hy-row' },
            h('span', { className: 'hy-label' }, '引擎类型:'),
            h(
              'div',
              { className: 'hy-field' },
              h(
                'select',
                { className: 'hy-select', value: 'openai', onChange: function () {} },
                h('option', { value: 'openai' }, 'OpenAI 兼容(Hyaloria / New-API 系网关)'),
              ),
              h('button', { className: 'hy-btn', onClick: onTest, disabled: busy !== '' }, busy === 'test' ? '测试中…' : '测试连接'),
            ),
          ),
          h(
            'div',
            { className: 'hy-row' },
            h('span', { className: 'hy-label' }, '快速预设:'),
            h(
              'div',
              { className: 'hy-field' },
              h(
                'select',
                { className: 'hy-select', value: route, onChange: onPresetChange },
                presets.map(function (item) {
                  return h('option', { key: item.route, value: item.route }, item.label)
                }),
              ),
              h('span', { className: 'hy-hint' }, preset && preset.hint ? preset.hint : '(选择后自动填入 base_url 和 model)'),
            ),
          ),
          h('div', { className: 'hy-divider' }),
          h('p', { className: 'hy-kicker' }, 'API 参数'),
          h(
            'div',
            { className: 'hy-row' },
            h('span', { className: 'hy-label' }, 'Base URL:'),
            h(
              'div',
              { className: 'hy-field' },
              h('input', {
                className: 'hy-input',
                value: baseURL,
                spellCheck: false,
                placeholder: 'https://api.hyaloria.cn/v1',
                onChange: function (event) {
                  setBaseURL(event.target.value)
                },
              }),
            ),
          ),
          h(
            'div',
            { className: 'hy-row' },
            h('span', { className: 'hy-label' }, 'Model:'),
            h(
              'div',
              { className: 'hy-field' },
              models.length > 0
                ? h(
                    'select',
                    {
                      className: 'hy-select',
                      value: model,
                      onChange: function (event) {
                        setModel(event.target.value)
                      },
                    },
                    modelGroups.map(function (group) {
                      return h(
                        'optgroup',
                        { key: group.label, label: group.label },
                        group.items.map(function (child) {
                          return h('option', { key: child.id, value: child.id }, child.text)
                        }),
                      )
                    }),
                  )
                : h('input', {
                    className: 'hy-input',
                    value: model,
                    spellCheck: false,
                    placeholder: preset ? preset.model : '模型 ID',
                    onChange: function (event) {
                      setModel(event.target.value)
                    },
                  }),
              h('button', { className: 'hy-btn', onClick: onFetchModels, disabled: busy !== '' }, busy === 'models' ? '获取中…' : '获取模型'),
            ),
          ),
          h(
            'div',
            { className: 'hy-row' },
            h('span', { className: 'hy-label' }, 'API Key:'),
            h(
              'div',
              { className: 'hy-field' },
              h('input', {
                className: 'hy-input',
                type: showKey ? 'text' : 'password',
                value: apiKey,
                spellCheck: false,
                autoComplete: 'off',
                placeholder: keyPlaceholder,
                onChange: function (event) {
                  setApiKey(event.target.value)
                },
              }),
              h(
                'button',
                {
                  className: 'hy-btn',
                  onClick: function () {
                    setShowKey(!showKey)
                  },
                },
                showKey ? '隐藏' : '显示',
              ),
            ),
          ),
          message
            ? h(
                'div',
                { className: 'hy-status ' + (message.kind === 'ok' ? 'ok' : message.kind === 'err' ? 'err' : 'info') },
                message.text,
              )
            : null,
          h('div', { className: 'hy-divider' }),
          h(
            'div',
            { className: 'hy-foot' },
            hasKey
              ? h(
                  'button',
                  {
                    className: 'hy-btn',
                    onClick: function () {
                      setApiKey('')
                      setHasKey(false)
                      setKeyMasked('')
                      apiPost('/save', { route: route, clearKey: true }).then(function () {
                        setMessage({ kind: 'info', text: '已清掉这个路由的 API Key' })
                      })
                    },
                  },
                  '清空 Key',
                )
              : null,
            h('button', { className: 'hy-btn primary', onClick: onSave, disabled: busy !== '' }, busy === 'save' ? '保存中…' : '保存'),
          ),
          statePath !== '' ? h('p', { className: 'hy-path' }, '配置写在：' + statePath) : null,
        ),
        h(
          'p',
          { className: 'hy-desc' },
          '「获取模型」两条路：有 key 就拉 GET /v1/models 全量清单；没 key 也能从网关公开的 /api/pricing 拿到模型名与用途标签（对话 / 图像生成 / 视频生成）。结果按厂商分组，能聊天的排前面，画图/视频的标【非对话】，别选错。',
        ),
      )
    }

    /* ══════════ 会话头部那一栏的状态座（conversation.session.header.utilities）══════════
     * 落在 ComfyUI 状态座左边：该槽 order 升序从左到右，ComfyUI 是 28，这里取 27。
     * 数据只走同源 HTTP（/api/hyaloria/state 与 /test），不通就变色，不抛错、不影响对话。
     */
    var SEAT_SLOT = 'conversation.session.header.utilities'
    var SEAT_ID = 'hyaloria-seat'
    var SEAT_ORDER = 27
    var PANEL_W = 296

    function activeProvider(state) {
      if (state === null || typeof state !== 'object' || state.__error) return null
      var rows = Array.isArray(state.providers) ? state.providers : []
      var i
      for (i = 0; i < rows.length; i += 1) {
        if (rows[i] !== null && typeof rows[i] === 'object' && rows[i].route === state.activeRoute) return rows[i]
      }
      return rows.length > 0 ? rows[0] : null
    }

    function messageOf(error) {
      return error !== null && error !== undefined && error.message ? error.message : String(error)
    }

    function HyaloriaSeat(props) {
      var sessionId =
        props !== null && props !== undefined && typeof props.sessionId === 'string' ? props.sessionId : ''
      var seatRef = useRef(null)
      var [open, setOpen] = useState(false)
      var [state, setState] = useState(null)
      var [note, setNote] = useState(null)
      var [busy, setBusy] = useState('')
      var [at, setAt] = useState(null)
      var [keyInput, setKeyInput] = useState('')
      var [quota, setQuota] = useState(null)
      var [catalogModels, setCatalogModels] = useState([])
      var [pickerOpen, setPickerOpen] = useState(false)
      var [pickerQuery, setPickerQuery] = useState('')
      var [checkedIds, setCheckedIds] = useState({})
      var [pickerBusy, setPickerBusy] = useState(false)

      var modelLineRef = useRef(null)

      var refresh = useCallback(function () {
        apiGet('/state')
          .then(function (data) {
            setState(data !== null && typeof data === 'object' ? data : { __error: 'state 返回空' })
            var active = data !== null && typeof data === 'object' && typeof data.activeRoute === 'string' ? data.activeRoute : ''
            if (active !== '') loadCatalog(active)
          })
          .catch(function (error) {
            setState({ __error: messageOf(error) })
          })
      }, [])

      // 下拉展开时点面板外任意位置收起（面板本身也算外：只在模型那一行内的点击例外）。
      useEffect(function () {
        if (!pickerOpen) return undefined
        function onDocumentDown(event) {
          var node = modelLineRef.current
          if (node !== null && node !== undefined && typeof node.contains === 'function' && node.contains(event.target)) return
          setPickerOpen(false)
        }
        document.addEventListener('mousedown', onDocumentDown, true)
        return function () {
          document.removeEventListener('mousedown', onDocumentDown, true)
        }
      }, [pickerOpen])

      var loadQuota = useCallback(function () {
        apiGet('/quota')
          .then(function (data) {
            setQuota(data !== null && typeof data === 'object' ? data : { ok: false, error: 'quota 返回空' })
          })
          .catch(function (error) {
            setQuota({ ok: false, error: messageOf(error) })
          })
      }, [])

      // 每次刷新顺手问一次上游，只用它填目录清单；落盘只发生在 /save（勾选集）与首次播种。
      var loadCatalog = useCallback(function (route) {
        if (typeof route !== 'string' || route === '') return
        apiPost('/models', { route: route })
          .then(function (res) {
            if (res !== null && res !== undefined && res.ok === true && Array.isArray(res.models)) {
              setCatalogModels(res.models)
            }
          })
          .catch(function () {
            // 上游不通就用配置里已有的名单，不打扰人
          })
      }, [])

      useEffect(function () {
        refresh()
        loadQuota()
      }, [refresh, loadQuota])

      useEffect(function () {
        if (!open) return undefined
        function onDown(event) {
          var seat = seatRef.current
          if (seat !== null && seat !== undefined && seat.contains(event.target)) return
          var panel = document.getElementById('dshhy-panel')
          if (panel !== null && panel.contains(event.target)) return
          setOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        return function () {
          document.removeEventListener('mousedown', onDown)
        }
      }, [open])

      var provider = activeProvider(state)
      var hasKey = provider !== null && provider.hasKey === true
      var dot = state === null ? 'idle' : state.__error ? 'off' : hasKey ? 'on' : 'warn'
      var modelCount = provider !== null && Array.isArray(provider.models) ? provider.models.length : 0
      var failReason = state !== null && state.__error ? state.__error : ''

      function toggle() {
        if (open) {
          setOpen(false)
          return
        }
        var rect = seatRef.current !== null && seatRef.current !== undefined ? seatRef.current.getBoundingClientRect() : null
        if (rect !== null && rect !== undefined) {
          var left = rect.left - 8
          if (left + PANEL_W > window.innerWidth - 8) left = window.innerWidth - PANEL_W - 8
          if (left < 8) left = 8
          var top = rect.bottom + 6
          if (top + 320 > window.innerHeight - 8) top = Math.max(8, rect.top - 320)
          setAt({ left: left, top: top })
        }
        setOpen(true)
        refresh()
      }

      function runTest() {
        if (provider === null) return
        setBusy('test')
        setNote(null)
        apiPost('/test', { route: provider.route })
          .then(function (res) {
            if (res !== null && res !== undefined && res.ok === true) {
              setNote({
                kind: 'ok',
                text: '连接正常 · ' + String(res.model || '') + ' · ' + String(res.elapsedMs || 0) + ' ms',
              })
            } else {
              setNote({ kind: 'err', text: '连接失败 · ' + String(res !== null && res !== undefined && res.error ? res.error : '未知原因') })
            }
          })
          .catch(function (error) {
            setNote({ kind: 'err', text: '连接失败 · ' + messageOf(error) })
          })
          .then(function () {
            setBusy('')
          })
      }

      function saveKey() {
        if (provider === null) return
        var value = String(keyInput || '').trim()
        if (value === '') {
          setNote({ kind: 'err', text: '先填 Key' })
          return
        }
        setBusy('save')
        setNote(null)
        apiPost('/save', { route: provider.route, apiKey: value })
          .then(function (res) {
            if (res !== null && res !== undefined && res.ok === true) {
              setNote({ kind: 'ok', text: 'Key 已保存' })
              setKeyInput('')
              refresh()
              loadQuota()
            } else {
              setNote({
                kind: 'err',
                text: '保存失败 · ' + String(res !== null && res !== undefined && res.error ? res.error : '未知原因'),
              })
            }
          })
          .catch(function (error) {
            setNote({ kind: 'err', text: '保存失败 · ' + messageOf(error) })
          })
          .then(function () {
            setBusy('')
          })
      }

      function quotaText() {
        if (quota === null) return '额度 · 读取中…'
        if (quota.ok !== true) return '额度 · ' + String(quota.error !== undefined && quota.error !== null ? quota.error : '读不到')
        var remain = quota.remainText !== undefined && quota.remainText !== '' ? quota.remainText : '—'
        var used = quota.usedText !== undefined && quota.usedText !== '' ? quota.usedText : '—'
        return '剩余 ' + remain + ' · 已用 ' + used
      }

      var catalog = Array.isArray(catalogModels) && catalogModels.length > 0
        ? catalogModels
        : provider !== null && Array.isArray(provider.models)
          ? provider.models
          : []
      var selectedModel = provider !== null && provider.model ? provider.model : ''
      var hasSelected = false
      for (var ci = 0; ci < catalog.length; ci += 1) {
        if (catalog[ci] !== null && typeof catalog[ci] === 'object' && catalog[ci].id === selectedModel) hasSelected = true
      }
      if (!hasSelected && selectedModel !== '') catalog = [{ id: selectedModel }].concat(catalog)

      // 勾选集写回 config.models（服务端 /save 会把 model 排到第一），会话模型列表读的就是这一份。
      function openPicker() {
        // 同一个按钮既开也关：展开状态下再点一次就收起来。
        if (pickerOpen) {
          setPickerOpen(false)
          return
        }
        if (provider === null) {
          setNote({ kind: 'err', text: '获取失败 · 面板还没读到 provider' })
          return
        }
        var next = {}
        var current = Array.isArray(provider.models) ? provider.models : []
        for (var pi = 0; pi < current.length; pi += 1) {
          var row = current[pi]
          if (row !== null && typeof row === 'object' && typeof row.id === 'string') next[row.id] = true
        }
        if (Object.keys(next).length === 0 && selectedModel !== '') next[selectedModel] = true
        setCheckedIds(next)
        setPickerQuery('')
        setNote(null)
        setPickerOpen(true)
        loadCatalog(provider.route)
      }

      function closePicker() {
        if (pickerBusy) return
        setPickerOpen(false)
      }

      function toggleId(id) {
        setCheckedIds(function (prev) {
          var next = {}
          for (var key in prev) {
            if (Object.prototype.hasOwnProperty.call(prev, key)) next[key] = prev[key]
          }
          if (next[id] === true) delete next[id]
          else next[id] = true
          return next
        })
      }

      function clearAll() {
        setCheckedIds({})
      }

      function savePicker() {
        if (provider === null) {
          setNote({ kind: 'err', text: '添加失败 · 面板还没读到 provider' })
          return
        }
        var picked = []
        for (var spi = 0; spi < catalog.length; spi += 1) {
          var item = catalog[spi]
          if (item !== null && typeof item === 'object' && checkedIds[item.id] === true) picked.push(item.id)
        }
        if (picked.length === 0) {
          setNote({ kind: 'err', text: '添加失败 · 至少要勾一个模型' })
          return
        }
        var chosen = picked.indexOf(selectedModel) >= 0 ? selectedModel : picked[0]
        setPickerBusy(true)
        apiPost('/save', { route: provider.route, model: chosen, models: picked })
          .then(function (res) {
            if (res !== null && res !== undefined && res.ok === true) {
              setNote({ kind: 'ok', text: '已添加 · 可用模型 ' + picked.length + ' 个 · 当前 ' + chosen })
              setPickerOpen(false)
              refresh()
            } else {
              setNote({
                kind: 'err',
                text: '添加失败 · ' + String(res !== null && res !== undefined && res.error ? res.error : '未知原因'),
              })
            }
          })
          .catch(function (error) {
            setNote({ kind: 'err', text: '添加失败 · ' + messageOf(error) })
          })
          .then(function () {
            setPickerBusy(false)
          })
      }

      function renderPicker() {
        if (!pickerOpen) return null
        var q = pickerQuery.trim().toLowerCase()
        function itemNode(idv) {
          return h(
            'label',
            { key: 'pick-' + idv, className: 'dshhy-item' },
            h('input', {
              type: 'checkbox',
              checked: checkedIds[idv] === true,
              onChange: function () {
                toggleId(idv)
              },
            }),
            h('span', { title: idv }, idv),
          )
        }
        var itemNodes = []
        for (var ri = 0; ri < catalog.length; ri += 1) {
          var item = catalog[ri]
          if (item === null || typeof item !== 'object' || typeof item.id !== 'string') continue
          if (q !== '' && item.id.toLowerCase().indexOf(q) < 0) continue
          itemNodes.push(itemNode(item.id))
        }
        if (itemNodes.length === 0) {
          itemNodes.push(
            h(
              'div',
              { key: 'pick-empty', className: 'dshhy-drop-empty' },
              catalog.length === 0 ? '还没拿到上游模型 · 检查端点与 Key 后重开这个窗口' : '没有匹配的模型',
            ),
          )
        }
        return h(
          'div',
          { className: 'dshhy-drop' },
          h(
            'div',
            { className: 'dshhy-drop-search' },
            h('input', {
              type: 'search',
              placeholder: '搜索模型',
              value: pickerQuery,
              onChange: function (event) {
                setPickerQuery(event.target.value)
              },
            }),
            h('button', { type: 'button', className: 'dshhy-clearall', onClick: clearAll }, '取消全选'),
          ),
          h('div', { className: 'dshhy-list' }, itemNodes),
          h(
            'div',
            { className: 'dshhy-drop-foot' },
            h('button', { type: 'button', className: 'dshhy-drop-btn', disabled: pickerBusy, onClick: closePicker }, '收起'),
            h(
              'button',
              { type: 'button', className: 'dshhy-drop-btn primary', disabled: pickerBusy, onClick: savePicker },
              pickerBusy ? '添加中…' : '添加模型',
            ),
          ),
        )
      }

      var pairs = [
        ['路由', provider !== null && provider.route ? provider.route : '—'],
        ['协议', provider !== null && provider.apiLabel ? provider.apiLabel : 'OpenAI 兼容'],
        ['端点', provider !== null && provider.baseURL ? provider.baseURL + (provider.official === true ? ' · 官方' : '') : '—'],
        ['Key', hasKey ? String(provider.keyMasked || '已配置') : '未配置'],
        [
          '模型',
          h(
            'div',
            { className: 'dshhy-modelline', ref: modelLineRef },
            h(
              'button',
              {
                type: 'button',
                className: 'dshhy-trigger',
                title: '当前 ' + (selectedModel || '未选模型') + ' · 拉取上游可用模型，勾选后作为模型列表',
                onClick: openPicker,
                'aria-expanded': pickerOpen ? 'true' : 'false',
              },
              h('span', null, '获取可用模型'),
              h('span', { className: 'dshhy-caret', 'data-open': pickerOpen ? 'true' : 'false' }, '▾'),
            ),
            pickerOpen ? renderPicker() : null,
          ),
        ],
      ]
      var kv = []
      for (var i = 0; i < pairs.length; i += 1) {
        kv.push(h('div', { key: 'k' + i, className: 'dshhy-k' }, pairs[i][0]))
        kv.push(h('div', { key: 'v' + i, className: 'dshhy-v' }, pairs[i][1]))
      }

      return h(
        'div',
        { style: { position: 'relative', display: 'inline-flex' } },
        h(
          'button',
          {
            ref: seatRef,
            type: 'button',
            className: 'dshhy-seat',
            onClick: toggle,
            title: 'Hyaloria 接口 · 点开看状态',
          },
          h('span', { className: 'dshhy-dot', 'data-state': dot }),
          h('span', null, 'Hyaloria'),
          h('span', { className: 'dshhy-muted' }, hasKey ? '在线' : '未配 Key'),
        ),
        open && at !== null
          ? h(
              'div',
              { id: 'dshhy-panel', className: 'dshhy-panel', style: { left: at.left + 'px', top: at.top + 'px' } },
              h(
                'div',
                { className: 'dshhy-head' },
                h('span', { className: 'dshhy-dot', 'data-state': dot }),
                h('span', null, 'Hyaloria 接口'),
              ),
              failReason !== ''
                ? h('div', { className: 'dshhy-note err' }, '读不到本机接口：' + failReason)
                : h('div', { className: 'dshhy-kv' }, kv),
              h('div', { className: 'dshhy-quota' }, quotaText()),
              h(
                'div',
                { className: 'dshhy-form' },
                h('input', {
                  className: 'dshhy-input',
                  type: 'password',
                  spellCheck: false,
                  placeholder: hasKey ? '换 Key（不填就不改）' : 'API Key：sk-...',
                  value: keyInput,
                  onChange: function (event) {
                    setKeyInput(event.target.value)
                  },
                }),
                h(
                  'button',
                  { type: 'button', className: 'dshhy-btn dshhy-btn-save', onClick: saveKey, disabled: busy !== '' },
                  busy === 'save' ? '保存中' : '保存',
                ),
              ),
              note !== null ? h('div', { className: 'dshhy-note ' + note.kind }, note.text) : null,
              h(
                'div',
                { className: 'dshhy-actions' },
                h(
                  'button',
                  { type: 'button', className: 'dshhy-btn', onClick: runTest, disabled: busy !== '' || provider === null },
                  busy === 'test' ? '测试中…' : '测试连接',
                ),
                h('button', { type: 'button', className: 'dshhy-btn', onClick: refresh }, '刷新'),
              ),
              h('div', { className: 'dshhy-foot' }, 'Key 只存本机 · 保存后自动取额度'),
            )
          : null,
      )
    }

    function ErrorBoundary(props) {
      var [error, setError] = useState(null)
      if (error !== null) {
        return h('div', { className: 'hy-root' }, h('div', { className: 'hy-status err' }, '面板出错：' + String(error && error.message ? error.message : error)))
      }
      try {
        return props.children
      } catch (caught) {
        setError(caught)
        return null
      }
    }

    function apply(ctx) {
      ctx.effect(
        function () {
          var id = 'dsh-hyaloria-styles'
          if (document.getElementById(id) === null) {
            var style = document.createElement('style')
            style.id = id
            style.textContent = CSS
            document.head.appendChild(style)
          }
          return function () {
            var el = document.getElementById(id)
            if (el !== null && el.parentNode !== null) el.parentNode.removeChild(el)
          }
        },
        'dsh-hyaloria: styles',
      )

      /* 设置页的 Hyaloria 面板已下线：Key 与额度都挪到会话头部状态座。 */

      /* 状态座：挂不上也不能拖坏设置页，单独 try。 */
      try {
        ctx.slots.inject(SEAT_SLOT, function () {
          return ctx.slots.register(
            {
              name: SEAT_SLOT,
              id: SEAT_ID,
              order: SEAT_ORDER,
              // 槽框架会把当前会话 id 传进来，面板靠它调 sessions.selectModel
              inject: function (sessionId) {
                return { sessionId: sessionId }
              },
              label: function () {
                return 'Hyaloria 接口'
              },
            },
            HyaloriaSeat,
          )
        })
      } catch (error) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('dsh-hyaloria: 状态座没挂上（设置页不受影响）', error)
        }
      }
    }

    module.exports = {
      name: 'hyaloria',
      inject: ['slots'],
      apply: apply,
    }
    return module.exports
  },
})
