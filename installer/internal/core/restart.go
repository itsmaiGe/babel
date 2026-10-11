package core

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// RestartProcess is one process observed for the restart operation. The
// platform handle stays bound to this exact process, so a reused process ID can
// never be mistaken for Discord, and it is released on every path. Observed
// entries that are only recorded, never acted on, carry no handle: Name keeps
// the executable's file name for the details, Cause keeps the system reason an
// entry could not be opened or held, and Updater marks a recorded blocker as
// the selected base's Update.exe rather than another program.
type RestartProcess struct {
	PID     uint32
	Image   string
	Name    string
	Cause   error
	Updater bool
	// State records the one native liveness reading taken at classification:
	// positively known running, or unknown/ambiguous state. Empty means the
	// reading was not taken.
	State  string
	handle uintptr
}

// ProcessName is the executable's file name, taken from the verified image path
// or from the snapshot entry for a process whose image could not be read.
func (p RestartProcess) ProcessName() string {
	if p.Name != "" {
		return p.Name
	}
	_, name := pathParts(p.Image)
	return name
}

// RestartScan is the verified process picture under one Discord base folder.
// Family holds only target-executable processes from app-* folders; Foreign
// holds other executables from inside the base (for example Update.exe); and
// Unreadable reports a Discord executable that could not be opened, queried or
// held, together with the system cause that blocked verification.
type RestartScan struct {
	Family     []RestartProcess
	Foreign    []RestartProcess
	Unreadable []RestartProcess
}

// RestartResult reports one restart attempt. DetailID names the localized
// detail line for a failure and OpenManually selects the recovery instruction
// used after Discord has already quit. Changed reports a target that no longer
// matches what was stored, and Err carries only the OS cause. Stage, Process
// and PID keep where the first useful failure happened and which process it
// belongs to, Image keeps that process's verified path when it is known, and
// Observed keeps the one zero-time handle reading taken on the final-check
// failure path — diagnostics only, never a changed decision.
type RestartResult struct {
	DetailID     string
	Stage        string
	Process      string
	PID          uint32
	Image        string
	Observed     *RestartObservation
	OpenManually bool
	AlreadyOpen  bool
	Changed      bool
	Err          error
}

// restartCauseError carries the stage and the process of the first useful
// system cause out of the platform seams. Its text stays the system text: an
// app-authored string is never displayed.
type restartCauseError struct {
	stage string
	name  string
	pid   uint32
	image string
	cause error
}

func (e *restartCauseError) Error() string { return e.cause.Error() }
func (e *restartCauseError) Unwrap() error { return e.cause }

// stageCause records which stage failed and which verified process the system
// cause belongs to.
func stageCause(stage string, proc RestartProcess, cause error) error {
	return &restartCauseError{stage: stage, name: proc.ProcessName(), pid: proc.PID, image: proc.Image, cause: cause}
}

// firstCause fills the diagnostic fields of a failure from the first recorded
// cause in err, falling back to the stage of the call site when a seam reported
// a plain error. The error itself is preserved unchanged.
func firstCause(result *RestartResult, stage string, err error) {
	result.Stage = stage
	result.Err = err
	var typed *restartCauseError
	if errors.As(err, &typed) {
		result.Stage, result.Process, result.PID, result.Image = typed.stage, typed.name, typed.pid, typed.image
	}
}

// Platform hooks in the installHook/activityOverride style. Tests replace them
// with fakes; production uses the platform implementations.
var (
	restartEnumerate    = platformRestartEnumerate
	restartCloseWindows = platformRestartCloseWindows
	restartTerminate    = platformRestartTerminate
	restartWaitGone     = platformRestartWaitGone
	restartLaunch       = platformRestartLaunch
	restartRelease      = platformRestartRelease
	restartElevated     = platformRestartElevated
)

// Elevated reports whether this installer runs with administrator rights. An
// elevated manager never spawns Discord, because that would elevate Discord.
func Elevated() bool { return restartElevated() }

var restartExeNames = []string{"Discord.exe", "DiscordPTB.exe", "DiscordCanary.exe", "DiscordDevelopment.exe"}

