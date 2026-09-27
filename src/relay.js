// 中继核心：把跨域的 /chat/completions 与 /models 请求改写后交给酒馆后端通道。
// 只负责"怎么发"，不关心"发给谁"（由 patcher 决定是否进入这里）。

import {
    CHAT_RELAY, MODELS_RELAY, RESERVED_FIELDS, UNSUPPORTED_INTERFACES, UNSUPPORTED_HINT,
    GEMINI_URL_HINT, SKIP_MODELS_HOSTS
} from './constants.js';
import {
    readBodyText, readHeaders, readSignal, buildIncludeHeaders,
    stripSuffix, isUsableResponse, expectPatternFor
} from './http.js';

// 判断请求路径是否属于无法中继的接口
export function matchUnsupported(path) {
    for (const item of UNSUPPORTED_INTERFACES) {
        if (item.re.test(path)) return item;
    }
    return null;
}

export function createRelay({ platform, diag, notify }) {
    // 依据是否已被宿主接管决定尝试顺序：先用宿主的通道，再退回本窗口直连
    function buildAttempts(win, originalFetch, path, init, topWin, absolute) {
        let topFetch = null;
        try {
            if (topWin && topWin !== win && typeof topWin.fetch === 'function') {
                topFetch = topWin.fetch.bind(topWin);
            }
        } catch (error) { topFetch = null; }

        const direct = () => originalFetch.call(win, path, init);
        const viaTop = topFetch ? () => topFetch(absolute, init) : null;

        // 宿主自带 patchedFetch 时说明它已接管路由，优先走本窗口
        let isHostPatched = false;
        try {
            isHostPatched = /patchedFetch/i.test(String(originalFetch));
        } catch (error) { /* 忽略 */ }

        const attempts = [];
        if (isHostPatched) {
            attempts.push(direct);
            if (viaTop) attempts.push(viaTop);
        } else {
            if (viaTop) attempts.push(viaTop);
            attempts.push(direct);
        }
        return attempts;
    }

    async function relayFetch(win, originalFetch, path, init, kind, topWin) {
        let absolute = path;
        try {
            if (typeof win.URL === 'function') absolute = new win.URL(path, String(topWin.location.href)).href;
        } catch (error) { /* 保持相对路径 */ }

        const attempts = buildAttempts(win, originalFetch, path, init, topWin, absolute);
        const expect = expectPatternFor(kind);
        let lastError = null;

        for (const attempt of attempts) {
            let res = null;
            try {
                res = await attempt();
            } catch (error) {
                lastError = error;
                continue;
            }
            const verdict = isUsableResponse(res, expect);
            if (verdict.ok) return res;
            lastError = new Error(`relay unavailable: ${verdict.why}`);
        }
        throw lastError || new Error('relay unavailable');
    }

    // 对话请求：解析 body -> 构造通道 DTO -> 发送 -> 原样返回
    async function relayChat(win, originalFetch, status, url, input, init, topWin) {
        const bodyText = await readBodyText(win, input, init);
        if (bodyText == null) return originalFetch.call(win, input, init);

        let body = null;
        try {
            body = JSON.parse(bodyText);
        } catch (error) {
            return originalFetch.call(win, input, init);
        }
        if (!body || typeof body !== 'object') return originalFetch.call(win, input, init);

        const dto = {
            chat_completion_source: 'custom',
            custom_url: stripSuffix(url.href, '/chat/completions'),
            model: typeof body.model === 'string' ? body.model : '',
            custom_model: typeof body.model === 'string' ? body.model : '',
            messages: Array.isArray(body.messages) ? body.messages : [],
            stream: Boolean(body.stream)
        };

        const include = buildIncludeHeaders(win, readHeaders(input, init));
        if (include) dto.custom_include_headers = include;

        // 除保留字段外全部透传，保证应用自定义 body 参数不丢失
        for (const key of Object.keys(body)) {
            if (!RESERVED_FIELDS.has(key)) dto[key] = body[key];
        }

        const headers = Object.assign({ 'Content-Type': 'application/json' }, await platform.authHeaders());
        const res = await relayFetch(win, originalFetch, CHAT_RELAY, {
            method: 'POST',
            headers,
            body: JSON.stringify(dto),
            signal: readSignal(input, init)
        }, 'chat', topWin);

        status.relayed += 1;
        status.lastRelayAt = Date.now();
        return res;
    }

    // 模型列表：走 status 通道，再整形为 OpenAI 的 { object, data }
    async function relayModels(win, originalFetch, status, url, input, init, topWin) {
        // Gemini 与 OpenAI 的 /models 不兼容，交还应用自带的分页逻辑
        if (SKIP_MODELS_HOSTS.includes(url.hostname) || GEMINI_URL_HINT.test(url.href)) {
            return originalFetch.call(win, input, init);
        }

        const dto = {
            chat_completion_source: 'custom',
            custom_url: stripSuffix(url.href, '/models')
        };
        const include = buildIncludeHeaders(win, readHeaders(input, init));
        if (include) dto.custom_include_headers = include;

        const headers = Object.assign({ 'Content-Type': 'application/json' }, await platform.authHeaders());
        const res = await relayFetch(win, originalFetch, MODELS_RELAY, {
            method: 'POST',
            headers,
            body: JSON.stringify(dto),
            signal: readSignal(input, init)
        }, 'models', topWin);

        let payload = null;
        try {
            payload = await res.json();
        } catch (error) { /* 忽略 */ }

        let models = [];
        if (payload && Array.isArray(payload.data)) models = payload.data;
        else if (payload && Array.isArray(payload.models)) models = payload.models;

        status.relayed += 1;
        status.lastRelayAt = Date.now();
        return new win.Response(JSON.stringify({ object: 'list', data: models }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 命中不可中继接口时明确告知，而不是静默回退到必然失败的直连
    function flagUnsupported(item, url) {
        diag.unsupported[item.name] = url.hostname;
        notify(
            `检测到「${item.name}」接口调用（${url.hostname}），该接口无法经由酒馆通道中继。${UNSUPPORTED_HINT}。`,
            'warning'
        );
    }

    return { relayChat, relayModels, flagUnsupported };
}
