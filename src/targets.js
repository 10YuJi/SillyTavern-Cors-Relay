// 目标窗口识别：判断某个 iframe / window 是否需要装代理。
// 识别依据全部来自 src/profiles.js 的场景档案；广谱兜底不依赖档案。

import { PROFILES } from './profiles.js';

function readGlobal(win, key) {
    try {
        return win[key];
    } catch (error) {
        return undefined;
    }
}

function matchAny(patterns, value) {
    for (const re of patterns) {
        try {
            if (re.test(value)) return true;
        } catch (error) { /* 忽略非法正则 */ }
    }
    return false;
}

// 命中某个档案时返回该档案，否则返回 null。
// 优先级：window 全局标记 > iframe 元素特征 > 文档特征。
export function identify(win, frame) {
    for (const profile of PROFILES) {
        try {
            const marks = profile.windowMarks || {};
            for (const key of marks.self || []) {
                if (readGlobal(win, key)) return profile;
            }
            if (marks.parent && win.parent && win.parent !== win) {
                for (const key of marks.parent) {
                    if (readGlobal(win.parent, key)) return profile;
                }
            }

            const f = profile.frame || {};
            if (frame && frame.getAttribute) {
                if (f.selector && frame.matches && frame.matches(f.selector)) return profile;
                if (f.ancestors && frame.closest && frame.closest(f.ancestors)) return profile;
                const id = String(frame.id || '');
                if (id && matchAny(f.idPatterns || [], id)) return profile;
                const srcdoc = String(frame.getAttribute('srcdoc') || '');
                if (srcdoc && matchAny(f.srcdocPatterns || [], srcdoc)) return profile;
                const src = String(frame.getAttribute('src') || '');
                if (src && matchAny(f.srcPatterns || [], src)) return profile;
            }

            const doc = win.document;
            if (doc) {
                const d = profile.doc || {};
                const title = String(doc.title || '');
                if (title && matchAny(d.titlePatterns || [], title)) return profile;
                if (d.elementSelectors && d.elementSelectors.length && doc.querySelector) {
                    if (doc.querySelector(d.elementSelectors.join(', '))) return profile;
                }
            }
        } catch (error) { /* 跨域读取会抛错，继续下一个档案 */ }
    }
    return null;
}

// sandbox 且未开 allow-same-origin 的帧 origin 为 null，永远无法接管，直接跳过
export function isSandboxIsolated(frame) {
    try {
        if (!frame || !frame.hasAttribute) return false;
        if (!frame.hasAttribute('sandbox')) return false;
        const value = String(frame.getAttribute('sandbox') || '');
        return !/\ballow-same-origin\b/i.test(value);
    } catch (error) {
        return false;
    }
}

export function frameLabel(frame) {
    try {
        const id = String((frame && frame.id) || '');
        const title = frame && frame.getAttribute ? String(frame.getAttribute('title') || '') : '';
        if (id) return id;
        if (title) return title;
        if (frame && frame.src) return String(frame.src).slice(0, 80);
        return 'iframe';
    } catch (error) {
        return 'iframe';
    }
}

// 是否需要接管：档案命中优先；未命中时由广谱设置兜底
export function shouldPatch(win, frame, settings) {
    if (identify(win, frame)) return true;
    return Boolean(settings.broadPatch);
}
