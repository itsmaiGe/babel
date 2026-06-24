# Babel · 巴别

A lightweight Discord translator plugin for **macOS and Windows**. Double-click any
message to translate it in place, or type in a floating box to translate-then-send.
Bring your own AI provider (OpenAI, Claude, Gemini, DeepSeek, and more).

It installs a BetterDiscord-style desktop-core hook: it backs up Discord's original
loader, then patches it to load the Babel runtime into Discord's renderer.

```txt
# macOS
~/Library/Application Support/discord/app-*/modules/discord_desktop_core-*/discord_desktop_core/index.js
# Windows
%LOCALAPPDATA%\Discord\app-*\modules\discord_desktop_core-*\discord_desktop_core\index.js
```

## Install

### macOS
Build (or download) the manager app and double-click it to choose Install / Uninstall:

```bash
npm install
npm run build      # produces dist/Babel Manager.app (+ .zip)
```

If the project lives in iCloud Drive, run the `.zip` copy or the app under
`~/Applications` — iCloud may add extended attributes to `.app` bundles in place.
The manager compiles as a native arm64 Cocoa app and launches Node via `arch -arm64`,
so it never triggers a Rosetta prompt. It needs no administrator rights.

### Windows
**No Node.js required.** Two options (from the GitHub Release):

- **`Babel-Installer.exe`** (recommended) — a single self-contained app (Go + giu GUI,
  payload embedded). Double-click → window with **Install** / **Uninstall** buttons.
- **`Babel-Windows.zip`** (fallback, no exe) — unzip and double-click **`Babel.bat`**
  for the same buttons via a built-in Windows (PowerShell/WinForms) UI.

Both back up Discord's loader, copy the payload, and patch the hook, mirroring the
macOS manager. The `.exe` is built on a Windows CI runner (`installer/`, Go + giu);
see `.github/workflows/build.yml`. To build it yourself on Windows:

```bash
node scripts/prepare-installer-payload.js   # populate installer/payload/
cd installer && go mod tidy && go build -ldflags "-H windowsgui" -o Babel-Installer.exe .
```

### After installing (both platforms)
**Fully quit Discord** (system tray → Quit Discord, not just closing the window) and
reopen it. Babel then appears in **Discord Settings → Babel**.

> **Discord updates remove the plugin.** When Discord auto-updates, it replaces the
> versioned core module folder, which drops the hook. Just run the installer again
> after a Discord update.

## Usage

- **Read:** double-click a message to show its translation; double-click again to hide it.
- **Send:** enable the floating input box in settings, type, press Enter to translate & send.
- Configure provider, model, target languages, translation tone, and translation
  styling (background on/off, marker / wavy / bold / faded, colors, font) in settings.

## Privacy & security

- **Your messages and the text you translate are sent to the AI provider you choose**
  (e.g. OpenAI/Anthropic/Google). Use a provider you trust; see their data policies.
- **API keys are encrypted at rest** via the OS keystore (Electron `safeStorage`:
  Keychain on macOS, DPAPI on Windows) and stored locally in Discord's userData folder.
  They are never written in plaintext and never leave your machine except as the
  `Authorization` header to your chosen provider.
- Babel does **not** use your Discord token and does **not** call Discord's private APIs.

## Development

```bash
npm test              # unit tests
npm run build         # macOS app + Windows package into dist/
npm run install:mod   # dev install from source (needs Node; works on macOS/Windows/Linux)
npm run uninstall:mod
npm run verify        # test + build + dist signature check
```

## License

MIT © 麦格 (Maige) — [x.com/unflwMaige](https://x.com/unflwMaige)
