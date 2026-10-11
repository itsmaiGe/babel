//go:build windows

package core

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

// Neutral fixture paths; no user folder from this machine is used here.
const neutralWindowsBase = `C:\Users\neutral\AppData\Local\Discord`

type probeResult struct {
	handle uintptr
	image  string
	err    error
}

// fakeWindowsProbes replaces the Win32 primitives only, so the platform
// decisions themselves are what the tests exercise.
type fakeWindowsProbes struct {
	full, query    map[uint32]probeResult
	wait           func(uintptr, uint32) (uint32, error)
	kill           func(uintptr) error
	exitCodes      map[uint32]uint32
	fullCalls      []uint32
	queryCalls     []uint32
	killed, closed []uintptr
}

func useFakeWindowsProbes(t *testing.T) *fakeWindowsProbes {
	t.Helper()
	fake := &fakeWindowsProbes{full: map[uint32]probeResult{}, query: map[uint32]probeResult{}, exitCodes: map[uint32]uint32{}}
	prevProbe, prevWait := restartProbeProcess, restartWaitHandle
	prevKill, prevClose := restartEndProcess, restartCloseHandle
	prevExit := restartExitCode
	restartProbeProcess = func(access, pid uint32) (uintptr, string, error) {
		if access == restartAccess {
			fake.fullCalls = append(fake.fullCalls, pid)
			result, ok := fake.full[pid]
			if !ok {
				return 0, "", windows.ERROR_ACCESS_DENIED
			}
			return result.handle, result.image, result.err
		}
		fake.queryCalls = append(fake.queryCalls, pid)
		result, ok := fake.query[pid]
		if !ok {
			return 0, "", windows.ERROR_ACCESS_DENIED
		}
		return result.handle, result.image, result.err
	}
	restartWaitHandle = func(handle uintptr, ms uint32) (uint32, error) {
		if fake.wait != nil {
			return fake.wait(handle, ms)
		}
		return 1, nil
	}
	restartEndProcess = func(handle uintptr) error {
		fake.killed = append(fake.killed, handle)
		if fake.kill != nil {
			return fake.kill(handle)
		}
		return nil
	}
	// Unset fixture processes report the ambiguous exit code by default.
	restartExitCode = func(handle uintptr) (uint32, error) {
		if code, ok := fake.exitCodes[uint32(handle)]; ok {
			return code, nil
		}
		return stillActive, nil
	}
	restartCloseHandle = func(handle uintptr) { fake.closed = append(fake.closed, handle) }
	t.Cleanup(func() {
		restartProbeProcess, restartWaitHandle = prevProbe, prevWait
		restartEndProcess, restartCloseHandle = prevKill, prevClose
		restartExitCode = prevExit
	})
	return fake
}

func probeEntry(pid uint32, name string) *windows.ProcessEntry32 {
	entry := &windows.ProcessEntry32{ProcessID: pid}
	encoded, _ := windows.UTF16FromString(name)
	copy(entry.ExeFile[:], encoded)
	return entry
}

func TestWindowsObserveBlocksAQueryOnlyUpdaterUnderTheBase(t *testing.T) {
	fake := useFakeWindowsProbes(t)
	// Update.exe denies terminate rights but its image is queryable; observing
	// it must not depend on terminate rights and it must block the restart.
	fake.full[2001] = probeResult{err: windows.ERROR_ACCESS_DENIED}
	fake.query[2001] = probeResult{handle: 31, image: neutralWindowsBase + `\Update.exe`}
	var scan RestartScan
	restartObserve(probeEntry(2001, "Update.exe"), neutralWindowsBase, "Discord.exe", &scan)
	if len(scan.Foreign) != 1 || scan.Foreign[0].PID != 2001 || scan.Foreign[0].ProcessName() != "Update.exe" || !scan.Foreign[0].Updater || len(scan.Family) != 0 || len(scan.Unreadable) != 0 {
		t.Fatalf("%#v", scan)
	}
	if len(fake.queryCalls) != 1 || len(fake.killed) != 0 {
		t.Fatalf("query calls %#v killed %#v", fake.queryCalls, fake.killed)
	}
}

