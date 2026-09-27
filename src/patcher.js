// fetch 代理的安装与卸载：派生原始实现、探测可写性、构造拦截函数。

import { VERSION, WIN_KEYS, PROXY_TAG, PROXY_ORIGINAL, MAX_UNWRAP_HOPS } from './constants.js';
import { originOf, resolveUrl, readMethod, normalizedPath } from './http.js';
import { matchUnsupported } from './relay.js';

// 沿原始实现链回溯到未经包装的 fetch，避免多层代理叠加
function deriveBaseFetch(win, topWin) {
    let current = win.fetch;
    let hops = 0;
    while (current && current[PROXY_TAG] && hops < MAX_UNWRAP_HOPS) {
        if (typeof current[PROXY_ORIGINAL] === 'function') {
            current = current[PROXY_ORIGINAL];
            hops += 1;
            continue;
        }
        current = null;
        break;
    }
    if (current && !current[PROXY_TAG]) return current;
    if (win[WIN_KEYS.baseFetch]) return win[WIN_KEYS.baseFetch];

    // 无原始实现可用时，构造一个把相对地址补全后转发给宿主的基座
    let host = null;
    try {
        if (topWin && topWin !== win && typeof topWin.fetch === 'function') host = topWin.fetch.bind(topWin);
    } catch (error) { host = null; }
    const fallback = win.fetch;

    const base = function stcrBaseFetch(input, init) {
        let target = input;
        try {
            if (typeof input === 'string') {
                const origin = originOf(win, topWin);
                if (origin) target = new win.URL(input, `${origin}/`).href;
            }
        } catch (error) { /* 忽略 */ }
        return host ? host(target, init) : fallback.call(win, target, init);
    };

    try {
        win[WIN_KEYS.baseFetch] = base;
    } catch (error) { /* 忽略 */ }
    return base;
}

// 探测 fetch 是否可写：跨域窗口读取属性本身就会抛 SecurityError。
// 用属性描述符判断，避免真实写入探针函数。
export function canPatch(win) {
    try {
        if (!win || typeof win.fetch !== 'function') return { ok: false, reason: 'no-fetch' };
        const own = Object.getOwnPropertyDescriptor(win, 'fetch');
        if (own) {
            if (own.writable === false || own.configurable === false) return { ok: false, reason: 'frozen-fetch' };
            return { ok: true, reason: '' };
        }
        // fetch 位于原型链上，试写一次确认可覆盖
        const current = win.fetch;
        win.fetch = current;
        return { ok: true, reason: '' };
    } catch (error) {
        return { ok: false, reason: String((error && error.name) || error || 'unknown') };
    }
}

function versionRank(v) {
    const parts = String(v || '').split('.');
    let rank = 0;
    for (let i = 0; i < 3; i++) rank = rank * 1000 + (parseInt(parts[i], 10) || 0);
    return rank;
}

export function createPatcher({ relay, settings, diag, topWin }) {
    function makeProxy(win, originalFetch) {
        let status = win[WIN_KEYS.status];
        if (!status || typeof status !== 'object') {
            status = { version: VERSION, relayed: 0, failed: 0, lastError: '', lastRelayAt: 0 };
        }
        status.version = VERSION;
        status.relayed = status.relayed || 0;
        status.failed = status.failed || 0;
        win[WIN_KEYS.status] = status;

        const proxy = async function stcrRelayFetch(input, init) {
            if (!settings.enabled) return originalFetch.call(win, input, init);

            let url = null;
            try {
                const raw = typeof input === 'string' ? input : ((input && (input.url || input.href)) || '');
                if (raw) url = resolveUrl(win, raw, topWin);
            } catch (error) { /* 忽略 */ }

            try {
                const selfOrigin = originOf(win, topWin);
                // origin 取不到时直接放行，避免误把同源请求送去中继
                if (!url || !selfOrigin || url.origin === selfOrigin || !/^https?:$/.test(url.protocol)) {
                    return originalFetch.call(win, input, init);
                }

                const method = readMethod(input, init);
                const path = normalizedPath(url);

                if (method === 'POST' && /\/chat\/completions$/i.test(path)) {
                    return await relay.relayChat(win, originalFetch, status, url, input, init, topWin);
                }
                if (method === 'GET' && /\/models$/i.test(path)) {
                    return await relay.relayModels(win, originalFetch, status, url, input, init, topWin);
                }

                const unsupported = matchUnsupported(path);
                if (unsupported && (method === 'POST' || method === 'PUT')) {
                    relay.flagUnsupported(unsupported, url);
                }
                return originalFetch.call(win, input, init);
            } catch (error) {
                status.failed += 1;
                status.lastError = String((error && error.message) || error);
                console.warn('[CORS中继] 回退直连：' + status.lastError);
                return originalFetch.call(win, input, init);
            }
        };

        proxy[PROXY_TAG] = true;
        proxy[PROXY_ORIGINAL] = originalFetch;
        return proxy;
    }

    function install(win, label) {
        try {
            if (!win || typeof win.fetch !== 'function') return false;

            const current = win.fetch;
            if (current && current[PROXY_TAG]) {
                const installed = String(win[WIN_KEYS.installed] || '');
                if (installed === VERSION) return true;
                if (versionRank(installed) > versionRank(VERSION)) return true; // 已装更高版本，不降级
            }

            const probe = canPatch(win);
            if (!probe.ok) {
                diag.blocked[label] = probe.reason;
                return false;
            }

            win.fetch = makeProxy(win, deriveBaseFetch(win, topWin));
            win[WIN_KEYS.installed] = VERSION;
            delete diag.blocked[label];
            diag.installed[label] = Date.now();
            console.info(`[CORS中继] 已接管网络请求 (${label}, v${VERSION})`);
            return true;
        } catch (error) {
            diag.blocked[label] = String((error && error.message) || error);
            return false;
        }
    }

    return { install };
}
