//go:build windows

package ui

import (
	"babel-installer/internal/core"
	"babel-installer/internal/i18n"
	"encoding/json"
	"golang.org/x/sys/windows"
	"io/fs"
	"os"
	"runtime"
	"strings"
	"unsafe"
)

var user, gdi, common, kernel = windows.NewLazySystemDLL("user32.dll"), windows.NewLazySystemDLL("gdi32.dll"), windows.NewLazySystemDLL("comctl32.dll"), windows.NewLazySystemDLL("kernel32.dll")

// Keep Go pointers visible to the collector until the native call returns.
// Converting them in caller-side helpers to uintptr would lose that lifetime.
func call(dll *windows.LazyDLL, name string, args ...any) uintptr {
	native := make([]uintptr, len(args))
	for i, arg := range args {
		switch value := arg.(type) {
		case uintptr:
			native[i] = value
		case int:
			native[i] = uintptr(value)
		case uint32:
			native[i] = uintptr(value)
		case int32:
			native[i] = uintptr(value)
		case unsafe.Pointer:
			native[i] = uintptr(value)
		case *uint16:
			native[i] = uintptr(unsafe.Pointer(value))
		default:
			panic("unsupported native argument")
		}
	}
	r, _, _ := dll.NewProc(name).Call(native...)
	runtime.KeepAlive(args)
	return r
}
func ptr(s string) *uint16 { p, _ := windows.UTF16PtrFromString(s); return p }

type point struct{ X, Y int32 }
type rect struct{ Left, Top, Right, Bottom int32 }
type message struct {
	Window  uintptr
	ID      uint32
	W, L    uintptr
	Time    uint32
	Point   point
	Private uint32
}
type windowClass struct {
	Size, Style                        uint32
	Proc                               uintptr
	ClassExtra, WindowExtra            int32
	Instance, Icon, Cursor, Background uintptr
	Menu, Name                         *uint16
	SmallIcon                          uintptr
}
type logFont struct {
	Height, Width, Escapement, Orientation, Weight                int32
	Italic, Underline, Strike, Charset, Out, Clip, Quality, Pitch byte
	Face                                                          [32]uint16
}
type nonClient struct {
	Size                                         uint32
	Border, ScrollW, ScrollH, CaptionW, CaptionH int32
	Caption                                      logFont
	SmallW, SmallH                               int32
	Small                                        logFont
	MenuW, MenuH                                 int32
	Menu, Status, Message                        logFont
	Padding                                      int32
}
type workerResult struct {
	Kind          string
	Generation    int
	Path, Message string
	Profile       core.ProfileTarget
	Steps         []core.StepResult
	Restart       core.RestartResult
	Scan          core.RestartResult
	Stopped       bool
	Err           error
}
type manager struct {
	window, instance, font, titleFont uintptr
	controls                          map[int]uintptr
	dpi                               int
	minW, minH, defaultID             int
	generation                        int
	busy, valid, profileRunning       bool
	profile                           core.ProfileTarget
	payload                           fs.FS
	version, status, next, note       string
	locale                            string
	payloadErr                        error
	results                           chan workerResult
	hasIcon                           bool
	iconKind                          string
	restartBase, restartExe           string
}

var app *manager