func TestWindowsObserveTreatsQueryOnlyFamilyAsUnverifiable(t *testing.T) {
	fake := useFakeWindowsProbes(t)
	fake.full[2002] = probeResult{err: windows.ERROR_ACCESS_DENIED}
	fake.query[2002] = probeResult{handle: 32, image: neutralWindowsBase + `\app-1.0.10\Discord.exe`}
	var scan RestartScan
	restartObserve(probeEntry(2002, "Discord.exe"), neutralWindowsBase, "Discord.exe", &scan)
	if len(scan.Unreadable) != 1 || scan.Unreadable[0].PID != 2002 || scan.Unreadable[0].ProcessName() != "Discord.exe" ||
		!errors.Is(scan.Unreadable[0].Cause, windows.ERROR_ACCESS_DENIED) || len(scan.Family) != 0 || len(scan.Foreign) != 0 {
		t.Fatalf("%#v", scan)
	}
}

func TestWindowsObserveSkipsProcessesThatExitDuringEnumeration(t *testing.T) {
	fake := useFakeWindowsProbes(t)
	fake.full[2003] = probeResult{err: windows.ERROR_INVALID_PARAMETER}
	var scan RestartScan
	restartObserve(probeEntry(2003, "Update.exe"), neutralWindowsBase, "Discord.exe", &scan)
	if len(fake.queryCalls) != 0 || len(scan.Foreign) != 0 || len(scan.Family) != 0 || len(scan.Unreadable) != 0 {
		t.Fatalf("%#v query calls %#v", scan, fake.queryCalls)
	}
	// An unqueryable process that is not a Discord executable is ignored rather
	// than denied globally; an unqueryable Discord executable blocks.
	fake.full[2004] = probeResult{err: windows.ERROR_ACCESS_DENIED}
	restartObserve(probeEntry(2004, "helper.exe"), neutralWindowsBase, "Discord.exe", &scan)
	if len(scan.Unreadable) != 0 || len(scan.Foreign) != 0 {
		t.Fatalf("%#v", scan)
	}
	fake.full[2005] = probeResult{err: windows.ERROR_ACCESS_DENIED}
	restartObserve(probeEntry(2005, "Discord.exe"), neutralWindowsBase, "Discord.exe", &scan)
	if len(scan.Unreadable) != 1 || scan.Unreadable[0].PID != 2005 {
		t.Fatalf("%#v", scan)
	}
}

func TestWindowsObserveHoldsOnlyVerifiedFamilyHandles(t *testing.T) {
	fake := useFakeWindowsProbes(t)
	fake.full[2006] = probeResult{handle: 61, image: neutralWindowsBase + `\app-1.0.10\Discord.exe`}
	fake.full[2007] = probeResult{handle: 62, image: `C:\Games\Discord\app-1.0.10\Discord.exe`}
	var scan RestartScan
	restartObserve(probeEntry(2006, "Discord.exe"), neutralWindowsBase, "Discord.exe", &scan)
	restartObserve(probeEntry(2007, "Discord.exe"), neutralWindowsBase, "Discord.exe", &scan)
	if len(scan.Family) != 1 || scan.Family[0].PID != 2006 || scan.Family[0].handle != 61 ||
		scan.Family[0].Image != neutralWindowsBase+`\app-1.0.10\Discord.exe` {
		t.Fatalf("%#v", scan.Family)
	}
	if len(scan.Foreign) != 0 || len(fake.killed) != 0 {
		t.Fatalf("foreign %#v killed %#v", scan.Foreign, fake.killed)
	}
}

// Discord's System Helper is classified auxiliary and never recorded: its
// handle is closed as soon as it is classified and it never blocks anything.
func TestWindowsObserveIgnoresTheSystemHelper(t *testing.T) {
	fake := useFakeWindowsProbes(t)
	helper := neutralWindowsBase + `\app-1.0.9261\modules\discord_utils-1\discord_utils\DiscordSystemHelper.exe`
	fake.full[2010] = probeResult{handle: 91, image: helper}
	var scan RestartScan
	restartObserve(probeEntry(2010, "DiscordSystemHelper.exe"), neutralWindowsBase, "Discord.exe", &scan)
	if len(scan.Family) != 0 || len(scan.Foreign) != 0 || len(scan.Unreadable) != 0 {
		t.Fatalf("the helper must never be recorded: %#v", scan)
	}
	if len(fake.closed) != 1 || fake.closed[0] != 91 || len(fake.killed) != 0 {
		t.Fatalf("closed %#v killed %#v", fake.closed, fake.killed)
	}
	// The query-only path classifies it by image path alone and never records
	// it even when its rights deny the hold.
	fake.full[2011] = probeResult{err: windows.ERROR_ACCESS_DENIED}
	fake.query[2011] = probeResult{handle: 92, image: helper}
	restartObserve(probeEntry(2011, "DiscordSystemHelper.exe"), neutralWindowsBase, "Discord.exe", &scan)
	if len(scan.Family) != 0 || len(scan.Foreign) != 0 || len(scan.Unreadable) != 0 {
		t.Fatalf("the helper must never be recorded: %#v", scan)
	}
}

