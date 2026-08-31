// Babel installer — a small Go + giu GUI that patches/unpatches Discord, mirroring
// the Vencord installer approach. The plugin payload is embedded into the exe, so
// it is a single self-contained file with no Node.js requirement.
//
// The UI is Chinese; we load Microsoft YaHei (msyh.ttc, shipped with Windows) so
// Dear ImGui can render CJK glyphs — its default font cannot.
package main

import (
	"embed"
	"errors"
	"image/color"
	"io/fs"
	"os"

	"github.com/AllenDang/giu"

	"babel-installer/internal/core"
)

//go:embed all:payload
var payloadFS embed.FS

var (
	discordPath = core.DiscordBaseDir()
	status      = "安装器已自动填写 Discord 路径。通常无需修改，直接点击「安装」即可。"
)

func payloadRoot() fs.FS {
	sub, err := fs.Sub(payloadFS, "payload")
	if err != nil {
		return payloadFS
	}
	return sub
}

func runInstall() {
	msg, err := core.Install(discordPath, payloadRoot())
	if err != nil {
		status = friendlyActionError("安装", err)
	} else {
		status = msg + "\n\n安装成功。接下来只需：\n1. 在系统托盘右键 Discord，选择「退出 Discord」\n2. 重新打开 Discord\n\n不需要关闭或重新打开本安装器。"
	}
	giu.Update()
}

func runUninstall() {
	msg, err := core.Uninstall(discordPath)
	if err != nil {
		status = friendlyActionError("卸载", err)
	} else {
		status = msg + "\n\n请彻底退出 Discord 后重新打开。"
	}
	giu.Update()
}

func redetectDiscord() {
	dirs := core.FindDiscordBaseDirs()
	if len(dirs) == 0 {
		status = "没有自动检测到 Discord。请粘贴 Discord 文件夹、app-* 文件夹或 Discord.exe 的完整路径。"
	} else {
		discordPath = dirs[0]
		status = "已检测到 Discord：\n" + discordPath
	}
	giu.Update()
}

func friendlyActionError(action string, err error) string {
	if errors.Is(err, core.ErrDiscordNotFound) || errors.Is(err, core.ErrDiscordCore) {
		return action + "失败：没有在所填路径中找到可用的 Discord。\n\n请确认 Discord 已安装并至少启动过一次，然后填写 Discord 文件夹、app-* 文件夹或 Discord.exe 的完整路径。"
	}
	if errors.Is(err, os.ErrPermission) {
		return action + "失败：没有文件访问权限。\n\n请先从系统托盘彻底退出 Discord，再重试；仍失败时请右键本安装器并选择「以管理员身份运行」。"
	}
	return action + "失败。\n\n请确认 Discord 已彻底退出，并检查上方路径是否正确。\n详细信息：" + err.Error()
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
		giu.Dummy(0, 12),
		giu.Label("Discord 安装目录"),
		giu.InputText(&discordPath).Hint("可粘贴 Discord 文件夹、app-* 文件夹或 Discord.exe").Size(452),
		giu.Button("重新检测").OnClick(redetectDiscord).Size(120, 34),
		giu.Label("支持任意磁盘，安装器不会固定查找 C 盘。").Wrapped(true),
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
	wnd := giu.NewMasterWindow("Babel 安装器", 500, 470, giu.MasterWindowFlagsNotResizable)
	// Microsoft YaHei ships with Windows and carries the CJK glyphs ImGui's default
	// font lacks. giu auto-registers the strings used below, so the needed glyphs
	// are rasterized; the larger size also makes the UI look cleaner. (giu's font
	// API takes the name and size separately.)
	giu.Context.FontAtlas.SetDefaultFont("msyh.ttc")
	giu.Context.FontAtlas.SetDefaultFontSize(18)
	wnd.Run(loop)
}
