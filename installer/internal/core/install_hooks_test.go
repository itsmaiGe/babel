package core

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// installFixture builds a selected installation with its client executable and
// returns the base folder.
func installFixture(t *testing.T) string {
	t.Helper()
	useActivity(t, true, false)
	base := fakeDiscord(t, "1.0.0")
	write(t, filepath.Join(base, "app-1.0.0", "Discord.exe"), "exe")
	return base
}

func changedTarget(err error) bool {
	var typed *MessageError
	return errors.As(err, &typed) && typed.ID == "common.error.targetChanged"
}

func generationDirs(t *testing.T, core string) int {
	t.Helper()
	entries, err := os.ReadDir(core)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, entry := range entries {
		if generationRe.MatchString(entry.Name()) {
			count++
		}
	}
	return count
}

// Without valid preflight nothing is touched and the stop never runs.
func TestInstallWithoutValidPreflightTouchesNothing(t *testing.T) {
	base := installFixture(t)
	core, _ := ResolveCoreDir(base)
	indexPath := filepath.Join(core, "index.js")
	original, _ := os.ReadFile(indexPath)
	stopped := 0
	hooks := InstallHooks{Stop: func(InstallTarget) error { stopped++; return nil }}
	if _, err := InstallWithHooks(base, payloadWithExtra(t, "@dtm-test-only"), hooks); err == nil {
		t.Fatal("an invalid payload must fail")
	}
	if stopped != 0 {
		t.Fatalf("the stop ran %d times before a valid preflight", stopped)
	}
	after, _ := os.ReadFile(indexPath)
	if generationDirs(t, core) != 0 || !strings.Contains(string(original), "core.asar") || string(after) != string(original) {
		t.Fatal("nothing may be published or changed on a preflight failure")
	}
	// The same holds when the client executable cannot be resolved.
	os.Remove(filepath.Join(base, "app-1.0.0", "Discord.exe"))
	if _, err := InstallWithHooks(base, samplePayload(), hooks); err == nil {
		t.Fatal("a target without its executable must fail")
	}
	if stopped != 0 {
		t.Fatalf("the stop ran %d times without a resolvable target", stopped)
	}
}

// A failed stop publishes nothing, mutates nothing and runs no cleanup.
func TestInstallStopFailureTouchesNothing(t *testing.T) {
	base := installFixture(t)
	core, _ := ResolveCoreDir(base)
	indexPath := filepath.Join(core, "index.js")
	backup := filepath.Join(core, BackupName)
	write(t, backup, "previous")
	original, _ := os.ReadFile(indexPath)
	stopErr := errors.New("stop failed")
	var seen InstallTarget
	hooks := InstallHooks{Stop: func(target InstallTarget) error {
		seen = target
		return stopErr
	}}
	if _, err := InstallWithHooks(base, samplePayload(), hooks); !errors.Is(err, stopErr) {
		t.Fatalf("the stop failure must abort the install: %v", err)
	}
	// The identity handed to the stop is complete and captured up front.
	coreDir, _ := ResolveCoreDir(base)
	exe, ok := RestartExecutable(base)
	if !ok || seen.Base != base || seen.Core != coreDir || seen.Exe != exe || len(seen.Index) == 0 {
		t.Fatalf("captured identity %#v", seen)
	}
	after, _ := os.ReadFile(indexPath)
	if string(after) != string(original) {
		t.Fatal("index.js must be untouched after a failed stop")
	}
	if generationDirs(t, core) != 0 {
		t.Fatal("no generation may be published after a failed stop")
	}
	if !fileExists(backup) {
		t.Fatal("a failed stop must run no cleanup")
	}
}

// A target that changes while Discord is being stopped aborts the install —
// including the already-installed early return — instead of retargeting.
func TestInstallRevalidatesTargetAfterStop(t *testing.T) {
	base := installFixture(t)
	// The first install creates the already-installed state.
	if _, err := Install(base, samplePayload()); err != nil {
		t.Fatal(err)
	}
	// A newer app-* folder appears during the stop: the matched-payload early
	// return must not run against the new target.
	hooks := InstallHooks{Stop: func(InstallTarget) error {
		if err := os.MkdirAll(filepath.Join(base, "app-1.0.11"), 0o755); err != nil {
			t.Fatal(err)
		}
		write(t, filepath.Join(base, "app-1.0.11", "Discord.exe"), "newer")
		return nil
	}}
	if _, err := InstallWithHooks(base, samplePayload(), hooks); !changedTarget(err) {
		t.Fatalf("a new app folder during the stop must abort: %v", err)
	}
	// Merely rewriting the old index.js during the stop is not enough to keep
	// going either.
	base2 := installFixture(t)
	core2, _ := ResolveCoreDir(base2)
	hooks = InstallHooks{Stop: func(InstallTarget) error {
		write(t, filepath.Join(core2, "index.js"), "module.exports = require('./core.asar');\n// changed\n")
		return nil
	}}
	if _, err := InstallWithHooks(base2, samplePayload(), hooks); !changedTarget(err) {
		t.Fatalf("a changed index.js during the stop must abort: %v", err)
	}
	// Without any change the revalidation passes and the matched payload
	// finishes normally.
	base3 := installFixture(t)
	if _, err := Install(base3, samplePayload()); err != nil {
		t.Fatal(err)
	}
	called := 0
	hooks = InstallHooks{Stop: func(InstallTarget) error { called++; return nil }}
	if _, err := InstallWithHooks(base3, samplePayload(), hooks); err != nil || called != 1 {
		t.Fatalf("unchanged target: %v calls %d", err, called)
	}
}

