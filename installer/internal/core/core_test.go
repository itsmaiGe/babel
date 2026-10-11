package core

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

// fakeDiscord builds a minimal Discord user-data tree with the given app
// versions, each having a valid discord_desktop_core, and returns the base dir.
func fakeDiscord(t *testing.T, versions ...string) string {
	t.Helper()
	base := t.TempDir()
	makeDiscordAt(t, base, versions...)
	return base
}

func makeDiscordAt(t *testing.T, base string, versions ...string) {
	t.Helper()
	for _, v := range versions {
		core := filepath.Join(base, "app-"+v, "modules", "discord_desktop_core-1", "discord_desktop_core")
		if err := os.MkdirAll(core, 0o755); err != nil {
			t.Fatal(err)
		}
		write(t, filepath.Join(core, "core.asar"), "asar")
		write(t, filepath.Join(core, "package.json"), "{}")
		write(t, filepath.Join(core, "index.js"), VanillaIndex)
	}
}

func write(t *testing.T, p, content string) {
	t.Helper()
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func samplePayload() fstest.MapFS {
	payload := fstest.MapFS{
		"shared/defaults.js": {Data: []byte(`const BABEL_VERSION = "0.1.6";`)},
		"main.js":            {Data: []byte("exports.install=()=>{}")},
		"preload.js":         {Data: []byte("// preload")},
		"renderer.js":        {Data: []byte("// renderer")},
		"shared/util.js":     {Data: []byte("// shared")},
		"shared/settings.js": {Data: []byte("// settings")},
	}
	manifest := PayloadManifest{Version: "0.1.6"}
	for name, entry := range payload {
		hash := sha256.Sum256(entry.Data)
		manifest.Files = append(manifest.Files, PayloadEntry{Path: name, Bytes: len(entry.Data), SHA256: fmt.Sprintf("%x", hash)})
	}
	data, _ := json.Marshal(manifest)
	payload["manifest.json"] = &fstest.MapFile{Data: data}
	return payload

}

func payloadWithExtra(t *testing.T, extra string) fstest.MapFS {
	t.Helper()
	payload := samplePayload()
	main := payload["main.js"]
	main.Data = append(append([]byte(nil), main.Data...), []byte(extra)...)
	payload["main.js"] = main
	delete(payload, "manifest.json")
	manifest := PayloadManifest{Version: "0.1.6"}
	for name, entry := range payload {
		sum := sha256.Sum256(entry.Data)
		manifest.Files = append(manifest.Files, PayloadEntry{Path: name, Bytes: len(entry.Data), SHA256: fmt.Sprintf("%x", sum)})
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	payload["manifest.json"] = &fstest.MapFile{Data: data}
	return payload
}

func TestResolveCoreDirPicksNewestVersion(t *testing.T) {
	base := fakeDiscord(t, "1.0.9", "1.0.10", "1.0.2")
	core, err := ResolveCoreDir(base)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(core, filepath.Join("app-1.0.10", "modules")) {
		t.Fatalf("expected newest version app-1.0.10, got %s", core)
	}
}

func TestFindDiscordBaseDirsUsesLocalAppDataAcrossDrives(t *testing.T) {
	local := t.TempDir()
	stable := filepath.Join(local, "Discord")
	makeDiscordAt(t, stable, "1.0.1")
	t.Setenv("LOCALAPPDATA", local)

	got := FindDiscordBaseDirs()
	if len(got) != 1 || got[0] != stable {
		t.Fatalf("expected detected Discord at %s, got %#v", stable, got)
	}
}

func TestNormalizeDiscordBaseDirAcceptsBaseAppDirAndExe(t *testing.T) {
	base := fakeDiscord(t, "1.0.1")
	appDir := filepath.Join(base, "app-1.0.1")
	exe := filepath.Join(appDir, "Discord.exe")
	write(t, exe, "exe")

	for _, input := range []string{base, appDir, exe} {
		got, err := NormalizeDiscordBaseDir(input)
		if err != nil {
			t.Fatalf("NormalizeDiscordBaseDir(%s): %v", input, err)
		}
		if got != base {
			t.Fatalf("NormalizeDiscordBaseDir(%s) = %s, want %s", input, got, base)
		}
	}
}

func useActivity(t *testing.T, known, running bool) {
	t.Helper()
	activityOverride = func(string) (bool, bool) { return known, running }
	t.Cleanup(func() { activityOverride = nil })
}

func nativeGenerations(t *testing.T, core string) []string {
	t.Helper()
	entries, err := os.ReadDir(core)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, entry := range entries {
		if nativeGenerationRe.MatchString(entry.Name()) {
			names = append(names, entry.Name())
		}
	}
	return names
}

func TestInstallThenUninstallRoundTrips(t *testing.T) {
	useActivity(t, true, false)
	base := fakeDiscord(t, "1.0.0")
	// Redirect the config store to a temp dir so the test never deletes the real
	// user config, and so we can assert uninstall wipes it.
	configStore := filepath.Join(t.TempDir(), PayloadDirName)
	t.Setenv("BABEL_CONFIG_DIR", configStore)
	if err := os.MkdirAll(configStore, 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(configStore, "api-keys.json"), "{}")

	core, _ := ResolveCoreDir(base)
	indexPath := filepath.Join(core, "index.js")

	if _, err := Install(base, samplePayload()); err != nil {
		t.Fatal(err)
	}

	idx, _ := os.ReadFile(indexPath)
	if !strings.Contains(string(idx), LoaderMarker) {
		t.Fatal("loader marker not written")
	}
	if _, err := os.Stat(filepath.Join(core, BackupName)); err == nil {
		t.Fatal("additive install should not create a backup")
	}
	generations := nativeGenerations(t, core)
	if len(generations) != 1 {
		t.Fatalf("expected one native generation, got %v", generations)
	}
	if _, err := os.Stat(filepath.Join(core, generations[0], "main.js")); err != nil {
		t.Fatal("payload main.js not copied")
	}
	if _, err := os.Stat(filepath.Join(core, generations[0], "shared", "util.js")); err != nil {
		t.Fatal("nested payload not copied")
	}

	if _, err := UninstallWithOptions(base, UninstallOptions{RemoveProfileData: true, ProfileDirectory: filepath.Dir(configStore)}); err != nil {
		t.Fatal(err)
	}
	idx, _ = os.ReadFile(indexPath)
	if !bytes.Equal(idx, []byte(VanillaIndex)) {
		t.Fatalf("index not restored, got %q", string(idx))
	}
	if _, err := os.Stat(filepath.Join(core, BackupName)); err == nil {
		t.Fatal("backup not removed")
	}
	if remaining := nativeGenerations(t, core); len(remaining) != 0 {
		t.Fatalf("payload generation not removed: %v", remaining)
	}
	if _, err := os.Stat(filepath.Join(core, PayloadDirName)); err == nil {
		t.Fatal("legacy payload not removed")
	}
	if _, err := os.Stat(configStore); err == nil {
		t.Fatal("config store (api keys / settings) not removed on uninstall")
	}
}

func TestInstallRefusesUnknownIndex(t *testing.T) {
	base := fakeDiscord(t, "1.0.0")
	core, _ := ResolveCoreDir(base)
	write(t, filepath.Join(core, "index.js"), "console.log('some other mod owns this');")

	if _, err := Install(base, samplePayload()); err == nil {
		t.Fatal("expected Install to refuse an unknown index.js")
	}
}

func TestInstallIsIdempotent(t *testing.T) {
	base := fakeDiscord(t, "1.0.0")
	core, err := Install(base, samplePayload())
	if err != nil {
		t.Fatal(err)
	}
	indexPath := filepath.Join(core, "index.js")
	before, err := os.Stat(indexPath)
	if err != nil {
		t.Fatal(err)
	}
	names := nativeGenerations(t, core)
	payloadBefore, err := os.Stat(filepath.Join(core, names[0]))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Install(base, samplePayload()); err != nil {
		t.Fatalf("second install failed: %v", err)
	}
	after, err := os.Stat(indexPath)
	if err != nil {
		t.Fatal(err)
	}
	payloadAfter, err := os.Stat(filepath.Join(core, names[0]))
	if err != nil {
		t.Fatal(err)
	}
	if !before.ModTime().Equal(after.ModTime()) || before.Size() != after.Size() {
		t.Fatal("identical reinstall rewrote index.js")
	}
	if !payloadBefore.ModTime().Equal(payloadAfter.ModTime()) {
		t.Fatal("identical reinstall rewrote the active generation")
	}
	if again := nativeGenerations(t, core); len(again) != 1 || again[0] != names[0] {
		t.Fatalf("generation changed: %v", again)
	}
}

func TestInstallCleanupWarningKeepsCommittedGeneration(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("directory mode 0 does not deny traversal or removal on Windows; TestInstallCleanupReadFailureKeepsCommittedGeneration covers this warning")
	}
	useActivity(t, true, false)
	base := fakeDiscord(t, "1.0.0")
	core, err := Install(base, samplePayload())
	if err != nil {
		t.Fatal(err)
	}
	names := nativeGenerations(t, core)
	if len(names) != 1 {
		t.Fatalf("generations: %v", names)
	}
	stale := filepath.Join(core, names[0])
	if err = os.WriteFile(filepath.Join(stale, "kept.txt"), []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(stale, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(stale, 0o755) })
	installed, err := Install(base, payloadWithExtra(t, "\nexports.extra=true\n"))
	var warning *CleanupWarning
	if !errors.As(err, &warning) || warning.DetailID != "common.detail.payloadKept" {
		t.Fatalf("expected payload cleanup warning, got %v", err)
	}
	if installed != core {
		t.Fatalf("installed path %s, want %s", installed, core)
	}
	index := readFile(t, filepath.Join(core, "index.js"))
	referenced := referencedPayload(index)
	if referenced == "" || referenced == names[0] {
		t.Fatalf("index references %q", referenced)
	}
	if _, statErr := os.Stat(stale); statErr != nil {
		t.Fatal("old generation was removed", statErr)
	}
	if !strings.Contains(readFile(t, filepath.Join(core, referenced, "main.js")), "exports.extra=true") {
		t.Fatal("committed payload is missing the new bytes")
	}
	if !strings.Contains(index, LoaderMarker) {
		t.Fatal("loader missing from committed index")
	}
}

func TestInstallBackupCleanupWarningKeepsInstall(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("directory mode 0555 does not deny removal on Windows; only the owner-write bit controls the read-only attribute")
	}
	useActivity(t, true, false)
	base := fakeDiscord(t, "1.0.0")
	core, err := Install(base, samplePayload())
	if err != nil {
		t.Fatal(err)
	}
	indexPath := filepath.Join(core, "index.js")
	before := readFile(t, indexPath)
	backup := filepath.Join(core, BackupName)
	write(t, backup, "recovery\n")
	if err = os.Chmod(core, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(core, 0o755) })
	installed, err := Install(base, samplePayload())
	var warning *CleanupWarning
	if !errors.As(err, &warning) || warning.DetailID != "common.detail.previousFileKept" {
		t.Fatalf("expected backup cleanup warning, got %v", err)
	}
	if installed != core {
		t.Fatalf("installed path %s, want %s", installed, core)
	}
	if got := readFile(t, indexPath); got != before {
		t.Fatalf("index changed: %s", got)
	}
	if got := readFile(t, backup); got != "recovery\n" {
		t.Fatalf("backup changed: %s", got)
	}
	if err = os.Chmod(core, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err = Install(base, samplePayload()); err != nil {
		t.Fatalf("writable reinstall failed: %v", err)
	}
	if _, statErr := os.Stat(backup); !os.IsNotExist(statErr) {
		t.Fatal("backup remained after a writable reinstall", statErr)
	}
}

