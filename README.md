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

以下截图来自 0.1.5，展示基本使用方式；0.1.6 已调整设置布局，实际界面以当前版本为准。
**Babel 不内置 API Key，需要使用你自己的模型服务。**

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
- **模型自由**：支持常见云端平台、自定义接口，以及 Ollama、LM Studio 本地模型。
- **贴近 Discord**：设置尽量复用 Discord 原生组件，并跟随当前主题。
- **覆盖常用场景**：阅读消息、引用回复、发送文字和新消息自动翻译都能处理。

## 🚀 主要功能

| 功能 | 说明 |
| --- | --- |
| 双击翻译 | 双击消息，在原文旁显示译文；再次双击即可隐藏。引用预览与回复正文分别翻译。 |
| 输入翻译框 | 在 Discord 输入框上方翻译要发送的文字，可移动、调整宽度。关闭「回车发送」后，译文先填入原生输入框，由你确认发送。 |
| 自动翻译新消息 | 只处理开启后收到的新消息，跳过目标语言，不翻译频道历史记录。 |
| 翻译风格 | 自然、口语、意译、直译、简洁、游戏、正式，也可以编写自己的翻译提示词。 |
| 译文外观 | 调整位置、样式、字体、强调和颜色。颜色带有名称与预览，选择「自动」即可跟随 Discord 主题。 |
| 本地缓存 | 自动保存译文，匹配的翻译优先复用；相同的并发请求会合并，减少重复调用。可随时清除缓存。 |
| 多语言界面 | 插件与安装器支持简体中文、繁體中文、English 和日本語，自动跟随系统语言。 |
| 系统代理 | 翻译请求使用 Discord 所在的 Electron 网络环境，跟随系统或 Discord 的代理设置。 |

### 支持的平台与接口

| 云端平台 | 本地与自定义 |
| --- | --- |
| OpenAI、Google Gemini、Claude、DeepSeek、智谱 / Z.AI、Kimi、OpenRouter | Ollama、LM Studio，以及支持下列协议的自定义接口 |

自定义接口支持 **Chat Completions、Responses、Messages**；OpenAI 支持选择
Chat Completions 或 Responses。按服务商说明选择协议，不需要调整 temperature 等生成参数。

云端平台需要使用**你自己的 API Key 和额度**。Ollama 与 LM Studio 通常不需要云端 API Key。
模型是否可用，取决于所选服务是否支持该模型与协议的组合。

## 📦 安装

直接下载最新版本：

<p>
  <a href="https://github.com/itsmaiGe/babel/releases/latest/download/Babel-Installer.exe"><strong>Windows：Babel-Installer.exe</strong></a><br />
  <a href="https://github.com/itsmaiGe/babel/releases/latest/download/Babel.Manager.dmg"><strong>macOS：Babel Manager.dmg</strong></a>
</p>

### Windows

1. 下载并运行 **`Babel-Installer.exe`**。
2. 确认安装器找到的 Discord 路径。如果 Discord 被移动过，可以填入 Discord 文件夹、
   `app-*` 文件夹或 `Discord.exe` 的完整路径。
3. 点击 **安装 / 更新**。安装器会先退出所选的 Discord，再完成安装。
4. 成功后点击 **重启 Discord**，重新打开 Discord 并退出安装器。

支持 **Windows x64**。安装器暂未签名，SmartScreen 可能提示警告；请确认文件来自本仓库的 Releases 页面。

### macOS

1. 下载并打开 **`Babel Manager.dmg`**。
2. 运行 **Babel Manager**，确认目标目录后点击 **安装 / 更新**。
3. 成功后点击 **重启 Discord**，重新打开 Discord 并退出安装器。

支持 **Apple Silicon（M1 及更新机型）**。应用暂未公证。

如果提示无法访问 Discord 数据，通过安装器的 **文件 → 选择 Discord 文件夹…**
（英文界面为 **File → Choose Discord folder…**）选择窗口中显示的目录，再重试。

### 安装完成后

