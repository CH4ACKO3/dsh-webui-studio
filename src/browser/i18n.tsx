import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

export const STUDIO_LOCALE_STORAGE_KEY = 'dsh-webui-studio.locale'

export const STUDIO_LANGUAGES = [
  { locale: 'en', nativeName: 'English' },
  { locale: 'zh-CN', nativeName: '简体中文' },
] as const

export type StudioLocale = typeof STUDIO_LANGUAGES[number]['locale']

const DEFAULT_STUDIO_LOCALE: StudioLocale = 'en'

const messages = {
  appSubtitle: { en: 'Plugin client workspace', 'zh-CN': '插件客户端工作区' },
  settings: { en: 'Settings', 'zh-CN': '设置' },
  settingsClose: { en: 'Close settings', 'zh-CN': '关闭设置' },
  settingsNavigation: { en: 'Settings sections', 'zh-CN': '设置分类' },
  settingsGeneral: { en: 'General', 'zh-CN': '常规' },
  settingsAppearance: { en: 'Appearance', 'zh-CN': '外观' },
  settingsLanguage: { en: 'Language', 'zh-CN': '语言' },
  settingsLanguageDescription: { en: 'Choose the language used across Studio.', 'zh-CN': '选择 Studio 全局界面语言。' },
  settingsLanguageControl: { en: 'Interface language', 'zh-CN': '界面语言' },
  settingsTheme: { en: 'Color theme', 'zh-CN': '颜色主题' },
  settingsThemeDescription: { en: 'Use a light, dark, or system-matched interface.', 'zh-CN': '使用浅色、深色或跟随系统的界面。' },
  themeLight: { en: 'Light', 'zh-CN': '浅色' },
  themeSystem: { en: 'System', 'zh-CN': '跟随系统' },
  themeDark: { en: 'Dark', 'zh-CN': '深色' },
  localDshActive: { en: 'Local DSH active', 'zh-CN': '本地 DSH 活跃' },
  localDshStopped: { en: 'Local DSH stopped', 'zh-CN': '本地 DSH 已停止' },
  runtimeRunning: { en: 'Instance running', 'zh-CN': '实例运行中' },
  runtimeStarting: { en: 'Instance starting', 'zh-CN': '实例启动中' },
  runtimeFailed: { en: 'Instance failed to start', 'zh-CN': '实例启动失败' },
  runtimeStopped: { en: 'Instance stopped', 'zh-CN': '实例已停止' },
  operationRestarting: { en: 'Restarting', 'zh-CN': '重启中' },
  operationStopping: { en: 'Stopping', 'zh-CN': '终止中' },
  operationRunning: { en: 'Running', 'zh-CN': '执行中' },
  operationActive: { en: 'Running', 'zh-CN': '运行中' },
  operationFailed: { en: 'Failed', 'zh-CN': '失败' },
  terminal: { en: 'Terminal', 'zh-CN': '终端' },
  terminalHostLabel: { en: 'Draft Host terminal', 'zh-CN': 'Draft Host 终端' },
  terminalDock: { en: 'Dock terminal in the left sidebar', 'zh-CN': '将终端停靠回左侧栏' },
  terminalExpand: { en: 'Expand terminal at the bottom', 'zh-CN': '在底部展开终端' },
  terminalReadonly: { en: 'Read-only instance terminal output', 'zh-CN': '实例终端只读输出' },
  terminalNotStarted: { en: '[studio] Instance has not started.', 'zh-CN': '[studio] 实例尚未启动。' },
  draftWorkspace: { en: 'Draft workspace', 'zh-CN': 'Draft 工作区' },
  draftTabs: { en: 'Draft tabs', 'zh-CN': '草稿标签页' },
  draftLoading: { en: 'Loading drafts…', 'zh-CN': '正在载入草稿…' },
  draftUnsaved: { en: 'unsaved changes', 'zh-CN': '有未保存修改' },
  draftTabLabel: { en: '{name}, {state}{dirty}', 'zh-CN': '{name}，{state}{dirty}' },
  draftTabDirtySuffix: { en: ', unsaved changes', 'zh-CN': '，有未保存修改' },
  draftTabMoveHint: { en: 'Drag to reorder; use Alt+Left/Right Arrow to move', 'zh-CN': '拖动排序；按 Alt+左右方向键移动' },
  draftClose: { en: 'Close draft {name}', 'zh-CN': '关闭草稿 {name}' },
  draftNew: { en: 'New draft', 'zh-CN': '新建草稿' },
  draftCreateDescription: { en: 'Configure the plugin source and isolated preview environment.', 'zh-CN': '配置插件来源和隔离预览环境。' },
  draftCreateClose: { en: 'Close new draft window', 'zh-CN': '关闭新建草稿窗口' },
  draftCreateCancel: { en: 'Cancel', 'zh-CN': '取消' },
  draftCreateSourceHeading: { en: 'Plugin source', 'zh-CN': '插件来源' },
  draftCreateSourceDescription: { en: 'Scaffold a new plugin or import a snapshot of an existing local plugin.', 'zh-CN': '创建一个新插件，或导入已有本地插件的快照。' },
  draftCreateProfileHeading: { en: 'Preview profile', 'zh-CN': '预览配置' },
  draftCreateProfileDescription: { en: 'Choose the DSH profile copied into the isolated Preview Host.', 'zh-CN': '选择复制到隔离 Preview Host 的 DSH 配置。' },
  draftOpenFromPlugins: { en: 'You can also reopen saved drafts from Plugin Management.', 'zh-CN': '也可以从插件管理打开已有草稿' },
  controlSidebar: { en: 'DSH controls', 'zh-CN': 'DSH 控制' },
  controlTitle: { en: 'DSH Instance Control', 'zh-CN': 'DSH 实例控制' },
  controlSubtitle: { en: 'Plugin runtime and instance status', 'zh-CN': '插件运行环境与实例状态' },
  controlExpand: { en: 'Expand DSH controls', 'zh-CN': '展开 DSH 控制栏' },
  controlCollapse: { en: 'Collapse DSH controls', 'zh-CN': '收起 DSH 控制栏' },
  controlResize: { en: 'Resize DSH controls', 'zh-CN': '调整 DSH 控制栏宽度' },
  controlPages: { en: 'DSH control pages', 'zh-CN': 'DSH 控制页面' },
  instanceStatus: { en: 'Instance', 'zh-CN': '实例状态' },
  pluginManagement: { en: 'Plugin Management', 'zh-CN': '插件管理' },
  profileManagerTitle: { en: 'Stable Host profile', 'zh-CN': '稳定 Host 配置' },
  profileManagerDescription: {
    en: 'Reorder plugins or enable and disable Harmony providers, then apply everything in one hot-reload transaction.',
    'zh-CN': '调整插件顺序或启停 Harmony Provider，然后通过一次热重载事务应用全部修改。',
  },
  profileRefresh: { en: 'Refresh', 'zh-CN': '刷新' },
  profileLoading: { en: 'Reading the active profile…', 'zh-CN': '正在读取当前配置…' },
  profileLoadError: { en: 'The Harmony profile could not be loaded', 'zh-CN': '无法读取 Harmony 配置' },
  retry: { en: 'Retry', 'zh-CN': '重试' },
  profilePinned: { en: 'Pinned', 'zh-CN': '固定' },
  profileMovePlugin: { en: 'Move {name}; use Alt and arrow keys or drag', 'zh-CN': '移动 {name}；可按 Alt 加方向键或拖动' },
  profileNoPatches: { en: 'No patches', 'zh-CN': '无 Patch' },
  profileVersionUnknown: { en: 'Version unknown', 'zh-CN': '版本未知' },
  profileEnablePlugin: { en: 'Enable provider', 'zh-CN': '启用 Provider' },
  profileDisablePlugin: { en: 'Disable provider', 'zh-CN': '停用 Provider' },
  profileEnabled: { en: 'On', 'zh-CN': '开启' },
  profileDisabled: { en: 'Off', 'zh-CN': '关闭' },
  profileOrderWarning: { en: 'Unsatisfied plugin order constraints: {count}.', 'zh-CN': '未满足的插件顺序约束：{count} 条。' },
  profileConflictWarning: { en: 'Active plugin incompatibility declarations: {count}.', 'zh-CN': '活跃的插件不兼容声明：{count} 条。' },
  profileUnsaved: { en: 'Profile changes are not applied yet.', 'zh-CN': '配置修改尚未应用。' },
  profileNoChanges: { en: 'The stable Host profile is up to date.', 'zh-CN': '稳定 Host 配置已是最新状态。' },
  profileApply: { en: 'Apply & hot reload', 'zh-CN': '应用并热重载' },
  profileApplying: { en: 'Reloading…', 'zh-CN': '正在重载…' },
  profileApplied: { en: 'Harmony generation {generation} is active.', 'zh-CN': 'Harmony generation {generation} 已生效。' },
  profileRunningDraftNotice: {
    en: 'Running Drafts keep their isolated profile snapshot. Restart a Draft to rebuild it from its selected source profile.',
    'zh-CN': '运行中的 Draft 会保留自己的隔离 profile 快照；重启 Draft 后才会从其所选源 profile 重新构建。',
  },
  sourceKind: { en: 'Source', 'zh-CN': '来源' },
  sourceNew: { en: 'New plugin', 'zh-CN': '新插件' },
  sourceExisting: { en: 'Existing local plugin', 'zh-CN': '已有本地插件' },
  packageName: { en: 'Package name', 'zh-CN': '包名称' },
  draftStorage: { en: 'Project storage', 'zh-CN': '项目存储' },
  draftStoragePlaceholder: { en: 'Temporarily stored in Studio', 'zh-CN': '暂存在 Studio' },
  draftStorageDescription: {
    en: 'Optional. Enter an absolute path for a new or empty folder; Studio will not create it until you explicitly save the plugin.',
    'zh-CN': '可选。输入新文件夹或空文件夹的绝对路径；显式保存插件前，Studio 不会创建它。',
  },
  draftDestinationDirectory: { en: 'Local plugin folder', 'zh-CN': '本地插件文件夹' },
  pluginFolder: { en: 'Plugin folder', 'zh-CN': '插件文件夹' },
  pluginFolderDescription: { en: 'Enter an absolute local path. Studio copies a snapshot and never modifies the source folder.', 'zh-CN': '输入本机绝对路径；Studio 会复制快照，不会修改原文件夹。' },
  profile: { en: 'Profile', 'zh-CN': '配置' },
  profileMain: { en: 'Use the current main DSH_HOME profile', 'zh-CN': '使用当前主 DSH_HOME 配置' },
  profileCustom: { en: 'Copy another local profile', 'zh-CN': '复制其它本地配置' },
  profileDirectory: { en: 'Profile folder', 'zh-CN': '配置文件夹' },
  profileDirectoryDescription: {
    en: 'Enter an absolute DSH profile path. Studio copies its manifest and configuration into this Draft’s isolated runtime.',
    'zh-CN': '输入 DSH profile 的绝对路径；Studio 会将其清单和配置复制到当前草稿的隔离运行环境。',
  },
  creating: { en: 'Creating…', 'zh-CN': '正在创建…' },
  createDraft: { en: 'Create draft', 'zh-CN': '创建草稿' },
  createFirstDraft: { en: 'Create your first draft', 'zh-CN': '创建第一个草稿' },
  createFirstDraftDescription: { en: 'Start with a new plugin or import an existing local plugin.', 'zh-CN': '从一个新插件开始，或导入已有本地插件。' },
  noActiveDraft: { en: 'No active draft', 'zh-CN': '没有激活的草稿' },
  noActiveDraftDescription: { en: 'Reopen a saved draft from Plugin Management.', 'zh-CN': '在插件管理中重新打开一个已保存草稿。' },
  openPluginManagement: { en: 'Open Plugin Management', 'zh-CN': '打开插件管理' },
  instanceRestarting: { en: 'Instance restarting', 'zh-CN': '实例正在重启' },
  instanceStarting: { en: 'Instance starting', 'zh-CN': '实例正在启动' },
  instanceStopping: { en: 'Instance stopping', 'zh-CN': '实例正在终止' },
  instanceRunning: { en: 'Instance running', 'zh-CN': '实例运行中' },
  instanceFailed: { en: 'Instance failed to start', 'zh-CN': '实例启动失败' },
  instanceStopped: { en: 'Instance stopped', 'zh-CN': '实例已停止' },
  draftName: { en: 'Draft name', 'zh-CN': '草稿名称' },
  worktreeLocation: { en: 'Worktree location', 'zh-CN': '工作树位置' },
  draftExportToFolder: { en: 'Save plugin to folder', 'zh-CN': '保存插件到文件夹' },
  draftExporting: { en: 'Saving plugin…', 'zh-CN': '正在保存插件…' },
  draftDestinationPending: { en: 'The local folder has not been created yet.', 'zh-CN': '尚未创建本地文件夹。' },
  draftDestinationSaved: { en: 'The Studio project has been synchronized to the local folder.', 'zh-CN': 'Studio 项目已同步到本地文件夹。' },
  start: { en: 'Start', 'zh-CN': '启动' },
  starting: { en: 'Starting', 'zh-CN': '启动中' },
  stop: { en: 'Stop', 'zh-CN': '终止' },
  stopping: { en: 'Stopping', 'zh-CN': '终止中' },
  restart: { en: 'Restart', 'zh-CN': '重启' },
  restarting: { en: 'Restarting', 'zh-CN': '重启中' },
  restartInstance: { en: 'Restart instance', 'zh-CN': '重启实例' },
  previewLabel: { en: 'Live WebUI preview', 'zh-CN': 'WebUI 实时预览' },
  previewExitFullscreen: { en: 'Exit fullscreen preview', 'zh-CN': '退出全屏预览' },
  fullscreenStudioControls: { en: 'Studio fullscreen controls', 'zh-CN': 'Studio 全屏控件' },
  previewStartDraft: { en: 'Start {name}', 'zh-CN': '启动 {name}' },
  previewNoOpenDraft: { en: 'No draft is open', 'zh-CN': '工作区没有打开的 Draft' },
  previewHostDescription: { en: 'Preview Host uses an isolated DSH_HOME and port.', 'zh-CN': 'Preview Host 将使用隔离的 DSH_HOME 和端口。' },
  previewCreateDescription: { en: 'Create a plugin or import an existing local WebUI plugin.', 'zh-CN': '创建新插件，或导入已有的本地 WebUI 插件。' },
  previewReopenDescription: { en: 'Saved drafts remain available in Plugin Management.', 'zh-CN': '已保存的草稿仍在插件管理中，可以随时重新打开。' },
  previewFrameTitle: { en: 'DSH WebUI preview', 'zh-CN': 'DSH WebUI 预览' },
  inspectorSidebar: { en: 'Draft and UI controls', 'zh-CN': 'Draft 与 UI 控制' },
  inspectorResize: { en: 'Resize Draft controls', 'zh-CN': '调整 Draft 控制栏宽度' },
  inspectorExpand: { en: 'Expand Draft controls', 'zh-CN': '展开 Draft 控制栏' },
  inspectorCollapse: { en: 'Collapse Draft controls', 'zh-CN': '收起 Draft 控制栏' },
  livePreview: { en: 'Live Preview', 'zh-CN': '实时预览' },
  previewInteractionCanvas: { en: 'Interaction and canvas', 'zh-CN': '交互与画板' },
  interactionMode: { en: 'Interaction mode', 'zh-CN': '交互模式' },
  interactionBrowseDescription: { en: 'Use the WebUI normally', 'zh-CN': '正常操作 WebUI' },
  interactionInspectDescription: { en: 'Select and trace elements', 'zh-CN': '选择并追踪元素' },
  previewInteractionMode: { en: 'Preview interaction mode', 'zh-CN': '预览交互模式' },
  browse: { en: 'Browse', 'zh-CN': '浏览' },
  inspect: { en: 'Inspect', 'zh-CN': '检查' },
  artboardRatio: { en: 'Artboard ratio', 'zh-CN': '画板比例' },
  lockAspectRatio: { en: 'Lock aspect ratio', 'zh-CN': '锁定宽高比' },
  unlockAspectRatio: { en: 'Unlock aspect ratio', 'zh-CN': '解锁宽高比' },
  custom: { en: 'Custom', 'zh-CN': '自定义' },
  webuiSize: { en: 'WebUI size', 'zh-CN': 'WebUI 尺寸' },
  viewportWidth: { en: 'WebUI viewport width', 'zh-CN': 'WebUI viewport 宽度' },
  viewportHeight: { en: 'WebUI viewport height', 'zh-CN': 'WebUI viewport 高度' },
  previewZoom: { en: 'Studio preview zoom', 'zh-CN': 'Studio 预览缩放' },
  zoomOut: { en: 'Zoom out', 'zh-CN': '缩小 Studio 预览' },
  zoomIn: { en: 'Zoom in', 'zh-CN': '放大 Studio 预览' },
  fitCanvas: { en: 'Fit canvas', 'zh-CN': '适应画布' },
  fullscreen: { en: 'Fullscreen', 'zh-CN': '全屏' },
  exitFullscreen: { en: 'Exit fullscreen', 'zh-CN': '退出全屏' },
  studioTools: { en: 'Studio tools', 'zh-CN': 'Studio 工具' },
  panelElements: { en: 'Elements', 'zh-CN': '元素' },
  panelSelect: { en: 'Select', 'zh-CN': '选择' },
  panelSource: { en: 'Source', 'zh-CN': '源码' },
  panelBuild: { en: 'Build', 'zh-CN': '构建' },
  panelAgent: { en: 'Agent', 'zh-CN': 'Agent' },
  elementsTitle: { en: 'Draft Elements', 'zh-CN': 'Draft Elements' },
  elementsDescription: { en: 'Only subtrees and variables explicitly registered by the current Draft are shown.', 'zh-CN': '只展示当前 Draft 显式注册的子树与变量。' },
  elementsEmpty: { en: 'This Draft has no registered Elements', 'zh-CN': '当前 Draft 尚未注册 Elements' },
  elementsEmptyDescription: { en: 'Use dsh-harmony-react/studio to register boundaries, source entries, and live variables.', 'zh-CN': '使用 dsh-harmony-react/studio 注册边界、源码入口和实时变量。' },
  registeredElements: { en: 'Registered Draft Elements', 'zh-CN': '已注册的 Draft Elements' },
  previewSelection: { en: 'Preview selection', 'zh-CN': 'Preview 选中项' },
  elementControls: { en: '{name} controls', 'zh-CN': '{name} 控件' },
  openElementSource: { en: 'Open Element source', 'zh-CN': '打开 Element source' },
  elementMatched: { en: 'The selected node is inside this Element boundary.', 'zh-CN': '选中节点位于这个 Element 的边界内。' },
  elementNotMatched: { en: 'The selected node is outside this Element boundary.', 'zh-CN': '当前选中节点不在这个 Element 的已注册边界内。' },
  elementNoVariables: { en: 'This Element has no registered live variables.', 'zh-CN': '这个 Element 没有注册实时变量。' },
  pluginVariables: { en: 'Plugin Variables', 'zh-CN': '插件变量' },
  variableNote: { en: 'These controls only change the current Preview state. Persist changes through source or Agent before reloading.', 'zh-CN': '这些控件只修改当前 Preview 的插件状态；重新载入前请通过源码或 Agent 固化。' },
  selectionTitle: { en: 'Elements and Patches', 'zh-CN': '元素与 Patch' },
  selectionDescription: { en: 'Click to change the target, double-click to lock its outline. Changes are written to the current Draft layer.', 'zh-CN': '单击切换目标，双击固定描边；所有修改写入当前 Draft 图层。' },
  selectionEmpty: { en: 'Select an element in Preview', 'zh-CN': '在 Preview 中选择一个元素' },
  selectionEmptyDescription: { en: 'Switch to Inspect and click a page element. Double-click to lock its outline; click elsewhere to release it. Escape returns to Browse.', 'zh-CN': '切换到“检查”后单击页面元素。双击可固定描边，点击其他位置解除；Escape 返回“浏览”。' },
  selectedElement: { en: 'Selected element', 'zh-CN': '已选元素' },
  position: { en: 'Position', 'zh-CN': '位置' },
  component: { en: 'Component', 'zh-CN': '组件' },
  owners: { en: 'Owners', 'zh-CN': '归属插件' },
  source: { en: 'Source', 'zh-CN': '源码' },
  confidenceSourceMapped: { en: 'Source mapped', 'zh-CN': '已映射源码' },
  confidenceReactMapped: { en: 'React mapped', 'zh-CN': '已映射 React' },
  confidenceDomOnly: { en: 'DOM only', 'zh-CN': '仅 DOM' },
  openSelectedSource: { en: 'Open selected node source', 'zh-CN': '打开 Selected node source' },
  safeProps: { en: 'Safe props', 'zh-CN': '安全 Props' },
  sanitizedHtml: { en: 'Sanitized outerHTML', 'zh-CN': '已清理的 outerHTML' },
  patchCandidates: { en: 'Render-path Patch candidates', 'zh-CN': '渲染路径 Patch candidates' },
  patchCandidate: { en: 'candidate', 'zh-CN': '候选' },
  patchExternalNotice: { en: 'This render path inside the current Draft boundary includes candidate Patch effects from other plugins. The selected node may not map directly to Element source.', 'zh-CN': '当前 Draft 边界内的这条渲染路径包含其他插件的候选 Patch 影响；选中节点未必能在 Element source 中直接对应。' },
  patchEmpty: { en: 'No candidate trace is available for this render path. This does not mean no Patch participated.', 'zh-CN': '当前渲染路径未提供 candidate trace；这不表示没有 Patch 参与。' },
  effect: { en: 'Effect', 'zh-CN': '效果' },
  declaration: { en: 'Declaration', 'zh-CN': '声明' },
  target: { en: 'Target', 'zh-CN': '目标' },
  harmonyTargets: { en: 'Harmony Patch targets', 'zh-CN': 'Harmony Patch 目标' },
  materializedTargets: { en: 'Materialized Harmony targets', 'zh-CN': '已物化的 Harmony targets' },
  materializedTargetsEmpty: { en: 'The current runtime has no materialized target inspection. Let Preview load the relevant bundle first.', 'zh-CN': '当前 runtime 尚无已物化的 target inspection。先让 Preview 加载相关 bundle。' },
  patchSteps: { en: '{count} ordered Patch steps · upstream read-only', 'zh-CN': '{count} 个有序 Patch step · 上游只读' },
  matches: { en: 'matches', 'zh-CN': '处匹配' },
  original: { en: 'Original', 'zh-CN': '原始内容' },
  final: { en: 'Final', 'zh-CN': '最终内容' },
  sourceTitle: { en: 'Draft Source', 'zh-CN': 'Draft 源码' },
  sourceDescription: { en: 'Edit only UTF-8 files inside the linked Draft root.', 'zh-CN': '只编辑 linked Draft 根目录内的 UTF-8 文件。' },
  projectFile: { en: 'Project file', 'zh-CN': '项目文件' },
  noEditableFiles: { en: 'No editable files', 'zh-CN': '没有可编辑文件' },
  selectFile: { en: 'Select a file…', 'zh-CN': '选择文件…' },
  openLinkedDraft: { en: 'Open a linked Draft first', 'zh-CN': '先打开 linked Draft' },
  selectDraftFile: { en: 'Select a Draft file', 'zh-CN': '选择一个 Draft 文件' },
  sourceSafety: { en: 'The editor never writes to DSH or other installed plugin source.', 'zh-CN': '编辑器不会写入 DSH 或其他已安装插件的源码。' },
  saved: { en: 'Saved', 'zh-CN': '已保存' },
  unsaved: { en: 'Unsaved changes', 'zh-CN': '有未保存修改' },
  saving: { en: 'Saving…', 'zh-CN': '正在保存…' },
  saveToDraft: { en: 'Save to Draft', 'zh-CN': '保存到 Draft' },
  buildDescription: { en: 'Build, reload, and verify the current Draft without stopping Preview Host.', 'zh-CN': '构建、重载并验证当前 Draft，无需停止 Preview Host。' },
  hotReload: { en: 'Hot reload plugin', 'zh-CN': '热重载插件' },
  hotReloadDescription: { en: 'Run the package build, apply its output, and reload the current Preview.', 'zh-CN': '运行 package build，应用产物并重新载入当前 Preview。' },
  hotReloading: { en: 'Building and reloading…', 'zh-CN': '正在构建并重载…' },
  hotReloadUnavailable: { en: 'Start the instance and wait for Preview to activate before hot reloading.', 'zh-CN': '先启动实例并等待 Preview 激活，再热重载插件。' },
  latestBuild: { en: 'Latest build', 'zh-CN': '最近一次构建' },
  latestBuildOutput: { en: 'Latest build output', 'zh-CN': '最近一次构建输出' },
  readinessTitle: { en: 'Release readiness', 'zh-CN': '发布就绪检查' },
  readinessDescription: { en: 'Validate the current Draft against the live Preview. Ambient providers from other profiles are not guaranteed.', 'zh-CN': '验证当前 Draft 与真实 Preview；不承诺其他 profile 的 ambient providers。' },
  checking: { en: 'Checking…', 'zh-CN': '检查中…' },
  packDryRun: { en: 'npm pack dry-run', 'zh-CN': 'npm 打包预检' },
  packDryRunResult: { en: 'npm pack dry-run result', 'zh-CN': 'npm 打包预检结果' },
  openDraftFirst: { en: 'Open a Draft first', 'zh-CN': '先打开 Draft' },
  readinessEmptyDescription: { en: 'Readiness checks only the current overlay and never modifies upstream packages.', 'zh-CN': 'Readiness 只检查当前叠加图层，不修改上游包。' },
  readinessSummary: { en: 'Readiness summary', 'zh-CN': '就绪检查摘要' },
  readinessError: { en: 'Errors', 'zh-CN': '错误' },
  readinessWarning: { en: 'Warnings', 'zh-CN': '警告' },
  readinessInfo: { en: 'Info', 'zh-CN': '信息' },
  readinessClear: { en: 'Static checks and the current Preview found no issues. Run package dry-run before publishing.', 'zh-CN': '静态检查与当前 Preview 未发现问题。仍建议在发布前运行 package dry-run。' },
  packPassed: { en: 'Package dry-run passed', 'zh-CN': 'Package dry-run 通过' },
  packFailed: { en: 'Package dry-run failed', 'zh-CN': 'Package dry-run 失败' },
  fileCount: { en: '{count} files', 'zh-CN': '{count} 个文件' },
  viewPackFiles: { en: 'View packed files', 'zh-CN': '查看打包文件' },
  viewNpmOutput: { en: 'View npm output', 'zh-CN': '查看 npm 输出' },
  agentTitle: { en: 'Assistant Agent', 'zh-CN': '辅助 Agent' },
  agentWorking: { en: 'Working on the draft', 'zh-CN': '正在处理草稿' },
  agentWaiting: { en: 'Waiting to start', 'zh-CN': '等待启动' },
  agentReady: { en: 'Ready for more changes', 'zh-CN': '可以继续提出修改' },
  agentCancel: { en: 'Stop', 'zh-CN': '停止' },
  agentScope: { en: 'A real DSH session with access only to Selection, Harmony inspection, Draft files, build, and preview tools.', 'zh-CN': '真实 DSH session，仅开放 Selection、Harmony inspection、Draft 文件和构建预览工具。' },
  agentStartFromDraft: { en: 'Start Agent from the current Draft', 'zh-CN': '让 Agent 从当前 Draft 开始' },
  agentOpenDraftFirst: { en: 'Open and activate a linked Draft first', 'zh-CN': '先打开并激活 linked Draft' },
  agentDescription: { en: 'Agent uses DSH models and sessions. Draft lifecycle does not depend on Agent.', 'zh-CN': 'Agent 使用 DSH 自身的模型与 session；Draft 生命周期不依赖 Agent。' },
  agentStarting: { en: 'Creating…', 'zh-CN': '正在创建…' },
  agentStart: { en: 'Start Studio Agent', 'zh-CN': '启动 Studio Agent' },
  you: { en: 'You', 'zh-CN': '你' },
  agentMessage: { en: 'Message Studio Agent', 'zh-CN': '给 Studio Agent 的消息' },
  agentPlaceholderStart: { en: 'Start Studio Agent first', 'zh-CN': '先启动 Studio Agent' },
  agentPlaceholder: { en: 'Describe the changes you want to apply to WebUI…', 'zh-CN': '描述你希望叠加到 WebUI 的修改…' },
  sending: { en: 'Sending…', 'zh-CN': '发送中…' },
  send: { en: 'Send', 'zh-CN': '发送' },
  interactionApproval: { en: 'Agent is waiting for tool approval. Continue in the official WebUI for now.', 'zh-CN': 'Agent 正在等待工具授权；请暂时在官方 WebUI 中处理。' },
  interactionQuestion: { en: 'Agent is waiting for more information. Reply in the official WebUI for now.', 'zh-CN': 'Agent 正在等待补充信息；请暂时在官方 WebUI 中回答。' },
  errorUnsavedCreate: { en: 'Save the current file before creating a new draft.', 'zh-CN': '当前文件尚未保存。请先保存，再创建新的草稿。' },
  errorEmptyDraftName: { en: 'Draft name cannot be empty.', 'zh-CN': '草稿名称不能为空。' },
  errorUnsavedReload: { en: 'Save the current file before hot reloading the plugin.', 'zh-CN': '当前文件尚未保存。请先保存，再热重载插件。' },
  errorUnsavedExport: { en: 'Save the current source file before saving the plugin to its local folder.', 'zh-CN': '当前源码文件尚未保存。请先保存文件，再把插件保存到本地文件夹。' },
  errorUnsavedOpenFile: { en: 'Save the current file before opening another file.', 'zh-CN': '当前文件尚未保存。请先保存，再打开其他文件。' },
  errorUnsavedSwitchDraft: { en: 'Press Ctrl+S or Command+S to save before switching drafts.', 'zh-CN': '当前文件尚未保存。请先按 Ctrl+S 或 Command+S 保存，再切换草稿。' },
  errorUnsavedCloseDraft: { en: 'Save the current file before closing this draft tab.', 'zh-CN': '当前文件尚未保存。保存后才能关闭这个草稿标签。' },
} as const