// RestartExecutable returns the one Discord executable in the newest app-*
// folder of base, and whether it exists. For a manually entered folder this
// executable is the proof that the folder owns that Discord application.
func RestartExecutable(base string) (string, bool) {
	entries, err := os.ReadDir(base)
	if err != nil {
		return "", false
	}
	type versioned struct {
		dir string
		v   [3]int
	}
	var versions []versioned
	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() || !strings.HasPrefix(strings.ToLower(name), "app-") {
			continue
		}
		match := appDirRe.FindStringSubmatch(name)
		if match == nil {
			continue
		}
		a, _ := strconv.Atoi(match[1])
		b, _ := strconv.Atoi(match[2])
		c, _ := strconv.Atoi(match[3])
		versions = append(versions, versioned{filepath.Join(base, name), [3]int{a, b, c}})
	}
	sort.Slice(versions, func(i, j int) bool {
		for k := 0; k < 3; k++ {
			if versions[i].v[k] != versions[j].v[k] {
				return versions[i].v[k] > versions[j].v[k]
			}
		}
		return false
	})
	if len(versions) == 0 {
		return "", false
	}
	var found []string
	for _, name := range restartExeNames {
		candidate := filepath.Join(versions[0].dir, name)
		if info, statErr := os.Stat(candidate); statErr == nil && !info.IsDir() {
			found = append(found, candidate)
		}
	}
	if len(found) != 1 {
		return "", false
	}
	return found[0], true
}

func sameInstallPath(left, right string) bool {
	for _, a := range []string{left, canonicalPath(left)} {
		for _, b := range []string{right, canonicalPath(right)} {
			if hasInstallPrefix(a, b) && hasInstallPrefix(b, a) {
				return true
			}
		}
	}
	return false
}

// restartFamilyImage applies the process-family rule to one verified image
// path: the executable name must equal the target's name and its folder must be
// an app-* folder directly inside the selected base. Discord's helper processes
// and older app-* copies run that same executable; Update.exe and anything
// outside the selected folder never qualifies.
func restartFamilyImage(base, exeName, image string) bool {
	dir, name := pathParts(image)
	if name == "" || !strings.EqualFold(name, exeName) {
		return false
	}
	parent, folder := pathParts(dir)
	if !strings.HasPrefix(strings.ToLower(folder), "app-") {
		return false
	}
	return sameInstallPath(parent, base) || sameInstallPath(parent, canonicalPath(base))
}

// auxiliaryWrapperRe matches the module wrapper folder of Discord's System
// Helper layout.
var auxiliaryWrapperRe = regexp.MustCompile(`(?i)^discord_utils-\d+$`)

// restartAuxiliaryImage is the narrow structural rule for Discord's System
// Helper: exactly DiscordSystemHelper.exe inside the exact
// modules\discord_utils-<n>\discord_utils layout of an app-* folder directly
// inside the selected base. It is a path-based compatibility rule, not
// signature verification. A copy at another location, a similar file name, or
// any other module folder never qualifies and stays a blocking program.
func restartAuxiliaryImage(base, image string) bool {
	dir, name := pathParts(image)
	if !strings.EqualFold(name, "DiscordSystemHelper.exe") {
		return false
	}
	wrapper, leaf := pathParts(dir)
	if !strings.EqualFold(leaf, "discord_utils") {
		return false
	}
	modules, wrapperName := pathParts(wrapper)
	if !auxiliaryWrapperRe.MatchString(wrapperName) {
		return false
	}
	appDir, folder := pathParts(modules)
	if !strings.EqualFold(folder, "modules") {
		return false
	}
	parent, app := pathParts(appDir)
	// Only the local app segment is case-normalized for the shared version
	// pattern; the module, name and base checks above keep their exact rules.
	if appDirRe.FindStringSubmatch(strings.ToLower(app)) == nil {
		return false
	}
	return sameInstallPath(parent, base) || sameInstallPath(parent, canonicalPath(base))
}

