//go:build windows

package core

import (
	"errors"
	"os/exec"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var user32 = windows.NewLazySystemDLL("user32.dll")

// Elevated reports whether this process runs with administrator rights.
func platformRestartElevated() bool { return windows.GetCurrentProcessToken().IsElevated() }

// Each handle carries every right the short restart needs, so every later check
// and action stays bound to the exact process the path was read from.
const restartAccess = windows.PROCESS_QUERY_LIMITED_INFORMATION | windows.PROCESS_TERMINATE | windows.SYNCHRONIZE

// The Win32 primitives the restart decisions rest on. They live here, one call
// each, so the decisions themselves stay testable without a running Windows.
var (
	restartProbeProcess = func(access, pid uint32) (uintptr, string, error) {
		handle, err := windows.OpenProcess(access, false, pid)
		if err != nil {
			return 0, "", err
		}
		buf := make([]uint16, 32768)
		size := uint32(len(buf))
		if err = windows.QueryFullProcessImageName(handle, 0, &buf[0], &size); err != nil || size > uint32(len(buf)) {
			windows.CloseHandle(handle)
			if err == nil {
				err = windows.ERROR_INSUFFICIENT_BUFFER
			}
			// The process was opened; a failure from here on is a later image
			// query failure and never an OpenProcess failure.
			return 0, "", &imageQueryError{err}
		}
		return uintptr(handle), windows.UTF16ToString(buf[:size]), nil
	}
	restartWaitHandle = func(handle uintptr, milliseconds uint32) (uint32, error) {
		return windows.WaitForSingleObject(windows.Handle(handle), milliseconds)
	}
	restartEndProcess = func(handle uintptr) error {
		return windows.TerminateProcess(windows.Handle(handle), 1)
	}
	restartExitCode = func(handle uintptr) (uint32, error) {
		var code uint32
		err := windows.GetExitCodeProcess(windows.Handle(handle), &code)
		return code, err
	}
	restartCloseHandle = func(handle uintptr) {
		windows.CloseHandle(windows.Handle(handle))
	}
)

// imageQueryError marks a failure of the image query that happened after the
// process was already opened. ERROR_INVALID_PARAMETER proves that a process is
// gone only when the open itself failed with it, never when the later query
// did.
type imageQueryError struct{ err error }

func (e *imageQueryError) Error() string { return e.err.Error() }
func (e *imageQueryError) Unwrap() error { return e.err }

func isImageQueryFailure(err error) bool {
	var typed *imageQueryError
	return errors.As(err, &typed)
}

// stillActive is the exit code a running process reports: ambiguous, and never
// proof of life on its own. Any other exit code proves the process exited.
const stillActive = 259

// restartProvedExited reports whether native liveness semantics prove that the
// process behind a handle has already exited. A zero-time wait on a
// SYNCHRONIZE handle reads signaled (proved exited), timeout (still pending)
// or a genuine wait error (state unknown). A query-only handle is never waited
// on: its exit code proves the exit only when it is not STILL_ACTIVE.
func restartProvedExited(handle uintptr, queryOnly bool) (bool, error) {
	if queryOnly {
		code, err := restartExitCode(handle)
		if err != nil {
			return false, err
		}
		return code != stillActive, nil
	}
	state, err := restartWaitHandle(handle, 0)
	if err != nil {
		return false, err
	}
	return state == waitSignaled, nil
}

func platformRestartRelease(procs []RestartProcess) {
	for i := range procs {
		if procs[i].handle != 0 {
			restartCloseHandle(procs[i].handle)
			procs[i].handle = 0
		}
	}
}

// restartObserve reads one snapshot entry through its own handle and applies
// the shared process-role rule. When the full rights cannot be opened, the
// entry is retried with query rights alone: observing a process must not
// depend on terminate rights. Only a verified family handle carrying every
// right the restart acts with is kept, so PID reuse can never direct an action
// at an unrelated process. Discord's System Helper is recognized by its exact
// structural path and its handle is closed as soon as it is classified: it is
// never recorded, closed out, ended or waited for. An entry only becomes a
// live client or blocker when native liveness semantics cannot prove that it
// already exited, and one that cannot be verified keeps its name and the first
// useful system cause.
func restartObserve(entry *windows.ProcessEntry32, base, exeName string, scan *RestartScan) {
	name := windows.UTF16ToString(entry.ExeFile[:])
	handle, image, err := restartProbeProcess(restartAccess, entry.ProcessID)
	if err != nil {
		// A failed open reporting ERROR_INVALID_PARAMETER means the process
		// exited between the snapshot and the open; a later query failure with
		// that code proves nothing.
		if !isImageQueryFailure(err) && errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
			return
		}
		fullErr := err
		// Terminate rights may be denied while the image stays queryable.
		handle, image, err = restartProbeProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, entry.ProcessID)
		if err != nil {
			if discordCandidateName(name) {
				// The failed hold is the first useful reason; the failed query
				// is kept alongside it instead of being dropped.
				scan.Unreadable = append(scan.Unreadable, RestartProcess{PID: entry.ProcessID, Name: name, Cause: errors.Join(fullErr, err)})
			}
			return
		}
		class := classifyObserved(base, exeName, image, false)
		if class == restartAuxiliary || class == restartUnrelated {
			// Classified: never recorded, never acted on, and never read for
			// liveness. Its handle goes at once.
			restartCloseHandle(handle)
			return
		}
		// A query-only handle is never waited on; its exit code proves the
		// exit only when it is not STILL_ACTIVE, and 259 stays ambiguous —
		// never proof of life.
		exited, liveErr := restartProvedExited(handle, true)
		restartCloseHandle(handle)
		switch class {
		case restartUnverifiable:
			if exited {
				return
			}
			cause := fullErr
			if liveErr != nil {
				cause = errors.Join(fullErr, liveErr)
			}
			scan.Unreadable = append(scan.Unreadable, RestartProcess{PID: entry.ProcessID, Name: name, Image: image, Cause: cause})
		case restartUpdater:
			if exited {
				return
			}
			scan.Foreign = append(scan.Foreign, RestartProcess{PID: entry.ProcessID, Name: name, Image: image, Updater: true, Cause: liveErr, State: "win.state.uncheckable"})
		case restartForeign:
			if exited {
				return
			}
			scan.Foreign = append(scan.Foreign, RestartProcess{PID: entry.ProcessID, Name: name, Image: image, Cause: liveErr, State: "win.state.uncheckable"})
		}
		return
	}
	switch class := classifyObserved(base, exeName, image, true); class {
	case restartAuxiliary:
		restartCloseHandle(handle)
		return // classified: never recorded, never acted on
	case restartUnrelated:
		restartCloseHandle(handle)
	default:
		// A zero-time read on the held SYNCHRONIZE handle: signaled proves the
		// exit and the entry is never a live client or blocker; a genuine wait
		// error means the state is unknown, which never permits force.
		exited, liveErr := restartProvedExited(handle, false)
		if exited {
			restartCloseHandle(handle)
			return
		}
		if class == restartFamily {
			if liveErr != nil {
				// The state is unknown: block everything before any action,
				// keeping the verified image path for the details.
				restartCloseHandle(handle)
				scan.Unreadable = append(scan.Unreadable, RestartProcess{PID: entry.ProcessID, Name: name, Image: image, Cause: liveErr})
				return
			}
			scan.Family = append(scan.Family, RestartProcess{PID: entry.ProcessID, Image: image, Name: name, handle: handle})
			return
		}
		restartCloseHandle(handle)
		state := "win.state.unsignaled"
		if liveErr != nil {
			state = "win.state.uncheckable"
		}
		scan.Foreign = append(scan.Foreign, RestartProcess{PID: entry.ProcessID, Name: name, Image: image, Updater: class == restartUpdater, Cause: liveErr, State: state})
	}
}

