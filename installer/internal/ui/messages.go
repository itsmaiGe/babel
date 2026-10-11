package ui

import (
	"babel-installer/internal/core"
	"babel-installer/internal/i18n"
	"errors"
	"io/fs"
	"os"
	"strings"
	"syscall"
)

var StepIDs = map[string]string{"detach": "common.step.detach", "remove backup": "common.step.backup", "remove payload": "common.step.payload", "profile data": "common.step.profile"}
var StateIDs = map[string]string{"done": "common.state.done", "already absent": "common.state.absent", "failed": "common.state.failed", "not attempted": "common.state.skipped", "kept": "common.state.kept"}

// ErrorText never displays an app-authored Error() string. Only OS causes are shown
// under the localized system-message label with their native error code; typed
// parameters contain paths only.
func ErrorText(locale string, err error) string {
	if err == nil {
		return ""
	}
	if joined, ok := err.(interface{ Unwrap() []error }); ok {
		lines := []string{}
		for _, cause := range joined.Unwrap() {
			lines = append(lines, ErrorText(locale, cause))
		}
		return strings.Join(lines, "\n")
	}
	if typed, ok := err.(*core.MessageError); ok {
		lines := append([]string{i18n.T(locale, typed.ID, typed.Params)}, systemLines(locale, typed.Cause)...)
		return strings.Join(lines, "\n")
	}
	lines := append([]string{i18n.T(locale, "common.error.operation", nil)}, systemLines(locale, err)...)
	return strings.Join(lines, "\n")
}

// systemLines renders only the OS causes under the system-message label. Each
// system cause keeps its native error code as well as the localized system
// text, and app-authored causes produce no line at all.
func systemLines(locale string, cause error) []string {
	if cause == nil {
		return nil
	}
	if joined, ok := cause.(interface{ Unwrap() []error }); ok {
		var lines []string
		for _, part := range joined.Unwrap() {
			lines = append(lines, systemLines(locale, part)...)
		}
		return lines
	}
	var path *fs.PathError
	var errno syscall.Errno
	switch {
	case errors.As(cause, &path):
		return []string{systemText(locale, path.Error(), cause)}
	case errors.As(cause, &errno):
		return []string{systemText(locale, errno.Error(), cause)}
	}
	return nil
}

// systemText is one system message: the system's own text and, when the cause
// carries one, the native error code beside it.
func systemText(locale, message string, cause error) string {
	var errno syscall.Errno
	if errors.As(cause, &errno) {
		return i18n.T(locale, "win.systemMessageCode", map[string]any{"message": message, "code": int(errno)})
	}
	return i18n.T(locale, "common.systemMessage", map[string]any{"message": message})
}

// ActionView is the install/uninstall outcome the window may show.
// A post-commit cleanup warning stays on the installed status. Armed reports
// that the installed target is proven and Open Discord replaces Close, and
// Elevated reports an explicitly elevated manager that keeps Close.
type ActionView struct {
	StatusID string
	Failed   bool
	DetailID string
	Warning  error
	Armed    bool
	Elevated bool
}

func PresentAction(kind string, err error) ActionView {
	var warning *core.CleanupWarning
	if kind == "install" && errors.As(err, &warning) {
		return ActionView{StatusID: "common.installed", Failed: false, DetailID: warning.DetailID, Warning: warning.Err}
	}
	if err != nil {
		return ActionView{StatusID: "common.incomplete", Failed: true}
	}
	if kind == "install" {
		return ActionView{StatusID: "common.installed"}
	}
	return ActionView{StatusID: "common.uninstalled"}
}

// Outcome is the short title, next step, and symbol the native window shows.
// Dialog is true only after an explicit install or uninstall.
type Outcome struct {
	Title, Next, Icon string
	Dialog            bool
}

func DetectOutcome(locale string, err, payloadErr error) Outcome {
	if payloadErr != nil {
		return Outcome{Title: i18n.T(locale, "common.error.payloadIntegrity", nil), Next: i18n.T(locale, "common.seeDetails", nil), Icon: "error"}
	}
	if err == nil {
		return Outcome{Title: i18n.T(locale, "common.ready", nil), Next: i18n.T(locale, "common.readyNext", nil)}
	}
	if errors.Is(err, os.ErrPermission) {
		return Outcome{Title: i18n.T(locale, "win.permissionTitle", nil), Next: i18n.T(locale, "win.permission", nil), Icon: "warning"}
	}
	return Outcome{Title: i18n.T(locale, "win.notFoundTitle", nil), Next: i18n.T(locale, "win.notFound", nil), Icon: "warning"}
}

func failureNext(locale, platform string, err error) string {
	if errors.Is(err, os.ErrPermission) {
		if platform == "mac" {
			return i18n.T(locale, "mac.permissionNext", nil)
		}
		return i18n.T(locale, "win.permission", nil)
	}
	var typed *core.MessageError
	if errors.As(err, &typed) && typed.ID != "" {
		return i18n.T(locale, typed.ID, typed.Params) + "\n" + i18n.T(locale, "common.seeDetails", nil)
	}
	return i18n.T(locale, "common.seeDetails", nil)
}