// Entries whose handles prove the exit on native liveness semantics are never
// live clients or blockers, and an ambiguous STILL_ACTIVE code proves nothing.
func TestWindowsObserveIgnoresProvedExitedEntries(t *testing.T) {
	fake := useFakeWindowsProbes(t)
	// A held handle that is already signaled: proved exited, never recorded.
	fake.full[2020] = probeResult{handle: 93, image: neutralWindowsBase + `\app-1.0.10\Discord.exe`}
	fake.wait = func(handle uintptr, ms uint32) (uint32, error) {
		if handle == 93 {
			return waitSignaled, nil
		}
		return 1, nil
	}
	var scan RestartScan
	restartObserve(probeEntry(2020, "Discord.exe"), neutralWindowsBase, "Discord.exe", &scan)
	if len(scan.Family) != 0 || len(fake.closed) != 1 {
		t.Fatalf("scan %#v closed %#v", scan, fake.closed)
	}
	// A query-only blocker whose exit code proves the exit is not a blocker;
	// the ambiguous code 259 stays one.
	fake.full[2021] = probeResult{err: windows.ERROR_ACCESS_DENIED}
	fake.query[2021] = probeResult{handle: 94, image: neutralWindowsBase + `\Update.exe`}
	fake.exitCodes[94] = 1
	restartObserve(probeEntry(2021, "Update.exe"), neutralWindowsBase, "Discord.exe", &scan)
	if len(scan.Foreign) != 0 {
		t.Fatalf("a proved-exited updater must not block: %#v", scan)
	}
	fake.full[2022] = probeResult{err: windows.ERROR_ACCESS_DENIED}
	fake.query[2022] = probeResult{handle: 95, image: neutralWindowsBase + `\Update.exe`}
	restartObserve(probeEntry(2022, "Update.exe"), neutralWindowsBase, "Discord.exe", &scan)
	if len(scan.Foreign) != 1 || !scan.Foreign[0].Updater {
		t.Fatalf("an ambiguous updater stays a blocker: %#v", scan)
	}
}

// A failed open and a later image-query failure are never the same thing:
// ERROR_INVALID_PARAMETER proves the exit only when the open itself failed.
func TestWindowsObserveSeparatesOpenFailuresFromQueryFailures(t *testing.T) {
	fake := useFakeWindowsProbes(t)
	fake.full[2030] = probeResult{err: &imageQueryError{windows.ERROR_INVALID_PARAMETER}}
	fake.query[2030] = probeResult{err: windows.ERROR_INVALID_PARAMETER}
	var scan RestartScan
	restartObserve(probeEntry(2030, "Discord.exe"), neutralWindowsBase, "Discord.exe", &scan)
	if len(scan.Unreadable) != 1 || scan.Unreadable[0].PID != 2030 {
		t.Fatalf("a later query failure proves nothing about the exit: %#v", scan)
	}
	// The same code from a failed open means the process is gone.
	fake.full[2031] = probeResult{err: windows.ERROR_INVALID_PARAMETER}
	restartObserve(probeEntry(2031, "Discord.exe"), neutralWindowsBase, "Discord.exe", &scan)
	if len(scan.Unreadable) != 1 {
		t.Fatalf("a gone process must not block: %#v", scan)
	}
}

