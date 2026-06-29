/**
 * Lightweight i18n dictionaries for PTerminal.
 *
 * No third-party library: a flat object keyed by dotted names, plus a pure
 * `translate(locale, key, params?)` function used both from React (via the
 * I18nProvider context) and from non-component code (e.g. the Zustand store,
 * which can't use hooks). Placeholders use `{name}` and are replaced with the
 * matching value from `params`.
 */

export type Locale = 'en' | 'zh-CN';

/** Languages offered in the picker. `value: null` means "follow the system". */
export interface LanguageOption {
  value: Locale | null;
  label: { en: string; 'zh-CN': string };
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: null, label: { en: 'Follow system', 'zh-CN': '跟随系统' } },
  { value: 'en', label: { en: 'English', 'zh-CN': 'English' } },
  { value: 'zh-CN', label: { en: '简体中文', 'zh-CN': '简体中文' } },
];

/**
 * Resolve the interface language from the OS/browser. Anything starting with
 * `zh` → Simplified Chinese, otherwise English (the fallback).
 */
export function detectSystemLocale(): Locale {
  const lang =
    (typeof navigator !== 'undefined' && (navigator.language || navigator.languages?.[0])) || 'en';
  return lang.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

/** Resolve the effective locale: the user's explicit choice wins, else detect. */
export function resolveLocale(userChoice: Locale | null | undefined): Locale {
  return userChoice ?? detectSystemLocale();
}

/** The translation dictionaries. Both must keep the same set of keys. */
export const translations = {
  en: {
    // ---- common ----
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.add': 'Add',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.new': 'New',
    'common.settings': 'Settings',
    'common.pinned': 'Pinned',
    'common.others': 'Others',

    // ---- top bar ----
    'topbar.noTerminalSelected': 'No Terminal Selected',
    'topbar.hideSidebar': 'Hide sidebar',
    'topbar.showSidebar': 'Show sidebar',
    'topbar.autocompleteOn': 'Terminal completion: on (click to turn off)',
    'topbar.autocompleteOff': 'Terminal completion: off (click to turn on)',
    'topbar.zoomOut': 'Decrease terminal font size',
    'topbar.zoomTooltip': 'Zoom {pct}% (click to reset to 100%)',
    'topbar.zoomIn': 'Increase terminal font size',
    'topbar.toLight': 'Switch to light theme',
    'topbar.toDark': 'Switch to dark theme',
    'topbar.hideAssistant': 'Hide assistant panel',
    'topbar.showAssistant': 'Show assistant panel',
    'topbar.backToTerminal': 'Back to terminal',

    // ---- left panel ----
    'leftPanel.terminals': 'Terminal list',
    'leftPanel.newTerminal': 'New Terminal',
    'leftPanel.empty': 'No terminals yet.',
    'leftPanel.emptyHint': 'Click + or press ⌘N to create one.',
    'leftPanel.pinned': 'Pinned',
    'leftPanel.deleteTerminal': 'Delete terminal',
    'leftPanel.unpin': 'Unpin',
    'leftPanel.pin': 'Pin',
    'leftPanel.rename': 'Rename',

    // ---- center panel ----
    'center.noActiveTerminal': 'No active terminal',
    'center.createOrSelect': 'Create or select a terminal from the left panel',

    // ---- right panel ----
    'right.commandsTab': 'Commands',
    'right.aiTab': 'AI Assistant',
    'right.selectTerminal': 'Select a terminal to view its commands.',

    // ---- terminal search bar ----
    'search.placeholder': 'Search terminal content',
    'search.noResults': 'No results',
    'search.previous': 'Previous (Shift+Enter)',
    'search.next': 'Next (Enter)',
    'search.close': 'Close (Esc)',

    // ---- terminal autocomplete hint ----
    'autocomplete.hint': '↑↓ Select · Tab Confirm · Esc Close',

    // ---- AI chat ----
    'ai.selectTerminal': 'Select a terminal to start chatting.',
    'ai.empty': 'Ask anything about your terminal work — paste an error, request a command, or get an explanation.',
    'ai.placeholder': 'Ask the assistant…  (Shift+Enter for newline)',
    'ai.clearConversation': 'Clear conversation',
    'ai.stopGenerating': 'Stop generating',
    'ai.send': 'Send',
    'ai.run': 'Run',
    'ai.truncated': 'Showing only the latest {shown} messages; {hidden} earlier messages are not loaded.',

    // ---- common commands ----
    'commands.title': 'Common Commands',
    'commands.add': 'Add command',
    'commands.selectTerminal': 'Select a terminal to manage its commands.',
    'commands.empty': 'No saved commands. Click + to add one.',
    'commands.insertRunTooltip': 'Single-click: insert  |  Double-click: run\n{command}',
    'commands.unpin': 'Unpin',
    'commands.pinToTop': 'Pin to top',
    'commands.runNow': 'Run now',
    'commands.labelPlaceholder': 'Label (e.g. List files)',
    'commands.commandPlaceholder': 'Command (e.g. ls -la)',

    // ---- ssh ----
    'ssh.title': 'SSH',
    'ssh.empty': 'No SSH shortcuts.',
    'ssh.connectTo': 'Connect to {host}',

    // ---- workspaces (folder groupings in the left sidebar) ----
    'workspaces.title': 'Workspaces',
    'workspaces.empty': 'No workspaces.',
    'workspaces.openFolder': 'Open folder as workspace',
    'workspaces.addTerminal': 'New terminal in this folder',
    'workspaces.removeFolder': 'Close workspace (removes its terminals)',
    'workspaces.folderMissing': 'Folder missing on disk',
    'workspaces.folderMissingHint': 'The folder was deleted or moved',
    'workspaces.confirmCloseTitle': 'Close workspace?',
    'workspaces.confirmCloseMessage':
      'Closing "{name}" will also close its {count} terminal(s) in this workspace. This cannot be undone.',
    'workspaces.confirmCloseOk': 'Close',

    // ---- settings: menu ----
    'settings.menu.general': 'General',
    'settings.menu.model': 'Model Settings',
    'settings.menu.ssh': 'SSH Shortcuts',
    'settings.menu.completion': 'Custom Completion',
    'settings.menu.shortcuts': 'Shortcuts',

    // ---- settings: general ----
    'settings.general.title': 'General',
    'settings.general.description':
      'Configure the terminal font and default font size. The font applies to all terminals; the default font size is used for new terminals, and existing terminals can be resized individually from the top bar.',
    'settings.general.language': 'Interface language',
    'settings.general.languageHint': 'Follow system uses your OS language, falling back to English.',
    'settings.general.font': 'Font',
    'settings.general.fontHint': 'Only takes effect when the selected font is installed on the system; otherwise it falls back to the default monospace font.',
    'settings.general.defaultFontSize': 'Default font size',
    'settings.general.fontSizeHint': 'Initial font size for new terminals (base 13px = 100%). Existing terminals can be zoomed individually with +/− in the top bar.',
    'settings.general.lineHeight': 'Line height',
    'settings.general.lineHeightHint': 'Spacing multiplier between terminal lines; 1.0 means compact with no extra spacing.',
    'settings.general.autocompleteGroup': 'Terminal completion (experimental, not recommended for SSH)',
    'settings.general.enableCompletion': 'Enable terminal completion',
    'settings.general.enableAiCompletion': 'Enable AI-enhanced completion',
    'settings.general.autocompleteHint':
      'Terminal completion includes local commands, paths, and common subcommands; AI enhancement adds more complete command suggestions only when needed.',
    'lineHeight.compact': 'Compact (0.8)',
    'lineHeight.tight': 'Tight (0.9)',
    'lineHeight.standard': 'Standard (1.0)',
    'lineHeight.loose': 'Slightly loose (1.1)',
    'lineHeight.wide': 'Loose (1.2)',
    'lineHeight.wider': 'Very loose (1.3)',
    'lineHeight.widest': 'Extra loose (1.5)',

    // ---- settings: SOCKS proxy ----
    'settings.proxy.title': 'SOCKS Proxy',
    'settings.proxy.description':
      'After setting a SOCKS5 proxy, all traffic goes through it (localhost/private IPs are bypassed automatically). The two traffic types below can be controlled independently.',
    'settings.proxy.address': 'Proxy address',
    'settings.proxy.emptyDirect': 'Empty = direct connection. Supports',
    'settings.proxy.dnsHint': '(the latter resolves DNS via the proxy).',
    'settings.proxy.applyAi': 'Route AI traffic through proxy',
    'settings.proxy.applyHttp': 'Route terminal commands through proxy',
    'settings.proxy.saving': 'Saving…',
    'settings.proxy.saveApply': 'Save & Apply',
    'settings.proxy.applied': '✓ Applied',

    // ---- settings: model ----
    'settings.model.title': 'Model Settings',
    'settings.model.description':
      'Configure an OpenAI-compatible model service (OpenAI, Ollama, DeepSeek, Moonshot, etc.).',
    'settings.model.openaiCompatible': 'OpenAI compatible',
    'settings.model.ollamaLocal': 'Ollama (local)',
    'settings.model.provider': 'Provider',
    'settings.model.baseUrl': 'Base URL',
    'settings.model.apiKey': 'API Key',
    'settings.model.model': 'Model',
    'settings.model.baseUrlHint': 'OpenAI-compatible endpoint. For example:',
    'settings.model.apiKeySet': '(set; leave blank to keep unchanged)',
    'settings.model.apiKeyPlaceholderOllama': 'Local models need no API key',
    'settings.model.modelHint': 'Model name; must match a model available on the server.',
    'settings.model.contextLines': 'Terminal lines read by AI',
    'settings.model.contextLinesNone': 'None',
    'settings.model.contextLinesDefault': ' (default)',
    'settings.model.contextLinesHint':
      'When sending an AI message, the most recent N lines of terminal output are included as context. Set to "None" to protect privacy or save tokens.',
    'settings.model.contextWindow': 'Context window length (tokens)',
    'settings.model.contextWindowHint':
      'Model context window size (token count). Used to decide when to compress conversation history. Default 200000.',
    'settings.model.compressionThreshold': 'Context compression threshold',
    'settings.model.compressionThresholdHint':
      'Compression triggers when the estimated token count exceeds "window length × threshold". Range 0.1–1.0, default 0.75.',
    'settings.model.testing': 'Testing…',
    'settings.model.testConnection': 'Test connection',
    'settings.model.saved': '✓ Saved',

    // ---- settings: ssh ----
    'settings.ssh.backToList': 'Back to list',
    'settings.ssh.editTitle': 'Edit SSH shortcut',
    'settings.ssh.newTitle': 'New SSH shortcut',
    'settings.ssh.editDesc': 'Modify the connection info; takes effect immediately after saving.',
    'settings.ssh.newDesc': 'Fill in the connection info; after saving you can quickly connect from the left sidebar.',
    'settings.ssh.listTitle': 'SSH Shortcuts',
    'settings.ssh.listDesc': 'Manage frequently used SSH connections. Click a shortcut in the left sidebar to open a new terminal and connect.',
    'settings.ssh.empty': 'No SSH shortcuts yet. Click "New" to add one.',
    'settings.ssh.name': 'Name',
    'settings.ssh.user': 'User',
    'settings.ssh.identityFile': 'Identity File (optional)',
    'settings.ssh.password': 'Password (optional)',    'settings.ssh.passwordKeep': 'leave blank to keep unchanged',
    'settings.ssh.passwordNewPlaceholder': 'Internal/test machines only; password stored in plaintext',
    'settings.ssh.passwordWarning':
      '⚠ The password is stored in plaintext in the local database. Only recommended for internal/test environments. Use key authentication for production.',
    'settings.ssh.namePlaceholder': 'Production server',

    // ---- settings: completion ----
    'settings.completion.editTitle': 'Edit custom completion',
    'settings.completion.newTitle': 'New custom completion',
    'settings.completion.newDesc': 'Enter a command with its full arguments; after saving it will be merged into terminal completion and de-duplicated automatically.',
    'settings.completion.listTitle': 'Custom Completion',
    'settings.completion.listDesc': 'Manage custom commands with full arguments.',
    'settings.completion.empty': 'No custom completions yet. Click "New" to add one.',
    'settings.completion.command': 'Command (with full arguments)',
    'settings.completion.commandHint': 'Used as a completion candidate when its prefix is typed, and de-duplicated against other sources.',
    'settings.completion.note': 'Note (optional)',
    'settings.completion.notePlaceholder': 'Defaults to the command itself if blank',
    'settings.completion.noteHint': 'Only shown in the list for easy identification.',

    // ---- settings: shortcuts ----
    'settings.shortcuts.title': 'Keyboard Shortcuts',
    'settings.shortcuts.description':
      'Customimize keyboard shortcuts. Click the edit icon next to a shortcut, then press the desired key combination.',
    'settings.shortcuts.reset': 'Reset to Defaults',
    'settings.shortcuts.saved': '✓ Shortcut updated',
    'settings.shortcuts.conflict': '⚠ Conflicts with "{shortcut}". Please choose a different combination.',
    'settings.shortcuts.pressKeys': 'Press keys…',

    // ---- shortcuts: categories ----
    'shortcuts.category.navigation': 'Navigation',
    'shortcuts.category.terminal': 'Terminal',
    'shortcuts.category.panel': 'Panel & Theme',

    // ---- shortcuts: descriptions ----
    'shortcuts.newTerminal': 'New terminal',
    'shortcuts.closeTerminal': 'Close active terminal',
    'shortcuts.nextTerminal': 'Next terminal',
    'shortcuts.prevTerminal': 'Previous terminal',
    'shortcuts.focusTerminal1': 'Focus terminal #1',
    'shortcuts.focusTerminal2': 'Focus terminal #2',
    'shortcuts.focusTerminal3': 'Focus terminal #3',
    'shortcuts.zoomIn': 'Zoom in',
    'shortcuts.zoomOut': 'Zoom out',
    'shortcuts.zoomReset': 'Reset zoom',
    'shortcuts.toggleSearch': 'Toggle search bar',
    'shortcuts.toggleLeftPanel': 'Toggle left sidebar',
    'shortcuts.toggleRightPanel': 'Toggle assistant panel',
    'shortcuts.toggleTheme': 'Toggle dark/light theme',

    // ---- toast messages (from store actions) ----
    'toast.createTerminalFailed': 'Failed to create terminal',
    'toast.deleteTerminalFailed': 'Failed to delete terminal',
    'toast.renameTerminalFailed': 'Failed to rename terminal',
    'toast.pinTerminalFailed': 'Failed to pin terminal',
    'toast.addCommandFailed': 'Failed to add command',
    'toast.updateCommandFailed': 'Failed to update command',
    'toast.deleteCommandFailed': 'Failed to delete command',
    'toast.addCompletionFailed': 'Failed to add custom completion',
    'toast.updateCompletionFailed': 'Failed to update custom completion',
    'toast.deleteCompletionFailed': 'Failed to delete custom completion',
    'toast.addSshFailed': 'Failed to add SSH shortcut',
    'toast.updateSshFailed': 'Failed to update SSH shortcut',
    'toast.deleteSshFailed': 'Failed to delete SSH shortcut',
    'toast.openSshFailed': 'Failed to open SSH session',
    'toast.saveAiFailed': 'Failed to save AI settings',
    'toast.clearAiFailed': 'Failed to clear AI messages',
    'toast.addWorkspaceFailed': 'Failed to open workspace',
    'toast.removeWorkspaceFailed': 'Failed to close workspace',
  },

  'zh-CN': {
    // ---- common ----
    'common.cancel': '取消',
    'common.save': '保存',
    'common.add': '添加',
    'common.delete': '删除',
    'common.edit': '编辑',
    'common.new': '新建',
    'common.settings': '设置',
    'common.pinned': '已置顶',
    'common.others': '其它',

    // ---- top bar ----
    'topbar.noTerminalSelected': '未选择终端',
    'topbar.hideSidebar': '隐藏侧边栏',
    'topbar.showSidebar': '显示侧边栏',
    'topbar.autocompleteOn': '终端补全：已开启（点击关闭）',
    'topbar.autocompleteOff': '终端补全：已关闭（点击开启）',
    'topbar.zoomOut': '缩小终端字号',
    'topbar.zoomTooltip': '缩放 {pct}%（点击重置为 100%）',
    'topbar.zoomIn': '放大终端字号',
    'topbar.toLight': '切换到亮色',
    'topbar.toDark': '切换到暗色',
    'topbar.hideAssistant': '隐藏助手面板',
    'topbar.showAssistant': '显示助手面板',
    'topbar.backToTerminal': '返回终端',

    // ---- left panel ----
    'leftPanel.terminals': '终端列表',
    'leftPanel.newTerminal': 'New Terminal',
    'leftPanel.empty': '暂无终端。',
    'leftPanel.emptyHint': '点击 + 或按 ⌘N 创建一个。',
    'leftPanel.pinned': '已置顶',
    'leftPanel.deleteTerminal': '删除终端',
    'leftPanel.unpin': '取消置顶',
    'leftPanel.pin': '置顶',
    'leftPanel.rename': '重命名',

    // ---- center panel ----
    'center.noActiveTerminal': '没有活动的终端',
    'center.createOrSelect': '从左侧面板创建或选择一个终端',

    // ---- right panel ----
    'right.commandsTab': '命令',
    'right.aiTab': 'AI 助手',
    'right.selectTerminal': '选择一个终端以查看其命令。',

    // ---- terminal search bar ----
    'search.placeholder': '搜索终端内容',
    'search.noResults': '无结果',
    'search.previous': '上一个 (Shift+Enter)',
    'search.next': '下一个 (Enter)',
    'search.close': '关闭 (Esc)',

    // ---- terminal autocomplete hint ----
    'autocomplete.hint': '↑↓ 选择 · Tab 确认 · Esc 关闭',

    // ---- AI chat ----
    'ai.selectTerminal': '选择一个终端开始对话。',
    'ai.empty': '问问关于终端操作的任何问题——粘贴报错、请求命令，或获取解释。',
    'ai.placeholder': '向助手提问…（Shift+Enter 换行）',
    'ai.clearConversation': '清空对话',
    'ai.stopGenerating': '停止生成',
    'ai.send': '发送',
    'ai.run': '运行',
    'ai.truncated': '仅显示最近 {shown} 条，另有 {hidden} 条更早消息未加载',

    // ---- common commands ----
    'commands.title': '常用命令',
    'commands.add': '添加命令',
    'commands.selectTerminal': '选择一个终端来管理其命令。',
    'commands.empty': '暂无已保存命令。点击 + 添加。',
    'commands.insertRunTooltip': '单击：插入  |  双击：运行\n{command}',
    'commands.unpin': '取消置顶',
    'commands.pinToTop': '置顶',
    'commands.runNow': '立即运行',
    'commands.labelPlaceholder': '备注（如：列出文件）',
    'commands.commandPlaceholder': '命令（如：ls -la）',

    // ---- ssh ----
    'ssh.title': 'SSH',
    'ssh.empty': '暂无 SSH 快捷方式。',
    'ssh.connectTo': '连接到 {host}',

    // ---- workspaces (folder groupings in the left sidebar) ----
    'workspaces.title': '工作区',
    'workspaces.empty': '暂无工作区。',
    'workspaces.openFolder': '打开文件夹作为工作区',
    'workspaces.addTerminal': '在该文件夹下新建终端',
    'workspaces.removeFolder': '关闭工作区（一并删除其下终端）',
    'workspaces.folderMissing': '文件夹在磁盘上已不存在',
    'workspaces.folderMissingHint': '该文件夹已被删除或移动',
    'workspaces.confirmCloseTitle': '关闭工作区？',
    'workspaces.confirmCloseMessage': '关闭「{name}」将同时关闭其下 {count} 个终端，且无法撤销。',
    'workspaces.confirmCloseOk': '关闭',

    // ---- settings: menu ----
    'settings.menu.general': '常规',
    'settings.menu.model': '大模型设置',
    'settings.menu.ssh': 'SSH 快捷方式',
    'settings.menu.completion': '自定义补全',
    'settings.menu.shortcuts': '快捷键',

    // ---- settings: general ----
    'settings.general.title': '常规',
    'settings.general.description':
      '配置终端字体与默认字号。字体对所有终端生效；默认字号用于新建终端，已有终端的字号可在顶部栏单独调整。',
    'settings.general.language': '界面语言',
    'settings.general.languageHint': '跟随系统会使用你的操作系统语言，否则使用英文。',
    'settings.general.font': '字体',
    'settings.general.fontHint': '仅当系统已安装所选字体时生效，否则回退到默认等宽字体。',
    'settings.general.defaultFontSize': '默认字号',
    'settings.general.fontSizeHint': '新建终端的初始字号（基准 13px = 100%）。已有终端可用顶部栏 +/− 单独缩放。',
    'settings.general.lineHeight': '行间距',
    'settings.general.lineHeightHint': '终端行与行之间的间距倍数，1.0 为紧凑无额外间距。',
    'settings.general.autocompleteGroup': '终端补全（实验性，不适合 SSH 使用）',
    'settings.general.enableCompletion': '启用终端补全',
    'settings.general.enableAiCompletion': '启用 AI 增强补全',
    'settings.general.autocompleteHint':
      '终端补全包含本地命令、路径与常用子命令；AI 增强只在需要时补充更完整的命令建议。',
    'lineHeight.compact': '紧凑 (0.8)',
    'lineHeight.tight': '较紧 (0.9)',
    'lineHeight.standard': '标准 (1.0)',
    'lineHeight.loose': '稍松 (1.1)',
    'lineHeight.wide': '宽松 (1.2)',
    'lineHeight.wider': '很松 (1.3)',
    'lineHeight.widest': '超松 (1.5)',

    // ---- settings: SOCKS proxy ----
    'settings.proxy.title': 'SOCKS 代理',
    'settings.proxy.description':
      '设置 SOCKS5 代理后，所有流量都走代理（内网 localhost/私有 IP 自动绕过）。可单独控制下方两类流量。',
    'settings.proxy.address': '代理地址',
    'settings.proxy.emptyDirect': '留空 = 直连。支持',
    'settings.proxy.dnsHint': '（后者由代理解析 DNS）。',
    'settings.proxy.applyAi': 'AI 流量走代理',
    'settings.proxy.applyHttp': '终端命令走代理',
    'settings.proxy.saving': '保存中…',
    'settings.proxy.saveApply': '保存并应用',
    'settings.proxy.applied': '✓ 已应用',

    // ---- settings: model ----
    'settings.model.title': '大模型设置',
    'settings.model.description': '配置 OpenAI 兼容的大模型服务（OpenAI、Ollama、DeepSeek、Moonshot 等）。',
    'settings.model.openaiCompatible': 'OpenAI 兼容',
    'settings.model.ollamaLocal': 'Ollama (本地)',
    'settings.model.provider': '服务商',
    'settings.model.baseUrl': 'Base URL',
    'settings.model.apiKey': 'API Key',
    'settings.model.model': '模型',
    'settings.model.baseUrlHint': 'OpenAI 兼容端点。例如：',
    'settings.model.apiKeySet': '（已设置，留空则保持不变）',
    'settings.model.apiKeyPlaceholderOllama': '本地模型无需 API Key',
    'settings.model.modelHint': '模型名称，需与服务端可用模型一致。',
    'settings.model.contextLines': 'AI 读取终端行数',
    'settings.model.contextLinesNone': '不读取',
    'settings.model.contextLinesDefault': '（默认）',
    'settings.model.contextLinesHint':
      '发送 AI 消息时，自动将当前终端最近 N 行输出作为上下文一并发出。设为「不读取」可保护隐私或节省 token。',
    'settings.model.contextWindow': '上下文窗口长度（tokens）',
    'settings.model.contextWindowHint':
      '大模型的上下文窗口大小（token 数）。用于判断何时需要压缩历史对话。默认 200000。',
    'settings.model.compressionThreshold': '上下文压缩阈值',
    'settings.model.compressionThresholdHint':
      '当预估 token 数超过「窗口长度 × 阈值」时触发压缩。取值 0.1–1.0，默认 0.75。',
    'settings.model.testing': '测试中…',
    'settings.model.testConnection': '测试连接',
    'settings.model.saved': '✓ 已保存',

    // ---- settings: ssh ----
    'settings.ssh.backToList': '返回列表',
    'settings.ssh.editTitle': '编辑 SSH 快捷方式',
    'settings.ssh.newTitle': '新建 SSH 快捷方式',
    'settings.ssh.editDesc': '修改连接信息，保存后立即生效。',
    'settings.ssh.newDesc': '填写连接信息，保存后可在左侧边栏快速连接。',
    'settings.ssh.listTitle': 'SSH 快捷方式',
    'settings.ssh.listDesc': '管理常用的 SSH 连接。在左侧边栏点击快捷方式即可快速打开新终端并连接。',
    'settings.ssh.empty': '暂无 SSH 快捷方式，点击「新建」添加。',
    'settings.ssh.name': '名称',
    'settings.ssh.user': '用户名',
    'settings.ssh.identityFile': '密钥文件（可选）',
    'settings.ssh.password': '密码（可选）',
    'settings.ssh.passwordKeep': '留空保持不变',
    'settings.ssh.passwordNewPlaceholder': '仅限内网/测试机，密码明文存储',
    'settings.ssh.passwordWarning':
      '⚠ 密码以明文存储在本地数据库，仅建议用于内网/测试环境。生产环境请使用密钥认证。',
    'settings.ssh.namePlaceholder': '生产服务器',

    // ---- settings: completion ----
    'settings.completion.editTitle': '编辑自定义补全',
    'settings.completion.newTitle': '新建自定义补全',
    'settings.completion.newDesc': '填写带完整参数的命令，保存后会在终端补全中融入并自动去重。',
    'settings.completion.listTitle': '自定义补全',
    'settings.completion.listDesc': '管理带完整参数的自定义命令。',
    'settings.completion.empty': '暂无自定义补全，点击「新建」添加。',
    'settings.completion.command': '命令（含完整参数）',
    'settings.completion.commandHint': '输入命令前缀时会作为补全候选，并与其他来源自动去重。',
    'settings.completion.note': '备注（可选）',
    'settings.completion.notePlaceholder': '留空则使用命令本身',
    'settings.completion.noteHint': '仅用于列表中显示，便于识别。',

    // ---- settings: shortcuts ----
    'settings.shortcuts.title': '键盘快捷键',
    'settings.shortcuts.description':
      '自定义键盘快捷键。点击某项右侧的编辑图标，然后按下新的按键组合即可。',
    'settings.shortcuts.reset': '恢复默认',
    'settings.shortcuts.saved': '✓ 快捷键已更新',
    'settings.shortcuts.conflict': '⚠ 与「{shortcut}」冲突，请选择其它按键组合。',
    'settings.shortcuts.pressKeys': '按下按键…',

    // ---- shortcuts: categories ----
    'shortcuts.category.navigation': '导航',
    'shortcuts.category.terminal': '终端',
    'shortcuts.category.panel': '面板与主题',

    // ---- shortcuts: descriptions ----
    'shortcuts.newTerminal': '新建终端',
    'shortcuts.closeTerminal': '关闭当前终端',
    'shortcuts.nextTerminal': '下一个终端',
    'shortcuts.prevTerminal': '上一个终端',
    'shortcuts.focusTerminal1': '聚焦第 1 个终端',
    'shortcuts.focusTerminal2': '聚焦第 2 个终端',
    'shortcuts.focusTerminal3': '聚焦第 3 个终端',
    'shortcuts.zoomIn': '放大字号',
    'shortcuts.zoomOut': '缩小字号',
    'shortcuts.zoomReset': '重置缩放',
    'shortcuts.toggleSearch': '切换搜索栏',
    'shortcuts.toggleLeftPanel': '切换左侧边栏',
    'shortcuts.toggleRightPanel': '切换助手面板',
    'shortcuts.toggleTheme': '切换深色/浅色主题',

    // ---- toast messages (from store actions) ----
    'toast.createTerminalFailed': '创建终端失败',
    'toast.deleteTerminalFailed': '删除终端失败',
    'toast.renameTerminalFailed': '重命名终端失败',
    'toast.pinTerminalFailed': '置顶终端失败',
    'toast.addCommandFailed': '添加命令失败',
    'toast.updateCommandFailed': '更新命令失败',
    'toast.deleteCommandFailed': '删除命令失败',
    'toast.addCompletionFailed': '添加自定义补全失败',
    'toast.updateCompletionFailed': '更新自定义补全失败',
    'toast.deleteCompletionFailed': '删除自定义补全失败',
    'toast.addSshFailed': '添加 SSH 快捷方式失败',
    'toast.updateSshFailed': '更新 SSH 快捷方式失败',
    'toast.deleteSshFailed': '删除 SSH 快捷方式失败',
    'toast.openSshFailed': '打开 SSH 会话失败',
    'toast.saveAiFailed': '保存 AI 设置失败',
    'toast.clearAiFailed': '清空 AI 消息失败',
    'toast.addWorkspaceFailed': '打开工作区失败',
    'toast.removeWorkspaceFailed': '关闭工作区失败',
  },
} as const;

export type TranslationKey = keyof (typeof translations)['en'];

/**
 * Look up a key for a locale, interpolating `{name}` placeholders from params.
 * Falls back to the key itself if missing (never throws), so a typo can't
 * crash the UI — it just shows the dotted key.
 */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>
): string {
  const dict = translations[locale] ?? translations.en;
  let value: string = (dict as Record<string, string>)[key];
  if (value === undefined) {
    // Fall back to the other locale before giving up entirely.
    const fallback = (translations.en as Record<string, string>)[key];
    value = fallback ?? key;
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return value;
}
