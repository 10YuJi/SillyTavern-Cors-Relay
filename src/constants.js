// 全局常量：版本号、中继端点、状态键、透传策略、默认设置。
// 所有模块共享，避免魔法字符串散落各处。

export const VERSION = '1.1.0';
export const EXT_TITLE = 'CORS 跨域中继';

// 设置持久化：extension_settings 下的键名；localStorage 降级键名
export const SETTINGS_KEY = 'corsRelay';
export const LOCAL_STORAGE_KEY = 'stCorsRelaySettings';

// 酒馆后端通道：对话生成与模型列表探测
export const CHAT_RELAY = '/api/backends/chat-completions/generate';
export const MODELS_RELAY = '/api/backends/chat-completions/status';

// 挂在 window 上的状态键（用于去重、诊断与原始 fetch 追溯）
export const WIN_KEYS = {
    status: '__stcrStatus__',
    installed: '__stcrInstalled__',
    baseFetch: '__stcrBaseFetch__',
    openHooked: '__stcrOpenHooked__',
    booted: '__stcrExtBooted__'
};

// 代理函数自身携带的标记与原始实现回溯链
export const PROXY_TAG = '__stcrRelayProxy__';
export const PROXY_ORIGINAL = '__stcrOriginalFetch__';

// 酒馆 chat-completions 通道接不住的接口，命中后明确提示用户切换类型
export const UNSUPPORTED_INTERFACES = [
    { re: /\/responses$/i, name: 'OpenAI Responses' },
    { re: /\/messages$/i, name: 'Anthropic Messages' },
    { re: /:generatecontent$/i, name: 'Gemini generateContent' }
];
export const UNSUPPORTED_HINT = '请在应用的 Provider / 接口类型设置里改为「OpenAI 聊天补全」';

// Gemini 的 /models 与 OpenAI 不兼容，交还应用自带逻辑处理
export const GEMINI_URL_HINT = /(:generatecontent|\/v1beta|\/v1alpha)/i;
export const SKIP_MODELS_HOSTS = ['generativelanguage.googleapis.com'];

// 中继自行构造、不允许请求体覆盖的字段。
// 其余字段一律原样透传 —— 部分应用支持任意自定义 body 参数（如梦境创客的 YAML bodyParameters），
// 用白名单会静默丢掉私有参数，因此这里只做「排除」而非「允许」。
export const RESERVED_FIELDS = new Set([
    'chat_completion_source', 'custom_url', 'custom_model', 'custom_include_headers',
    'model', 'messages', 'stream'
]);

// 请求头只转发鉴权相关，其余交给通道按 custom_url 自行处理
export const AUTH_HEADER_NAMES = ['authorization', 'api-key', 'x-api-key'];

export const DEFAULT_SETTINGS = {
    enabled: true,       // 总开关
    patchTop: true,      // 接管主窗口自身
    broadPatch: true,    // 广谱接管所有同源帧（兜底无法靠档案识别的应用）
    deepScan: false,     // 扫描三层嵌套 iframe（默认两层）
    notifyBlocked: true, // 无法接管时提示
    windowFilterMode: 'off', // 窗口名单模式：off 不过滤 / blacklist 黑名单 / whitelist 白名单
    windowFilterList: ''     // 名单规则，每行一条，对窗口标签做包含匹配（不区分大小写）
};

// 窗口名单模式的合法取值（入口校验用）
export const WINDOW_FILTER_MODES = ['off', 'blacklist', 'whitelist'];

// 扩展可能装在 public/scripts/extensions/third-party/<name> 或 data/<user>/extensions/<name>，
// 两者相对层级不同，故列出全部候选逐个尝试。
export const CORE_PATHS = [
    '../../../script.js', '../../../../script.js', '../../script.js',
    '/script.js', '/public/script.js'
];
export const EXT_PATHS = [
    '../../../extensions.js', '../../../../extensions.js', '../../extensions.js', '../extensions.js',
    '/scripts/extensions.js', '/public/scripts/extensions.js'
];

export const SCAN_INTERVAL_MS = 1500;
export const STATUS_INTERVAL_MS = 2000;
export const NOTIFY_THROTTLE_MS = 30_000;
export const MAX_UNWRAP_HOPS = 10;
export const MAX_STATUS_WALK = 60;