func TestWindowsTerminateSkipsExitedAndKeepsTheFirstFailure(t *testing.T) {
	fake := useFakeWindowsProbes(t)
	// Mixed family: one handle is already signaled, the other is still running.
	fake.wait = func(handle uintptr, ms uint32) (uint32, error) {
		if handle == 71 {
			return waitSignaled, nil
		}
		return 1, nil
	}
	if err := platformRestartTerminate([]RestartProcess{{PID: 3, handle: 71}, {PID: 4, handle: 72}}); err != nil {
		t.Fatal(err)
	}
	if len(fake.killed) != 1 || fake.killed[0] != 72 {
		t.Fatalf("killed %#v, want only the live handle", fake.killed)
	}
	// A failed termination is kept as the first meaningful failure while the
	// pass still makes exactly one attempt per live process; whether the
	// processes exited anyway is decided by the caller's shared bounded wait.
	fake.killed = nil
	fake.wait = func(handle uintptr, ms uint32) (uint32, error) { return 1, nil }
	fake.kill = func(handle uintptr) error { return windows.ERROR_ACCESS_DENIED }
	err := platformRestartTerminate([]RestartProcess{{PID: 5, handle: 73}, {PID: 6, handle: 74}})
	if err == nil {
		t.Fatal("a kept termination failure must be reported")
	}
	if len(fake.killed) != 2 {
		t.Fatalf("killed %#v, want one attempt per live process", fake.killed)
	}
	var typed *restartCauseError
	if !errors.As(err, &typed) || typed.stage != stageTerminateFailed || typed.pid != 5 {
		t.Fatalf("first cause %#v, want the failed termination of PID 5", typed)
	}
	// A genuine wait failure is not swallowed and never escalates to a kill.
	fake.killed = nil
	fake.wait = func(handle uintptr, ms uint32) (uint32, error) { return 0, errors.New("wait failed") }
	fake.kill = nil
	err = platformRestartTerminate([]RestartProcess{{PID: 7, handle: 75}})
	if err == nil || err.Error() != "wait failed" || len(fake.killed) != 0 {
		t.Fatalf("wait failure = %v killed %#v", err, fake.killed)
	}
}

func TestWindowsWaitGoneDistinguishesTimeoutsFromWaitFailures(t *testing.T) {
	fake := useFakeWindowsProbes(t)
	procs := []RestartProcess{{PID: 8, handle: 81}}
	fake.wait = func(handle uintptr, ms uint32) (uint32, error) { return uint32(windows.WAIT_TIMEOUT), nil }
	stalled, err := platformRestartWaitGone(procs, time.Millisecond)
	if err != nil || stalled == nil || stalled.PID != 8 {
		t.Fatalf("clean timeout: stalled=%#v err=%v", stalled, err)
	}
	fake.wait = func(handle uintptr, ms uint32) (uint32, error) { return 0, errors.New("wait failed") }
	stalled, err = platformRestartWaitGone(procs, time.Millisecond)
	if err == nil || stalled != nil {
		t.Fatalf("wait failure: stalled=%#v err=%v", stalled, err)
	}
	// A genuine wait failure keeps its stage and the process it belongs to.
	var typed *restartCauseError
	if !errors.As(err, &typed) || typed.stage != stageWaitFailed || typed.pid != 8 {
		t.Fatalf("wait cause = %#v", typed)
	}
	fake.wait = func(handle uintptr, ms uint32) (uint32, error) { return waitSignaled, nil }
	stalled, err = platformRestartWaitGone([]RestartProcess{{PID: 8, handle: 81}, {PID: 9, handle: 82}}, time.Millisecond)
	if err != nil || stalled != nil {
		t.Fatalf("signaled: stalled=%#v err=%v", stalled, err)
	}
}

// TestWindowsFixtureChild is the fixture process body. It runs only as a copy
// of this test binary under a temporary folder and stays alive until the
// handle the test verified ends it.
func TestWindowsFixtureChild(t *testing.T) {
	if os.Getenv("BABEL_FIXTURE_CHILD") != "1" {
		t.Skip("fixture process body: runs only with the fixture marker")
	}
	time.Sleep(60 * time.Second)
}

// spawnFixtureProcess starts one fixture process from a copy of this test
// binary under a temporary folder. The process is this test's own child and is
// ended again by the test's cleanup.
func spawnFixtureProcess(t *testing.T, exe string) *exec.Cmd {
	t.Helper()
	command := exec.Command(exe, "-test.run=^TestWindowsFixtureChild$")
	command.Dir = filepath.Dir(exe)
	command.Env = append(os.Environ(), "BABEL_FIXTURE_CHILD=1")
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = command.Process.Kill()
		_, _ = command.Process.Wait()
	})
	return command
}

