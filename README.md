# Discord Translator Mod

macOS demo for a lightweight Discord translator mod.

This modifies the local Discord desktop app by patching `Resources/app.asar`.
It creates a backup before patching and includes an uninstall script that restores
the original archive.

## Commands

```bash
npm install
npm test
npm run build
npm run install:mod
npm run uninstall:mod
```

The build command creates:

```txt
dist/Discord Translator Mod Installer.app
```

Double-click the app to install the demo into `/Applications/Discord.app`.

## Scope

- macOS demo only.
- Does not use user tokens.
- Does not call Discord private APIs.
- Stores the LLM API key in macOS Keychain.
- Injects a local translator runtime into Discord renderer windows.
