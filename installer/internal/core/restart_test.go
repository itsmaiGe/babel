package core

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fakeScan struct {
	scan RestartScan
	err  error
}

type fakeRestart struct {
	scans        []fakeScan
	gone         []bool
	waitErrors   []error
	readGone     []bool
	readErrors   []error
	terminateErr error
	launchErr    error
	closed       [][]uint32
	terminated   [][]uint32
	launched     []string
	waitCalls    int
	readCalls    int
}

func useFakeRestart(t *testing.T) *fakeRestart {
	t.Helper()
	fake := &fakeRestart{}
	prevEnumerate, prevClose := restartEnumerate, restartCloseWindows
	prevTerminate, prevWait := restartTerminate, restartWaitGone
	prevLaunch, prevRelease := restartLaunch, restartRelease
	restartEnumerate = func(base, exeName string) (RestartScan, error) {
		if len(fake.scans) == 0 {
			return RestartScan{}, nil
		}
		next := fake.scans[0]
		fake.scans = fake.scans[1:]
		return next.scan, next.err
	}
	restartCloseWindows = func(pids []uint32) error {
		fake.closed = append(fake.closed, append([]uint32(nil), pids...))
		return nil
	}
	restartTerminate = func(procs []RestartProcess) error {
		pids := []uint32{}
		for _, proc := range procs {
			pids = append(pids, proc.PID)
		}
		fake.terminated = append(fake.terminated, pids)
		return fake.terminateErr
	}
	restartWaitGone = func(procs []RestartProcess, timeout time.Duration) (*RestartProcess, error) {
		if timeout == 0 {
			// One zero-time handle reading, kept for the details only.
			fake.readCalls++
			if len(fake.readErrors) > 0 {
				err := fake.readErrors[0]
				fake.readErrors = fake.readErrors[1:]
				return nil, err
			}
			if len(fake.readGone) > 0 {
				gone := fake.readGone[0]
				fake.readGone = fake.readGone[1:]
				if gone {
					return nil, nil
				}
			}
			return &procs[0], nil
		}
		fake.waitCalls++
		if len(fake.waitErrors) > 0 {
			err := fake.waitErrors[0]
			fake.waitErrors = fake.waitErrors[1:]
			return nil, err
		}
		if len(fake.gone) == 0 {
			return nil, nil
		}
		gone := fake.gone[0]
		fake.gone = fake.gone[1:]
		if gone {
			return nil, nil
		}
		// A timeout names the process that had not exited yet.
		return &procs[0], nil
	}
	restartLaunch = func(exe, dir string) error {
		fake.launched = append(fake.launched, exe)
		return fake.launchErr
	}
	restartRelease = func(procs []RestartProcess) {}
	t.Cleanup(func() {
		restartEnumerate, restartCloseWindows = prevEnumerate, prevClose
		restartTerminate, restartWaitGone = prevTerminate, prevWait
		restartLaunch, restartRelease = prevLaunch, prevRelease
	})
	return fake
}

func restartFixture(t *testing.T) (base, exe string) {
	t.Helper()
	base = fakeDiscord(t, "1.0.9", "1.0.10")
	exe = filepath.Join(base, "app-1.0.10", "Discord.exe")
	write(t, exe, "exe")
	return base, exe
}

func TestRestartExecutableUsesTheNewestAppFolder(t *testing.T) {
	base := fakeDiscord(t, "1.0.9", "1.0.10")
	write(t, filepath.Join(base, "app-1.0.9", "Discord.exe"), "old")
	newest := filepath.Join(base, "app-1.0.10", "Discord.exe")
	write(t, newest, "new")
	if got, ok := RestartExecutable(base); !ok || got != newest {
		t.Fatalf("RestartExecutable = %q %v, want %q", got, ok, newest)
	}
	// The newest folder must own the executable; an older copy is not offered.
	os.Remove(newest)
	if _, ok := RestartExecutable(base); ok {
		t.Fatal("executable in an older app folder must not be offered")
	}
	write(t, filepath.Join(base, "app-1.0.10", "DiscordPTB.exe"), "ptb")
	if got, ok := RestartExecutable(base); !ok || !strings.HasSuffix(got, "DiscordPTB.exe") {
		t.Fatalf("RestartExecutable = %q %v, want the PTB executable", got, ok)
	}
	write(t, filepath.Join(base, "app-1.0.10", "DiscordCanary.exe"), "canary")
	if _, ok := RestartExecutable(base); ok {
		t.Fatal("two executables in one app folder must not be offered")
	}
	if _, ok := RestartExecutable(t.TempDir()); ok {
		t.Fatal("a custom folder without app folders must not be offered")
	}
	empty := fakeDiscord(t, "1.0.0")
	if _, ok := RestartExecutable(empty); ok {
		t.Fatal("an app folder without an executable must not be offered")
	}
}