func ActionOutcome(locale, platform, kind string, view ActionView, err error) Outcome {
	if view.Failed {
		title := "common.installFailed"
		if kind == "uninstall" {
			title = "common.uninstallFailed"
		}
		return Outcome{Title: i18n.T(locale, title, nil), Next: failureNext(locale, platform, err), Icon: "error", Dialog: true}
	}
	next := i18n.T(locale, "mac.restartSteps", nil)
	if platform == "win" {
		// Uninstalling does not stop a running Discord: the plugin stays
		// loaded until it is quit and opened again.
		next = i18n.T(locale, "win.restartSteps", nil)
		if kind != "uninstall" {
			next = i18n.T(locale, "win.openManually", nil)
			if view.Elevated {
				// An elevated manager keeps Close and asks for an ordinary
				// manual launch instead of spawning an elevated Discord.
				next = i18n.T(locale, "win.elevatedNext", nil)
			}
			if view.Armed {
				next = i18n.T(locale, "win.openNext", nil)
			}
		}
	} else if view.Armed {
		next = i18n.T(locale, "common.restartNext", nil)
	}
	icon := "information"
	if view.DetailID != "" {
		next += "\n" + i18n.T(locale, "common.cleanupLeftover", nil)
		icon = "warning"
	}
	return Outcome{Title: i18n.T(locale, view.StatusID, nil), Next: next, Icon: icon, Dialog: true}
}

// OpenOutcome is the presentation of one failed open-only attempt: an
// open-specific title with the actual blocker or target reason, or the
// manual-open guidance when the system did not accept the launch. No quit was
// attempted by this action, so no quit wording may appear.
func OpenOutcome(locale string, reason error) Outcome {
	next := i18n.T(locale, "win.openManually", nil)
	if reason != nil {
		next = failureNext(locale, "win", reason)
	}
	return Outcome{Title: i18n.T(locale, "win.openFailed", nil), Next: next, Icon: "error", Dialog: true}
}

// RestartDetailText is the detail block of a failed restart: the app-authored
// cause first, then the stage, the process and its verified path, then the one
// zero-time handle reading of the final-check failure, then the system message
// with its native error code. App-authored causes are never shown.
func RestartDetailText(locale, detailID string, result core.RestartResult) string {
	lines := []string{i18n.T(locale, detailID, map[string]any{"name": result.Process})}
	if result.Stage != "" {
		lines = append(lines, i18n.T(locale, "win.detail.stage", map[string]any{"stage": i18n.T(locale, result.Stage, nil)}))
	}
	if result.Process != "" || result.PID != 0 {
		lines = append(lines, i18n.T(locale, "win.detail.process", map[string]any{"name": result.Process, "pid": int(result.PID)}))
	}
	if result.Image != "" {
		lines = append(lines, i18n.T(locale, "win.detail.image", map[string]any{"path": result.Image}))
	}
	if result.Observed != nil {
		state := i18n.T(locale, result.Observed.State, nil)
		if result.Observed.Err != nil || result.Observed.State == "win.state.uncheckable" {
			// An unknown or ambiguous state is never presented with a wait
			// result code, and its system cause stays visible.
			lines = append(lines, i18n.T(locale, "win.detail.handleFailed", map[string]any{"state": state}))
			lines = append(lines, systemLines(locale, result.Observed.Err)...)
		} else {
			lines = append(lines, i18n.T(locale, "win.detail.handle", map[string]any{"state": state, "code": int(result.Observed.Result)}))
		}
	}
	lines = append(lines, systemLines(locale, result.Err)...)
	return strings.Join(lines, "\n")
}

// footerCommand routes the footer buttons and Escape. Escape and an unarmed
// Close button only close the installer; a restart happens on an explicit
// click of the armed button and never as a side effect of closing.
func footerCommand(control int, restartReady bool) string {
	if control == 113 && restartReady {
		return "restart"
	}
	return "close"
}

// DialogFlags is the single MessageBoxW style. Cleanup warnings stay informational.
func DialogFlags(outcome Outcome) uint32 {
	if !outcome.Dialog {
		return 0
	}
	if outcome.Icon == "error" {
		return 0x10
	}
	return 0x40
}

func StepText(locale string, step core.StepResult) string {
	lines := []string{i18n.T(locale, StepIDs[step.Action], nil) + " — " + i18n.T(locale, StateIDs[step.State], nil), step.Path}
	if step.DetailID != "" {
		lines = append(lines, i18n.T(locale, step.DetailID, nil))
	}
	if step.SystemError != nil {
		lines = append(lines, ErrorText(locale, step.SystemError))
	}
	return strings.Join(lines, "\n")
}