func (m *manager) t(id string, params ...map[string]any) string {
	var values map[string]any
	if len(params) > 0 {
		values = params[0]
	}
	return i18n.T(m.locale, id, values)
}
func (m *manager) text(id int, value string) {
	call(user, "SetWindowTextW", m.controls[id], ptr(value))
}
func (m *manager) value(id int) string {
	n := call(user, "GetWindowTextLengthW", m.controls[id])
	buf := make([]uint16, n+1)
	call(user, "GetWindowTextW", m.controls[id], unsafe.Pointer(&buf[0]), n+1)
	return windows.UTF16ToString(buf)
}
func (m *manager) enabled(id int, value bool) {
	v := uintptr(0)
	if value {
		v = 1
	}
	call(user, "EnableWindow", m.controls[id], v)
}
func (m *manager) child(id int, class, title string, style, extra uintptr) {
	m.controls[id] = call(user, "CreateWindowExW", extra, ptr(class), ptr(title), 0x40000000|0x10000000|style, 0, 0, 0, 0, m.window, uintptr(id), m.instance, 0)
}
func (m *manager) create() {
	m.child(101, "STATIC", "Babel", 0, 0)
	m.child(102, "STATIC", "v"+m.version, 2, 0)
	m.child(103, "STATIC", m.t("win.path"), 0, 0)
	m.child(104, "EDIT", core.DiscordBaseDir(), 0x10000|0x80, 0x200)
	m.child(105, "BUTTON", m.t("win.redetect"), 0x10000, 0)
	m.child(114, "BUTTON", m.t("win.cleanup"), 0x10000|3|0x2000, 0)
	m.child(115, "STATIC", "", 0, 0)
	m.child(106, "STATIC", "", 3, 0)
	m.child(107, "STATIC", m.status, 0, 0)
	m.child(116, "STATIC", "", 0, 0)
	m.child(108, "msctls_progress32", "", 8, 0)
	m.child(109, "STATIC", m.t("win.details"), 0, 0)
	m.child(110, "EDIT", m.t("common.ready"), 0x10000|4|0x40|0x800|0x200000, 0x200)
	m.child(111, "BUTTON", m.t("win.install"), 0x10000|1, 0)
	m.child(112, "BUTTON", m.t("win.uninstall"), 0x10000, 0)
	m.child(113, "BUTTON", m.t("win.close"), 0x10000, 0)
	call(user, "ShowWindow", m.controls[106], 0)
	call(user, "ShowWindow", m.controls[108], 0)
	m.refreshFont()
	m.layout()
	m.redetect(false)
}
func (m *manager) refreshFont() {
	dpi := call(user, "GetDpiForWindow", m.window)
	if dpi == 0 {
		dpi = 96
	}
	m.dpi = int(dpi)
	var metrics nonClient
	metrics.Size = uint32(unsafe.Sizeof(metrics))
	proc := user.NewProc("SystemParametersInfoForDpi")
	var ok uintptr
	if proc.Find() == nil {
		ok = call(user, "SystemParametersInfoForDpi", 0x29, uintptr(metrics.Size), unsafe.Pointer(&metrics), 0, dpi)
	} else {
		ok = call(user, "SystemParametersInfoW", 0x29, uintptr(metrics.Size), unsafe.Pointer(&metrics), 0)
	}
	old, oldTitle := m.font, m.titleFont
	if ok != 0 {
		m.font = call(gdi, "CreateFontIndirectW", unsafe.Pointer(&metrics.Message))
		title := metrics.Message
		title.Height = title.Height * 4 / 3
		title.Weight = 600
		m.titleFont = call(gdi, "CreateFontIndirectW", unsafe.Pointer(&title))
	} else {
		m.font = call(gdi, "GetStockObject", 17)
		m.titleFont = m.font
	}
	for id, hwnd := range m.controls {
		font := m.font
		if id == 107 {
			font = m.titleFont
		}
		call(user, "SendMessageW", hwnd, 0x30, font, 1)
	}
	if old != 0 && ok != 0 {
		call(gdi, "DeleteObject", old)
	}
	if oldTitle != 0 && oldTitle != old && ok != 0 {
		call(gdi, "DeleteObject", oldTitle)
	}
}
func (m *manager) pixel(edge int) int32 { return int32((edge*m.dpi + 48) / 96) }
func (m *manager) dip(pixel int32) int  { return (int(pixel)*96 + m.dpi - 1) / m.dpi }
func (m *manager) measure(text string, width int) (int, int) {
	return m.measureFont(text, width, m.font)
}
func (m *manager) measureFont(text string, width int, font uintptr) (int, int) {
	dc := call(user, "GetDC", m.window)
	old := call(gdi, "SelectObject", dc, font)
	bounds := rect{Right: m.pixel(width)}
	call(user, "DrawTextW", dc, ptr(text), ^uintptr(0), unsafe.Pointer(&bounds), 0x400|0x10|0x800)
	call(gdi, "SelectObject", dc, old)
	call(user, "ReleaseDC", m.window, dc)
	return m.dip(bounds.Right - bounds.Left), m.dip(bounds.Bottom - bounds.Top)
}
func (m *manager) systemIcon(kind string) uintptr {
	var id uintptr
	switch kind {
	case "information":
		id = 32516
	case "warning":
		id = 32515
	case "error":
		id = 32513
	default:
		return 0
	}
	cx := call(user, "GetSystemMetricsForDpi", 11, uintptr(m.dpi))
	cy := call(user, "GetSystemMetricsForDpi", 12, uintptr(m.dpi))
	if cx == 0 || cy == 0 {
		return 0
	}
	return call(user, "LoadImageW", 0, id, 1, cx, cy, 0)
}
func (m *manager) setIcon(kind string) {
	m.iconKind = kind
	next := m.systemIcon(kind)
	prev := call(user, "SendMessageW", m.controls[106], 0x170, 0, next)
	if prev != 0 {
		call(user, "DestroyIcon", prev)
	}
	if next == 0 {
		m.hasIcon = false
		call(user, "ShowWindow", m.controls[106], 0)
		return
	}
	m.hasIcon = true
	call(user, "ShowWindow", m.controls[106], 5)
}
func (m *manager) defaultButton(id int) {
	m.defaultID = id
	call(user, "SendMessageW", m.window, 0x401, uintptr(id), 0)
	for _, button := range []int{111, 112, 113} {
		style := uintptr(0)
		if button == id {
			style = 1
		}
		call(user, "SendMessageW", m.controls[button], 0xF4, style, 1)
	}
}
func (m *manager) showOutcome(outcome Outcome) {
	m.status = outcome.Title
	m.next = outcome.Next
	m.text(107, m.status)
	m.text(116, m.next)
	m.setIcon(outcome.Icon)
}
func (m *manager) ideal(id int, width int) (int, int) {
	size := point{X: m.pixel(width)}
	call(user, "SendMessageW", m.controls[id], 0x1601, 0, unsafe.Pointer(&size))
	return m.dip(size.X), m.dip(size.Y)
}
func (m *manager) layout() {
	if len(m.controls) == 0 {
		return
	}
	var bounds rect
	call(user, "GetClientRect", m.window, unsafe.Pointer(&bounds))
	w, h := m.dip(bounds.Right), m.dip(bounds.Bottom)
	_, line := m.measure("Ag中文", max(560, w))
	vw, _ := m.measure("v"+m.version, max(560, w))
	_, heading := m.measure("Babel", max(160, w-29-vw))
	_, note := m.measure(m.note, max(538, w-22))
	bw, ch := 75, 23
	for _, id := range []int{111, 112, 113} {
		iw, ih := m.ideal(id, 0)
		bw = max(bw, iw)
		ch = max(ch, ih)
	}
	rw, _ := m.ideal(105, 0)
	_, kh := m.ideal(114, max(538, w-22))
	iconW, iconH := 0, 0
	if m.hasIcon {
		iconW = m.dip(int32(call(user, "GetSystemMetricsForDpi", 11, uintptr(m.dpi))))
		iconH = m.dip(int32(call(user, "GetSystemMetricsForDpi", 12, uintptr(m.dpi))))
	}
	titleWidth := max(538, w-22)
	if m.hasIcon {
		titleWidth = max(160, w-22-iconW-7)
	}
	_, status := m.measureFont(m.status, titleWidth, m.titleFont)
	next := 0
	if m.next != "" {
		_, next = m.measureFont(m.next, titleWidth, m.font)
	}
	layout := ComputeLayout(w, h, Metrics{Line: line, Heading: heading, Control: ch, Button: bw, Redetect: rw, Checkbox: kh, Note: note, Status: status, Next: next, Version: vw, IconW: iconW, IconH: iconH})
	m.minW, m.minH = layout.MinWidth, layout.MinHeight
	for id, r := range layout.Controls {
		left, top, right, bottom := m.pixel(r.X), m.pixel(r.Y), m.pixel(r.X+r.W), m.pixel(r.Y+r.H)
		call(user, "MoveWindow", m.controls[id], uintptr(left), uintptr(top), uintptr(right-left), uintptr(bottom-top), 1)
	}
	if w < m.minW || h < m.minH {
		outer := m.outer(m.minW, m.minH)
		call(user, "SetWindowPos", m.window, 0, 0, 0, uintptr(outer.Right-outer.Left), uintptr(outer.Bottom-outer.Top), 0x16)
	}
}
func (m *manager) outer(w, h int) rect {
	bounds := rect{Right: m.pixel(w), Bottom: m.pixel(h)}
	proc := user.NewProc("AdjustWindowRectExForDpi")
	if proc.Find() == nil {
		call(user, "AdjustWindowRectExForDpi", unsafe.Pointer(&bounds), 0x00c80000|0x40000|0x20000, 0, 0x10000, uintptr(m.dpi))
	} else {
		call(user, "AdjustWindowRectEx", unsafe.Pointer(&bounds), 0x00c80000|0x40000|0x20000, 0, 0x10000)
	}
	return bounds
}
func (m *manager) working(value bool) {
	m.busy = value
	for _, id := range []int{104, 105, 111, 112, 113, 114} {
		m.enabled(id, !value)
	}
	if !value {
		m.enabled(111, m.valid && m.payloadErr == nil)
		m.enabled(112, m.valid)
		m.enabled(114, m.profile.State == "Known")
	}
	flag := uintptr(0)
	if value {
		flag = 1
	}
	call(user, "EnableMenuItem", call(user, "GetSystemMenu", m.window, 0), 0xf060, flag)
	animate := uint32(1)
	call(user, "SystemParametersInfoW", 0x1042, 0, unsafe.Pointer(&animate), 0)
	if value && animate != 0 {
		call(user, "ShowWindow", m.controls[108], 5)
		call(user, "SendMessageW", m.controls[108], 0x40a, 1, 0)
	} else {
		call(user, "SendMessageW", m.controls[108], 0x40a, 0, 0)
		call(user, "ShowWindow", m.controls[108], 0)
	}
}
func (m *manager) redetect(replace bool) {
	if m.busy || m.profileRunning {
		return
	}
	m.clearRestart()
	m.status = m.t("common.detecting")
	m.next = ""
	m.text(107, m.status)
	m.text(116, "")
	m.setIcon("")
	m.profileRunning = true
	m.enabled(111, false)
	m.enabled(112, false)
	generation := m.generation
	value := m.value(104)
	go func() {
		if replace {
			value = core.DiscordBaseDir()
		}
		normalized, err := core.NormalizeDiscordBaseDir(value)
		profile := core.ProfileForTarget(value)
		result := workerResult{Kind: "profile", Generation: generation, Path: normalized, Profile: profile, Err: err}
		if replace {
			result.Kind = "detect"
		}
		m.results <- result
		call(user, "PostMessageW", m.window, 0x8001, 0, 0)
	}()
}
func (m *manager) action(install bool) {
	if m.busy || m.profileRunning || !m.valid {
		return
	}
	m.clearRestart()
	path := m.value(104)
	remove := call(user, "SendMessageW", m.controls[114], 0xf0, 0, 0) == 1
	directory, store := m.profile.Directory, m.profile.Store
	m.working(true)
	m.status = m.t("common.uninstalling")
	if install {
		m.status = m.t("win.installing")
	}
	m.next = ""
	m.text(107, m.status)
	m.text(116, "")
	m.setIcon("")
	m.layout()
	go func() {
		result := workerResult{Kind: "uninstall"}
		if install {
			result.Kind = "install"
			// The Windows transaction stops the selected Discord client under
			// the install lock before anything is published, and runs one
			// bounded read-only check immediately before the commit. Both
			// report only: nothing is ever killed again, and an open Discord
			// is never touched by the completion action.
			hooks := core.InstallHooks{
				Stop: func(target core.InstallTarget) error {
					stop := core.StopDiscord(target.Base, target.Exe)
					result.Restart = stop
					if stop.DetailID != "" {
						return core.Message(stop.DetailID, map[string]any{"name": stop.Process}, stop.Err)
					}
					result.Stopped = true
					return nil
				},
				PreCommit: func(target core.InstallTarget) error {
					found := core.CheckDiscordStopped(target.Base, target.Exe)
					result.Scan = found
					if found.DetailID != "" {
						return core.Message(found.DetailID, map[string]any{"name": found.Process}, found.Err)
					}
					return nil
				},
			}
			_, result.Err = core.InstallWithHooks(path, m.payload, hooks)
			result.Message = store
		} else {
			outcome, err := core.UninstallWithOptions(path, core.UninstallOptions{RemoveProfileData: remove, ProfileDirectory: directory})
			result.Err = err
			result.Steps = outcome.Steps
			result.Message = ""
		}
		result.Profile = core.ProfileForTarget(path)
		m.results <- result
		call(user, "PostMessageW", m.window, 0x8001, 0, 0)
	}()
}

