// 与酒馆宿主对接：定位核心模块、取鉴权头、发通知。
// 拿不到时全部降级为无害默认值，不因探测失败中断中继。

import { CORE_PATHS, EXT_PATHS } from './constants.js';

async function importFirst(paths, accept) {
    for (const path of paths) {
        try {
            const mod = await import(/* webpackIgnore: true */ path);
            if (mod && accept(mod)) return mod;
        } catch (error) {
            // 路径不存在或不可达，换下一个候选
        }
    }
    return null;
}

export function createPlatform(win) {
    let corePromise = null;
    let extPromise = null;

    const core = () => {
        if (!corePromise) {
            corePromise = importFirst(CORE_PATHS, mod => (
                typeof mod.getCsrfToken === 'function' ||
                typeof mod.getRequestHeaders === 'function' ||
                typeof mod.saveSettingsDebounced === 'function'
            ));
        }
        return corePromise;
    };

    const extensions = () => {
        if (!extPromise) {
            extPromise = importFirst(EXT_PATHS, mod => mod && mod.extension_settings);
        }
        return extPromise;
    };

    function csrfFromCookie() {
        try {
            const match = win.document.cookie.match(/(?:^|;\s*)csrfToken=([^;]+)/i);
            return match ? decodeURIComponent(match[1]) : '';
        } catch (error) {
            return '';
        }
    }

    // 酒馆若开启访问控制 / 反向代理，中继请求必须带上同样的凭据
    async function authHeaders() {
        const headers = {};
        const mod = await core();
        let token = '';
        try {
            if (mod && typeof mod.getCsrfToken === 'function') token = mod.getCsrfToken() || '';
        } catch (error) { /* 忽略 */ }
        if (!token) token = csrfFromCookie();
        if (token) headers['X-CSRF-Token'] = token;
        try {
            if (mod && typeof mod.getRequestHeaders === 'function') {
                Object.assign(headers, mod.getRequestHeaders() || {});
            }
        } catch (error) { /* 忽略 */ }
        return headers;
    }

    function notify(message, level = 'warning', timeOut = 10000) {
        try {
            const toastr = win.toastr;
            if (toastr && typeof toastr[level] === 'function') {
                toastr[level](message, '', { timeOut, extendedTimeOut: 6000 });
                return;
            }
        } catch (error) { /* 落到 console */ }
        console.warn('[CORS中继]', message);
    }

    async function saveSettings() {
        try {
            const mod = await core();
            if (mod && typeof mod.saveSettingsDebounced === 'function') {
                mod.saveSettingsDebounced();
                return true;
            }
        } catch (error) { /* 落到 localStorage */ }
        return false;
    }

    // 扩展设置容器：优先用模块导出，其次全局，都没有则交给 localStorage
    async function settingsHolder() {
        const mod = await extensions();
        if (mod && mod.extension_settings && typeof mod.extension_settings === 'object') {
            return mod.extension_settings;
        }
        try {
            if (win.extension_settings && typeof win.extension_settings === 'object') {
                return win.extension_settings;
            }
        } catch (error) { /* 忽略 */ }
        return null;
    }

    // SillyTavern 初始化完成后补扫一次，确保晚加载的应用也能被接管
    async function onAppReady(handler) {
        try {
            const mod = await core();
            if (!mod || !mod.eventSource || !mod.event_types) return;
            if (typeof mod.eventSource.on !== 'function') return;
            const evt = mod.event_types.APP_READY || 'app_ready';
            mod.eventSource.on(evt, handler);
        } catch (error) { /* 忽略 */ }
    }

    return { authHeaders, notify, saveSettings, settingsHolder, onAppReady };
}
