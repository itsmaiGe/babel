<div align="center">
  <img src="assets/babel-icon.png" width="96" alt="Babel icon" />
  <h1>Babel</h1>
  <p><strong>AI translation inside Discord, without a full client-mod framework.</strong></p>
  <p>Double-click a message to translate it, translate your own text before sending, or automatically translate new messages.</p>

  <p>
    <a href="https://github.com/itsmaiGe/babel/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/itsmaiGe/babel?style=flat-square&color=5865F2" /></a>
    <img alt="Windows and macOS" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-24292f?style=flat-square" />
    <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square" /></a>
  </p>

  <p>
    <a href="#-preview">Preview</a> •
    <a href="#-features">Features</a> •
    <a href="#-install">Install</a> •
    <a href="#-how-to-use">How to use</a> •
    <a href="#-faq">FAQ</a> •
    <a href="README.md">简体中文</a>
  </p>
</div>

> Babel is named after the Tower of Babel. The tower failed because people could no
> longer understand one another; this plugin tries to remove that wall inside Discord.

## 📸 Preview

These are real Babel settings running inside Discord. The provider details are example
values; **Babel does not include an API key**.

<table>
  <tr>
    <td width="50%" valign="top">
      <p><strong>Model and message translation</strong></p>
      <img src="assets/screenshots/settings-overview.png" alt="Babel model and message translation settings inside Discord" />
    </td>
    <td width="50%" valign="top">
      <p><strong>Send translation and appearance</strong></p>
      <img src="assets/screenshots/settings-translation.png" alt="Babel send translation and translation appearance settings inside Discord" />
    </td>
  </tr>
</table>

## ✨ Why Babel?

BetterDiscord and Vencord are great when you want a complete mod framework. Babel is
for people who only want translation.

- **Standalone and focused**: one translator, one small runtime, no plugin framework.
- **Use the AI you already trust**: cloud providers, custom OpenAI-compatible APIs,
  Ollama, or LM Studio.
- **Feels like Discord**: settings reuse Discord's native controls and follow the active
  theme.
- **Translation where you need it**: incoming messages, replies, your own outgoing text,
  and new-message auto-translation.

## 🚀 Features

| Feature | What it does |
| --- | --- |
| Double-click translation | Translates a message in place. Double-click again to hide it. Replies translate the quoted preview and reply body separately. |
| Send translation | A movable, resizable input above Discord's composer translates your text before sending. Disable auto-send when you want to review the result first. |
| Auto-translate | Translates only messages that arrive after you enable it. It never translates the channel backlog and skips messages already in your target language. |
| Translation styles | Natural, casual, literal, concise, gaming, formal, or your own custom prompt. |
| Appearance | Put translations above or below the original, hide the background, and adjust colors, fonts, emphasis, and input opacity. |
| Persistent cache | Reuses matching translations to reduce repeated requests, latency, and model cost. |
| Native proxy support | Provider requests use Electron's network stack and follow the system or Discord proxy. |

### Supported providers

| Cloud | Local and custom |
| --- | --- |
| OpenAI, Google Gemini, Claude, DeepSeek, Z.AI, Kimi, OpenRouter | Ollama, LM Studio, and OpenAI-compatible endpoints |

Cloud providers require **your own API key and quota**. Ollama and LM Studio can run
without a cloud API key.

## 📦 Install

Download the latest release:

<p>
  <a href="https://github.com/itsmaiGe/babel/releases/latest/download/Babel-Installer.exe"><strong>Windows: Babel-Installer.exe</strong></a><br />
  <a href="https://github.com/itsmaiGe/babel/releases/latest/download/Babel.Manager.dmg"><strong>macOS: Babel Manager.dmg</strong></a>
</p>

### Windows

1. Run **`Babel-Installer.exe`**.
2. The installer normally finds Discord automatically. If Discord was moved, paste the
   Discord folder, an `app-*` folder, or the full `Discord.exe` path.