// restartUpdaterImage is exactly the selected base's Update.exe: Discord's
// updater at the root of the installation. Update.exe anywhere else under the
// base stays an ordinary blocking program.
func restartUpdaterImage(base, image string) bool {
	dir, name := pathParts(image)
	if !strings.EqualFold(name, "Update.exe") {
		return false
	}
	return sameInstallPath(dir, base) || sameInstallPath(dir, canonicalPath(base))
}

// pathParts splits a path on either separator so Windows image paths behave the
// same way in every test environment.
func pathParts(path string) (dir, name string) {
	trimmed := strings.TrimRight(path, `/\`)
	index := strings.LastIndexAny(trimmed, `/\`)
	if index < 0 {
		return "", trimmed
	}
	return trimmed[:index], trimmed[index+1:]
}

// restartClass names what an image read from a process handle means for one
// restart attempt. Every scan uses the same classifier: the initial stop scan,
// the scan after stopping, the install's final check before commit, and the
// read-only check of the open-only action.
type restartClass int

const (
	restartUnrelated    restartClass = iota
	restartFamily                    // target executable from an app-* folder: acted on
	restartForeign                   // another executable under the base: blocks
	restartUnverifiable              // family process without the rights to act on it
	restartAuxiliary                 // Discord's System Helper: ignored, never acted on
	restartUpdater                   // the selected base's Update.exe: blocks
)

// classifyObserved applies the shared process-role rule to an image read from
// the process's own handle. held reports that the handle carries every right
// the restart acts with. Observation itself needs none of those rights, so a
// foreign image under the base still blocks even when only query rights could
// be opened, while a client process that cannot be held with full rights is
// unverifiable and blocks everything before any action. Discord's System
// Helper is recognized by its exact structural path and is never recorded: it
// receives no close request, is never ended and never waited for.
func classifyObserved(base, exeName, image string, held bool) restartClass {
	if restartAuxiliaryImage(base, image) {
		return restartAuxiliary
	}
	if restartFamilyImage(base, exeName, image) {
		if !held {
			return restartUnverifiable
		}
		return restartFamily
	}
	if restartUpdaterImage(base, image) {
		return restartUpdater
	}
	if image != "" && pathUnderBase(base, image) {
		return restartForeign
	}
	return restartUnrelated
}

// waitSignaled is the WaitForSingleObject result of an already exited process,
// and waitTimedOut the zero-time result of one that had not exited.
const (
	waitSignaled = 0
	waitTimedOut = 258
)

// terminateHeld makes at most one termination attempt per verified live
// process and keeps the first meaningful system failure. A handle that already
// exited is skipped on native liveness semantics before anything is done to
// it, and a genuine wait failure means the state is unknown: the pass stops
// there and no further force is applied. Termination-call failures are kept but
// do not stop the pass — the shared bounded exit wait that follows may still
// confirm the exit — and no call is ever retried in a loop.
func terminateHeld(procs []RestartProcess, wait func(uintptr, uint32) (uint32, error), kill func(uintptr) error) error {
	var first error
	for _, proc := range procs {
		if proc.handle == 0 {
			continue
		}
		state, err := wait(proc.handle, 0)
		if err != nil {
			// A genuine wait failure is never swallowed; the first meaningful
			// failure stays first when both happened.
			failure := stageCause(stageWaitFailed, proc, err)
			if first != nil {
				return errors.Join(first, failure)
			}
			return failure
		}
		if state == waitSignaled {
			continue
		}
		if err = kill(proc.handle); err != nil && first == nil {
			first = stageCause(stageTerminateFailed, proc, err)
		}
	}
	return first
}

// VerifyRestartTarget re-checks the stored identity the moment Restart is
// clicked. Discord may have created a newer app-* folder since the install, so
// the folder and the executable must still match what was stored.
func VerifyRestartTarget(entered, storedBase, storedExe string) error {
	changed := Message("common.error.targetChanged", nil, nil)
	current, err := NormalizeDiscordBaseDir(entered)
	if err != nil {
		return changed
	}
	same := sameInstallPath(current, storedBase)
	if left, statErr := os.Stat(current); statErr == nil {
		if right, statErr := os.Stat(storedBase); statErr == nil {
			same = os.SameFile(left, right)
		}
	}
	if !same {
		return changed
	}
	exe, ok := RestartExecutable(current)
	if !ok || !fileExists(storedExe) {
		return changed
	}
	if !strings.EqualFold(exe, storedExe) && !sameFileIdentity(exe, storedExe) {
		return changed
	}
	return nil
}

// sameFileIdentity keeps an alias of the same installation from reading as a
// changed target, while a different file never matches.
func sameFileIdentity(left, right string) bool {
	leftInfo, err := os.Stat(left)
	if err != nil {
		return false
	}
	rightInfo, err := os.Stat(right)
	if err != nil {
		return false
	}
	return os.SameFile(leftInfo, rightInfo)
}

const (
	restartDetailNotQuit        = "common.detail.notQuit"
	restartDetailUnverified     = "common.detail.unverified"
	restartDetailLaunchFailed   = "common.detail.launchFailed"
	restartDetailUpdaterRunning = "common.detail.updaterRunning"
	restartDetailOtherProgram   = "win.detail.otherProgram"
	restartDetailReopened       = "win.detail.reopened"
	restartDetailAlreadyOpen    = "win.detail.alreadyOpen"
)

// Failure stages reported in the details. Each names one distinguishable way
// a restart attempt stops: a failed query, another program found inside the
// Discord folder, a failed close request, a failed termination call, a failed
// wait, a wait that timed out, a process still reported by the final check,
// and a launch the system did not accept.
const (
	stageQueryFailed     = "win.stage.queryFailed"
	stageOtherProcess    = "win.stage.otherProcess"
	stageCloseFailed     = "win.stage.closeFailed"
	stageTerminateFailed = "win.stage.terminateFailed"
	stageWaitFailed      = "win.stage.waitFailed"
	stageWaitTimeout     = "win.stage.waitTimeout"
	stageRescanFound     = "win.stage.rescanFound"
	stageLaunchFailed    = "win.stage.launchFailed"
)

// One zero-time reading of a held, verified process handle, kept for the
// details only. State names whether the handle is signaled, unsignaled or
// uncheckable; Result and Err keep the native wait result or its error.
type RestartObservation struct {
	State  string
	Result uint32
	Err    error
}

// observeHeldHandle takes one zero-time read-only reading of one held, verified
// process handle through the existing wait primitive. Only handles opened with
// SYNCHRONIZE — every held family handle — may be read this way; a query-only
// handle is never waited on, and the reading never leads to a termination.
// The reading is diagnostic only: callers keep their own failure decision.
func observeHeldHandle(proc RestartProcess) *RestartObservation {
	if proc.handle == 0 {
		return nil
	}
	stalled, err := restartWaitGone([]RestartProcess{proc}, 0)
	if err != nil {
		return &RestartObservation{State: "win.state.uncheckable", Err: err}
	}
	if stalled != nil {
		return &RestartObservation{State: "win.state.unsignaled", Result: waitTimedOut}
	}
	return &RestartObservation{State: "win.state.signaled", Result: waitSignaled}
}

// blockerDetail names the accurate category of a recorded blocker: only the
// selected base's verified Update.exe keeps the updater message, while any
// other program inside the base is named in its own message.
func blockerDetail(proc RestartProcess) string {
	if proc.Updater {
		return restartDetailUpdaterRunning
	}
	return restartDetailOtherProgram
}

// blockerResult reports the first recorded blocker without ever touching it.
// The native liveness reading is kept so an unknown state is never presented
// as positively known running, and its system cause is retained.
func blockerResult(entries []RestartProcess, openManually bool) RestartResult {
	first := entries[0]
	result := RestartResult{DetailID: blockerDetail(first), Stage: stageOtherProcess, Process: first.ProcessName(), PID: first.PID, Image: first.Image, Err: first.Cause, OpenManually: openManually}
	if first.State != "" {
		result.Observed = &RestartObservation{State: first.State, Result: waitTimedOut}
	}
	return result
}

// waitFailureIn reports the first genuine wait/state failure anywhere inside
// err, including joined errors. Only a termination-call failure may resolve
// through the bounded exit wait; a state failure stays fatal and is never
// hidden behind an error that merely wraps it.
func waitFailureIn(err error) error {
	switch typed := err.(type) {
	case nil:
		return nil
	case interface{ Unwrap() []error }:
		for _, part := range typed.Unwrap() {
			if found := waitFailureIn(part); found != nil {
				return found
			}
		}
	case *restartCauseError:
		if typed.stage == stageWaitFailed {
			return typed
		}
		return waitFailureIn(typed.cause)
	case interface{ Unwrap() error }:
		return waitFailureIn(typed.Unwrap())
	}
	return nil
}

// StopDiscord closes and ends the verified Discord client processes of the
// selected installation and confirms with one final scan. It never launches
// anything. Discord's System Helper is ignored throughout; the base's updater,
// any other program inside the base, and anything unverifiable stop the
// operation without being touched. Every failure keeps its stage, the process
// the first useful system cause belongs to, and that cause itself.
func StopDiscord(base, exe string) RestartResult {
	_, name := pathParts(exe)
	if name == "" {
		name = filepath.Base(exe)
	}
	scan, err := restartEnumerate(base, name)
	if err != nil {
		restartRelease(scan.Family)
		result := RestartResult{DetailID: restartDetailUnverified}
		firstCause(&result, stageQueryFailed, err)
		return result
	}
	defer restartRelease(scan.Family)
	// The all-or-nothing check runs before anything is closed or ended.
	if len(scan.Unreadable) > 0 {
		first := scan.Unreadable[0]
		return RestartResult{DetailID: restartDetailUnverified, Stage: stageQueryFailed, Process: first.ProcessName(), PID: first.PID, Image: first.Image, Err: first.Cause}
	}
	if len(scan.Foreign) > 0 {
		return blockerResult(scan.Foreign, false)
	}
	if len(scan.Family) > 0 {
		pids := make([]uint32, 0, len(scan.Family))
		for _, proc := range scan.Family {
			pids = append(pids, proc.PID)
		}
		if err = restartCloseWindows(pids); err != nil {
			result := RestartResult{DetailID: restartDetailUnverified}
			firstCause(&result, stageCloseFailed, err)
			return result
		}
		stalled, waitErr := restartWaitGone(scan.Family, 2*time.Second)
		if waitErr != nil {
			// A grace-period wait error is not a clean timeout: escalating to
			// termination would act on processes whose state is unknown.
			result := RestartResult{DetailID: restartDetailNotQuit}
			firstCause(&result, stageWaitFailed, waitErr)
			return result
		}
		if stalled != nil {
			// At most one termination attempt per verified live client. A
			// termination-call failure may resolve through the shared bounded
			// exit wait that follows, but a genuine wait/state failure is
			// fatal: it is never swallowed and never resolved that way.
			termErr := restartTerminate(scan.Family)
			if waitFailureIn(termErr) != nil {
				result := RestartResult{DetailID: restartDetailNotQuit}
				firstCause(&result, stageWaitFailed, termErr)
				return result
			}
			stalled, waitErr = restartWaitGone(scan.Family, 5*time.Second)
			if waitErr != nil {
				// A genuine wait failure is never swallowed and never permits
				// further force; the first meaningful failure stays first.
				if termErr != nil {
					waitErr = errors.Join(termErr, waitErr)
				}
				result := RestartResult{DetailID: restartDetailNotQuit}
				firstCause(&result, stageWaitFailed, waitErr)
				return result
			}
			if stalled != nil {
				// A timeout reports "not quit" with the kept cause, if any —
				// reported with the process that cause belongs to, never with
				// another process's identity.
				result := RestartResult{DetailID: restartDetailNotQuit, Stage: stageWaitTimeout, Process: stalled.ProcessName(), PID: stalled.PID, Image: stalled.Image}
				if termErr != nil {
					result.Process, result.PID, result.Image = "", 0, ""
					firstCause(&result, stageTerminateFailed, termErr)
				}
				return result
			}
		}
	}
	// The initial scan handles are released once before the final rescan; the
	// deferred release above then finds them cleared and closes nothing twice.
	restartRelease(scan.Family)
	rescan, err := restartEnumerate(base, name)
	if err != nil {
		restartRelease(rescan.Family)
		result := RestartResult{DetailID: restartDetailUnverified}
		firstCause(&result, stageQueryFailed, err)
		return result
	}
	defer restartRelease(rescan.Family)
	// The final check still reports a matching process: it stops the operation
	// and no second instance may ever be started. The details keep what is
	// actually known — the verified path and one zero-time reading of its held
	// handle — without claiming it is new, alive or respawned, and the reading
	// never changes this decision.
	if len(rescan.Family) > 0 {
		first := rescan.Family[0]
		return RestartResult{DetailID: restartDetailNotQuit, Stage: stageRescanFound, Process: first.ProcessName(), PID: first.PID, Image: first.Image, Observed: observeHeldHandle(first)}
	}
	if len(rescan.Unreadable) > 0 {
		first := rescan.Unreadable[0]
		return RestartResult{DetailID: restartDetailUnverified, Stage: stageQueryFailed, Process: first.ProcessName(), PID: first.PID, Image: first.Image, Err: first.Cause, OpenManually: true}
	}
	if len(rescan.Foreign) > 0 {
		return blockerResult(rescan.Foreign, true)
	}
	return RestartResult{}
}

// readCheck runs the shared classifier once, read-only. A running client is
// reported with openDetail — already open for the open-only action, reopened
// for the install's final check — and a blocker keeps its own category.
// Nothing is closed, ended, waited out or launched.
func readCheck(base, exe, openDetail string) RestartResult {
	_, name := pathParts(exe)
	if name == "" {
		name = filepath.Base(exe)
	}
	scan, err := restartEnumerate(base, name)
	if err != nil {
		restartRelease(scan.Family)
		result := RestartResult{DetailID: restartDetailUnverified}
		firstCause(&result, stageQueryFailed, err)
		return result
	}
	defer restartRelease(scan.Family)
	if len(scan.Unreadable) > 0 {
		first := scan.Unreadable[0]
		return RestartResult{DetailID: restartDetailUnverified, Stage: stageQueryFailed, Process: first.ProcessName(), PID: first.PID, Image: first.Image, Err: first.Cause}
	}
	if len(scan.Foreign) > 0 {
		return blockerResult(scan.Foreign, false)
	}
	if len(scan.Family) > 0 {
		first := scan.Family[0]
		return RestartResult{DetailID: openDetail, Process: first.ProcessName(), PID: first.PID, Image: first.Image, AlreadyOpen: openDetail == restartDetailAlreadyOpen}
	}
	return RestartResult{}
}

// CheckDiscordStopped reports what one bounded read-only classifier scan finds
// immediately before an install commits: a running client is reported as
// reopened, a blocker keeps its accurate category, and an empty result means
// nothing under the base is running.
func CheckDiscordStopped(base, exe string) RestartResult {
	return readCheck(base, exe, restartDetailReopened)
}

// OpenDiscord launches the verified executable of the selected installation
// when nothing under the base is running. It revalidates the target and makes
// one read-only process check, then launches only: a running client is
// reported as already open and is never touched, and a blocker keeps its own
// category. Success means only that the OS accepted the launch.
func OpenDiscord(base, exe string) RestartResult {
	if found := readCheck(base, exe, restartDetailAlreadyOpen); found.DetailID != "" {
		return found
	}
	// Discord may have created a newer app-* folder meanwhile; the stored
	// target is revalidated before the launch.
	if latest, ok := RestartExecutable(base); !ok || !strings.EqualFold(latest, exe) {
		return RestartResult{Changed: true}
	}
	if err := restartLaunch(exe, parentDir(exe)); err != nil {
		result := RestartResult{DetailID: restartDetailLaunchFailed, OpenManually: true}
		firstCause(&result, stageLaunchFailed, err)
		return result
	}
	return RestartResult{}
}
func parentDir(path string) string {
	dir, _ := pathParts(path)
	if dir == "" {
		return filepath.Dir(path)
	}
	return dir
}
