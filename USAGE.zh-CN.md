# Babel 使用教程

Babel 是一个用于 Discord 桌面版的翻译插件，支持 macOS 和 Windows。安装后可以在 Discord 里双击消息翻译，也可以把自己要发送的文字先翻译成目标语言再发出去。

本文基于 Babel `v0.1.5` 编写。下载入口以 GitHub Releases 为准：

https://github.com/itsmaiGe/babel/releases/latest

## 安装前准备

你需要准备：

- Discord 桌面版，不是网页版。
- 一个可用的 AI 平台 API Key，例如 OpenAI、Claude、Gemini、DeepSeek、Kimi、智谱 / Z.AI、OpenRouter 等。
- 能正常访问你选择的 AI 平台。如果平台需要代理，请先让 Discord 或系统代理能正常访问它。

安装或卸载后，都要彻底退出 Discord 再重新打开。只点窗口右上角关闭不算退出：

- macOS：在菜单栏或 Dock 中退出 Discord。
- Windows：右键系统托盘里的 Discord 图标，选择 Quit Discord / 退出 Discord。

## Windows 安装

1. 打开下载页：

   https://github.com/itsmaiGe/babel/releases/latest

2. 下载 `Babel-Installer.exe`。
3. 双击运行安装器。
4. 如果 Windows SmartScreen 提示拦截，确认文件来自上面的 GitHub Releases 页面后，点击“更多信息”，再点击“仍要运行”。
5. 安装器会自动填写标准 Discord 安装路径，直接点击“安装”即可。如果 Discord 被移动到其他位置，可以填写 Discord 文件夹、`app-*` 文件夹或 `Discord.exe` 的完整路径；路径可位于任意磁盘。
6. 安装成功后，彻底退出 Discord，然后重新打开。
7. 打开 Discord 设置，左侧栏里会出现 `Babel`。

Windows 安装器是自包含程序，不需要安装 Node.js。

## macOS 安装

1. 打开下载页：

   https://github.com/itsmaiGe/babel/releases/latest

2. 下载 `Babel Manager.dmg`。
3. 打开 dmg，把 `Babel Manager` 拖到 Applications / 应用程序，或者直接运行。
4. 如果 macOS 提示无法打开：
   - 右键 `Babel Manager`，选择“打开”。
   - 或打开“系统设置 → 隐私与安全性”，允许打开该应用。
5. 在弹出的窗口里点击 `Install`。
6. 安装成功后，彻底退出 Discord，然后重新打开。
7. 打开 Discord 设置，左侧栏里会出现 `Babel`。

macOS 管理器是 Apple Silicon / arm64 原生应用，安装逻辑由管理器直接执行，不需要 Node.js、Rosetta 或管理员权限。

## 添加 API Key

1. 打开 Discord。
2. 进入 `用户设置 → Babel`。
3. 在 `模型` 区域配置：
   - `AI 平台`：选择你的供应商，例如 OpenAI、Google Gemini、Claude、DeepSeek、智谱 / Z.AI、Kimi、OpenRouter、Ollama、LM Studio 或自定义。
   - `模型地址`：普通平台会自动填写，不能编辑。选择 `自定义` 时可以填写 OpenAI 兼容接口地址，例如 `https://example.com/v1`。
   - `匹配模型`：选择或输入模型名。
   - `API Key`：粘贴你的 API Key。
4. 可选：点击 `刷新模型`，从当前平台拉取可用模型列表。如果拉取失败，也可以手动输入模型名。
5. 点击 `测试连接`，确认能正常调用模型。
6. 点击 `保存`。

保存后，Babel 会按平台分别保存 API Key。再次打开设置时，输入框会显示“已保存”或脱敏后的 key 预览。要替换 key，重新粘贴新的 API Key 并点击 `保存`。

本地模型说明：

- `Ollama（本地）` 默认地址是 `http://localhost:11434/v1`。
- `LM Studio（本地）` 默认地址是 `http://localhost:1234/v1`。
- 本地模型通常不需要 API Key，但你需要先启动对应的本地服务，并确认模型已经可用。

自定义平台说明：

- `模型地址` 填基础地址即可，例如 `https://example.com/v1`。
- Babel 会按 OpenAI 兼容格式请求 `/chat/completions`，刷新模型时请求 `/models`。

## 隐私与 API Key 保存

- 你翻译的消息内容会发送给你选择的 AI 平台。请选择你信任的平台，并自行确认对方的数据政策。
- Babel 不使用 Discord token，也不会调用 Discord 私有 API。
- API Key 会保存在本机 Discord 用户数据目录下，并通过系统能力加密保存：macOS 使用 Keychain 相关能力，Windows 使用 DPAPI 相关能力。
- API Key 不会以明文写入配置文件；发起翻译请求时，只会作为请求头发送给你选择的 AI 平台。
- 卸载 Babel 会删除本地保存的设置、API Key 和翻译缓存。

## 消息翻译

在 `消息翻译` 区域可以调整：