func TestInstallCleanupReadFailureKeepsCommittedGeneration(t *testing.T) {
	useActivity(t, true, false)
	base := fakeDiscord(t, "1.0.0")
	core, err := Install(base, samplePayload())
	if err != nil {
		t.Fatal(err)
	}
	names := nativeGenerations(t, core)
	if len(names) != 1 {
		t.Fatalf("generations: %v", names)
	}
	indexReadForCleanup = func(string) ([]byte, error) {
		return nil, os.ErrPermission
	}
	t.Cleanup(func() { indexReadForCleanup = nil })
	installed, err := Install(base, payloadWithExtra(t, "\nexports.extra=true\n"))
	var warning *CleanupWarning
	if !errors.As(err, &warning) || warning.DetailID != "common.detail.payloadKept" || !errors.Is(warning.Err, os.ErrPermission) {
		t.Fatalf("expected payload cleanup warning, got %v", err)
	}
	if installed != core {
		t.Fatalf("installed path %s, want %s", installed, core)
	}
	index := readFile(t, filepath.Join(core, "index.js"))
	referenced := referencedPayload(index)
	if referenced == "" || referenced == names[0] {
		t.Fatalf("index references %q", referenced)
	}
	if _, statErr := os.Stat(filepath.Join(core, names[0])); statErr != nil {
		t.Fatal("old generation was removed", statErr)
	}
	if !strings.Contains(readFile(t, filepath.Join(core, referenced, "main.js")), "exports.extra=true") {
		t.Fatal("committed payload is missing the new bytes")
	}
	if !strings.Contains(index, LoaderMarker) {
		t.Fatal("loader missing from committed index")
	}
}