// TestWindowsFixtureProcessesGiveLifecycleEvidence is the one native fixture:
// real fixture processes under one temporary base exercise the exact Win32
// calls the restart acts with — OpenProcess rights, TerminateProcess, bounded
// waits on verified handles, an extra observer handle, the STILL_ACTIVE
// ambiguity of a query-only exit code, and a fresh snapshot/rescan after the
// confirmed termination. Only the verified family handle is ever ended; the
// second fixture program, standing in for any other same-dir program, is never
// touched by the restart paths.
func TestWindowsFixtureProcessesGiveLifecycleEvidence(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	base := t.TempDir()
	appDir := filepath.Join(base, "app-1.0.0")
	if err = os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	target, other := filepath.Join(appDir, "Discord.exe"), filepath.Join(base, "helper.exe")
	for _, path := range []string{target, other} {
		source, readErr := os.ReadFile(self)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if writeErr := os.WriteFile(path, source, 0o755); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	fixture := spawnFixtureProcess(t, target)
	sibling := spawnFixtureProcess(t, other)
	fixturePID, siblingPID := uint32(fixture.Process.Pid), uint32(sibling.Process.Pid)

	// Complete preflight: the scan must see exactly the two fixture processes
	// before anything is ever ended.
	var scan RestartScan
	restartObserve(probeEntry(fixturePID, "Discord.exe"), base, "Discord.exe", &scan)
	restartObserve(probeEntry(siblingPID, "helper.exe"), base, "Discord.exe", &scan)
	if len(scan.Family) != 1 || scan.Family[0].PID != fixturePID || scan.Family[0].handle == 0 ||
		!strings.EqualFold(scan.Family[0].Image, target) || len(scan.Unreadable) != 0 ||
		len(scan.Foreign) != 1 || scan.Foreign[0].PID != siblingPID {
		platformRestartRelease(scan.Family)
		t.Fatalf("%#v", scan)
	}
	defer platformRestartRelease(scan.Family)
	family := scan.Family

	// The verified handle is alive: a zero-wait check times out and the
	// query-only exit code is STILL_ACTIVE, which proves nothing on its own.
	state, err := restartWaitHandle(family[0].handle, 0)
	if err != nil || state != uint32(windows.WAIT_TIMEOUT) {
		t.Fatalf("running fixture: state=%d err=%v", state, err)
	}
	var code uint32
	if err = windows.GetExitCodeProcess(windows.Handle(family[0].handle), &code); err != nil || code != 259 {
		t.Fatalf("running exit code=%d err=%v", code, err)
	}

	// One extra SYNCHRONIZE-only observer handle is held across the stop; it
	// observes only and never takes part in the ending.
	observer, err := windows.OpenProcess(windows.SYNCHRONIZE, false, fixturePID)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(observer)

	if err = platformRestartTerminate(family); err != nil {
		t.Fatal(err)
	}
	if stalled, waitErr := platformRestartWaitGone(family, 5*time.Second); waitErr != nil || stalled != nil {
		t.Fatalf("bounded exit wait: stalled=%#v err=%v", stalled, waitErr)
	}

	// Both the restart handle and the extra observer see the same exit, and a
	// non-STILL_ACTIVE exit code proves it.
	if state, err = restartWaitHandle(family[0].handle, 0); err != nil || state != waitSignaled {
		t.Fatalf("exited fixture: state=%d err=%v", state, err)
	}
	if state, err = restartWaitHandle(uintptr(observer), 0); err != nil || state != waitSignaled {
		t.Fatalf("observer handle: state=%d err=%v", state, err)
	}
	if err = windows.GetExitCodeProcess(windows.Handle(family[0].handle), &code); err != nil || code != 1 {
		t.Fatalf("ended exit code=%d err=%v", code, err)
	}

	// A fresh snapshot/rescan after the confirmed termination, while the test
	// still holds its observer handle. Whether a terminated process still
	// appears in a fresh snapshot is recorded, never asserted; when it does
	// appear, its reported path and state are verified against the fixture
	// handle. The scan only observes: by path classification nothing outside
	// the fixture base can be family here, so it never acts on any real
	// installation, and every handle it opens is released again.
	rescan, scanErr := platformRestartEnumerate(base, "Discord.exe")
	if scanErr != nil {
		t.Fatal(scanErr)
	}
	defer platformRestartRelease(rescan.Family)
	reported := false
	for _, proc := range rescan.Family {
		if proc.PID != fixturePID {
			t.Fatalf("the family scan must only report the fixture: %#v", proc)
		}
		reported = true
		if !strings.EqualFold(proc.Image, target) {
			t.Fatalf("fixture reported with another image path: %q", proc.Image)
		}
		state, stateErr := restartWaitHandle(proc.handle, 0)
		observerState, observerErr := restartWaitHandle(uintptr(observer), 0)
		if stateErr == nil && observerErr == nil && state != observerState {
			t.Fatalf("reported state %d disagrees with the fixture handle %d", state, observerState)
		}
		t.Logf("fresh rescan reports the fixture: state=%d err=%v; fixture handle: state=%d err=%v", state, stateErr, observerState, observerErr)
	}
	observerState, observerErr := restartWaitHandle(uintptr(observer), 0)
	t.Logf("fresh rescan after confirmed termination: fixture PID %d reported=%v; fixture handle state=%d err=%v", fixturePID, reported, observerState, observerErr)

	// The other same-dir program was never ended: its own verified handle
	// still times out a zero-wait check. The test's cleanup ends it.
	siblingHandle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, siblingPID)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(siblingHandle)
	if state, err = restartWaitHandle(uintptr(siblingHandle), 0); err != nil || state != uint32(windows.WAIT_TIMEOUT) {
		t.Fatalf("untouched sibling: state=%d err=%v", state, err)
	}
}

