<div align="center">
  <img src="assets/babel-icon.png" width="96" alt="Babel 图标" />
  <h1>Babel</h1>
  <p><strong>一个轻量、独立的 Discord AI 翻译插件。</strong></p>
  <p>双击消息即时翻译，也可以先翻译自己要发送的文字，或自动翻译新消息。</p>

  <p>
    <a href="https://github.com/itsmaiGe/babel/releases/latest"><img alt="最新版本" src="https://img.shields.io/github/v/release/itsmaiGe/babel?style=flat-square&color=5865F2" /></a>
    <img alt="支持 Windows 和 macOS" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-24292f?style=flat-square" />
    <a href="LICENSE"><img alt="MIT 许可证" src="https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square" /></a>
  </p>

  <p>
    <a href="#-界面预览">界面预览</a> •
    <a href="#-主要功能">主要功能</a> •
    <a href="#-安装">安装</a> •
    <a href="#-使用方法">使用方法</a> •
    <a href="#-常见问题">常见问题</a> •
    <a href="README.en.md">English</a>
  </p>
</div>

> Babel 取名自巴别塔。巴别塔因人们无法理解彼此而崩塌，而这个插件想做的，
> 就是帮大家跨过 Discord 里的语言障碍。

## 📸 界面预览

以下是真实运行的 0.1.5 设置截图；0.1.6 本地候选版本正在测试，界面截图将在实机验证后更新。图中的平台信息仅用于展示，
**Babel 不会内置或公开任何 API Key**。

<table>
  <tr>
    <td width="50%" valign="top">
      <p><strong>模型与消息翻译</strong></p>
      <img src="assets/screenshots/settings-overview.png" alt="Discord 中的 Babel 模型与消息翻译设置" />
    </td>
    <td width="50%" valign="top">
      <p><strong>翻译与外观</strong></p>
      <img src="assets/screenshots/settings-translation.png" alt="Discord 中的 Babel 翻译与外观设置" />
    </td>
  </tr>
</table>

## ✨ 为什么选择 Babel？

BetterDiscord 和 Vencord 很适合需要完整客户端模组框架的人。Babel 面向的，
是只想给 Discord 加一个翻译功能的用户。

- **独立轻量**：只做翻译，不需要安装完整插件框架。
- **模型自由**：可以使用常见云端平台、自定义 OpenAI 兼容接口、Ollama 或 LM Studio。
- **贴近 Discord**：设置尽量复用 Discord 原生组件，并跟随当前主题。
- **覆盖常用场景**：阅读消息、引用回复、发送文字和新消息自动翻译都能处理。

## 🚀 主要功能

| 功能 | 说明 |
| --- | --- |
| 双击翻译 | 双击消息后原地显示译文，再次双击即可隐藏。回复消息会分别翻译引用预览和回复正文。 |
| 发送翻译 | Discord 输入框上方提供可移动、可调整宽度的翻译输入框。关闭自动发送后，译文会先进入原生输入框等待确认。 |
| 自动翻译 | 只翻译开启功能后出现的新消息，不会翻译频道历史记录，并自动跳过已经是目标语言的消息。 |
| 翻译风格 | 支持自然、口语、意译、直译、简洁、游戏、正式和自定义提示词。 |
| 译文外观 | 可以调整译文位置、译文样式、背景色、译文颜色、译文字体、强调样式和翻译框不透明度。颜色显示名称；选择「自动」时跟随 Discord 主题。 |
| 翻译缓存 | 译文始终保存在本地。相同内容、模型和提示词优先复用已有译文，同时翻译相同内容会合并请求。设置中可以清除缓存，不显示用量。 |
| 界面语言 | 插件与原生安装器支持 English、简体中文、繁體中文和日本語，始终跟随系统语言。 |
| 系统代理 | 翻译请求使用 Electron 网络能力，会跟随系统或 Discord 的代理设置。 |

### 支持的平台

| 云端平台 | 本地与自定义 |
| --- | --- |
| OpenAI、Google Gemini、Claude、DeepSeek、智谱 / Z.AI、Kimi、OpenRouter | Ollama、LM Studio、OpenAI 兼容接口 |

云端平台需要使用**你自己的 API Key 和额度**。Ollama 与 LM Studio 可以直接连接本地模型，
通常不需要云端 API Key。

## 📦 安装

直接下载最新版本：

<p>
  <a href="https://github.com/itsmaiGe/babel/releases/latest/download/Babel-Installer.exe"><strong>Windows：Babel-Installer.exe</strong></a><br />
  <a href="https://github.com/itsmaiGe/babel/releases/latest/download/Babel.Manager.dmg"><strong>macOS：Babel Manager.dmg</strong></a>
</p>

### Windows

1. 运行 **`Babel-Installer.exe`**。
2. 安装器通常会自动找到 Discord。如果 Discord 被移动过，也可以填入 Discord 文件夹、
   `app-*` 文件夹或 `Discord.exe` 的完整路径。
3. 点击 **安装**。

当前 Windows 安装器支持 **64 位 Windows**。由于开源安装器暂未购买代码签名证书，
SmartScreen 可能会弹出警告。请先确认文件来自本仓库 Releases 页面，再选择继续运行。

### macOS

1. 打开 **`Babel Manager.dmg`**。
2. 运行 **Babel Manager**，点击 **Install**。

当前 macOS 安装器仅支持 **Apple Silicon（M1 及更新机型）**。

如果安装器提示无法访问 Discord 数据，请用 **File → Choose Discord folder…**
选择窗口中显示的 Discord 数据目录后重试。权限拒绝时，安装和卸载按钮会禁用。