// armOpen replaces Close with Open Discord only when the installed target is
// proven by its own executable and this manager is not elevated: an elevated
// manager must never spawn an elevated Discord, and it keeps Close with the
// ordinary-launch direction instead.
func (m *manager) armOpen() bool {
	base, err := core.NormalizeDiscordBaseDir(m.value(104))
	if err != nil {
		return false
	}
	exe, ok := core.RestartExecutable(base)
	if !ok || core.Elevated() {
		return false
	}
	m.restartBase, m.restartExe = base, exe
	m.text(113, m.t("win.restart"))
	m.layout()
	return true
}

func (m *manager) clearRestart() {
	if m.restartExe == "" {
		return
	}
	m.restartBase, m.restartExe = "", ""
	m.text(113, m.t("win.close"))
	m.layout()
}

func (m *manager) restartReady() bool { return m.restartExe != "" && !m.busy }

// openDiscord revalidates the stored target before anything else. A failure
// keeps the installer open with its cause, and the button only ever launches:
// it never closes or ends any process.
func (m *manager) openDiscord() {
	if m.busy || m.profileRunning || m.restartExe == "" {
		return
	}
	if err := core.VerifyRestartTarget(m.value(104), m.restartBase, m.restartExe); err != nil {
		m.clearRestart()
		outcome := OpenOutcome(m.locale, err)
		m.showOutcome(outcome)
		m.text(110, strings.ReplaceAll(ErrorText(m.locale, err), "\n", "\r\n"))
		call(user, "MessageBoxW", m.window, ptr(outcome.Title+"\r\n\r\n"+outcome.Next), ptr(m.t("win.title")), uintptr(DialogFlags(outcome)))
		m.defaultButton(113)
		m.layout()
		return
	}
	m.working(true)
	m.status = m.t("win.opening")
	m.next = ""
	m.text(107, m.status)
	m.text(116, "")
	m.setIcon("")
	m.layout()
	base, exe := m.restartBase, m.restartExe
	go func() {
		m.results <- workerResult{Kind: "open", Restart: core.OpenDiscord(base, exe)}
		call(user, "PostMessageW", m.window, 0x8001, 0, 0)
	}()
}
func (m *manager) result() {
	result := <-m.results
	if result.Kind == "open" {
		restart := result.Restart
		if restart.DetailID == "" && !restart.Changed {
			// The OS accepted the launch; the installer exits immediately.
			m.working(false)
			call(user, "DestroyWindow", m.window)
			return
		}
		detailID := restart.DetailID
		var outcome Outcome
		switch {
		case restart.Changed:
			// The stored target no longer matches; the button returns to Close
			// and the message leads the user back to a fresh install.
			m.clearRestart()
			detailID = "common.error.targetChanged"
			outcome = OpenOutcome(m.locale, core.Message(detailID, nil, nil))
		case restart.AlreadyOpen:
			// Discord is already open: say so and restore Close. It is never
			// closed or ended here.
			m.clearRestart()
			outcome = Outcome{Title: m.t("win.detail.alreadyOpen"), Next: "", Icon: "information", Dialog: true}
		case restart.OpenManually:
			// The launch itself failed: manual-open guidance only.
			outcome = OpenOutcome(m.locale, nil)
		default:
			// A blocker or query failure keeps its own reason; this action
			// never attempted a quit, so no quit wording may appear.
			outcome = OpenOutcome(m.locale, core.Message(detailID, map[string]any{"name": restart.Process}, restart.Err))
		}
		m.showOutcome(outcome)
		details := m.t("common.target", map[string]any{"path": m.value(104)}) + "\r\n"
		details += strings.ReplaceAll(RestartDetailText(m.locale, detailID, restart), "\n", "\r\n")
		m.text(110, details)
		if outcome.Dialog {
			call(user, "MessageBoxW", m.window, ptr(outcome.Title+"\r\n\r\n"+outcome.Next), ptr(m.t("win.title")), uintptr(DialogFlags(outcome)))
		}
		// The footer button keeps its default role for the next action.
		m.working(false)
		m.defaultButton(113)
		m.layout()
		return
	}
	if result.Kind == "profile" || result.Kind == "detect" {
		m.profileRunning = false
		if result.Generation != m.generation {
			m.redetect(false)
			return
		}
		if result.Kind == "detect" && result.Err == nil {
			m.text(104, result.Path)
		}
		m.valid = result.Err == nil
		m.profile = result.Profile
		switch m.profile.State {
		case "Known":
			m.note = m.t("common.profile.known")
		case "KnownAbsent":
			m.note = m.t("common.profile.absent")
		default:
			m.note = m.t("common.profile.unknown")
		}
		m.text(115, m.note)
		m.showOutcome(DetectOutcome(m.locale, result.Err, m.payloadErr))
		details := m.t("common.target", map[string]any{"path": m.value(104)})
		if result.Err != nil {
			details += "\n" + ErrorText(m.locale, result.Err)
		}
		if m.payloadErr != nil {
			details += "\n" + ErrorText(m.locale, m.payloadErr)
		}
		m.text(110, strings.ReplaceAll(details, "\n", "\r\n"))
		m.working(false)
		if result.Generation == 0 && m.valid && m.payloadErr == nil {
			call(user, "SetFocus", m.controls[111])
		}
		m.layout()
		return
	}
	view := PresentAction(result.Kind, result.Err)
	if result.Kind == "install" && !view.Failed {
		view.Armed = m.armOpen()
		view.Elevated = core.Elevated()
	} else {
		m.clearRestart()
	}
	outcome := ActionOutcome(m.locale, "win", result.Kind, view, result.Err)
	if result.Kind == "install" && view.Failed {
		// The main prompt names the phase in plain words; the details keep the
		// stage, the process and the first useful system cause.
		switch {
		case result.Restart.DetailID != "" && !result.Restart.OpenManually:
			outcome = Outcome{Title: m.t("win.quitFailed"), Next: m.t("win.quitSteps"), Icon: "error", Dialog: true}
		case result.Restart.DetailID != "", result.Scan.DetailID != "":
			// The client is gone and something else blocks, or the final check
			// found something: the accurate category stays in the details.
			outcome = Outcome{Title: m.t("common.installFailed"), Next: failureNext(m.locale, "win", result.Err), Icon: "error", Dialog: true}
		}
		if result.Stopped {
			// Discord was stopped and nothing relaunches it: the next step and
			// the dialog itself point at the Start menu, not only the details.
			outcome.Next += "\n" + m.t("win.detail.stoppedForInstall")
		}
	}
	m.showOutcome(outcome)
	details := m.t("common.target", map[string]any{"path": m.value(104)}) + "\n"
	if result.Kind == "install" {
		details += m.t("common.savedData", map[string]any{"path": result.Message}) + "\n"
	}
	if view.Failed {
		switch {
		case result.Restart.DetailID != "":
			details = RestartDetailText(m.locale, result.Restart.DetailID, result.Restart) + "\n" + details
		case result.Scan.DetailID != "":
			details = RestartDetailText(m.locale, result.Scan.DetailID, result.Scan) + "\n" + details
		default:
			details = ErrorText(m.locale, result.Err) + "\n" + details
		}
	} else if view.DetailID != "" {
		if view.Warning != nil {
			details += ErrorText(m.locale, core.Message(view.DetailID, nil, view.Warning))
		} else {
			details += m.t(view.DetailID)
		}
		details += "\n"
	}
	for _, step := range result.Steps {
		details += StepText(m.locale, step) + "\n"
	}
	if result.Kind == "install" && view.Failed && result.Stopped {
		// Discord was stopped for the install and nothing relaunches it: the
		// user opens it again from the Start menu whenever they want.
		details += m.t("win.detail.stoppedForInstall") + "\n"
	}
	m.text(110, strings.ReplaceAll(strings.ReplaceAll(details, "\r\n", "\n"), "\n", "\r\n"))
	if outcome.Dialog {
		call(user, "MessageBoxW", m.window, ptr(outcome.Title+"\r\n\r\n"+outcome.Next), ptr(m.t("win.title")), uintptr(DialogFlags(outcome)))
	}
	call(user, "SendMessageW", m.controls[114], 0xf1, 0, 0)
	m.profile = result.Profile
	m.working(false)
	if !view.Failed {
		m.defaultButton(113)
		call(user, "SetFocus", m.controls[113])
	}
	m.layout()
}
func windowProc(hwnd uintptr, id uint32, w, l uintptr) uintptr {
	if app == nil {
		return call(user, "DefWindowProcW", hwnd, uintptr(id), w, l)
	}
	switch id {
	case 5:
		app.layout()
		return 0
	case 0x24:
		if app.minW > 0 {
			type minMax struct{ Reserved, MaxSize, MaxPosition, MinTrack, MaxTrack point }
			// WM_GETMINMAXINFO supplies a native-owned MINMAXINFO buffer. It is
			// valid only for this callback and is never retained in Go state.
			info := (*minMax)(unsafe.Pointer(l))
			r := app.outer(app.minW, app.minH)
			info.MinTrack = point{r.Right - r.Left, r.Bottom - r.Top}
		}
		return 0
	case 0x2e0:
		// WM_DPICHANGED supplies a native-owned RECT for this callback.
		// LOWORD(wParam) is the new DPI. Reload the icon at that size.
		r := (*rect)(unsafe.Pointer(l))
		app.refreshFont()
		if dpi := int(w & 0xffff); dpi > 0 {
			app.dpi = dpi
		}
		app.setIcon(app.iconKind)
		call(user, "SetWindowPos", hwnd, 0, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top), 0x14)
		app.layout()
		return 0
	case 0x400:
		id := app.defaultID
		if id == 0 {
			id = 111
		}
		return uintptr(0x534b0000 | id)
	case 0x111:
		control, notification := int(w&0xffff), uint16(w>>16)
		if control == 104 && notification == 0x300 {
			app.generation++
			app.valid = false
			app.clearRestart()
			app.profile = core.ProfileTarget{State: "Unknown"}
			call(user, "SendMessageW", app.controls[114], 0xf1, 0, 0)
			app.enabled(114, false)
			call(user, "SetTimer", hwnd, 1, 300, 0)
			return 0
		}
		switch control {
		case 1, 111:
			app.action(true)
		case 112:
			app.action(false)
		case 105:
			app.redetect(true)
		case 2, 113:
			if footerCommand(control, app.restartReady()) == "restart" {
				app.openDiscord()
				return 0
			}
			call(user, "PostMessageW", hwnd, 0x10, 0, 0)
		}
		return 0
	case 0x113:
		call(user, "KillTimer", hwnd, 1)
		app.redetect(false)
		return 0
	case 0x8001:
		app.result()
		return 0
	case 0x10:
		if !app.busy {
			call(user, "DestroyWindow", hwnd)
		}
		return 0
	case 2:
		call(user, "PostQuitMessage", 0)
		return 0
	}
	return call(user, "DefWindowProcW", hwnd, uintptr(id), w, l)
}
func Run(payload fs.FS, version string, payloadErr error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	call(user, "SetProcessDpiAwarenessContext", ^uintptr(3))
	init := struct{ Size, Classes uint32 }{8, 0x20}
	call(common, "InitCommonControlsEx", unsafe.Pointer(&init))
	app = &manager{controls: map[int]uintptr{}, dpi: 96, defaultID: 111, payload: payload, version: version, payloadErr: payloadErr, locale: i18n.SystemLocale(), results: make(chan workerResult, 4)}
	app.status = app.t("common.detecting")
	app.instance = call(kernel, "GetModuleHandleW", 0)
	name, _ := windows.UTF16PtrFromString("BabelNativeManager")
	class := windowClass{Instance: app.instance, Name: name, Proc: windows.NewCallback(windowProc), Cursor: call(user, "LoadCursorW", 0, 32512), Background: 16}
	class.Size = uint32(unsafe.Sizeof(class))
	class.Icon = call(user, "LoadImageW", app.instance, 1, 1, 0, 0, 0x40)
	class.SmallIcon = class.Icon
	call(user, "RegisterClassExW", unsafe.Pointer(&class))
	outer := app.outer(560, 440)
	app.window = call(user, "CreateWindowExW", 0x10000, unsafe.Pointer(name), ptr(app.t("win.title")), 0x00c80000|0x40000|0x20000, 100, 100, uintptr(outer.Right-outer.Left), uintptr(outer.Bottom-outer.Top), 0, 0, app.instance, 0)
	if app.window == 0 {
		panic("CreateWindowExW failed")
	}
	app.create()
	call(user, "ShowWindow", app.window, 5)
	call(user, "UpdateWindow", app.window)
	call(user, "SetFocus", app.controls[104])
	if len(os.Args) == 3 && os.Args[1] == "--smoke-ui" {
		classes := map[int]string{}
		for id, hwnd := range app.controls {
			buf := make([]uint16, 128)
			call(user, "GetClassNameW", hwnd, unsafe.Pointer(&buf[0]), 128)
			classes[id] = windows.UTF16ToString(buf)
		}
		data, _ := json.Marshal(struct {
			Version  string
			Controls map[int]string
		}{version, classes})
		if err := os.WriteFile(os.Args[2], data, 0600); err != nil {
			panic(err)
		}
		call(user, "PostMessageW", app.window, 0x10, 0, 0)
	}
	var msg message
	for {
		result := call(user, "GetMessageW", unsafe.Pointer(&msg), 0, 0, 0)
		if result == 0 || int32(result) == -1 {
			break
		}
		if call(user, "IsDialogMessageW", app.window, unsafe.Pointer(&msg)) == 0 {
			call(user, "TranslateMessage", unsafe.Pointer(&msg))
			call(user, "DispatchMessageW", unsafe.Pointer(&msg))
		}
	}
}
