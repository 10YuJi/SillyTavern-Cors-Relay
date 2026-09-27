// CORS 跨域中继（酒馆扩展版）
// 把嵌入酒馆的 iframe 应用发往外部 LLM 的跨域请求，转交给酒馆后端通道执行，
// 绕过 WebView / iframe 的 CORS 限制。应用识别见 src/profiles.js。
//
// 本文件只做装配：探测宿主 -> 载入设置 -> 组装各模块 -> 启动扫描与面板。
// 具体实现见 src/ 下的各模块。

import { VERSION, WIN_KEYS, NOTIFY_THROTTLE_MS, WINDOW_FILTER_MODES } from './src/constants.js';
import { createPlatform } from './src/platform.js';
import { createSettingsStore } from './src/settings.js';
import { createDiagnostics } from './src/diagnostics.js';
import { createRelay } from './src/relay.js';
import { createPatcher } from './src/patcher.js';
import { createScanner } from './src/scanner.js';
import { mountPanel } from './src/ui.js';

function resolveTop() {
    try {
        return window.top || window;
    } catch (error) {
        return window;
    }
}

async function main() {
    const topWin = resolveTop();

    // 防止重复注入导致定时器与代理叠加
    if (topWin[WIN_KEYS.booted]) {
        console.info('[CORS中继] 检测到重复加载，跳过');
        return;
    }
    topWin[WIN_KEYS.booted] = VERSION;

    const platform = createPlatform(topWin);
    const store = createSettingsStore({ platform, win: topWin });
    await store.load();

    const settings = store.settings;
    const diagnostics = createDiagnostics({ topWin, settings });

    // 不可中继接口的提示按 30 秒节流，避免刷屏
    let lastUnsupportedAt = 0;
    const notify = (message, level) => {
        if (Date.now() - lastUnsupportedAt < NOTIFY_THROTTLE_MS) return;
        lastUnsupportedAt = Date.now();
        platform.notify(message, level);
    };

    const relay = createRelay({ platform, diag: diagnostics.state, notify });
    const patcher = createPatcher({ relay, settings, diag: diagnostics.state, topWin });
    const scanner = createScanner({ patcher, settings, diag: diagnostics.state, topWin });

    let blockedNotified = false;
    function maybeNotifyBlocked() {
        if (!settings.notifyBlocked || blockedNotified) return;
        const keys = Object.keys(diagnostics.state.blocked);
        if (!keys.length) return;
        blockedNotified = true;
        platform.notify(
            `CORS 跨域中继：有 ${keys.length} 个窗口因跨域限制无法接管（${keys.slice(0, 2).join('、')}）。这些窗口里的请求仍会被 CORS 拦截。`
        );
    }

    scanner.start();

    const panel = mountPanel({
        win: topWin,
        settings,
        diagnostics,
        actions: {
            onToggle: async (key, value) => {
                await store.update(key, value);
                if (key === 'enabled' && value) {
                    blockedNotified = false;
                    scanner.scan();
                }
            },
            onWindowFilter: async (key, value) => {
                if (key === 'windowFilterMode') {
                    if (!WINDOW_FILTER_MODES.includes(value)) return;
                } else if (key === 'windowFilterList') {
                    if (typeof value !== 'string') return;
                } else {
                    return;
                }
                await store.update(key, value);
                scanner.scan(); // 立即按新名单装/卸代理
                scanner.scheduleScan();
            },
            onRescan: () => {
                blockedNotified = false;
                diagnostics.state.blocked = {};
                diagnostics.state.filtered = {};
                scanner.scan();
            },
            onCopy: () => {
                const text = JSON.stringify(diagnostics.snapshot(), null, 2);
                try {
                    topWin.navigator.clipboard.writeText(text);
                    platform.notify('诊断信息已复制', 'success', 3000);
                } catch (error) {
                    console.info(text);
                }
            }
        }
    });

    platform.onAppReady(() => {
        scanner.scan();
        scanner.scheduleScan();
    });

    setTimeout(() => {
        scanner.scan();
        maybeNotifyBlocked();
        if (panel) panel.render();
    }, 1200);

    topWin.__stcrDiagnostics = () => diagnostics.snapshot();
    topWin.__stcrDiag = diagnostics.state;
}

main();
