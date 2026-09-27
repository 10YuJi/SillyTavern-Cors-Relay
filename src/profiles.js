// 场景档案：描述「哪些窗口属于某个应用」。
// 中继、扫描、安装等核心逻辑完全通用，不包含任何应用专用代码；
// 要支持新应用，在 PROFILES 里追加一个档案对象即可。
//
// 字段说明：
// - id           档案标识（诊断输出用）
// - label        显示名（面板与日志）
// - windowMarks  应用写入 window 的真实全局标记键，比猜测 iframe 特征可靠
//                self   ：命中窗口自身携带的键
//                parent ：命中窗口的父窗口（宿主帧）携带的键
// - frame        iframe 元素特征
//                selector       ：frame.matches() 直接匹配的选择器
//                ancestors      ：frame.closest() 命中的容器选择器
//                idPatterns     ：iframe id 的正则列表
//                srcPatterns    ：iframe src 属性的正则列表
//                srcdocPatterns ：iframe srcdoc 内容的正则列表
// - doc          窗口文档特征
//                titlePatterns    ：document.title 的正则列表
//                elementSelectors ：document.querySelector 能命中的元素选择器列表
// - topMarks     从顶层窗口可见的运行时标记键（用于诊断快照确认应用已加载）

export const PROFILES = [
    {
        id: 'dream-creator',
        label: '梦境创客',
        // 标记来源：deepsleep-claw/SleepTavernHome（src/酒馆助手/梦境创客）
        windowMarks: {
            self: ['__dream_creator_client_host__', '__dream_creator_client_environment__'],
            parent: ['__dream_card_agent_host_runtime_v1__']
        },
        frame: {
            selector: 'iframe.dca-floating-body-frame, iframe[title="梦境创客工作台"], iframe[title*="梦境创客"]',
            ancestors: '#dream-creator-drawer-content, #dream-card-agent-window, #dream_creator, .dream-creator',
            idPatterns: [
                /^TH-script--梦境创客--/,
                /867bc417-c9a0-47f5-aadf-36daada71430/,
                /dream[-_ ]?creator/i
            ],
            srcPatterns: [/dream[-_ ]?creator/i],
            srcdocPatterns: [/__dream_creator_client_/u, /dream[-_ ]?creator/i]
        },
        doc: {
            titlePatterns: [/^梦境创客(工作台)?$/, /dream[-_ ]?creator/i],
            elementSelectors: ['#dca-client-loading', '.dca-app', '.dca-floating-window']
        },
        topMarks: ['__dream_card_agent_host_runtime_v1__', '__dream_creator_client_host__']
    }
];