func TestInstallBeforeCommitFailureIsNotACleanupWarning(t *testing.T) {
	useActivity(t, true, false)
	base := fakeDiscord(t, "1.0.0")
	core, err := ResolveCoreDir(base)
	if err != nil {
		t.Fatal(err)
	}
	indexPath := filepath.Join(core, "index.js")
	installHook = func(step, _ string) error {
		if step == "beforeCommit" {
			return errors.New("before commit")
		}
		return nil
	}
	t.Cleanup(func() { installHook = nil })
	if _, err = Install(base, samplePayload()); err == nil {
		t.Fatal("expected pre-commit failure")
	}
	var warning *CleanupWarning
	if errors.As(err, &warning) {
		t.Fatalf("pre-commit failure must stay a hard failure, got %#v", warning)
	}
	if strings.Contains(readFile(t, indexPath), LoaderMarker) {
		t.Fatal("loader was committed")
	}
}

func TestInstallCoexistsWithOtherInjector(t *testing.T) {
	base := fakeDiscord(t, "1.0.0")
	core, _ := ResolveCoreDir(base)
	indexPath := filepath.Join(core, "index.js")
	t.Setenv("BABEL_CONFIG_DIR", filepath.Join(t.TempDir(), "store"))

	// Simulate BetterDiscord having patched index.js first.
	bdLine := "require('./betterdiscord-injector');"
	original := bdLine + "\nmodule.exports = require('./core.asar');\n"
	write(t, indexPath, original)

	if _, err := Install(base, samplePayload()); err != nil {
		t.Fatal(err)
	}
	got := readFile(t, indexPath)
	if !strings.Contains(got, LoaderMarker) {
		t.Fatal("Babel hook missing")
	}
	if !strings.Contains(got, bdLine) {
		t.Fatal("BetterDiscord injection must be preserved")
	}
	if strings.Index(got, BlockStart) > strings.Index(got, bdLine) {
		t.Fatal("Babel hook should be prepended before the other injector")
	}

	// Re-install stays idempotent and keeps the other injector exactly once.
	if _, err := Install(base, samplePayload()); err != nil {
		t.Fatal(err)
	}
	got = readFile(t, indexPath)
	if c := strings.Count(got, BlockStart); c != 1 {
		t.Fatalf("expected exactly one Babel block, got %d", c)
	}
	if c := strings.Count(got, bdLine); c != 1 {
		t.Fatalf("expected the other injector once, got %d", c)
	}

	// Uninstall strips only Babel, leaving BetterDiscord intact.
	if _, err := Uninstall(base); err != nil {
		t.Fatal(err)
	}
	got = readFile(t, indexPath)
	if got != original {
		t.Fatalf("uninstall changed original bytes: %q", got)
	}
}