export type StudioMessageKey = keyof typeof messages
export type StudioTranslate = (key: StudioMessageKey, values?: Record<string, string | number>) => string

export interface StudioLocaleState {
  locale: StudioLocale
  setLocale(locale: StudioLocale): void
  t: StudioTranslate
}

const StudioLocaleContext = createContext<StudioLocaleState | undefined>(undefined)

export function isStudioLocale(value: unknown): value is StudioLocale {
  return typeof value === 'string' && STUDIO_LANGUAGES.some(language => language.locale === value)
}

export function readStudioLocale(storage: Pick<Storage, 'getItem'>, browserLanguage: string): StudioLocale {
  const stored = storage.getItem(STUDIO_LOCALE_STORAGE_KEY)
  if (isStudioLocale(stored)) return stored
  const normalized = browserLanguage.toLowerCase()
  return STUDIO_LANGUAGES.find(language => language.locale.toLowerCase() === normalized)?.locale
    ?? STUDIO_LANGUAGES.find(language => language.locale.split('-')[0] === normalized.split('-')[0])?.locale
    ?? DEFAULT_STUDIO_LOCALE
}

export function translate(
  locale: StudioLocale,
  key: StudioMessageKey,
  values: Record<string, string | number> = {},
): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    messages[key][locale] as string,
  )
}

export function StudioLocaleProvider({ children }: { children: ReactNode }): JSX.Element {
  const [locale, setLocaleState] = useState<StudioLocale>(
    () => readStudioLocale(window.localStorage, window.navigator.language),
  )

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: StudioLocale): void => {
    window.localStorage.setItem(STUDIO_LOCALE_STORAGE_KEY, next)
    setLocaleState(next)
  }, [])

  const t = useCallback<StudioTranslate>((key, values) => translate(locale, key, values), [locale])
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <StudioLocaleContext.Provider value={value}>{children}</StudioLocaleContext.Provider>
}

export function useStudioLocale(): StudioLocaleState {
  const value = useContext(StudioLocaleContext)
  if (value === undefined) throw new Error('useStudioLocale must be used inside StudioLocaleProvider')
  return value
}
