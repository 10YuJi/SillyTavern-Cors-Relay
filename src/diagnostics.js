// 诊断与统计：汇总各窗口的中继计数，输出可复制的排查快照。

import { VERSION, WIN_KEYS, MAX_STATUS_WALK } from './constants.js';
import { PROFILES } from './profiles.js';

function readGlobal(win, key) {
    try {
        return win[key];
    } catch (error) {
        return undefined;
    }
}

export function createDiagnostics({ topWin, settings }) {
    const state = {
        version: VERSION,
        installed: {},
        blocked: {},
        unsupported: {},
        startedAt: Date.now(),
        relayed: 0,
        failed: 0,
        lastError: ''
    };

    // 遍历窗口树累加各代理实例的计数
    function collect() {
        let relayed = 0;
        let failed = 0;
        let lastError = '';
        const seen = new Set();

        const walk = win => {
            try {
                if (seen.has(win) || seen.size >= MAX_STATUS_WALK) return;
                seen.add(win);
                const status = win[WIN_KEYS.status];
                if (status) {
                    relayed += status.relayed || 0;
                    failed += status.failed || 0;
                    if (status.lastError) lastError = status.lastError;
                }
                const doc = win.document;
                if (!doc || !doc.querySelectorAll) return;
                for (const frame of doc.querySelectorAll('iframe')) {
                    let sub = null;
                    try {
                        sub = frame.contentWindow;
                    } catch (error) { sub = null; }
                    if (sub) walk(sub);
                }
            } catch (error) { /* 忽略 */ }
        };
        walk(topWin);

        state.relayed = relayed;
        state.failed = failed;
        state.lastError = lastError;
        return { relayed, failed, lastError };
    }

    // 各内置场景的运行时标记是否已从顶层窗口可见（确认应用已加载）
    function scenarios() {
        return PROFILES.map(profile => ({
            id: profile.id,
            label: profile.label,
            marksVisible: (profile.topMarks || []).some(key => Boolean(readGlobal(topWin, key)))
        }));
    }

    function snapshot() {
        collect();
        return {
            version: VERSION,
            settings: Object.assign({}, settings),
            userAgent: String(topWin.navigator && topWin.navigator.userAgent || ''),
            topOrigin: (() => {
                try {
                    return topWin.location.origin;
                } catch (error) {
                    return 'unknown';
                }
            })(),
            hasTauriAbi: Boolean(readGlobal(topWin, '__TAURITAVERN__')),
            tauriAbiKeys: (() => {
                try {
                    return Object.keys(readGlobal(topWin, '__TAURITAVERN__') || {});
                } catch (error) {
                    return [];
                }
            })(),
            scenarios: scenarios(),
            installedTargets: state.installed,
            blockedTargets: state.blocked,
            unsupportedInterfaces: state.unsupported,
            relayed: state.relayed,
            failed: state.failed,
            lastError: state.lastError,
            uptimeMs: Date.now() - state.startedAt
        };
    }

    return { state, collect, scenarios, snapshot };
}