func readFile(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestSelectedProfilesDoNotGuessOrEraseAnotherClient(t *testing.T) {
	useActivity(t, true, false)
	local, roaming := t.TempDir(), t.TempDir()
	t.Setenv("LOCALAPPDATA", local)
	t.Setenv("APPDATA", roaming)
	t.Setenv("BABEL_CONFIG_DIR", "")
	stable, ptb := filepath.Join(local, "Discord"), filepath.Join(local, "DiscordPTB")
	makeDiscordAt(t, stable, "0.0.999")
	makeDiscordAt(t, ptb, "0.0.999")
	stableStore, ptbStore := filepath.Join(roaming, "discord", PayloadDirName), filepath.Join(roaming, "discordptb", PayloadDirName)
	for _, store := range []string{stableStore, ptbStore} {
		os.MkdirAll(store, 0755)
		write(t, filepath.Join(store, "api-keys.json"), "saved")
	}
	target := ProfileForTarget(filepath.Join(ptb, "app-0.0.999"))
	if target.State != "Known" || target.Store != ptbStore {
		t.Fatalf("wrong selected profile: %+v", target)
	}
	alias := filepath.Join(local, "alias")
	if err := os.Symlink(ptb, alias); err == nil {
		if ProfileForTarget(alias).Store != ptbStore {
			t.Fatal("alias did not match by file identity")
		}
	}
	unknown := fakeDiscord(t, "0.0.999")
	if ProfileForTarget(unknown).State != "Unknown" {
		t.Fatal("unknown manual target guessed a profile")
	}
	if _, err := UninstallWithOptions(unknown, UninstallOptions{RemoveProfileData: true, ProfileDirectory: filepath.Dir(stableStore)}); err == nil {
		t.Fatal("unknown target erasure was allowed")
	}
	if _, err := UninstallWithOptions(ptb, UninstallOptions{RemoveProfileData: true, ProfileDirectory: target.Directory}); err != nil {
		t.Fatal(err)
	}
	if !fileExists(stableStore) || fileExists(ptbStore) {
		t.Fatal("erased the wrong profile")
	}
	if ProfileForTarget(ptb).State != "KnownAbsent" {
		t.Fatal("known absence not reported")
	}
}
func TestPayloadRejectsMissingImportsVersionCorruptionAndSymlinks(t *testing.T) {
	for _, name := range []string{"missing import", "version", "checksum", "symlink"} {
		t.Run(name, func(t *testing.T) {
			payload := samplePayload()
			switch name {
			case "checksum":
				payload["main.js"].Data = []byte("corrupt")
			case "symlink":
				payload["main.js"].Mode = os.ModeSymlink
			case "version":
				var manifest PayloadManifest
				json.Unmarshal(payload["manifest.json"].Data, &manifest)
				manifest.Version = "0.1.5"
				payload["manifest.json"].Data, _ = json.Marshal(manifest)
			case "missing import":
				payload["main.js"].Data = []byte(`require("./core/absent")`)
				var manifest PayloadManifest
				json.Unmarshal(payload["manifest.json"].Data, &manifest)
				for i, entry := range manifest.Files {
					if entry.Path == "main.js" {
						h := sha256.Sum256(payload["main.js"].Data)
						manifest.Files[i].Bytes = len(payload["main.js"].Data)
						manifest.Files[i].SHA256 = fmt.Sprintf("%x", h)
					}
				}
				payload["manifest.json"].Data, _ = json.Marshal(manifest)
			}
			if _, err := ValidatePayload(payload); err == nil {
				t.Fatal("invalid payload accepted")
			}
		})
	}
}

func TestUninstallDefersEraseAndKeepsPayloadWithoutKnownIdleTarget(t *testing.T) {
	for _, name := range []string{"unresolved", "running"} {
		t.Run(name, func(t *testing.T) {
			if name == "running" {
				useActivity(t, true, true)
			}
			base := fakeDiscord(t, "1.0.0")
			configStore := filepath.Join(t.TempDir(), PayloadDirName)
			t.Setenv("BABEL_CONFIG_DIR", configStore)
			if err := os.MkdirAll(configStore, 0o755); err != nil {
				t.Fatal(err)
			}
			core, err := Install(base, samplePayload())
			if err != nil {
				t.Fatal(err)
			}
			result, err := UninstallWithOptions(base, UninstallOptions{RemoveProfileData: true, ProfileDirectory: filepath.Dir(configStore)})
			if err != nil {
				t.Fatal(err)
			}
			if len(nativeGenerations(t, core)) != 1 || !fileExists(configStore) {
				t.Fatalf("retention failed: %+v", result.Steps)
			}
			want := "common.detail.identityUnresolved"
			if name == "running" {
				want = "common.detail.discordRunning"
			}
			found := false
			for _, step := range result.Steps {
				if step.DetailID == want {
					found = true
				}
			}
			if !found {
				t.Fatalf("missing %s in %+v", want, result.Steps)
			}
		})
	}
}

func TestInstallFailureKeepsThePreviousLoader(t *testing.T) {
	base := fakeDiscord(t, "1.0.0")
	core, err := ResolveCoreDir(base)
	if err != nil {
		t.Fatal(err)
	}
	indexPath := filepath.Join(core, "index.js")
	original, _ := os.ReadFile(indexPath)
	foreign := filepath.Join(core, ".discord-translator-mod-s-n-0123456789abcdef")
	if err = os.Mkdir(foreign, 0o755); err != nil {
		t.Fatal(err)
	}
	installHook = func(step, _ string) error {
		if step == "stage" {
			return errors.New("stage failed")
		}
		return nil
	}
	t.Cleanup(func() { installHook = nil })
	if _, err = Install(base, samplePayload()); err == nil {
		t.Fatal("expected stage failure")
	}
	if got, _ := os.ReadFile(indexPath); !bytes.Equal(got, original) {
		t.Fatal("index changed after stage failure")
	}
	if _, err = os.Stat(foreign); err != nil {
		t.Fatal("foreign stage was removed")
	}
	for _, entry := range mustRead(t, core) {
		if nativeGenerationRe.MatchString(entry.Name()) || (strings.HasPrefix(entry.Name(), ".discord-translator-mod-s-n-") && entry.Name() != filepath.Base(foreign)) {
			t.Fatalf("unexpected entry %s", entry.Name())
		}
	}

	installHook = func(step, path string) error {
		if step != "beforeCommit" {
			return nil
		}
		return os.WriteFile(path, append(original, []byte("/* mutated */\n")...), 0o644)
	}
	_, err = Install(base, samplePayload())
	var changed *MessageError
	if !errors.As(err, &changed) || changed.ID != "common.error.targetChanged" {
		t.Fatalf("expected targetChanged, got %v", err)
	}
	if text, _ := os.ReadFile(indexPath); bytes.Contains(text, []byte(BlockStart)) || !bytes.Contains(text, []byte("/* mutated */")) {
		t.Fatalf("index after aborted commit: %s", text)
	}
	if len(nativeGenerations(t, core)) != 1 {
		t.Fatal("published generation was removed after an uncertain commit")
	}
	os.WriteFile(indexPath, original, 0o644)

	installHook = func(step, _ string) error {
		if step == "commit" {
			return errors.New("commit failed")
		}
		return nil
	}
	if _, err = Install(base, samplePayload()); err == nil {
		t.Fatal("expected commit failure")
	}
	if got, _ := os.ReadFile(indexPath); !bytes.Equal(got, original) {
		t.Fatal("commit failure replaced index.js")
	}
	for _, entry := range mustRead(t, core) {
		if nativeTempRe.MatchString(entry.Name()) {
			t.Fatalf("index temp left behind: %s", entry.Name())
		}
	}
	if len(nativeGenerations(t, core)) < 1 {
		t.Fatal("published candidate removed after commit failure")
	}
}

func TestNativeCleanupIsOwnershipScoped(t *testing.T) {
	for _, running := range []bool{false, true} {
		t.Run(fmt.Sprintf("running=%v", running), func(t *testing.T) {
			useActivity(t, true, running)
			base := fakeDiscord(t, "1.0.0")
			core, err := ResolveCoreDir(base)
			if err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{
				"discord-translator-mod-g-n-1-fedcba9876543210",
				"discord-translator-mod-g-d-1-0123456789abcdef",
				PayloadDirName,
				"unrelated-mod",
			} {
				if err = os.Mkdir(filepath.Join(core, name), 0o755); err != nil {
					t.Fatal(err)
				}
			}
			if _, err = Install(base, samplePayload()); err != nil {
				t.Fatal(err)
			}
			entries := map[string]bool{}
			for _, entry := range mustRead(t, core) {
				entries[entry.Name()] = true
			}
			if !entries["discord-translator-mod-g-d-1-0123456789abcdef"] || !entries["unrelated-mod"] {
				t.Fatal("cleanup removed an entry it does not own")
			}
			if running {
				if !entries["discord-translator-mod-g-n-1-fedcba9876543210"] || !entries[PayloadDirName] {
					t.Fatal("running target removed native payload")
				}
			} else if entries["discord-translator-mod-g-n-1-fedcba9876543210"] || entries[PayloadDirName] {
				t.Fatal("idle cleanup left an unreferenced native entry")
			}
			referenced := 0
			for name := range entries {
				if nativeGenerationRe.MatchString(name) && name != "discord-translator-mod-g-n-1-fedcba9876543210" {
					referenced++
				}
			}
			if referenced != 1 {
				t.Fatalf("expected the new generation to remain, entries=%v", entries)
			}
		})
	}
}

func TestManualReinstallTargetsTheNewCore(t *testing.T) {
	base := fakeDiscord(t, "1.0.0")
	older, err := Install(base, samplePayload())
	if err != nil {
		t.Fatal(err)
	}
	previous, _ := os.ReadFile(filepath.Join(older, "index.js"))
	makeDiscordAt(t, base, "1.0.1")
	newer, err := Install(base, samplePayload())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(newer, "app-1.0.1") {
		t.Fatalf("newest core not selected: %s", newer)
	}
	if got, _ := os.ReadFile(filepath.Join(older, "index.js")); !bytes.Equal(got, previous) {
		t.Fatal("older core hook changed")
	}
	if !strings.Contains(readFile(t, filepath.Join(newer, "index.js")), LoaderMarker) {
		t.Fatal("new core was not patched")
	}
}

func TestInstallRefusesIncompleteCore(t *testing.T) {
	base := fakeDiscord(t, "1.0.0")
	core, _ := ResolveCoreDir(base)
	os.Remove(filepath.Join(core, "index.js"))
	_, err := Install(base, samplePayload())
	var message *MessageError
	if !errors.As(err, &message) || message.ID != "common.error.coreIncomplete" {
		t.Fatalf("expected coreIncomplete, got %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(core, "index.js")); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatal("incomplete core gained an index.js")
	}
}

func TestLockHolder(t *testing.T) {
	base := os.Getenv("BABEL_LOCK_HOLD")
	if base == "" {
		t.Skip()
	}
	release, err := acquireInstallLock(base)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if err = os.WriteFile(os.Getenv("BABEL_LOCK_READY"), []byte("ready"), 0o644); err != nil {
		t.Fatal(err)
	}
	select {}
}

func TestLockReleasedWhenHolderExits(t *testing.T) {
	base := fakeDiscord(t, "1.0.0")
	ready := filepath.Join(t.TempDir(), "ready")
	cmd := exec.Command(os.Args[0], "-test.run", "^TestLockHolder$")
	cmd.Env = append(os.Environ(), "BABEL_LOCK_HOLD="+base, "BABEL_LOCK_READY="+ready)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	stopped := false
	defer func() {
		if !stopped && cmd.Process != nil {
			cmd.Process.Kill()
			cmd.Wait()
		}
	}()
	deadline := time.Now().Add(5 * time.Second)
	for !fileExists(ready) {
		if time.Now().After(deadline) {
			t.Fatal("lock holder did not become ready")
		}
		time.Sleep(20 * time.Millisecond)
	}
	_, err := Install(base, samplePayload())
	var message *MessageError
	if !errors.As(err, &message) || message.ID != "common.error.targetLocked" {
		t.Fatalf("expected target lock, got %v", err)
	}
	if err = cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	cmd.Wait()
	stopped = true
	deadline = time.Now().Add(5 * time.Second)
	var last error
	for {
		_, last = Install(base, samplePayload())
		if last == nil || time.Now().After(deadline) {
			break
		}
		time.Sleep(30 * time.Millisecond)
	}
	if last != nil {
		t.Fatal(last)
	}
	if !fileExists(filepath.Join(base, ".discord-translator-mod.lock")) {
		t.Fatal("lock file was removed")
	}
}

func materializePayload(t *testing.T, dir string, payload fstest.MapFS) {
	t.Helper()
	for name, file := range payload {
		if file == nil {
			continue
		}
		target := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, file.Data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestInstallRejectsBlankOrIncompleteCoreWithoutMutation(t *testing.T) {
	base := fakeDiscord(t, "1.0.0")
	core, err := ResolveCoreDir(base)
	if err != nil {
		t.Fatal(err)
	}
	index := filepath.Join(core, "index.js")
	for _, content := range []string{"", " \n\t", "\r\n"} {
		if err = os.WriteFile(index, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		_, err = Install(base, samplePayload())
		var message *MessageError
		if !errors.As(err, &message) || message.ID != "common.error.coreIncomplete" {
			t.Fatalf("content %q: got %v", content, err)
		}
		got, readErr := os.ReadFile(index)
		if readErr != nil || !bytes.Equal(got, []byte(content)) {
			t.Fatalf("blank index mutated to %q (%v)", got, readErr)
		}
		if len(nativeGenerations(t, core)) != 0 {
			t.Fatal("blank index published a generation")
		}
	}
	if err = os.WriteFile(index, []byte(VanillaIndex), 0o644); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(core, "core.asar"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	_, err = Install(base, samplePayload())
	var message *MessageError
	if !errors.As(err, &message) || message.ID != "common.error.coreIncomplete" {
		t.Fatalf("empty core.asar: got %v", err)
	}
	if got, _ := os.ReadFile(index); !bytes.Equal(got, []byte(VanillaIndex)) {
		t.Fatalf("empty core.asar rewrote index.js: %q", got)
	}
}

func TestInstallPreservesNonBabelBytesExactly(t *testing.T) {
	base := fakeDiscord(t, "1.0.0")
	core, _ := ResolveCoreDir(base)
	index := filepath.Join(core, "index.js")
	original := []byte("\n  // Synthetic other injector\r\nrequire(\"./other.js\");  \r\nmodule.exports = require('./core.asar');\r\n\n")
	if err := os.WriteFile(index, original, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Install(base, samplePayload()); err != nil {
		t.Fatal(err)
	}
	if _, err := Uninstall(base); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(index)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, original) {
		t.Fatalf("original bytes changed: %q", got)
	}
}

func TestUninstallAbortsWhenIndexChangesBeforeCommit(t *testing.T) {
	useActivity(t, true, false)
	base := fakeDiscord(t, "1.0.0")
	core, err := Install(base, samplePayload())
	if err != nil {
		t.Fatal(err)
	}
	index := filepath.Join(core, "index.js")
	before, err := os.ReadFile(index)
	if err != nil {
		t.Fatal(err)
	}
	addition := []byte("\n// Synthetic external modification before final read\n")
	afterIndexSync = func(path string) error {
		if path != index {
			return nil
		}
		file, openErr := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
		if openErr != nil {
			return openErr
		}
		_, openErr = file.Write(addition)
		file.Close()
		return openErr
	}
	t.Cleanup(func() { afterIndexSync = nil })
	_, err = Uninstall(base)
	var message *MessageError
	if !errors.As(err, &message) || message.ID != "common.error.targetChanged" {
		t.Fatalf("expected targetChanged, got %v", err)
	}
	got, readErr := os.ReadFile(index)
	if readErr != nil || !bytes.Equal(got, append(append([]byte{}, before...), addition...)) {
		t.Fatalf("foreign append lost: %q (%v)", got, readErr)
	}
	if len(nativeGenerations(t, core)) != 1 {
		t.Fatal("uninstall deleted the generation after a pre-commit change")
	}
}

func TestUninstallRetainsEntriesWhenIndexCannotBeReread(t *testing.T) {
	useActivity(t, true, false)
	base := fakeDiscord(t, "1.0.0")
	core, err := Install(base, samplePayload())
	if err != nil {
		t.Fatal(err)
	}
	indexReadForCleanup = func(string) ([]byte, error) {
		return nil, os.ErrPermission
	}
	t.Cleanup(func() { indexReadForCleanup = nil })
	_, err = Uninstall(base)
	if err == nil {
		t.Fatal("unreadable index was treated as evidence")
	}
	if len(nativeGenerations(t, core)) != 1 {
		t.Fatal("generation deleted after the index could not be read")
	}
}

func TestIdenticalLegacyPayloadMigratesBeforeRemovingBackup(t *testing.T) {
	useActivity(t, true, false)
	base := fakeDiscord(t, "1.0.0")
	core, err := ResolveCoreDir(base)
	if err != nil {
		t.Fatal(err)
	}
	payload := samplePayload()
	legacyDir := filepath.Join(core, PayloadDirName)
	materializePayload(t, legacyDir, payload)
	index := filepath.Join(core, "index.js")
	backup := filepath.Join(core, BackupName)
	legacy := "// " + LoaderMarker + "\nrequire(\"./discord-translator-mod/main.js\").install();\n" + VanillaIndex
	original := "\nrequire(\"./synthetic-other-injector.js\");\n" + VanillaIndex + "\n"
	if err = os.WriteFile(index, []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(backup, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}
	installHook = func(step, path string) error {
		if step != "beforeCommit" {
			return nil
		}
		current, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		return os.WriteFile(path, append(current, []byte("\n// changed\n")...), 0o644)
	}
	t.Cleanup(func() { installHook = nil })
	_, err = Install(base, payload)
	var message *MessageError
	if !errors.As(err, &message) || message.ID != "common.error.targetChanged" {
		t.Fatalf("expected targetChanged, got %v", err)
	}
	if _, statErr := os.Stat(backup); statErr != nil {
		t.Fatal("backup removed before migration commit")
	}
	if bytes.Contains(mustBytes(t, index), []byte(BlockStart)) {
		t.Fatal("aborted migration installed the hook")
	}
	installHook = nil
	if err = os.WriteFile(index, []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err = Install(base, payload); err != nil {
		t.Fatal(err)
	}
	got := mustBytes(t, index)
	if !bytes.Contains(got, []byte(BlockStart)) || !bytes.HasSuffix(got, []byte(original)) {
		t.Fatalf("legacy migration did not preserve the backup bytes: %q", got)
	}
	if _, statErr := os.Stat(backup); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatal("backup remained after a successful migration commit")
	}
	if !fileExists(legacyDir) {
		t.Fatal("matching legacy payload was replaced instead of migrated")
	}
	if len(nativeGenerations(t, core)) != 0 {
		t.Fatal("identical payload published another generation")
	}
}

func TestSyncTreeSourceDoesNotFlushReadOnlyFiles(t *testing.T) {
	// Source invariant for the Windows installer. File.Sync is FlushFileBuffers,
	// which requires GENERIC_WRITE. This test does not execute the installer on Windows.
	source, err := os.ReadFile("publish.go")
	if err != nil {
		t.Fatal(err)
	}
	body := functionBody(t, string(source), "syncTree")
	if strings.Contains(body, "os.Open") || strings.Contains(body, ".Sync(") {
		t.Fatal("syncTree reopened payload files; writeSynced already flushed them with write access")
	}
	writeBody := functionBody(t, string(source), "writeSynced")
	if !strings.Contains(writeBody, ".Sync()") {
		t.Fatal("writeSynced no longer flushes payload files")
	}
	dir := t.TempDir()
	if err = os.WriteFile(filepath.Join(dir, "main.js"), []byte("x"), 0o444); err != nil {
		t.Fatal(err)
	}
	if err = syncTree(dir); err != nil {
		t.Fatal(err)
	}
}

func TestInstallationPathIdentityFollowsTheCanonicalBase(t *testing.T) {
	// Path identity only. This does not execute the Windows installer or enumerate processes.
	base := fakeDiscord(t, "1.0.1")
	aliasParent := t.TempDir()
	alias := filepath.Join(aliasParent, "Discord")
	if err := os.Symlink(base, alias); err != nil {
		t.Fatal(err)
	}
	image := filepath.Join(base, "app-1.0.1", "Discord.exe")
	write(t, image, "exe")
	if !pathUnderBase(alias, image) {
		t.Fatal("alias base was not identified with the canonical executable")
	}
	other := fakeDiscord(t, "1.0.1")
	if pathUnderBase(other, image) {
		t.Fatal("unrelated installation matched the executable")
	}
	root := `C:\Users\mai\AppData\Local\Discord`
	canonicalImage := `C:\Users\mai\AppData\Local\Discord\app-1.0.1\Discord.exe`
	if !hasInstallPrefix(root, canonicalImage) {
		t.Fatal("canonical Windows image was outside its installation")
	}
	if hasInstallPrefix(root, `C:\Users\mai\AppData\Local\DiscordPTB\DiscordPTB.exe`) {
		t.Fatal("sibling channel matched")
	}
	if hasInstallPrefix(`D:\junction\Discord`, canonicalImage) {
		t.Fatal("textual junction prefix matched a canonical image without resolution")
	}
}

func functionBody(t *testing.T, source, name string) string {
	t.Helper()
	marker := "func " + name + "("
	start := strings.Index(source, marker)
	if start < 0 {
		t.Fatalf("missing %s", name)
	}
	rest := source[start:]
	next := strings.Index(rest[len(marker):], "\nfunc ")
	if next < 0 {
		return rest
	}
	return rest[:len(marker)+next]
}

func mustBytes(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func mustRead(t *testing.T, dir string) []os.DirEntry {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	return entries
}
