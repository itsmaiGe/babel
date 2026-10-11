package ui

import (
	"babel-installer/internal/core"
	"babel-installer/internal/i18n"
	"errors"
	"os"
	"strings"
	"syscall"
	"testing"
)

func TestLocalizedStepsAndSafeErrors(t *testing.T) {
	for _, locale := range []string{"en", "zh-Hans", "zh-Hant", "ja"} {
		for action := range StepIDs {
			for state := range StateIDs {
				text := StepText(locale, core.StepResult{Path: "fixture", Action: action, State: state, DetailID: "common.detail.kept"})
				if text == "" || strings.Contains(text, "common.") {
					t.Fatal(locale, text)
				}
			}
		}
		text := ErrorText(locale, core.Message("common.error.profileUnsafe", nil, errors.New("private authored diagnostic")))
		if strings.Contains(text, "private") || text != i18n.T(locale, "common.error.profileUnsafe", nil) {
			t.Fatal(locale, text)
		}
		text = ErrorText(locale, &os.PathError{Op: "open", Path: "fixture", Err: syscall.EACCES})
		if !strings.Contains(text, i18n.T(locale, "common.systemMessage", map[string]any{"message": ""})) {
			t.Fatal(locale, text)
		}
	}
}

func TestCleanupWarningTextNamesTheKeptFileAndTheSystemCause(t *testing.T) {
	cause := &os.PathError{Op: "remove", Path: "fixture", Err: syscall.EACCES}
	for _, locale := range []string{"en", "zh-Hans", "zh-Hant", "ja"} {
		text := ErrorText(locale, core.Message("common.detail.previousFileKept", nil, cause))
		kept := i18n.T(locale, "common.detail.previousFileKept", nil)
		system := i18n.T(locale, "common.systemMessage", map[string]any{"message": cause.Error()})
		if !strings.Contains(text, kept) || !strings.Contains(text, system) {
			t.Fatal(locale, text)
		}
		if strings.Contains(text, i18n.T(locale, "common.error.operation", nil)) || strings.Contains(text, i18n.T(locale, "common.detail.backupRetained", nil)) {
			t.Fatal(locale, text)
		}
	}
}

func TestPresentActionSeparatesInstallWarningsFromFailures(t *testing.T) {
	warning := PresentAction("install", &core.CleanupWarning{DetailID: "common.detail.payloadKept", Err: os.ErrPermission})
	if warning.Failed || warning.StatusID != "common.installed" || warning.DetailID != "common.detail.payloadKept" || !errors.Is(warning.Warning, os.ErrPermission) {
		t.Fatalf("%#v", warning)
	}
	backup := PresentAction("install", &core.CleanupWarning{DetailID: "common.detail.backupRetained", Err: os.ErrPermission})
	if backup.Failed || backup.StatusID != "common.installed" || backup.DetailID != "common.detail.backupRetained" {
		t.Fatalf("%#v", backup)
	}
	failure := PresentAction("install", errors.New("commit failed"))
	if !failure.Failed || failure.StatusID != "common.incomplete" || failure.DetailID != "" {
		t.Fatalf("%#v", failure)
	}
	uninstall := PresentAction("uninstall", &core.CleanupWarning{DetailID: "common.detail.payloadKept", Err: os.ErrPermission})
	if !uninstall.Failed || uninstall.StatusID != "common.incomplete" {
		t.Fatalf("uninstall must stay incomplete: %#v", uninstall)
	}
	if installed := PresentAction("install", nil); installed.Failed || installed.StatusID != "common.installed" {
		t.Fatalf("%#v", installed)
	}
	if removed := PresentAction("uninstall", nil); removed.Failed || removed.StatusID != "common.uninstalled" {
		t.Fatalf("%#v", removed)
	}
}