// TestWindowsFixtureSystemHelperAndUpdaterEvidence reuses the temporary
// fixture processes for the role evidence: the stop ends only the client, the
// System Helper running from its exact structural path is still running
// afterwards and never blocked anything, and the base's Update.exe blocks the
// stop without ever being ended. Every handle waited on here belongs to a
// fixture this test created.
func TestWindowsFixtureSystemHelperAndUpdaterEvidence(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	base := t.TempDir()
	client := filepath.Join(base, "app-1.0.0", "Discord.exe")
	helper := filepath.Join(base, "app-1.0.0", "modules", "discord_utils-1", "discord_utils", "DiscordSystemHelper.exe")
	updater := filepath.Join(base, "Update.exe")
	for _, path := range []string{client, helper, updater} {
		if err = os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		source, readErr := os.ReadFile(self)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if writeErr := os.WriteFile(path, source, 0o755); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	observe := func(pid int) uintptr {
		handle, openErr := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
		if openErr != nil {
			t.Fatal(openErr)
		}
		t.Cleanup(func() { windows.CloseHandle(handle) })
		return uintptr(handle)
	}

	// The client and the System Helper run together: the stop must proceed and
	// end only the client.
	clientOne := spawnFixtureProcess(t, client)
	helperFixture := spawnFixtureProcess(t, helper)
	helperHandle := observe(helperFixture.Process.Pid)
	if result := StopDiscord(base, client); result.DetailID != "" {
		t.Fatalf("the helper must not block the stop: %#v", result)
	}
	state, waitErr := restartWaitHandle(observe(clientOne.Process.Pid), 0)
	if waitErr != nil || state != waitSignaled {
		t.Fatalf("the client must be ended: state=%d err=%v", state, waitErr)
	}
	state, waitErr = restartWaitHandle(helperHandle, 0)
	if waitErr != nil || state != uint32(windows.WAIT_TIMEOUT) {
		t.Fatalf("the helper must still be running: state=%d err=%v", state, waitErr)
	}

	// With the base's Update.exe running the stop refuses before touching
	// anything, and neither the updater nor the client is ever ended.
	updaterFixture := spawnFixtureProcess(t, updater)
	updaterHandle := observe(updaterFixture.Process.Pid)
	clientTwo := spawnFixtureProcess(t, client)
	clientHandle := observe(clientTwo.Process.Pid)
	result := StopDiscord(base, client)
	if result.DetailID != "common.detail.updaterRunning" || result.Process != "Update.exe" {
		t.Fatalf("%#v", result)
	}
	for _, held := range []struct {
		name   string
		handle uintptr
	}{{"updater", updaterHandle}, {"client", clientHandle}, {"helper", helperHandle}} {
		state, waitErr = restartWaitHandle(held.handle, 0)
		if waitErr != nil || state != uint32(windows.WAIT_TIMEOUT) {
			t.Fatalf("%s must not be ended: state=%d err=%v", held.name, state, waitErr)
		}
	}
}
