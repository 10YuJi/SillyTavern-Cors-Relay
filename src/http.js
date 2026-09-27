// fetch 入参解析：URL、方法、请求头、body、signal。
// fetch 的入参形态多样（字符串 / URL / Request / init 对象），这里统一成可读结构。

import { AUTH_HEADER_NAMES } from './constants.js';

export function originOf(win, fallbackWin) {
    try {
        const origin = String((win.location && win.location.origin) || '');
        if (origin && origin !== 'null') return origin;
    } catch (error) { /* 跨域，尝试兜底窗口 */ }
    try {
        const fallback = String((fallbackWin.location && fallbackWin.location.origin) || '');
        if (fallback && fallback !== 'null') return fallback;
    } catch (error) { /* 忽略 */ }
    return '';
}

export function resolveUrl(win, raw, fallbackWin) {
    try {
        return new win.URL(raw);
    } catch (error) { /* 相对地址，需要基准 */ }
    const origin = originOf(win, fallbackWin);
    if (!origin) return null;
    try {
        return new win.URL(raw, origin + '/');
    } catch (error) {
        return null;
    }
}

export function readMethod(input, init) {
    const method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
    return String(method).toUpperCase();
}

export function readSignal(input, init) {
    if (init && init.signal) return init.signal;
    if (input && typeof input === 'object' && input.signal) return input.signal;
    return undefined;
}

export function readHeaders(input, init) {
    if (init && init.headers) return init.headers;
    if (input && typeof input === 'object' && input.headers) return input.headers;
    return null;
}

export async function readBodyText(win, input, init) {
    // Request 对象优先：clone 后再读，避免消费掉原始流
    try {
        if (input && typeof input === 'object' && typeof input.clone === 'function' && typeof input.text === 'function') {
            return await input.clone().text();
        }
    } catch (error) { /* 已消费，回退到 init.body */ }

    const body = init ? init.body : null;
    if (body == null) return null;
    if (typeof body === 'string') return body;

    try {
        if (body instanceof win.ArrayBuffer) return new win.TextDecoder().decode(new Uint8Array(body));
        if (win.ArrayBuffer.isView(body)) return new win.TextDecoder().decode(body);
    } catch (error) { /* 忽略 */ }
    try {
        if (typeof body.text === 'function') return await body.text();
    } catch (error) { /* 忽略 */ }
    return null;
}

// 只转发鉴权相关请求头：Authorization / api-key / x-api-key / x-*
export function buildIncludeHeaders(win, headers) {
    const lines = [];
    try {
        const parsed = headers instanceof win.Headers ? headers : new win.Headers(headers || {});
        parsed.forEach((value, key) => {
            const name = String(key || '').toLowerCase();
            if (!name) return;
            const isAuth = AUTH_HEADER_NAMES.includes(name) || name.startsWith('x-');
            if (isAuth) lines.push(`${key}: ${value}`);
        });
    } catch (error) { /* 忽略 */ }
    return lines.join('\n');
}

// 去掉路径尾缀，拿到 API 根地址（https://x/v1/chat/completions -> https://x/v1）
export function stripSuffix(href, suffix) {
    let end = href.length;
    const query = href.indexOf('?');
    if (query >= 0) end = Math.min(end, query);
    const hash = href.indexOf('#');
    if (hash >= 0) end = Math.min(end, hash);

    let base = href.slice(0, end).replace(/\/+$/, '');
    if (base.length >= suffix.length && base.slice(-suffix.length).toLowerCase() === suffix.toLowerCase()) {
        base = base.slice(0, -suffix.length).replace(/\/+$/, '');
    }
    return base;
}

export function normalizedPath(url) {
    return url.pathname.replace(/\/+$/, '');
}

// 判定响应是否可用：既看 HTTP 状态码也看 content-type，
// 避免把 401/500 的错误 JSON 当成中继成功。
export function isUsableResponse(res, expectPattern) {
    try {
        const contentType = String((res.headers && res.headers.get('content-type')) || '').toLowerCase();
        if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
        if (!expectPattern.test(contentType)) {
            return { ok: false, why: `unexpected content-type: ${contentType || 'unknown'}` };
        }
        return { ok: true };
    } catch (error) {
        return { ok: false, why: String((error && error.message) || error) };
    }
}

export function expectPatternFor(kind) {
    return kind === 'chat' ? /(json|event-stream)/i : /json/i;
}