// The final check runs immediately before the commit: a blocker aborts after
// publication with the existing unreferenced-generation policy, and the index
// is never mutated.
func TestInstallFinalCheckBlocksBeforeCommit(t *testing.T) {
	base := installFixture(t)
	core, _ := ResolveCoreDir(base)
	indexPath := filepath.Join(core, "index.js")
	original, _ := os.ReadFile(indexPath)
	blocker := Message("win.detail.reopened", nil, nil)
	hooks := InstallHooks{
		Stop:      func(InstallTarget) error { return nil },
		PreCommit: func(InstallTarget) error { return blocker },
	}
	if _, err := InstallWithHooks(base, samplePayload(), hooks); !errors.Is(err, blocker) {
		t.Fatalf("the final check must abort the commit: %v", err)
	}
	after, _ := os.ReadFile(indexPath)
	if string(after) != string(original) {
		t.Fatal("index.js must be untouched when the final check fails")
	}
	// The published but unreferenced generation follows the existing policy:
	// it stays for a later idle cleanup instead of being referenced.
	if generationDirs(t, core) != 1 {
		t.Fatalf("generations = %d, want the one unreferenced publication", generationDirs(t, core))
	}
}

// Target identity is checked again after the final check's own hook: a new
// core selected during the install transaction aborts before the commit.
func TestInstallFinalCheckRevalidatesIdentity(t *testing.T) {
	base := installFixture(t)
	core, _ := ResolveCoreDir(base)
	indexPath := filepath.Join(core, "index.js")
	original, _ := os.ReadFile(indexPath)
	installHook = func(step, path string) error {
		if step == "beforeCommit" {
			// A Discord update completed while the install was running.
			makeDiscordAt(t, base, "1.0.11")
			write(t, filepath.Join(base, "app-1.0.11", "Discord.exe"), "newer")
		}
		return nil
	}
	t.Cleanup(func() { installHook = nil })
	if _, err := InstallWithHooks(base, samplePayload(), InstallHooks{
		Stop:      func(InstallTarget) error { return nil },
		PreCommit: func(InstallTarget) error { return nil },
	}); !changedTarget(err) {
		t.Fatalf("a new core selected during the install must abort: %v", err)
	}
	after, _ := os.ReadFile(indexPath)
	if string(after) != string(original) {
		t.Fatal("index.js must be untouched when the target changed")
	}
}

// The frozen identity evidence survives a stable alias and rejects a
// retargeted one: swapping the selected alias to another valid installation
// with identical versions and index bytes must abort.
func TestInstallRejectsARetargetedAliasDuringStop(t *testing.T) {
	first, second := installFixture(t), installFixture(t)
	alias := filepath.Join(t.TempDir(), "selected")
	if err := os.Symlink(first, alias); err != nil {
		t.Fatal(err)
	}
	hooks := InstallHooks{Stop: func(InstallTarget) error {
		if err := os.Remove(alias); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(second, alias); err != nil {
			t.Fatal(err)
		}
		return nil
	}}
	if _, err := InstallWithHooks(alias, samplePayload(), hooks); !changedTarget(err) {
		t.Fatalf("selected alias was retargeted during stop but installation continued: %v", err)
	}
	// A stable alias of the same objects keeps working.
	stable := filepath.Join(t.TempDir(), "stable")
	if err := os.Symlink(first, stable); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallWithHooks(stable, samplePayload(), InstallHooks{Stop: func(InstallTarget) error { return nil }}); err != nil {
		t.Fatalf("a stable alias must keep working: %v", err)
	}
}

// A same-path replacement is a different object: recreating the client
// executable where it was aborts even though every string is identical.
func TestInstallRejectsASamePathReplacementDuringStop(t *testing.T) {
	base := installFixture(t)
	exe, ok := RestartExecutable(base)
	if !ok {
		t.Fatal("fixture executable missing")
	}
	hooks := InstallHooks{Stop: func(InstallTarget) error {
		if err := os.Remove(exe); err != nil {
			t.Fatal(err)
		}
		write(t, exe, "exe")
		return nil
	}}
	if _, err := InstallWithHooks(base, samplePayload(), hooks); !changedTarget(err) {
		t.Fatalf("a replaced executable must abort the install: %v", err)
	}
	core, _ := ResolveCoreDir(base)
	if generationDirs(t, core) != 0 {
		t.Fatal("no generation may be published after a replaced target")
	}
}