### 安装完成后

Windows 和 macOS 都需要**彻底退出 Discord 后重新打开**。只关闭窗口并不算退出：
Windows 请从系统托盘退出 Discord，macOS 请使用 **Discord → Quit Discord**。
重新打开后，Discord 设置左侧会出现 **Babel**。

## 🎮 使用方法

1. 打开 **Discord 设置 → Babel**。
2. 选择服务商和模型，填写自己的 API Key，然后点击共享的 **保存** 按钮。服务商、模型、密钥和语言修改一起保存；未保存时可选择 **放弃更改**。
3. 设置阅读语言、发送语言和翻译风格。
4. 双击一条消息即可翻译。

需要翻译自己要发送的文字时，在设置里开启 **输入翻译框**。需要自动处理频道新消息时，
开启 **自动翻译新消息**，它只会从开启之后开始工作。所有修改需要点击 **保存**。

自定义接口的密钥按完整接口地址隔离。远程 HTTP 接口需明确允许，许可只适用于当前地址；建议使用 HTTPS。更改接口后请检查密钥状态。

翻译缓存始终保存在本地，**翻译** 页面只有 **清除翻译缓存**。清理成功只有短暂提示，失败时才显示错误。配置文件在外部改变时，页面会提示重新加载或明确覆盖。发送翻译期间按 **Esc** 可取消，原文会保留。

发送翻译不会覆盖原生输入框里已有的草稿。翻译期间切换频道、修改草稿或回复对象时，
本次发送会取消，翻译输入框里的原文会保留。

## 🔄 更新

- 打开 **Discord 设置 → Babel**，滚动到页面底部，点击 **检查更新**。
- 下载新安装器并重新运行即可覆盖更新，原有设置会保留。
- Discord 自身更新时可能会替换 desktop-core 目录。如果更新后 Babel 消失，
  重新运行一次安装器即可。

## 🔐 隐私说明

- 需要翻译的文字会发送给你选择的服务商，请使用你信任的服务并了解其隐私政策。
- API Key 会通过 Electron `safeStorage` 在本机加密保存：macOS 使用 Keychain，
  Windows 使用 DPAPI。Key 只会发送给你配置的平台。
- Babel 不会读取 Discord Token，也不会直接请求 Discord 的消息接口；发送译文使用原生输入框。
- 普通卸载保留设置、加密 API Key 和翻译缓存。只有明确勾选清除所选客户端的数据，且入口恢复成功后，才会删除该数据目录。其他客户端的数据不会被删除。

## ❓ 常见问题

<details>
<summary><strong>Discord 更新后 Babel 为什么消失了？</strong></summary>

Discord 更新会安装新的版本目录，并替换 Babel 注入过的 desktop-core。
重新运行最新版安装器，然后彻底退出并重新打开 Discord 即可。

</details>

<details>
<summary><strong>Discord 更新后为什么可能出现设置界面异常？</strong></summary>

Babel 为了保持轻量，会直接复用 Discord 的原生界面组件，而不是再携带一套 UI 框架。
Discord 修改内部组件后，Babel 可能需要跟进适配。如果选项消失或下拉框无法展开，
请先检查最新版本。

</details>

<details>
<summary><strong>Babel 可以和 BetterDiscord 一起使用吗？</strong></summary>

安装器会保留已经存在的 BetterDiscord 加载器，但 BetterDiscord 仍可能显示通用的
“检测到其他客户端模组”警告。如果你更看重 BetterDiscord 的稳定性，建议一次只使用一个客户端模组。

</details>

<details>
<summary><strong>“fetch failed”或请求超时是什么意思？</strong></summary>

这表示请求没有正常完成。请检查平台地址、系统代理或 VPN、DNS，以及模型服务是否正常。
超时则表示请求等待太久后被 Babel 主动取消；如果只是偶尔发生，通常重试一次即可。

</details>

<details>
<summary><strong>Babel 现在稳定吗？</strong></summary>

Babel 仍处于早期阶段，Discord 内部更新也可能带来兼容问题。遇到可以稳定复现的问题时，
欢迎前往 [Issues](https://github.com/itsmaiGe/babel/issues) 反馈。

</details>

<details>
<summary><strong>开发与源码安装</strong></summary>

```bash
npm ci
npm test
npm run install:mod   # 安装当前源码版本
npm run uninstall:mod # 卸载 Babel，保留本地数据
npm run uninstall:mod -- --remove-profile-data # 明确清除所选客户端的数据
npm run uninstall:mod -- --prune # 删除未被引用的载荷；确认 Discord 已关闭且没有安装器在运行
```

开发者命令不会锁定目标。不要让它和 macOS 应用、Windows 安装器或其他开发者命令同时改同一份 Discord。重叠运行不受支持。若一次安装被打断，等其他操作结束后再执行一次即可修复。

`npm run build` 会生成 macOS DMG，需要 Xcode Command Line Tools。
Windows 安装器由 GitHub Actions 使用 `installer/` 中锁定的 Go 依赖构建。

```powershell
node scripts/prepare-installer-payload.js
cd installer
go mod download
go test ./internal/...
go run github.com/akavel/rsrc@v0.10.2 -ico babel.ico -manifest babel.manifest -o rsrc.syso
$env:CGO_ENABLED="0"
go build -ldflags "-H windowsgui -s -w" -o Babel-Installer.exe .
```

</details>

## 许可证

MIT © [麦格](https://x.com/Samoye)

⭐ 如果 Babel 让 Discord 里的交流更轻松，欢迎给这个项目点一个 Star。