func platformRestartEnumerate(base, exeName string) (RestartScan, error) {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return RestartScan{}, err
	}
	defer windows.CloseHandle(snapshot)
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	var scan RestartScan
	_, err = walkProcesses(
		func() error { return windows.Process32First(snapshot, &entry) },
		func() error { return windows.Process32Next(snapshot, &entry) },
		func() (bool, error) {
			restartObserve(&entry, base, exeName, &scan)
			return false, nil
		},
	)
	if err != nil {
		platformRestartRelease(scan.Family)
		return RestartScan{}, err
	}
	return scan, nil
}

var (
	restartWindowPids map[uint32]bool
	restartWindowLock sync.Mutex
	// One shared callback: Windows bounds how many callbacks a process may create.
	restartEnumProc = windows.NewCallback(restartEnumWindow)
)

func restartEnumWindow(hwnd windows.HWND, _ uintptr) uintptr {
	var pid uint32
	if _, err := windows.GetWindowThreadProcessId(hwnd, &pid); err == nil && restartWindowPids[pid] {
		// One polite WM_CLOSE per top-level window. Discord may only hide to the
		// tray; the targeted termination after this covers that case.
		user32.NewProc("PostMessageW").Call(uintptr(hwnd), 0x10 /* WM_CLOSE */, 0, 0)
	}
	return 1
}

func platformRestartCloseWindows(pids []uint32) error {
	restartWindowLock.Lock()
	defer restartWindowLock.Unlock()
	restartWindowPids = make(map[uint32]bool, len(pids))
	for _, pid := range pids {
		restartWindowPids[pid] = true
	}
	defer func() { restartWindowPids = nil }()
	_ = windows.EnumWindows(restartEnumProc, nil)
	return nil
}

// platformRestartTerminate ends the held family processes that are still
// running; already exited ones are skipped and a failed termination is
// rechecked against a concurrent normal exit.
func platformRestartTerminate(procs []RestartProcess) error {
	return terminateHeld(procs, restartWaitHandle, restartEndProcess)
}

// platformRestartWaitGone waits on each handle in sequence against one shared
// deadline, which avoids the 64-handle limit of a single wait call. A genuine
// wait failure is returned, with the stage and process it belongs to, instead
// of being read as a clean timeout; a timeout reports the process that had not
// exited yet.
func platformRestartWaitGone(procs []RestartProcess, timeout time.Duration) (*RestartProcess, error) {
	deadline := time.Now().Add(timeout)
	for i := range procs {
		proc := &procs[i]
		if proc.handle == 0 {
			continue
		}
		remaining := time.Until(deadline)
		if remaining < 0 {
			remaining = 0
		}
		event, err := restartWaitHandle(proc.handle, uint32(remaining/time.Millisecond))
		if err != nil {
			return nil, stageCause(stageWaitFailed, *proc, err)
		}
		if event != windows.WAIT_OBJECT_0 {
			return proc, nil
		}
	}
	return nil, nil
}

func platformRestartLaunch(exe, dir string) error {
	command := exec.Command(exe)
	command.Dir = dir
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}
