# Babel

A lightweight Discord translator for **macOS and Windows**. Double-click any message
to translate it in place, type in a floating box to translate-then-send, or turn on
auto-translate to render new messages automatically. Bring your own AI provider —
OpenAI, Claude, Gemini, DeepSeek, Kimi, Zhipu, OpenRouter, or any OpenAI-compatible
endpoint.

> Named after the Tower of Babel — the wall of language this plugin is meant to tear down.

It installs a BetterDiscord-style desktop-core hook: it backs up Discord's original
loader, then patches it to load the Babel runtime into Discord's renderer. No Discord
token is used and Discord's private APIs are never called.

```txt
# macOS
~/Library/Application Support/discord/app-*/modules/discord_desktop_core-*/discord_desktop_core/index.js
# Windows
%LOCALAPPDATA%\Discord\app-*\modules\discord_desktop_core-*\discord_desktop_core\index.js
```

## Features

- **Read translation** — double-click a message to translate it in place; double-click
  again to hide it. Replies translate both the quoted preview and the body.
- **Send translation** — a draggable, resizable floating input box: type, press Enter,
  and Babel translates then sends.
- **Auto-translate** — optionally translate new incoming messages automatically. It only
  touches messages that arrive *after* you enable it (never the backlog), and skips
  messages already in your target language.
- **Bring your own key** — pick a provider and model, paste your API key, and go.
- **Native styling** — the settings UI reuses Discord's own components and follows the
  active theme. Style translations with background on/off, marker / wavy / bold / faded,
  custom colors, and fonts.
- **Proxy-aware** — provider requests go through Electron's network stack, so they honor
  your system / Discord proxy (a common cause of "fetch failed" on other plugins).

## Install

Grab the latest installer from the [**Releases**](https://github.com/itsmaiGe/babel/releases/latest) page.

### Windows
Download **`Babel-Installer.exe`** — a single self-contained app (Go + giu GUI, plugin
embedded; no Node.js required). Double-click it, then click **Install**.

### macOS
Download **`Babel Manager.dmg`**, open it, and run **Babel Manager** (drag it to
Applications first if you like). Click **Install**. It's a native arm64 Cocoa app that
launches Node via `arch -arm64`, so it never triggers a Rosetta prompt, and it needs no
administrator rights.

### After installing (both platforms)
**Fully quit Discord** — system tray → Quit Discord, not just closing the window — and
reopen it. Babel then appears in **Discord Settings → Babel**.

## Usage

1. Open **Discord Settings → Babel**.
2. Under **Model**, choose your AI provider and model and paste your API key.
3. Under **Translation**, set your read/send target languages, tone, enable the send box
   and/or auto-translate.
4. Double-click a message to translate it; use the floating box to translate-and-send.

## Staying updated

- **In-app update check** — on startup Babel checks GitHub for a newer release and, if one
  exists, shows a notice with a download link in the settings footer.
- **To update**, download the latest installer and run it again — it overwrites the
  existing install in place.
- **Discord updates remove the plugin.** When Discord auto-updates it replaces the
  versioned core module folder, dropping the hook. Just run the installer again afterward.

## Privacy & security

- **Your messages and the text you translate are sent to the AI provider you choose**
  (e.g. OpenAI / Anthropic / Google). Use a provider you trust; review its data policy.
- **API keys are encrypted at rest** via the OS keystore (Electron `safeStorage`:
  Keychain on macOS, DPAPI on Windows), stored locally in Discord's userData folder. They
  are never written in plaintext and never leave your machine except as the
  `Authorization` header to your chosen provider.
- **Uninstalling wipes everything** — settings, API keys, and cache are deleted on uninstall.

## Development

```bash
npm test              # unit tests (node --test)
npm run build         # builds dist/Babel Manager.dmg (macOS) — needs Xcode CLT
npm run install:mod   # dev install from source (needs Node; macOS/Windows/Linux)
npm run uninstall:mod # dev uninstall + config cleanup
npm run verify        # test + build + dist signature check
```

The Windows `.exe` is built on a Windows CI runner (`installer/`, Go + giu); see
`.github/workflows/build.yml`. To build it yourself on Windows:

```bash
node scripts/prepare-installer-payload.js   # populate installer/payload/
cd installer && go mod tidy && go build -ldflags "-H windowsgui" -o Babel-Installer.exe .
```

## License

MIT © Maige — [x.com/unflwMaige](https://x.com/unflwMaige)