func TestOpenOutcomesKeepRecoveryActionable(t *testing.T) {
	secret := errors.New("secret diagnostic")
	for _, locale := range []string{"en", "zh-Hans", "zh-Hant", "ja"} {
		// Open-only failures carry the open title with the actual blocker or
		// target reason, or the manual-open guidance — never quit wording.
		blocked := OpenOutcome(locale, core.Message("win.detail.otherProgram", map[string]any{"name": "helper.exe"}, nil))
		if blocked.Title != i18n.T(locale, "win.openFailed", nil) || !strings.Contains(blocked.Next, "helper.exe") ||
			strings.Contains(blocked.Next, i18n.T(locale, "win.quitSteps", nil)) || strings.Contains(blocked.Next, i18n.T(locale, "win.restartSteps", nil)) {
			t.Fatalf("%s %#v", locale, blocked)
		}
		changed := OpenOutcome(locale, core.Message("common.error.targetChanged", nil, nil))
		if changed.Title != i18n.T(locale, "win.openFailed", nil) || !strings.Contains(changed.Next, i18n.T(locale, "common.error.targetChanged", nil)) {
			t.Fatalf("%s %#v", locale, changed)
		}
		refused := OpenOutcome(locale, nil)
		if refused.Title != i18n.T(locale, "win.openFailed", nil) || refused.Next != i18n.T(locale, "win.openManually", nil) || DialogFlags(refused) != 0x10 {
			t.Fatalf("%s %#v", locale, refused)
		}
		detail := RestartDetailText(locale, "common.detail.notQuit", core.RestartResult{Err: secret})
		if !strings.Contains(detail, i18n.T(locale, "common.detail.notQuit", nil)) || strings.Contains(detail, "secret") {
			t.Fatalf("%s %#v", locale, detail)
		}
		system := RestartDetailText(locale, "common.detail.launchFailed", core.RestartResult{Err: &os.PathError{Op: "create", Path: "fixture", Err: syscall.EACCES}})
		if !strings.Contains(system, i18n.T(locale, "common.detail.launchFailed", nil)) || !strings.Contains(system, i18n.T(locale, "common.systemMessage", map[string]any{"message": ""})) {
			t.Fatalf("%s %#v", locale, system)
		}
	}
}

// TestRestartDetailsReportStageProcessAndNativeCode pins the diagnostics of a
// failed restart: the stage, the process name and PID with its verified path,
// the one zero-time handle reading of the final-check failure, and the system
// cause with its native error code as well as the localized system text.
func TestRestartDetailsReportStageProcessAndNativeCode(t *testing.T) {
	for _, locale := range []string{"en", "zh-Hans", "zh-Hant", "ja"} {
		result := core.RestartResult{
			DetailID: "common.detail.notQuit",
			Stage:    "win.stage.waitTimeout",
			Process:  "Discord.exe",
			PID:      1234,
			Image:    `C:\Users\neutral\AppData\Local\Discord\app-1.0.10\Discord.exe`,
			Err:      syscall.Errno(5),
		}
		text := RestartDetailText(locale, "common.detail.notQuit", result)
		for _, want := range []string{
			i18n.T(locale, "common.detail.notQuit", nil),
			i18n.T(locale, "win.detail.stage", map[string]any{"stage": i18n.T(locale, "win.stage.waitTimeout", nil)}),
			i18n.T(locale, "win.detail.process", map[string]any{"name": "Discord.exe", "pid": 1234}),
			i18n.T(locale, "win.detail.image", map[string]any{"path": result.Image}),
			i18n.T(locale, "win.systemMessageCode", map[string]any{"message": syscall.Errno(5).Error(), "code": 5}),
		} {
			if !strings.Contains(text, want) {
				t.Fatalf("%s missing %q in %q", locale, want, text)
			}
		}
		if strings.Contains(text, "common.") || strings.Contains(text, "win.") {
			t.Fatalf("%s %q", locale, text)
		}
		// The one zero-time reading is shown with its native wait result and
		// never changes the decision.
		result.Observed = &core.RestartObservation{State: "win.state.unsignaled", Result: 258}
		text = RestartDetailText(locale, "common.detail.notQuit", result)
		if !strings.Contains(text, i18n.T(locale, "win.detail.handle", map[string]any{"state": i18n.T(locale, "win.state.unsignaled", nil), "code": 258})) {
			t.Fatalf("%s %q", locale, text)
		}
		// An uncheckable reading keeps the error and its native code.
		result.Observed = &core.RestartObservation{State: "win.state.uncheckable", Err: syscall.Errno(6)}
		text = RestartDetailText(locale, "common.detail.notQuit", result)
		for _, want := range []string{
			i18n.T(locale, "win.detail.handleFailed", map[string]any{"state": i18n.T(locale, "win.state.uncheckable", nil)}),
			i18n.T(locale, "win.systemMessageCode", map[string]any{"message": syscall.Errno(6).Error(), "code": 6}),
		} {
			if !strings.Contains(text, want) {
				t.Fatalf("%s missing %q in %q", locale, want, text)
			}
		}
		// A named blocker message carries the process name exactly once.
		named := RestartDetailText(locale, "win.detail.otherProgram", core.RestartResult{Process: "helper.exe"})
		if !strings.Contains(named, i18n.T(locale, "win.detail.otherProgram", map[string]any{"name": "helper.exe"})) {
			t.Fatalf("%s %q", locale, named)
		}
		// Two system causes are both shown, the first useful one first.
		joined := core.RestartResult{Err: errors.Join(syscall.Errno(5), syscall.Errno(32))}
		text = RestartDetailText(locale, "common.detail.notQuit", joined)
		first := strings.Index(text, i18n.T(locale, "win.systemMessageCode", map[string]any{"message": syscall.Errno(5).Error(), "code": 5}))
		second := strings.Index(text, i18n.T(locale, "win.systemMessageCode", map[string]any{"message": syscall.Errno(32).Error(), "code": 32}))
		if first < 0 || second < 0 || first > second {
			t.Fatalf("%s %q", locale, text)
		}
	}
}

