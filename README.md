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
dist/Discord Translator Mod Manager.app
dist/Discord Translator Mod Manager.zip
```

Double-click the manager app to choose Install or Uninstall for `/Applications/Discord.app`.
If the project is inside iCloud Drive, use the `.zip` artifact first; it avoids
iCloud adding extended attributes inside the `.app` bundle.

On Apple Silicon Macs, the installer prefers native arm64 Node.js from
`/opt/homebrew/bin/node`. It checks the Node binary with `lipo` before running
it and launches it through `arch -arm64`, so Intel-only Node is skipped before
macOS can prompt for Rosetta.

## Scope

- macOS demo only.
- Does not use user tokens.
- Does not call Discord private APIs.
- Stores the LLM API key in macOS Keychain.
- Injects a local translator runtime into Discord renderer windows.