打开 **Discord 设置 → Babel** 即可开始配置。如果自动重启失败，按安装器提示彻底退出
Discord 后重新打开；只关闭窗口不算退出。

发布页同时提供 **SHA256SUMS**，可用于核对下载文件的完整性。

## 🎮 使用方法

1. 打开 **Discord 设置 → Babel**，在 **模型** 中选择服务商、填写 API Key，并选择或输入模型。
2. 使用自定义服务时，填写 API 地址，并按服务商说明选择 **接口协议**。
3. 点击 **测试连接**，确认配置能够完成翻译；再点击页面底部的 **保存**。
4. 在 **翻译** 中设置阅读语言、发送语言和翻译风格，然后保存。
5. 双击一条消息，即可原地查看译文。

需要翻译自己要发送的文字时，开启 **输入翻译框**。开启 **回车发送** 可直接发送译文；
关闭后，先在 Discord 原生输入框中确认。翻译期间按 **Esc** 可以取消，并保留原文。

需要自动阅读频道新消息时，开启 **自动翻译新消息**。它不会回头处理历史记录。

页面底部集中提供 **保存、放弃更改、打开配置文件夹、清除翻译缓存**。
缓存默认开启，无需另外设置。界面语言跟随系统，阅读和发送的目标语言可以分别选择。

Babel 不会覆盖原生输入框中已有的草稿。翻译期间切换频道、修改草稿或回复对象，
会取消本次发送，保留翻译框里的原文。

## 🔄 更新

- 打开 **Discord 设置 → Babel**，滚动到页面底部，点击 **检查更新**。
- 下载新安装器并重新运行即可覆盖更新，原有设置会保留。
- Discord 自身更新时可能会替换 desktop-core 目录。如果更新后 Babel 消失，
  重新运行一次安装器，完成后点击 **重启 Discord** 即可。

## 🔐 隐私说明

- 需要翻译的文字会发送给你选择的服务商，请使用你信任的服务并了解其隐私政策。
- API Key 在本机加密保存，使用 macOS Keychain 或 Windows DPAPI 提供的系统能力。
  自定义接口的密钥按接口地址隔离；更改地址后，请检查密钥状态。
- 建议使用 HTTPS。远程 HTTP 接口需要单独允许，授权只适用于当前地址。
- Babel 不会读取 Discord Token，也不会直接请求 Discord 的消息接口；发送译文使用原生输入框。
- 普通卸载保留设置、加密 API Key 和翻译缓存。只有明确勾选清除所选客户端的数据，且入口恢复成功后，才会删除该数据目录。其他客户端的数据不会被删除。

## ❓ 常见问题

<details>
<summary><strong>Discord 更新后 Babel 为什么消失了？</strong></summary>

Discord 更新会安装新的版本目录，并替换 Babel 注入过的 desktop-core。
重新运行最新版安装器，完成后点击 **重启 Discord** 即可。Babel 不会常驻一个后台进程来自动重装。

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
<summary><strong>模型能出现在列表里，为什么翻译仍然失败？</strong></summary>

获取模型列表与实际生成译文是两次不同的请求。列表中有这个模型，不代表当前服务已经支持它的生成接口。
先核对模型 ID、接口协议、密钥权限和额度，再点击 **测试连接**。

如果使用反向代理或中转服务，还需要确认它已正确转发所选协议。Babel 不会根据模型名称猜测协议，
也不会在出错后自动尝试其他协议。服务端不支持的组合，无法仅靠客户端选择模型解决。

</details>

<details>
<summary><strong>请求失败或超时，应该检查什么？</strong></summary>

根据提示检查 API 地址、密钥、额度、接口协议和服务状态。网络错误还需要检查系统代理或 VPN。
偶发超时可以重试；持续失败时，先用 **测试连接** 确认配置。

</details>

<details>
<summary><strong>卸载会删除设置和 API Key 吗？</strong></summary>

普通卸载会保留设置、加密 API Key 和翻译缓存。只有在安装器中明确选择清除保存的数据，
才会清理所选 Discord 客户端对应的数据目录。

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