func TestFooterCommandRestartsOnlyOnAnArmedExplicitClick(t *testing.T) {
	for _, c := range []struct {
		control int
		ready   bool
		want    string
	}{
		{2, true, "close"}, // Escape and IDCANCEL only close
		{2, false, "close"},
		{113, true, "restart"},
		{113, false, "close"},
		{1, true, "close"},
		{111, true, "close"},
	} {
		if got := footerCommand(c.control, c.ready); got != c.want {
			t.Fatalf("footerCommand(%d, %v) = %q, want %q", c.control, c.ready, got, c.want)
		}
	}
}

func TestArmedInstallOutcomePointsAtTheRestartButton(t *testing.T) {
	for _, locale := range []string{"en", "zh-Hans", "zh-Hant", "ja"} {
		view := PresentAction("install", nil)
		view.Armed = true
		armed := ActionOutcome(locale, "win", "install", view, nil)
		if armed.Next != i18n.T(locale, "win.openNext", nil) || strings.Contains(armed.Next, i18n.T(locale, "win.openManually", nil)) {
			t.Fatalf("%s %#v", locale, armed)
		}
		warning := PresentAction("install", &core.CleanupWarning{DetailID: "common.detail.payloadKept", Err: os.ErrPermission})
		warning.Armed = true
		kept := ActionOutcome(locale, "win", "install", warning, warning.Warning)
		lines := strings.Split(kept.Next, "\n")
		if len(lines) != 2 || lines[0] != i18n.T(locale, "win.openNext", nil) || lines[1] != i18n.T(locale, "common.cleanupLeftover", nil) || kept.Icon != "warning" {
			t.Fatalf("%s %#v", locale, kept)
		}
		// An unproven install target directs the ordinary launch, and an
		// explicitly elevated manager explains why Close remains.
		plain := ActionOutcome(locale, "win", "install", PresentAction("install", nil), nil)
		if plain.Next != i18n.T(locale, "win.openManually", nil) {
			t.Fatalf("%s %#v", locale, plain)
		}
		elevatedView := PresentAction("install", nil)
		elevatedView.Elevated = true
		elevated := ActionOutcome(locale, "win", "install", elevatedView, nil)
		if elevated.Next != i18n.T(locale, "win.elevatedNext", nil) {
			t.Fatalf("%s %#v", locale, elevated)
		}
		// Uninstalling does not stop a running Discord: the quit-then-reopen
		// guidance returns so the plugin actually unloads.
		removed := ActionOutcome(locale, "win", "uninstall", PresentAction("uninstall", nil), nil)
		if removed.Next != i18n.T(locale, "win.restartSteps", nil) {
			t.Fatalf("%s %#v", locale, removed)
		}
		// macOS wording and behavior are untouched.
		macInstalled := ActionOutcome(locale, "mac", "install", PresentAction("install", nil), nil)
		if macInstalled.Next != i18n.T(locale, "mac.restartSteps", nil) {
			t.Fatalf("%s %#v", locale, macInstalled)
		}
	}
}

