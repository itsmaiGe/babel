// Babel installer — a small Go + giu GUI that patches/unpatches Discord, mirroring
// the Vencord installer approach. The plugin payload is embedded into the exe, so
// it is a single self-contained file with no Node.js requirement.
//
// The UI is Chinese; we load Microsoft YaHei (msyh.ttc, shipped with Windows) so
// Dear ImGui can render CJK glyphs — its default font cannot.
package main

import (
	"embed"
	"image/color"
	"io/fs"

	"github.com/AllenDang/giu"

	"babel-installer/internal/core"
)

//go:embed all:payload
var payloadFS embed.FS

var status = "点击「安装」即可把 Babel 翻译插件装进 Discord。\n" +
	"安装或卸载后，请彻底退出 Discord（托盘图标 > 退出 Discord）再重新打开。"

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
		status = "安装失败：\n" + err.Error()
	} else {
		status = msg + "\n\n现在请彻底退出 Discord（托盘 > 退出 Discord）再重新打开。"
	}
	giu.Update()
}

func runUninstall() {
	msg, err := core.Uninstall(core.DiscordBaseDir())
	if err != nil {
		status = "卸载失败：\n" + err.Error()
	} else {
		status = msg + "\n\n请重启 Discord。"
	}
	giu.Update()
}

// Discord brand blurple, used for the primary (Install) button.
var (
	blurple        = color.RGBA{R: 0x58, G: 0x65, B: 0xF2, A: 0xff}
	blurpleHovered = color.RGBA{R: 0x4a, G: 0x55, B: 0xd0, A: 0xff}
	blurpleActive  = color.RGBA{R: 0x40, G: 0x49, B: 0xb8, A: 0xff}
)

func loop() {
	giu.SingleWindow().Layout(
		giu.Dummy(0, 8),
		giu.Label("Babel · Discord 翻译插件"),
		giu.Label("一键为 Discord 安装 / 卸载翻译插件，无需 Node.js。").Wrapped(true),
		giu.Dummy(0, 12),
		giu.Separator(),
		giu.Dummy(0, 16),
		giu.Row(
			giu.Style().
				SetColor(giu.StyleColorButton, blurple).
				SetColor(giu.StyleColorButtonHovered, blurpleHovered).
				SetColor(giu.StyleColorButtonActive, blurpleActive).
				To(
					giu.Button("安装").OnClick(runInstall).Size(190, 46),
				),
			giu.Button("卸载").OnClick(runUninstall).Size(190, 46),
		),
		giu.Dummy(0, 16),
		giu.Separator(),
		giu.Dummy(0, 10),
		giu.Label(status).Wrapped(true),
	)
}

func main() {
	wnd := giu.NewMasterWindow("Babel 安装器", 500, 360, giu.MasterWindowFlagsNotResizable)
	// Microsoft YaHei ships with Windows and carries the CJK glyphs ImGui's default
	// font lacks. giu auto-registers the strings used below, so the needed glyphs
	// are rasterized; the larger size also makes the UI look cleaner.
	giu.Context.FontAtlas.SetDefaultFont("msyh.ttc", 18)
	wnd.Run(loop)
}
