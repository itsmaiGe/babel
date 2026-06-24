// Babel installer — a small Go + giu GUI that patches/unpatches Discord, mirroring
// the Vencord installer approach. The plugin payload is embedded into the exe, so
// it is a single self-contained file with no Node.js requirement.
//
// The GUI text is English on purpose: Dear ImGui's default font has no CJK glyphs.
package main

import (
	"embed"
	"io/fs"

	"github.com/AllenDang/giu"

	"babel-installer/internal/core"
)

//go:embed all:payload
var payloadFS embed.FS

var status = "Click Install to add the Babel plugin to Discord.\n" +
	"After installing or removing, fully quit Discord (tray icon > Quit Discord) and reopen it."

func payloadRoot() fs.FS {
	sub, err := fs.Sub(payloadFS, "payload")
	if err != nil {
		return payloadFS
	}
	return sub
}

func runInstall() {
	msg, err := core.Install(core.DiscordBaseDir(), payloadRoot())
	if err != nil {
		status = "Install failed:\n" + err.Error()
	} else {
		status = msg + "\n\nNow fully quit Discord (tray > Quit Discord) and reopen it."
	}
	giu.Update()
}

func runUninstall() {
	msg, err := core.Uninstall(core.DiscordBaseDir())
	if err != nil {
		status = "Uninstall failed:\n" + err.Error()
	} else {
		status = msg + "\n\nRestart Discord."
	}
	giu.Update()
}

func loop() {
	giu.SingleWindow().Layout(
		giu.Label("Babel · Discord Translator"),
		giu.Label("Install or remove the plugin. No Node.js required."),
		giu.Dummy(0, 8),
		giu.Row(
			giu.Button("Install").OnClick(runInstall).Size(170, 38),
			giu.Button("Uninstall").OnClick(runUninstall).Size(170, 38),
		),
		giu.Dummy(0, 10),
		giu.Label(status).Wrapped(true),
	)
}

func main() {
	wnd := giu.NewMasterWindow("Babel Installer", 500, 340, giu.MasterWindowFlagsNotResizable)
	wnd.Run(loop)
}
