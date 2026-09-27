// 扩展面板：与其他酒馆扩展一致的 inline-drawer 折叠结构。
// 折叠状态下头部仍显示一行状态徽标，便于不开面板也能看到是否在工作。

import { VERSION, EXT_TITLE, STATUS_INTERVAL_MS } from './constants.js';
import { PROFILES } from './profiles.js';

const TOGGLES = [
    { key: 'enabled', id: 'stcr-relay-enabled', label: '启用中继' },
    { key: 'patchTop', id: 'stcr-relay-patchtop', label: '接管主窗口自身' },
    { key: 'broadPatch', id: 'stcr-relay-broad', label: '广谱接管所有同源帧' },
    { key: 'deepScan', id: 'stcr-relay-deep', label: '深度扫描嵌套 iframe' },
    { key: 'notifyBlocked', id: 'stcr-relay-notify', label: '无法接管时提示' }
];

function template() {
    const checkboxes = TOGGLES.map(item => `
                <label class="checkbox_label">
                    <input type="checkbox" id="${item.id}">
                    <span>${item.label}</span>
                </label>`).join('');

    return `
    <div class="inline-drawer" id="stcr-relay-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>${EXT_TITLE} <small class="stcr-relay-ver">v${VERSION}</small></b>
            <span class="stcr-relay-badge" id="stcr-relay-badge">—</span>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div>
        </div>
        <div class="inline-drawer-content">
            ${checkboxes}
            <div class="stcr-relay-hint">仅 OpenAI 兼容（聊天补全）接口可中继；Responses / Anthropic / Gemini 请在应用内切换接口类型。</div>
            <div class="stcr-relay-status" id="stcr-relay-status">—</div>
            <div class="stcr-relay-actions">
                <div class="menu_button" id="stcr-relay-copy">复制诊断信息</div>
                <div class="menu_button" id="stcr-relay-scan">立即重新扫描</div>
            </div>
        </div>
    </div>`;
}

export function mountPanel({ win, settings, diagnostics, actions }) {
    const $ = win.jQuery;
    if (!$ || typeof $ !== 'function') return null;

    const host = $('#extensions_settings');
    if (!host.length) return null;

    const $drawer = $(template());
    host.append($drawer);

    const $content = $drawer.find('.inline-drawer-content');
    const $icon = $drawer.find('.inline-drawer-icon');
    const $badge = $drawer.find('#stcr-relay-badge');
    const $status = $drawer.find('#stcr-relay-status');

    // 默认折叠，与其他扩展一致
    $content.hide();
    let open = false;

    // 自行实现折叠：既不依赖宿主是否注册了全局委托，也不会与它冲突。
    // 展开状态用内部变量记录，避免依赖 :visible 的布局计算。
    $drawer.find('.inline-drawer-toggle').on('click', function (event) {
        try {
            event.stopPropagation();
            event.stopImmediatePropagation();
        } catch (error) { /* 忽略 */ }
        open = !open;
        $content.stop().slideToggle(200);
        $icon.toggleClass('down', open);
    });

    for (const item of TOGGLES) {
        $drawer.find(`#${item.id}`)
            .prop('checked', Boolean(settings[item.key]))
            .on('change', function () {
                actions.onToggle(item.key, $(this).prop('checked'));
            });
    }

    $drawer.find('#stcr-relay-scan').on('click', () => actions.onRescan());
    $drawer.find('#stcr-relay-copy').on('click', () => actions.onCopy());

    function render() {
        try {
            const stats = diagnostics.collect();
            const installed = Object.keys(diagnostics.state.installed).length;
            const blocked = Object.keys(diagnostics.state.blocked);
            const unsupported = Object.keys(diagnostics.state.unsupported || {});
            const scenarios = diagnostics.scenarios();

            let badge = settings.enabled ? `接管 ${installed} · 中转 ${stats.relayed}` : '已停用';
            if (stats.failed) badge += ` · 失败 ${stats.failed}`;
            $badge.text(badge);
            $badge.toggleClass('stcr-relay-badge-warn', Boolean(stats.failed || blocked.length));

            const parts = [`开关：${settings.enabled ? '开' : '关'}`
                , `已接管窗口：${installed}`
                , `已中转：${stats.relayed}`
                , `失败：${stats.failed}`];
            if (blocked.length) parts.push(`跨域未接管：${blocked.length}`);
            if (unsupported.length) parts.push(`不支持的接口：${unsupported.join('、')}`);
            if (stats.lastError) parts.push(`最近错误：${stats.lastError.slice(0, 60)}`);
            $status.text(parts.join(' ｜ '));

            if (PROFILES.length > 1) {
                // 场景 >1 时才单列展示，避免单一场景占位
                const seen = scenarios.map(s => `${s.label} ${s.marksVisible ? '✓' : '—'}`).join(' ｜ ');
                $status.text($status.text() + `\n场景：${seen}`);
            }
        } catch (error) { /* 忽略 */ }
    }

    const timer = setInterval(render, STATUS_INTERVAL_MS);
    render();

    return { render, timer };
}