3. Click **安装**.

The current Windows build is for **64-bit Windows**. SmartScreen may warn because the
open-source installer is not code-signed. Verify that it came from this repository's
Releases page before choosing to run it.

### macOS

1. Open **`Babel Manager.dmg`**.
2. Run **Babel Manager** and click **Install**.

The current macOS build is for **Apple Silicon (M1 or newer)**.

### Finish the installation

On either platform, fully quit Discord and reopen it. Closing only the window is not
enough: use **system tray → Quit Discord** on Windows or **Discord → Quit Discord** on
macOS. Babel will then appear under **Discord Settings → Babel**.

## 🎮 How to use

1. Open **Discord Settings → Babel**.
2. Choose a provider and model, then save your API key if the provider needs one.
3. Pick the language and translation style you want.
4. Double-click a message to translate it.

For outgoing text, enable **Send Translation** in Babel settings. For automatic incoming
translation, enable **Auto-translate new messages**; only new messages are affected.

## 🔄 Updating

- Open **Discord Settings → Babel**, scroll to the footer, and click **Check for updates**.
- Download the new installer and run it again. It updates the existing installation in
  place; your settings are kept.
- Discord itself may replace its desktop-core folder during an update. If Babel
  disappears afterward, simply run the installer again.

## 🔐 Privacy

- Text you translate is sent to the AI provider you selected. Review that provider's
  privacy policy and use one you trust.
- API keys are encrypted locally with Electron `safeStorage` (Keychain on macOS, DPAPI
  on Windows). They are only sent to the provider you configured.
- Babel never reads your Discord token and does not call Discord's private APIs.
- Uninstalling Babel removes its settings, encrypted API keys, and translation cache.

## ❓ FAQ

<details>
<summary><strong>Why did Babel disappear after Discord updated?</strong></summary>

Discord installs updates into a new versioned desktop-core folder. That replaces the
hook Babel used. Run the latest installer again, then fully quit and reopen Discord.

</details>

<details>
<summary><strong>Why can a Discord update break the settings UI?</strong></summary>

Babel stays small by reusing Discord's native interface instead of shipping a second UI
framework. When Discord changes those internal components, Babel may need a compatibility
update. Check the latest release first if controls disappear or dropdowns stop opening.

</details>

<details>
<summary><strong>Can Babel coexist with BetterDiscord?</strong></summary>

The installer preserves an existing BetterDiscord loader, but BetterDiscord may still
show its generic “another client mod” warning. If maximum BetterDiscord stability matters
more than a standalone translator, use one client mod at a time.

</details>

<details>
<summary><strong>What does “fetch failed” or a timeout mean?</strong></summary>

The request did not complete normally. Check the provider URL, system proxy or VPN, DNS,
and whether the model service is responding. A timeout means Babel cancelled a request
that took too long; retrying is usually enough when it only happens occasionally.

</details>

<details>
<summary><strong>Is Babel stable?</strong></summary>

Babel is still an early project and Discord's internal updates can cause regressions.
Please report reproducible problems in [Issues](https://github.com/itsmaiGe/babel/issues).

</details>

<details>
<summary><strong>Development</strong></summary>

```bash
npm ci
npm test
npm run install:mod   # install the current source build
npm run uninstall:mod # remove Babel and its local data
```

`npm run build` creates the macOS DMG and requires Xcode Command Line Tools. The Windows
installer is built by GitHub Actions from the pinned Go dependencies in `installer/`.

```powershell
node scripts/prepare-installer-payload.js
cd installer
go mod download
go test ./internal/...
go run github.com/akavel/rsrc@v0.10.2 -ico babel.ico -o rsrc.syso
go build -ldflags "-H windowsgui -s -w" -o Babel-Installer.exe .
```

</details>

## License

MIT © [Maige](https://x.com/unflwMaige)

⭐ If Babel makes Discord easier to understand, consider starring the repository.
