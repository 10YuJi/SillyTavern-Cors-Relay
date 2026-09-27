// 设置读写：优先存进酒馆的 extension_settings，失败时降级到 localStorage。

import { DEFAULT_SETTINGS, SETTINGS_KEY, LOCAL_STORAGE_KEY } from './constants.js';

export function createSettingsStore({ platform, win }) {
    const settings = Object.assign({}, DEFAULT_SETTINGS);

    async function load() {
        const holder = await platform.settingsHolder();
        if (holder) {
            try {
                if (!holder[SETTINGS_KEY]) holder[SETTINGS_KEY] = {};
                Object.assign(settings, DEFAULT_SETTINGS, holder[SETTINGS_KEY]);
                return settings;
            } catch (error) { /* 落到 localStorage */ }
        }
        try {
            const raw = win.localStorage.getItem(LOCAL_STORAGE_KEY);
            if (raw) Object.assign(settings, DEFAULT_SETTINGS, JSON.parse(raw));
        } catch (error) { /* 忽略 */ }
        return settings;
    }

    async function save() {
        const holder = await platform.settingsHolder();
        if (holder) {
            holder[SETTINGS_KEY] = Object.assign({}, settings);
            if (await platform.saveSettings()) return;
        }
        try {
            win.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
        } catch (error) { /* 忽略 */ }
    }

    async function update(key, value) {
        settings[key] = value;
        await save();
    }

    return { settings, load, save, update };
}
