# SillyTavern CORS Relay（跨域中继） v1.0.0

把嵌入酒馆（SillyTavern）的 iframe 应用发往外部 LLM 的跨域请求，转交给酒馆后端通道执行，
绕过 WebView / iframe 的 CORS 限制。

本项目由「梦境创客跨域中继 v3.0.0」通用化重构而来：中继、扫描、安装等核心逻辑不含任何应用专用代码，
应用识别全部收敛到 `src/profiles.js` 的场景档案里。**梦境创客是内置场景之一**，
今后支持其他应用只需追加档案，或直接依赖广谱模式兜底。

## 内置场景

| 场景 | 来源 |
| --- | --- |
| 梦境创客 | [deepsleep-claw/SleepTavernHome](https://github.com/deepsleep-claw/SleepTavernHome) |

档案中记录了梦境创客写入 window 的真实全局标记（`__dream_creator_client_host__` 等，
已对照其源码核对），以及工作台 iframe 的结构特征，识别不依赖 iframe id 猜测。

## 目录结构（上传时请保持完整）

```
sillytavern-cors-relay/
├── manifest.json     扩展清单
├── index.js          入口，只做装配
├── style.css         面板样式
├── README.md
└── src/
    ├── constants.js   版本、端点、状态键、透传策略、默认设置
    ├── profiles.js    场景档案（梦境创客在此登记，新应用在此追加）
    ├── platform.js    对接酒馆：核心模块探测、鉴权头、通知、设置保存
    ├── http.js        fetch 入参解析（URL / 方法 / 头 / body / signal）
    ├── targets.js     目标窗口识别（档案驱动 + 广谱兜底）
    ├── relay.js       中继核心：构造通道 DTO、判定响应、不支持接口提示
    ├── patcher.js     fetch 代理安装、原始实现回溯、可写性探测
    ├── scanner.js     扫描调度、监听动态窗口、定时器登记
    ├── settings.js    设置读写（extension_settings / localStorage 降级）
    ├── diagnostics.js 统计汇总与诊断快照
    └── ui.js          折叠面板与状态渲染
```

> ⚠️ `src/` 目录必须一起上传。`index.js` 通过 `./src/*.js` 引用这些模块，目录被平铺会导致扩展加载失败。

## 安装

把整个文件夹放进下面任意一个目录，然后**重启酒馆**：

- 全局安装：`SillyTavern/public/scripts/extensions/third-party/`
- 当前用户：`SillyTavern/data/default-user/extensions/`

扩展面板（拼图图标）→ 管理扩展里打开「CORS 跨域中继（原生通道）」。

**互斥提示**：请停用「梦境创客跨域中继」旧扩展与酒馆助手里的旧中继脚本，
避免两套代理叠加。若之前依赖 `__dcaCorsRelayDiagnostics()` 排查问题，请改用 `__stcrDiagnostics()`。

## 重要前提：接口类型必须是「OpenAI 聊天补全」

中继经由酒馆的 chat-completions 通道执行，只接得住 OpenAI 兼容请求：

| 接口类型 | 实际请求路径 | 可否中继 |
| --- | --- | --- |
| OpenAI 聊天补全 | `{baseURL}/chat/completions` | ✅ |
| OpenAI Responses | `{baseURL}/responses` | ❌ 需切换接口类型 |
| Anthropic | `{baseURL}/messages` | ❌ 需切换接口类型 |
| Gemini | `models/{m}:generateContent` | ❌ 需切换接口类型 |

后三种酒馆通道接不住，扩展会**明确提示**切换，不会静默失败。

## 面板与状态

面板采用酒馆标准的 `inline-drawer` 折叠结构，默认折叠。头部徽标常驻显示
`接管 N · 中转 M`，不开面板也能看到是否在工作；有失败时徽标变黄。

展开后的设置项：

| 项目 | 默认 | 说明 |
| --- | --- | --- |
| 启用中继 | 开 | 关闭后所有请求原样直连 |
| 接管主窗口自身 | 开 | 覆盖在主窗口上下文直接发请求的情况 |
| 广谱接管所有同源帧 | 开 | 兜底：不依赖场景档案，对所有同源帧装代理 |
| 深度扫描嵌套 iframe | 关 | 默认扫两层，开启后扫三层（更耗性能） |
| 无法接管时提示 | 开 | 遇到无法接管的窗口时提示一次 |

排查时：浏览器控制台执行 `__stcrDiagnostics()` 可拿到完整诊断 JSON（含各场景标记是否可见、
接管/受阻窗口清单、中转计数）。

## 拦截范围

中继按**请求特征**触发，不挑发起方：

- 跨域 + `POST` + 路径以 `/chat/completions` 结尾
- 跨域 + `GET` + 路径以 `/models` 结尾

酒馆自身的同源 `/api/...` 请求不受影响。其他扩展若直连外部 OpenAI 兼容接口，也会被顺带中继。

## 参数透传策略

请求体采用**排除制**而非白名单：除 `model` / `messages` / `stream` 与通道控制字段外，
其余字段原样透传。这样应用里配置的任意自定义 body 参数（如梦境创客 YAML 的 `bodyParameters`）
都不会被静默丢弃。请求头只转发 `authorization` / `api-key` / `x-api-key` / `x-*`。

## 新增场景

在 `src/profiles.js` 的 `PROFILES` 数组里追加一个档案对象即可，字段说明见该文件头部注释。
推荐优先填写 `windowMarks`（应用写入 window 的真实全局标记，最可靠），
iframe / 文档特征作补充；`topMarks` 用于诊断快照确认应用已加载。
识别完全失效时，广谱模式（默认开启）仍会对所有同源帧装代理兜底。

## 已知限制

- 只有 OpenAI 兼容（聊天补全）接口可中继
- 中继走 `/api/backends/chat-completions/generate` 与 `/api/backends/chat-completions/status`，
  若酒馆后端接口路径变更需同步修改 `constants.js` 里的常量
- `sandbox` 且未开 `allow-same-origin` 的 iframe origin 为 `null`，无法接管（已自动跳过，不计入失败）
