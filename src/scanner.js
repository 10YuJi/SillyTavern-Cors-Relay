// 扫描调度：遍历 iframe 树安装代理，并监听后续动态插入的窗口。
// 所有定时器统一登记，便于整体停止。

import { SCAN_INTERVAL_MS, VERSION, WIN_KEYS } from './constants.js';
import { shouldPatch, isSandboxIsolated, frameLabel } from './targets.js';

export function createScanner({ patcher, settings, topWin }) {
    const timers = [];
    const intervals = [];
    const observers = [];

    function scanFramesIn(doc, depth, rootLabel) {
        if (!doc || !doc.querySelectorAll || depth < 0) return;
        const frames = doc.querySelectorAll('iframe');
        for (const frame of frames) {
            if (isSandboxIsolated(frame)) continue; // origin 为 null，永远无法接管
            let win = null;
            try {
                win = frame.contentWindow;
            } catch (error) { win = null; }
            if (!win) continue;

            const label = rootLabel ? `${rootLabel} > ${frameLabel(frame)}` : frameLabel(frame);
            if (!shouldPatch(win, frame, settings)) continue;

            patcher.install(win, label);

            // 广谱模式下限制递归深度，避免遍历整棵 iframe 树
            const nextDepth = settings.broadPatch ? Math.min(depth - 1, 1) : depth - 1;
            if (nextDepth >= 0) {
                let subDoc = null;
                try {
                    subDoc = win.document;
                } catch (error) { subDoc = null; }
                if (subDoc) scanFramesIn(subDoc, nextDepth, label);
            }
        }
    }

    function scanWindowDeep(win, label) {
        if (!win) return;
        try {
            if (shouldPatch(win, null, settings)) patcher.install(win, label || 'window');
        } catch (error) { /* 忽略 */ }
        let doc = null;
        try {
            doc = win.document;
        } catch (error) { doc = null; }
        if (doc) scanFramesIn(doc, 3, label || 'window');
    }

    function scan() {
        if (settings.patchTop) patcher.install(topWin, '主窗口');
        let doc = null;
        try {
            doc = topWin.document;
        } catch (error) { return; }
        if (!doc) return;
        scanFramesIn(doc, settings.deepScan ? 3 : 2, '主窗口');
    }

    let scheduled = false;
    function scheduleScan() {
        if (scheduled) return;
        scheduled = true;
        const id = setTimeout(() => {
            scheduled = false;
            scan();
        }, 300);
        timers.push(id);
    }

    // 独立窗口：部分应用在 open 返回后立刻 document.write，先扫一次避免错过首屏
    function hookOpen() {
        try {
            if (!topWin || topWin[WIN_KEYS.openHooked] || typeof topWin.open !== 'function') return;
            const previous = topWin.open;
            topWin.open = function () {
                const opened = previous.apply(this, arguments);
                if (!opened) return opened;
                try {
                    scanWindowDeep(opened, '弹出窗口');
                } catch (error) { /* 忽略 */ }
                let tries = 0;
                const timer = setInterval(() => {
                    tries += 1;
                    try {
                        if (opened.closed) {
                            clearInterval(timer);
                            return;
                        }
                    } catch (error) { /* 忽略 */ }
                    try {
                        scanWindowDeep(opened, '弹出窗口');
                    } catch (error) { /* 忽略 */ }
                    if (tries > 40) clearInterval(timer);
                }, SCAN_INTERVAL_MS);
                intervals.push(timer);
                return opened;
            };
            topWin[WIN_KEYS.openHooked] = true;
        } catch (error) { /* 忽略 */ }
    }

    function watchMutations(doc) {
        try {
            if (!doc || typeof MutationObserver !== 'function') return;
            const observer = new MutationObserver(records => {
                let sawIframe = false;
                try {
                    for (const record of records) {
                        for (const node of record.addedNodes || []) {
                            if (!node || node.nodeType !== 1) continue;
                            if (node.tagName === 'IFRAME' || (node.querySelector && node.querySelector('iframe'))) {
                                sawIframe = true;
                                break;
                            }
                        }
                        if (sawIframe) break;
                    }
                } catch (error) { /* 忽略 */ }
                if (sawIframe) scan();
                else scheduleScan();
            });
            observer.observe(doc.documentElement, { childList: true, subtree: true });
            observers.push(observer);
        } catch (error) {
            console.warn('[CORS中继] MutationObserver 注册失败', error);
        }
    }

    function bindEvents(doc) {
        const safe = (target, type, handler, options) => {
            try {
                target.addEventListener(type, handler, options);
            } catch (error) { /* 忽略 */ }
        };
        if (doc) {
            safe(doc, 'load', evt => {
                if (evt && evt.target && evt.target.tagName === 'IFRAME') {
                    scan();
                    scheduleScan();
                }
            }, true);
            safe(doc, 'visibilitychange', () => {
                scan();
                scheduleScan();
            });
        }
        safe(topWin, 'focus', () => scheduleScan());
        safe(topWin, 'pageshow', () => {
            scan();
            scheduleScan();
        });
    }

    function start() {
        // 先注册常驻轮询，确保后续钩子失败也不至于整体失效
        intervals.push(setInterval(scan, SCAN_INTERVAL_MS));
        scan();
        hookOpen();

        let doc = null;
        try {
            doc = topWin.document;
        } catch (error) { doc = null; }
        watchMutations(doc);
        bindEvents(doc);
        console.info(`[CORS中继] 已启动 v${VERSION}`);
    }

    function stop() {
        timers.forEach(clearTimeout);
        intervals.forEach(clearInterval);
        observers.forEach(observer => {
            try {
                observer.disconnect();
            } catch (error) { /* 忽略 */ }
        });
    }

    return { start, stop, scan, scanWindowDeep, scheduleScan, intervals };
}