- `启用插件`：总开关。
- `自动翻译新消息`：开启后，只翻译开启之后新出现的消息，不会回头翻译历史消息。
- `阅读目标语言`：别人发来的消息要翻译成什么语言，默认是简体中文。
- `翻译风格`：可选自然准确、口语化翻译、意译大师、直译优先、简洁翻译、游戏聊天、正式礼貌或自定义。
- `自定义提示词`：在翻译风格中选择“自定义”后出现，可填写自己的语气、措辞或保留规则。

## 发送翻译

在 `发送翻译` 区域可以调整：

- `启用发送翻译输入框`：开启后，Discord 输入框上方会出现 Babel 的浮动输入框。
- `发送目标语言`：你输入的内容要翻译成什么语言，默认是英语。
- `回车后自动发送`：开启时，翻译完成后会自动发送；关闭时，译文只会填入 Discord 原生输入框，等待你确认后手动发送。
- `输入框透明度`：调整浮动翻译输入框整体的透明程度。

修改后点击 `保存`。

## 译文外观

在 `译文外观` 区域可以调整译文显示效果：

- 译文显示在原文上方或下方。
- 是否显示译文背景。
- 译文样式，例如普通、加粗、淡化、马克笔、下划线、波浪线、删除线。
- 背景色。
- 译文颜色。
- 字体。

这些设置只影响 Discord 里显示的译文样式，不影响翻译内容。

## 配置与缓存

设置页底部还有两个维护按钮：

- `打开配置文件夹`：打开 Babel 本地保存设置、API Key 和缓存的位置。
- `清除翻译缓存`：清空已经保存的翻译缓存。已经显示在当前 Discord 界面里的译文不会立刻消失，但后续再次翻译相同文本时会重新请求模型。

## 如何使用

### 双击消息翻译

1. 在 Discord 频道里找到要翻译的消息。
2. 双击这条消息。
3. Babel 会在原消息下方显示译文。
4. 再次双击同一条消息，可以隐藏译文。

如果消息是回复，Babel 会尽量同时翻译引用预览和消息正文。

### 翻译后发送

1. 在 `用户设置 → Babel → 发送翻译` 里开启 `启用发送翻译输入框`。
2. 回到频道，Discord 输入框附近会出现 Babel 的浮动输入框。
3. 在浮动输入框里输入你想说的话。
4. 按 Enter。
5. Babel 会把文字翻译成 `发送目标语言`。开启“回车后自动发送”时会直接发送；关闭时只填入 Discord 原生输入框，等待你确认。

浮动输入框可以拖动，也可以调整宽度。

### 自动翻译新消息

1. 在 `用户设置 → Babel → 消息翻译` 里开启 `自动翻译新消息`。
2. 保存设置。
3. 从开启之后开始，新出现的消息会自动翻译。

自动翻译不会翻译当前频道已有的历史消息，这是为了避免刚开启时一次性消耗大量 API 调用。已经是目标语言的消息会尽量跳过。

## 更新

在 Babel 设置页底部点击“检查更新”，可以手动对比当前版本和 GitHub 上的最新版本。

更新方式：

1. 打开 https://github.com/itsmaiGe/babel/releases/latest。
2. 下载最新安装器。
3. 重新运行安装。
4. 彻底退出 Discord 并重新打开。

Discord 自己更新后，可能会替换 desktop core 目录，导致插件消失。这种情况下重新运行 Babel 安装器即可。

## 卸载

Windows：

1. 运行 `Babel-Installer.exe`。
2. 点击“卸载”。
3. 重启 Discord。

macOS：

1. 运行 `Babel Manager`。
2. 点击 `Uninstall`。
3. 重启 Discord。

卸载会移除 Babel 的注入文件，并删除本地保存的设置、API Key 和翻译缓存。

## 常见问题

### Discord 设置里没有 Babel

先彻底退出 Discord，再重新打开。如果还是没有，重新运行安装器。Discord 更新后也需要重新安装一次。

### 测试连接失败

先看报错类型：

- `401` / `403`：通常是 API Key 不正确、账号无权限或平台余额不足。
- `429`：通常是额度、频率或并发限制。
- 网络连接失败、DNS 失败、连接超时：检查网络、代理或 VPN。
- 模型不存在：检查 `匹配模型` 里的模型名是否真实可用。

Babel 会优先使用 Electron 的网络能力发请求，通常会跟随系统或 Discord 的代理设置。

### 双击没有翻译

检查：

- `用户设置 → Babel → 消息翻译 → 启用插件` 是否开启。
- API Key 是否已保存。
- `测试连接` 是否成功。
- 当前消息是否真的有可翻译文本，例如纯图片、纯贴纸、纯附件不会有正文可翻译。

### 发送翻译输入框不出现

检查：

- `启用插件` 是否开启。
- `启用发送翻译输入框` 是否开启。
- 当前页面是否有 Discord 的正常消息输入框。

如果刚改完设置，先点击 `保存`，再切换频道或重启 Discord。

## 从源码安装

普通用户建议使用 Releases 里的安装器。只有开发或调试时才需要源码安装。

```bash
git clone https://github.com/itsmaiGe/babel.git
cd babel
npm install
npm run install:mod
```

源码卸载：

```bash
npm run uninstall:mod
```

运行测试：

```bash
npm test
```