func TestRestartFamilyImageMatchesOnlyTheTargetExecutable(t *testing.T) {
	// Neutral fixture paths: no user folder from this machine is copied here.
	base := `C:\Users\neutral\AppData\Local\Discord`
	for _, c := range []struct {
		image string
		exe   string
		want  bool
	}{
		{`C:\Users\neutral\AppData\Local\Discord\app-1.0.10\Discord.exe`, "Discord.exe", true},
		{`C:\Users\neutral\AppData\Local\Discord\app-1.0.9\Discord.exe`, "Discord.exe", true},
		{`C:\Users\neutral\AppData\Local\Discord\app-1.0.10\Discord.exe`, "DiscordPTB.exe", false},
		{`C:\Users\neutral\AppData\Local\Discord\Update.exe`, "Discord.exe", false},
		{`C:\Users\neutral\AppData\Local\Discord\Discord.exe`, "Discord.exe", false},
		{`C:\Users\neutral\AppData\Local\Discord\app\Discord.exe`, "Discord.exe", false},
		{`C:\Users\neutral\AppData\Local\DiscordPTB\app-1.0.10\DiscordPTB.exe`, "DiscordPTB.exe", false},
		{`C:\Games\Discord\app-1.0.10\Discord.exe`, "Discord.exe", false},
		{``, "Discord.exe", false},
	} {
		if got := restartFamilyImage(base, c.exe, c.image); got != c.want {
			t.Fatalf("restartFamilyImage(%q, %q) = %v, want %v", c.image, c.exe, got, c.want)
		}
	}
	// A selected alias still identifies the canonical installation.
	root := t.TempDir()
	canon := filepath.Join(root, "Discord")
	alias := filepath.Join(root, "alias")
	if err := os.Mkdir(canon, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(canon, alias); err != nil {
		t.Fatal(err)
	}
	image := filepath.Join(canon, "app-1.0.10", "Discord.exe")
	if !restartFamilyImage(alias, "Discord.exe", image) {
		t.Fatal("an alias of the installation must match its canonical image")
	}
}

func TestOpenDiscordLaunchesWhenNothingRuns(t *testing.T) {
	fake := useFakeRestart(t)
	base, exe := restartFixture(t)
	if result := OpenDiscord(base, exe); result.DetailID != "" || result.Err != nil {
		t.Fatalf("%#v", result)
	}
	if len(fake.launched) != 1 || fake.launched[0] != exe {
		t.Fatalf("launched %#v", fake.launched)
	}
	if len(fake.closed) != 0 || len(fake.terminated) != 0 {
		t.Fatalf("no process must be touched: %#v", fake)
	}
}

func TestStopDiscordExitsAfterThePoliteCloseWithoutTerminating(t *testing.T) {
	fake := useFakeRestart(t)
	base, exe := restartFixture(t)
	fake.scans = []fakeScan{{scan: RestartScan{Family: []RestartProcess{{PID: 11, Image: exe}}}}, {}}
	fake.gone = []bool{true}
	if result := StopDiscord(base, exe); result.DetailID != "" {
		t.Fatalf("%#v", result)
	}
	if len(fake.closed) != 1 || len(fake.closed[0]) != 1 || fake.closed[0][0] != 11 {
		t.Fatalf("closed %#v", fake.closed)
	}
	if len(fake.terminated) != 0 {
		t.Fatalf("a clean exit must not be terminated: %#v", fake.terminated)
	}
	if len(fake.launched) != 0 {
		t.Fatalf("stopping never launches: %#v", fake.launched)
	}
}

func TestStopDiscordTerminatesTrayResidentFamily(t *testing.T) {
	fake := useFakeRestart(t)
	base, exe := restartFixture(t)
	// Only the target family is ended: a foreign Update.exe PID in the scan is
	// never closed or terminated.
	fake.scans = []fakeScan{
		{scan: RestartScan{Family: []RestartProcess{{PID: 21, Image: exe}, {PID: 22, Image: exe}}}},
		{},
	}
	fake.gone = []bool{false, true}
	if result := StopDiscord(base, exe); result.DetailID != "" {
		t.Fatalf("%#v", result)
	}
	if len(fake.terminated) != 1 || len(fake.terminated[0]) != 2 {
		t.Fatalf("terminated %#v", fake.terminated)
	}
	if len(fake.launched) != 0 || fake.waitCalls != 2 {
		t.Fatalf("launches %#v waits %d", fake.launched, fake.waitCalls)
	}
}

// A termination error alone is kept as the first meaningful failure but never
// stops the shared bounded exit wait: the process may still exit during it,
// and then the stop succeeds.
func TestStopDiscordSucceedsWhenTheExitHappensDespiteATerminationError(t *testing.T) {
	fake := useFakeRestart(t)
	base, exe := restartFixture(t)
	fake.scans = []fakeScan{
		{scan: RestartScan{Family: []RestartProcess{{PID: 23, Image: exe}}}},
		{},
	}
	fake.gone = []bool{false, true}
	fake.terminateErr = errors.New("terminate denied")
	if result := StopDiscord(base, exe); result.DetailID != "" || result.Err != nil {
		t.Fatalf("%#v", result)
	}
	if len(fake.terminated) != 1 {
		t.Fatalf("terminated %#v", fake.terminated)
	}
}

// When the process stays past the shared deadline, the timeout is reported
// with the kept termination failure as its cause.
func TestStopDiscordReportsTheKeptCauseOfATimeout(t *testing.T) {
	fake := useFakeRestart(t)
	base, exe := restartFixture(t)
	killErr := errors.New("terminate denied")
	fake.scans = []fakeScan{{scan: RestartScan{Family: []RestartProcess{{PID: 24, Image: exe, handle: 240}}}}}
	fake.gone = []bool{false, false}
	fake.terminateErr = stageCause(stageTerminateFailed, RestartProcess{PID: 24, Image: exe, handle: 240}, killErr)
	result := StopDiscord(base, exe)
	if result.DetailID != "common.detail.notQuit" || result.Stage != stageTerminateFailed || !errors.Is(result.Err, killErr) {
		t.Fatalf("%#v", result)
	}
	if result.Process != "Discord.exe" || result.PID != 24 {
		t.Fatalf("%#v", result)
	}
}

func TestStopDiscordStopsBeforeClosingAnUnverifiableProcess(t *testing.T) {
	fake := useFakeRestart(t)
	base, exe := restartFixture(t)
	fake.scans = []fakeScan{{scan: RestartScan{Family: []RestartProcess{{PID: 31, Image: exe}}, Unreadable: []RestartProcess{{PID: 31, Name: "Discord.exe", Cause: errors.New("query failed")}}}}}
	result := StopDiscord(base, exe)
	if result.DetailID != "common.detail.unverified" {
		t.Fatalf("%#v", result)
	}
	if len(fake.closed) != 0 || len(fake.terminated) != 0 || len(fake.launched) != 0 {
		t.Fatalf("nothing may be touched: %#v", fake)
	}
}

func TestStopDiscordBlocksOnTheBaseUpdaterAndNamesOtherPrograms(t *testing.T) {
	fake := useFakeRestart(t)
	base, exe := restartFixture(t)
	// Only the verified base Update.exe keeps the updater message.
	fake.scans = []fakeScan{{scan: RestartScan{Family: []RestartProcess{{PID: 41, Image: exe}}, Foreign: []RestartProcess{{PID: 4242, Name: "Update.exe", Image: filepath.Join(base, "Update.exe"), Updater: true}}}}}
	result := StopDiscord(base, exe)
	if result.DetailID != "common.detail.updaterRunning" || result.OpenManually || result.Process != "Update.exe" {
		t.Fatalf("%#v", result)
	}
	// Any other program inside the base is named in its own message.
	fake.scans = []fakeScan{{scan: RestartScan{Family: []RestartProcess{{PID: 42, Image: exe}}, Foreign: []RestartProcess{{PID: 4243, Name: "helper.exe", Image: filepath.Join(base, "helper.exe")}}}}}
	result = StopDiscord(base, exe)
	if result.DetailID != "win.detail.otherProgram" || result.OpenManually || result.Process != "helper.exe" || result.PID != 4243 {
		t.Fatalf("%#v", result)
	}
	if len(fake.closed) != 0 || len(fake.terminated) != 0 || len(fake.launched) != 0 {
		t.Fatalf("nothing may be touched: %#v", fake)
	}
}

func TestStopDiscordQuitsTimeoutWithoutPublishing(t *testing.T) {
	fake := useFakeRestart(t)
	base, exe := restartFixture(t)
	fake.scans = []fakeScan{{scan: RestartScan{Family: []RestartProcess{{PID: 51, Image: exe, handle: 510}}}}}
	fake.gone = []bool{false, false}
	result := StopDiscord(base, exe)
	if result.DetailID != "common.detail.notQuit" || result.Stage != stageWaitTimeout || result.PID != 51 {
		t.Fatalf("%#v", result)
	}
	if len(fake.terminated) != 1 || len(fake.launched) != 0 {
		t.Fatalf("terminated %#v launched %#v", fake.terminated, fake.launched)
	}
}

func TestStopDiscordDoesNotContinueWhenSomethingIsLeftUnderTheBase(t *testing.T) {
	fake := useFakeRestart(t)
	base, exe := restartFixture(t)
	// A respawned Update.exe appears in the final check.
	fake.scans = []fakeScan{
		{scan: RestartScan{Family: []RestartProcess{{PID: 61, Image: exe}}}},
		{scan: RestartScan{Foreign: []RestartProcess{{PID: 6242, Name: "Update.exe", Image: filepath.Join(base, "Update.exe"), Updater: true}}}},
	}
	fake.gone = []bool{true}
	result := StopDiscord(base, exe)
	if result.DetailID != "common.detail.updaterRunning" || !result.OpenManually {
		t.Fatalf("%#v", result)
	}
	if len(fake.terminated) != 0 || len(fake.launched) != 0 {
		t.Fatalf("terminated %#v launched %#v", fake.terminated, fake.launched)
	}
	// Another program in the final check keeps its own category.
	fake.scans = []fakeScan{
		{scan: RestartScan{Family: []RestartProcess{{PID: 62, Image: exe}}}},
		{scan: RestartScan{Foreign: []RestartProcess{{PID: 6243, Name: "helper.exe", Image: filepath.Join(base, "helper.exe")}}}},
	}
	fake.gone = []bool{true}
	result = StopDiscord(base, exe)
	if result.DetailID != "win.detail.otherProgram" || !result.OpenManually {
		t.Fatalf("%#v", result)
	}
	// A matching process still reported afterwards stops the operation, with
	// the neutral wording and the one zero-time handle reading.
	fake.scans = []fakeScan{
		{scan: RestartScan{Family: []RestartProcess{{PID: 71, Image: exe}}}},
		{scan: RestartScan{Family: []RestartProcess{{PID: 72, Image: exe, handle: 720}}}},
	}
	fake.gone = []bool{true}
	result = StopDiscord(base, exe)
	if result.DetailID != "common.detail.notQuit" || result.OpenManually || result.Stage != stageRescanFound {
		t.Fatalf("%#v", result)
	}
	if len(fake.launched) != 0 {
		t.Fatalf("launched %#v", fake.launched)
	}
}

func TestOpenDiscordReportsLaunchFailureWithManualRecovery(t *testing.T) {
	fake := useFakeRestart(t)
	base, exe := restartFixture(t)
	fake.launchErr = errors.New("access denied")
	result := OpenDiscord(base, exe)
	if result.DetailID != "common.detail.launchFailed" || !result.OpenManually || result.Err == nil {
		t.Fatalf("%#v", result)
	}
	if strings.Contains(result.Err.Error(), "private") {
		t.Fatal("system causes are shown, app diagnostics are not")
	}
}

func TestOpenDiscordOnlyLaunchesAndNeverEndsAnything(t *testing.T) {
	fake := useFakeRestart(t)
	base, exe := restartFixture(t)
	// A running client is reported as already open and never touched.
	fake.scans = []fakeScan{{scan: RestartScan{Family: []RestartProcess{{PID: 81, Image: exe, handle: 810}}}}}
	result := OpenDiscord(base, exe)
	if result.DetailID != "win.detail.alreadyOpen" || !result.AlreadyOpen || result.PID != 81 {
		t.Fatalf("%#v", result)
	}
	if len(fake.closed) != 0 || len(fake.terminated) != 0 || len(fake.launched) != 0 {
		t.Fatalf("nothing may be touched: %#v", fake)
	}
	// Discord may have created a newer app-* folder meanwhile.
	fake.scans = []fakeScan{{}}
	if err := os.MkdirAll(filepath.Join(base, "app-1.0.11"), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(base, "app-1.0.11", "Discord.exe"), "newer")
	result = OpenDiscord(base, exe)
	if !result.Changed || result.DetailID != "" || len(fake.launched) != 0 {
		t.Fatalf("%#v", result)
	}
}

func TestVerifyRestartTargetRejectsAChangedInstallation(t *testing.T) {
	base, exe := restartFixture(t)
	if err := VerifyRestartTarget(base, base, exe); err != nil {
		t.Fatal(err)
	}
	// An alias of the same folder is still the same target.
	alias := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(base, alias); err != nil {
		t.Fatal(err)
	}
	if err := VerifyRestartTarget(alias, base, exe); err != nil {
		t.Fatal(err)
	}
	changed := func(err error) bool {
		var typed *MessageError
		return errors.As(err, &typed) && typed.ID == "common.error.targetChanged"
	}
	if err := VerifyRestartTarget(fakeDiscord(t, "1.0.0"), base, exe); !changed(err) {
		t.Fatalf("another folder must be rejected: %v", err)
	}
	// Discord created a newer app-* folder after the install.
	if err := os.MkdirAll(filepath.Join(base, "app-1.0.11"), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(base, "app-1.0.11", "Discord.exe"), "newer")
	if err := VerifyRestartTarget(base, base, exe); !changed(err) {
		t.Fatalf("a newer app folder must be rejected: %v", err)
	}
	fresh, freshExe := restartFixture(t)
	if err := VerifyRestartTarget(fresh, fresh, freshExe); err != nil {
		t.Fatal(err)
	}
	os.Remove(freshExe)
	if err := VerifyRestartTarget(fresh, fresh, freshExe); !changed(err) {
		t.Fatalf("a removed executable must be rejected: %v", err)
	}
}

func TestTerminateHeldSkipsAlreadyExitedFamilyProcesses(t *testing.T) {
	// A mixed family: one member already exited gracefully or as a side effect
	// of ending another member, the other is still running.
	procs := []RestartProcess{{PID: 1, handle: 101}, {PID: 2, handle: 102}}
	killed := []uintptr{}
	err := terminateHeld(procs,
		func(handle uintptr, ms uint32) (uint32, error) {
			if handle == 101 {
				return waitSignaled, nil
			}
			return 1, nil
		},
		func(handle uintptr) error { killed = append(killed, handle); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if len(killed) != 1 || killed[0] != 102 {
		t.Fatalf("killed %#v, want only the live handle", killed)
	}
}

func TestTerminateHeldKeepsTheFirstFailureWithoutStoppingThePass(t *testing.T) {
	// The first process exits between the precheck and TerminateProcess while
	// the second is still live: the kept failure is the first meaningful one
	// and the pass still makes exactly one attempt per live process.
	attempts := map[uintptr]int{}
	first := windowsErrorAccessDenied()
	err := terminateHeld([]RestartProcess{{PID: 3, handle: 103}, {PID: 4, handle: 104}},
		func(handle uintptr, ms uint32) (uint32, error) { return 1, nil },
		func(handle uintptr) error {
			attempts[handle]++
			if handle == 103 {
				return first
			}
			return nil
		})
	if !errors.Is(err, first) {
		t.Fatalf("first meaningful failure lost: %v", err)
	}
	if attempts[103] != 1 || attempts[104] != 1 {
		t.Fatalf("attempts %#v, want exactly one per live process", attempts)
	}
	// A proved-exited handle is skipped before anything is done to it.
	attempts = map[uintptr]int{}
	err = terminateHeld([]RestartProcess{{PID: 5, handle: 105}},
		func(handle uintptr, ms uint32) (uint32, error) { return waitSignaled, nil },
		func(handle uintptr) error { attempts[handle]++; return nil })
	if err != nil || len(attempts) != 0 {
		t.Fatalf("exited handle: err %v attempts %#v", err, attempts)
	}
}

func TestTerminateHeldDoesNotSwallowWaitFailures(t *testing.T) {
	killed := 0
	err := terminateHeld([]RestartProcess{{PID: 5, handle: 105}},
		func(handle uintptr, ms uint32) (uint32, error) { return 0, errors.New("wait failed") },
		func(handle uintptr) error { killed++; return nil })
	if err == nil || killed != 0 {
		t.Fatalf("precheck wait failure = %v killed %d", err, killed)
	}
	// A genuine wait failure on a later process never swallows the first
	// meaningful failure and never permits further force.
	killCause, waitCause := windowsErrorAccessDenied(), errors.New("wait failed")
	killed = 0
	err = terminateHeld([]RestartProcess{{PID: 6, handle: 106}, {PID: 7, handle: 107}},
		func(handle uintptr, ms uint32) (uint32, error) {
			if handle == 107 {
				return 0, waitCause
			}
			return 1, nil
		},
		func(handle uintptr) error { killed++; return killCause })
	if err == nil || !errors.Is(err, killCause) || !errors.Is(err, waitCause) {
		t.Fatalf("joined failure = %v, want the termination and the wait error", err)
	}
	if killed != 1 {
		t.Fatalf("killed %d, want no force after the wait failure", killed)
	}
	var typed *restartCauseError
	if !errors.As(err, &typed) || typed.stage != stageTerminateFailed || typed.pid != 6 {
		t.Fatalf("first cause = %#v, want the failed termination of PID 6", typed)
	}
}

func TestRestartDoesNotEscalateAGracePeriodWaitFailure(t *testing.T) {
	fake := useFakeRestart(t)
	base, exe := restartFixture(t)
	fake.scans = []fakeScan{{scan: RestartScan{Family: []RestartProcess{{PID: 91, Image: exe}}}}}
	fake.waitErrors = []error{errors.New("wait failed")}
	result := StopDiscord(base, exe)
	if result.DetailID != "common.detail.notQuit" || result.Err == nil {
		t.Fatalf("%#v", result)
	}
	if len(fake.terminated) != 0 || len(fake.launched) != 0 {
		t.Fatalf("a wait failure must not escalate to termination: %#v", fake)
	}
	// The same holds for the wait after a real termination.
	fake.scans = []fakeScan{{scan: RestartScan{Family: []RestartProcess{{PID: 92, Image: exe}}}}}
	fake.gone = []bool{false}
	fake.waitErrors = []error{errors.New("wait failed")}
	result = StopDiscord(base, exe)
	if result.DetailID != "common.detail.notQuit" || result.Err == nil {
		t.Fatalf("%#v", result)
	}
	if len(fake.launched) != 0 {
		t.Fatalf("launched %#v", fake.launched)
	}
}

func TestClassifyObservedAppliesTheSharedRoleRule(t *testing.T) {
	base := `C:\Users\neutral\AppData\Local\Discord`
	exe := "Discord.exe"
	helper := `C:\Users\neutral\AppData\Local\Discord\app-1.0.9261\modules\discord_utils-1\discord_utils\DiscordSystemHelper.exe`
	for _, c := range []struct {
		image string
		held  bool
		want  restartClass
	}{
		// Observation needs no terminate rights: an under-base updater that only
		// grants query rights still blocks the restart, and it keeps the
		// updater category rather than a generic one.
		{`C:\Users\neutral\AppData\Local\Discord\Update.exe`, false, restartUpdater},
		{`C:\Users\neutral\AppData\Local\Discord\app-1.0.10\Update.exe`, false, restartForeign},
		// A family process without the rights to act on it is unverifiable.
		{`C:\Users\neutral\AppData\Local\Discord\app-1.0.10\Discord.exe`, false, restartUnverifiable},
		{`C:\Users\neutral\AppData\Local\Discord\app-1.0.10\Discord.exe`, true, restartFamily},
		// Discord's System Helper is auxiliary at every rights level.
		{helper, false, restartAuxiliary},
		{helper, true, restartAuxiliary},
		{`C:\Users\neutral\AppData\Local\Other\helper.exe`, false, restartUnrelated},
		{``, true, restartUnrelated},
	} {
		if got := classifyObserved(base, exe, c.image, c.held); got != c.want {
			t.Fatalf("classifyObserved(%q, held=%v) = %v, want %v", c.image, c.held, got, c.want)
		}
	}
}

func TestAuxiliaryImageRuleIsExactAndStructural(t *testing.T) {
	base := `C:\Users\neutral\AppData\Local\Discord`
	image := `C:\Users\neutral\AppData\Local\Discord\app-1.0.9261\modules\discord_utils-1\discord_utils\DiscordSystemHelper.exe`
	if !restartAuxiliaryImage(base, image) {
		t.Fatal("the observed helper layout must qualify")
	}
	// An older app version counts, and a version folder without the app-
	// prefix matches the same appDirRe pattern.
	if !restartAuxiliaryImage(base, `C:\Users\neutral\AppData\Local\Discord\app-1.0.9001\modules\discord_utils-2\discord_utils\DiscordSystemHelper.exe`) {
		t.Fatal("an older app version must qualify")
	}
	if !restartAuxiliaryImage(base, `C:\Users\neutral\AppData\Local\Discord\1.0.9261\modules\discord_utils-1\discord_utils\DiscordSystemHelper.exe`) {
		t.Fatal("the version folder pattern must qualify")
	}
	// Windows paths are case-insensitive in every component of the structure.
	if !restartAuxiliaryImage(base, `C:\Users\neutral\AppData\Local\Discord\APP-1.0.9261\MODULES\DISCORD_UTILS-1\DISCORD_UTILS\DISCORDSYSTEMHELPER.EXE`) {
		t.Fatal("the same helper path with different case must qualify")
	}
	// A junction-alias base still identifies the canonical installation.
	root := t.TempDir()
	canon := filepath.Join(root, "Discord")
	alias := filepath.Join(root, "alias")
	if err := os.Mkdir(canon, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(canon, alias); err != nil {
		t.Fatal(err)
	}
	aliased := filepath.Join(canon, "app-1.0.9261", "modules", "discord_utils-1", "discord_utils", "DiscordSystemHelper.exe")
	if !restartAuxiliaryImage(alias, aliased) {
		t.Fatal("an alias of the installation must match its canonical helper")
	}
	// Everything else blocks as an ordinary program or stays unrelated.
	for _, wrong := range []string{
		`C:\Users\neutral\AppData\Local\Discord\DiscordSystemHelper.exe`,
		`C:\Users\neutral\AppData\Local\Discord\app-1.0.9261\DiscordSystemHelper.exe`,
		`C:\Users\neutral\AppData\Local\Discord\app-1.0.9261\modules\discord_utils-1\DiscordSystemHelper.exe`,
		`C:\Users\neutral\AppData\Local\Discord\app-1.0.9261\modules\other-1\discord_utils\DiscordSystemHelper.exe`,
		`C:\Users\neutral\AppData\Local\Discord\app-1.0.9261\modules\discord_utils-1\discord_utils\DiscordSystemHelper2.exe`,
		`C:\Users\neutral\AppData\Local\Discord\app-1.0.9261\modules\discord_utils-abc\discord_utils\DiscordSystemHelper.exe`,
		`C:\Users\neutral\AppData\Local\DiscordPTB\app-1.0.9261\modules\discord_utils-1\discord_utils\DiscordSystemHelper.exe`,
	} {
		if restartAuxiliaryImage(base, wrong) {
			t.Fatalf("must not qualify: %q", wrong)
		}
		if got := classifyObserved(base, "Discord.exe", wrong, true); got != restartForeign && got != restartUnrelated {
			t.Fatalf("a misplaced helper copy must block or stay unrelated: %q = %v", wrong, got)
		}
	}
	// The updater rule is exactly <base>\Update.exe.
	if !restartUpdaterImage(base, `C:\Users\neutral\AppData\Local\Discord\Update.exe`) {
		t.Fatal("the base updater must qualify")
	}
	for _, wrong := range []string{
		`C:\Users\neutral\AppData\Local\Discord\app-1.0.10\Update.exe`,
		`C:\Users\neutral\AppData\Local\Discord\sub\Update.exe`,
		`C:\Users\neutral\AppData\Local\DiscordPTB\Update.exe`,
	} {
		if restartUpdaterImage(base, wrong) {
			t.Fatalf("must not qualify as the base updater: %q", wrong)
		}
	}
}

// TestRestartDetailsNameTheStageProcessAndCause pins the diagnostics the
// details area relies on: the failure stage, the process name and PID the
// first useful system cause belongs to, and that cause itself.
func TestRestartDetailsNameTheStageProcessAndCause(t *testing.T) {
	fake := useFakeRestart(t)
	base, exe := restartFixture(t)

	// A failed query keeps its stage and the system cause.
	queryCause := errors.New("query failed")
	fake.scans = []fakeScan{{scan: RestartScan{}, err: queryCause}}
	result := StopDiscord(base, exe)
	if result.DetailID != "common.detail.unverified" || result.Stage != stageQueryFailed || !errors.Is(result.Err, queryCause) {
		t.Fatalf("%#v", result)
	}

	// An unverifiable candidate names the process and the cause that blocked it.
	blocked := errors.New("hold denied")
	fake.scans = []fakeScan{{scan: RestartScan{Unreadable: []RestartProcess{{PID: 31, Name: "Discord.exe", Cause: blocked}}}}}
	result = StopDiscord(base, exe)
	if result.Stage != stageQueryFailed || result.Process != "Discord.exe" || result.PID != 31 || !errors.Is(result.Err, blocked) {
		t.Fatalf("%#v", result)
	}

	// The base updater is named by file name and PID with its own category.
	fake.scans = []fakeScan{{scan: RestartScan{Foreign: []RestartProcess{{PID: 4242, Image: filepath.Join(base, "Update.exe"), Updater: true}}}}}
	result = StopDiscord(base, exe)
	if result.Stage != stageOtherProcess || result.Process != "Update.exe" || result.PID != 4242 || result.Err != nil || result.DetailID != "common.detail.updaterRunning" {
		t.Fatalf("%#v", result)
	}

	// A wait that timed out names the process that had not exited.
	fake.scans = []fakeScan{{scan: RestartScan{Family: []RestartProcess{{PID: 51, Image: exe, handle: 510}}}}}
	fake.gone = []bool{false, false}
	result = StopDiscord(base, exe)
	if result.Stage != stageWaitTimeout || result.Process != "Discord.exe" || result.PID != 51 || result.DetailID != "common.detail.notQuit" {
		t.Fatalf("%#v", result)
	}

	// A failed termination keeps the stage and the process of that call, and
	// the timeout after it is reported with that kept cause.
	killErr := errors.New("kill denied")
	fake.scans = []fakeScan{{scan: RestartScan{Family: []RestartProcess{{PID: 52, Image: exe, handle: 520}}}}}
	fake.gone = []bool{false, false}
	fake.terminateErr = stageCause(stageTerminateFailed, RestartProcess{PID: 52, Image: exe, handle: 520}, killErr)
	result = StopDiscord(base, exe)
	if result.Stage != stageTerminateFailed || result.Process != "Discord.exe" || result.PID != 52 || !errors.Is(result.Err, killErr) {
		t.Fatalf("%#v", result)
	}

	// A plain seam error falls back to the stage of the call site.
	fake.scans = []fakeScan{{scan: RestartScan{Family: []RestartProcess{{PID: 53, Image: exe}}}}}
	fake.waitErrors = []error{errors.New("wait failed")}
	result = StopDiscord(base, exe)
	if result.Stage != stageWaitFailed || result.Err == nil {
		t.Fatalf("%#v", result)
	}

	// The final check names the process it still reports; the one zero-time
	// handle reading is recorded and never changes the decision.
	fake.scans = []fakeScan{
		{scan: RestartScan{Family: []RestartProcess{{PID: 61, Image: exe}}}},
		{scan: RestartScan{Family: []RestartProcess{{PID: 62, Image: exe, handle: 620}}}},
	}
	fake.gone = []bool{true}
	fake.readGone = []bool{false}
	result = StopDiscord(base, exe)
	if result.Stage != stageRescanFound || result.Process != "Discord.exe" || result.PID != 62 || result.DetailID != "common.detail.notQuit" || result.Image != exe {
		t.Fatalf("%#v", result)
	}
	if result.Observed == nil || result.Observed.State != "win.state.unsignaled" || result.Observed.Result != waitTimedOut || fake.readCalls != 1 {
		t.Fatalf("observation %#v readings %d", result.Observed, fake.readCalls)
	}

	// An uncheckable reading keeps its error and still fails the same way.
	fake.scans = []fakeScan{
		{scan: RestartScan{Family: []RestartProcess{{PID: 61, Image: exe}}}},
		{scan: RestartScan{Family: []RestartProcess{{PID: 63, Image: exe, handle: 630}}}},
	}
	fake.gone = []bool{true}
	readErr := errors.New("read failed")
	fake.readErrors = []error{readErr}
	result = StopDiscord(base, exe)
	if result.DetailID != "common.detail.notQuit" || result.Stage != stageRescanFound || result.Observed == nil ||
		result.Observed.State != "win.state.uncheckable" || !errors.Is(result.Observed.Err, readErr) {
		t.Fatalf("%#v", result)
	}

	// A signaled reading is recorded the same way, with its native result.
	fake.scans = []fakeScan{
		{scan: RestartScan{Family: []RestartProcess{{PID: 61, Image: exe}}}},
		{scan: RestartScan{Family: []RestartProcess{{PID: 64, Image: exe, handle: 640}}}},
	}
	fake.gone = []bool{true}
	fake.readGone = []bool{true}
	result = StopDiscord(base, exe)
	if result.DetailID != "common.detail.notQuit" || result.Observed == nil || result.Observed.State != "win.state.signaled" || result.Observed.Result != waitSignaled {
		t.Fatalf("%#v", result)
	}

	// A reported process without a held handle is shown without a reading.
	fake.scans = []fakeScan{
		{scan: RestartScan{Family: []RestartProcess{{PID: 61, Image: exe}}}},
		{scan: RestartScan{Family: []RestartProcess{{PID: 65, Image: exe}}}},
	}
	fake.gone = []bool{true}
	result = StopDiscord(base, exe)
	if result.DetailID != "common.detail.notQuit" || result.Observed != nil {
		t.Fatalf("%#v", result)
	}

	// A launch the system did not accept is its own stage.
	fake.scans = []fakeScan{{}}
	fake.launchErr = errors.New("launch denied")
	result = OpenDiscord(base, exe)
	if result.Stage != stageLaunchFailed || result.DetailID != "common.detail.launchFailed" || !result.OpenManually || result.Err == nil {
		t.Fatalf("%#v", result)
	}
}

// windowsErrorAccessDenied stands in for the Win32 cause TerminateProcess
// reports for an already terminated process.
func windowsErrorAccessDenied() error { return errors.New("Access is denied") }

// A genuine wait/state failure inside the terminate pass is fatal: it is never
// swallowed and never resolved through the bounded exit wait the way a plain
// termination error may be.
func TestStopDiscordTreatsAWaitStateFailureAsFatal(t *testing.T) {
	fake := useFakeRestart(t)
	base, exe := restartFixture(t)
	proc := RestartProcess{PID: 7001, Image: exe, handle: 701}
	fake.scans = []fakeScan{{scan: RestartScan{Family: []RestartProcess{proc}}}, {}}
	fake.gone = []bool{false, true}
	cause := errors.New("native wait failed before force")
	fake.terminateErr = stageCause(stageWaitFailed, proc, cause)
	result := StopDiscord(base, exe)
	if result.DetailID == "" || !errors.Is(result.Err, cause) {
		t.Fatalf("a genuine wait error was swallowed: %#v", result)
	}
	if len(fake.launched) != 0 {
		t.Fatalf("launched %#v", fake.launched)
	}
	// The same failure joined behind a termination error stays fatal too.
	fake.scans = []fakeScan{{scan: RestartScan{Family: []RestartProcess{proc}}}, {}}
	fake.gone = []bool{false, true}
	killErr := errors.New("terminate denied")
	fake.terminateErr = errors.Join(
		stageCause(stageTerminateFailed, proc, killErr),
		stageCause(stageWaitFailed, proc, cause))
	result = StopDiscord(base, exe)
	if result.DetailID == "" || !errors.Is(result.Err, cause) || !errors.Is(result.Err, killErr) {
		t.Fatalf("a joined wait error was swallowed: %#v", result)
	}
}

// When the shared deadline passes, the kept cause is reported with the process
// that cause belongs to — never with another process's identity.
func TestStopDiscordTimeoutCauseBelongsToItsOwnProcess(t *testing.T) {
	fake := useFakeRestart(t)
	base, exe := restartFixture(t)
	stalled := RestartProcess{PID: 7101, Image: exe, handle: 711}
	failed := RestartProcess{PID: 7102, Image: exe, handle: 712}
	fake.scans = []fakeScan{{scan: RestartScan{Family: []RestartProcess{stalled, failed}}}}
	fake.gone = []bool{false, false}
	cause := errors.New("termination denied for 7102")
	fake.terminateErr = stageCause(stageTerminateFailed, failed, cause)
	result := StopDiscord(base, exe)
	if result.Stage != stageTerminateFailed || result.PID != failed.PID || result.Process != "Discord.exe" || !errors.Is(result.Err, cause) {
		t.Fatalf("termination error attributed to a different process: %#v", result)
	}
	if result.Image != exe {
		t.Fatalf("verified image path lost: %#v", result)
	}
}