func TestNativeOutcomesStayShortAndDoNotEchoDiagnostics(t *testing.T) {
	secret := errors.New("secret diagnostic")
	for _, locale := range []string{"en", "zh-Hans", "zh-Hant", "ja"} {
		detect := DetectOutcome(locale, nil, nil)
		if detect.Dialog || detect.Icon != "" || detect.Title != i18n.T(locale, "common.ready", nil) || detect.Next != i18n.T(locale, "common.readyNext", nil) {
			t.Fatalf("%s %#v", locale, detect)
		}
		missing := DetectOutcome(locale, secret, nil)
		if missing.Dialog || missing.Icon != "warning" || missing.Title != i18n.T(locale, "win.notFoundTitle", nil) || strings.Contains(missing.Title+missing.Next, "secret") {
			t.Fatalf("%s %#v", locale, missing)
		}
		denied := DetectOutcome(locale, os.ErrPermission, nil)
		if denied.Dialog || denied.Icon != "warning" || denied.Title != i18n.T(locale, "win.permissionTitle", nil) || denied.Next != i18n.T(locale, "win.permission", nil) || strings.Contains(denied.Next, "admin") {
			t.Fatalf("%s %#v", locale, denied)
		}
		payload := DetectOutcome(locale, nil, secret)
		if payload.Dialog || payload.Icon != "error" || DialogFlags(payload) != 0 || strings.Contains(payload.Title+payload.Next, "secret") {
			t.Fatalf("%s %#v", locale, payload)
		}
		installed := ActionOutcome(locale, "win", "install", PresentAction("install", nil), nil)
		if !installed.Dialog || installed.Icon != "information" || DialogFlags(installed) != 0x40 || installed.Title != i18n.T(locale, "common.installed", nil) || installed.Next != i18n.T(locale, "win.openManually", nil) {
			t.Fatalf("%s %#v", locale, installed)
		}
		warning := PresentAction("install", &core.CleanupWarning{DetailID: "common.detail.payloadKept", Err: os.ErrPermission})
		kept := ActionOutcome(locale, "win", "install", warning, warning.Warning)
		if kept.Icon != "warning" || DialogFlags(kept) != 0x40 || kept.Title != i18n.T(locale, "common.installed", nil) || !strings.Contains(kept.Next, i18n.T(locale, "common.cleanupLeftover", nil)) {
			t.Fatalf("%s %#v", locale, kept)
		}
		failed := ActionOutcome(locale, "win", "install", PresentAction("install", secret), secret)
		if failed.Icon != "error" || DialogFlags(failed) != 0x10 || failed.Title != i18n.T(locale, "common.installFailed", nil) || strings.Contains(failed.Title+failed.Next, "secret") {
			t.Fatalf("%s %#v", locale, failed)
		}
		uninstalled := ActionOutcome(locale, "win", "uninstall", PresentAction("uninstall", &core.CleanupWarning{DetailID: "common.detail.payloadKept", Err: secret}), secret)
		if uninstalled.Title != i18n.T(locale, "common.uninstallFailed", nil) || uninstalled.Icon != "error" || DialogFlags(uninstalled) != 0x10 {
			t.Fatalf("%s %#v", locale, uninstalled)
		}
	}
}
