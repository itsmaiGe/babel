// Package core implements the Discord desktop-core patch/unpatch logic for the
// Babel installer. It is a faithful port of scripts/desktop-core-action.js and
// is deliberately GUI-free so it can be unit-tested without a display.
package core

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	posixpath "path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var (
	ErrDiscordNotFound = Message("common.error.targetMissing", nil, nil)
	ErrDiscordCore     = Message("common.error.coreMissing", nil, nil)
)

// MessageError is an app-authored diagnostic with a stable UI message identity.
// Its cause remains available to errors.Is; the UI shows only actual OS causes.
type MessageError struct {
	ID     string
	Params map[string]any
	Cause  error
}

func (e *MessageError) Error() string { return e.ID }
func (e *MessageError) Unwrap() error { return e.Cause }
func Message(id string, params map[string]any, cause error) error {
	return &MessageError{id, params, cause}
}

// CleanupWarning means a validated generation is already committed and only
// old-generation or legacy-backup cleanup failed.
type CleanupWarning struct {
	DetailID string
	Err      error
}

func (e *CleanupWarning) Error() string {
	if e == nil {
		return ""
	}
	if e.Err != nil {
		return e.Err.Error()
	}
	return e.DetailID
}
func (e *CleanupWarning) Unwrap() error { return e.Err }

const (
	// LoaderMarker must match the JS installer so install/uninstall interoperate.
	LoaderMarker   = "DiscordTranslatorMod desktop-core loader"
	BlockStart     = "/* " + LoaderMarker + ":start */"
	BlockEnd       = "/* " + LoaderMarker + ":end */"
	PayloadDirName = "discord-translator-mod"
	BackupName     = "index.js.dtm-original"
	VanillaIndex   = "module.exports = require('./core.asar');\n"
)

var (
	appDirRe     = regexp.MustCompile(`^(?:app-)?(\d+)\.(\d+)\.(\d+)$`)
	coreWrapRe   = regexp.MustCompile(`^discord_desktop_core-(\d+)$`)
	babelBlockRe = regexp.MustCompile("(?s)" + regexp.QuoteMeta(BlockStart) + ".*?" + regexp.QuoteMeta(BlockEnd) + "\\n?")
)

// DiscordBaseDir returns the first detected Discord installation base directory.
func DiscordBaseDir() string {
	if dirs := FindDiscordBaseDirs(); len(dirs) > 0 {
		return dirs[0]
	}
	if v := os.Getenv("LOCALAPPDATA"); v != "" {
		return filepath.Join(v, "Discord")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "AppData", "Local", "Discord")
}

// FindDiscordBaseDirs mirrors Vencord's Windows discovery: LOCALAPPDATA is the
// source of truth and may itself live on a non-C drive.
func FindDiscordBaseDirs() []string {
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		return nil
	}
	names := []string{"Discord", "DiscordPTB", "DiscordCanary", "DiscordDevelopment"}
	dirs := make([]string, 0, len(names))
	for _, name := range names {
		candidate := filepath.Join(local, name)
		cores, err := ResolveAllCoreDirs(candidate)
		if err == nil && len(cores) > 0 {
			dirs = append(dirs, candidate)
		}
	}
	return dirs
}

// NormalizeDiscordBaseDir accepts the Discord base folder, an app-* folder, or
// Discord.exe. Walking ancestors keeps manual selection forgiving without parsing
// Windows shortcuts or adding another dependency.
func NormalizeDiscordBaseDir(input string) (string, error) {
	cleaned := strings.Trim(strings.TrimSpace(input), "\"")
	if cleaned == "" {
		return "", ErrDiscordNotFound
	}
	current := filepath.Clean(cleaned)
	info, err := os.Stat(current)
	if err != nil {
		if errors.Is(err, os.ErrPermission) {
			return "", Message("common.error.pathRead", map[string]any{"path": current}, err)
		}
		return "", Message("common.error.targetMissing", nil, ErrDiscordNotFound)
	}
	if !info.IsDir() {
		current = filepath.Dir(current)
	}

	for attempts := 0; attempts < 8; attempts++ {
		cores, readErr := ResolveAllCoreDirs(current)
		if readErr == nil && len(cores) > 0 {
			return current, nil
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return "", Message("common.error.coreMissing", nil, ErrDiscordCore)
}

// ConfigStoreDir returns the plugin's config directory (settings.json, api-keys.json,
// cache.json). It lives under Electron's userData dir (Roaming on Windows), which is
// NOT the same as the Discord modules dir (Local) used for patching.
func ConfigStoreDir() string {
	if v := os.Getenv("BABEL_CONFIG_DIR"); v != "" {
		return v
	}
	if v := os.Getenv("APPDATA"); v != "" {
		return filepath.Join(v, "discord", PayloadDirName)
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "AppData", "Roaming", "discord", PayloadDirName)
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// ResolveAllCoreDirs returns every discord_desktop_core directory found, newest
// Discord version first, highest core wrapper first.
func ResolveAllCoreDirs(baseDir string) ([]string, error) {
	entries, err := os.ReadDir(baseDir)
	if err != nil {
		if errors.Is(err, os.ErrPermission) {
			return nil, Message("common.error.pathRead", map[string]any{"path": baseDir}, err)
		}
		return nil, Message("common.error.targetMissing", nil, ErrDiscordNotFound)
	}

	type versioned struct {
		dir string
		v   [3]int
		app bool
	}
	var versions []versioned
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		m := appDirRe.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		a, _ := strconv.Atoi(m[1])
		b, _ := strconv.Atoi(m[2])
		c, _ := strconv.Atoi(m[3])
		versions = append(versions, versioned{filepath.Join(baseDir, e.Name()), [3]int{a, b, c}, strings.HasPrefix(e.Name(), "app-")})
	}
	sort.Slice(versions, func(i, j int) bool {
		if versions[i].app != versions[j].app {
			return versions[i].app
		}
		for k := 0; k < 3; k++ {
			if versions[i].v[k] != versions[j].v[k] {
				return versions[i].v[k] > versions[j].v[k]
			}
		}
		return false
	})

	var cores []string
	for _, ver := range versions {
		modules := filepath.Join(ver.dir, "modules")
		wrapEntries, err := os.ReadDir(modules)
		if err != nil {
			continue
		}
		type wrapper struct {
			dir string
			n   int
		}
		var wrappers []wrapper
		for _, w := range wrapEntries {
			if !w.IsDir() {
				continue
			}
			m := coreWrapRe.FindStringSubmatch(w.Name())
			if m == nil {
				continue
			}
			n, _ := strconv.Atoi(m[1])
			wrappers = append(wrappers, wrapper{filepath.Join(modules, w.Name()), n})
		}
		sort.Slice(wrappers, func(i, j int) bool { return wrappers[i].n > wrappers[j].n })
		before := len(cores)
		for _, w := range wrappers {
			cd := filepath.Join(w.dir, "discord_desktop_core")
			if fileExists(filepath.Join(cd, "core.asar")) && fileExists(filepath.Join(cd, "package.json")) {
				cores = append(cores, cd)
				break
			}
		}
		if len(cores) == before {
			legacy := filepath.Join(modules, "discord_desktop_core")
			if fileExists(filepath.Join(legacy, "core.asar")) && fileExists(filepath.Join(legacy, "package.json")) {
				cores = append(cores, legacy)
			}
		}
	}
	return cores, nil
}

// ResolveCoreDir returns the newest core directory.
func ResolveCoreDir(baseDir string) (string, error) {
	dirs, err := ResolveAllCoreDirs(baseDir)
	if err != nil {
		return "", err
	}
	if len(dirs) == 0 {
		return "", Message("common.error.coreMissing", nil, ErrDiscordCore)
	}
	return dirs[0], nil
}

// baseIndex returns the index with only Babel's delimited block removed.
// Every other original byte is kept, including blank lines, CRLF, and trailing
// spaces. The vanilla text is used only for a recognized legacy whole-file loader
// whose original backup is unavailable; blank current content is not that case.
func baseIndex(content string) string {
	if strings.Contains(content, BlockStart) {
		return babelBlockRe.ReplaceAllString(content, "")
	}
	if strings.Contains(content, LoaderMarker) {
		return VanillaIndex
	}
	return content
}

// loaderBlock is our hook, wrapped in try/catch (a payload failure can never break
// Discord) and fenced by start/end markers so it can be stripped back out on uninstall.
func loaderBlock(name string) string {
	return BlockStart + "\n" +
		"try {\n" +
		"  require(\"./" + name + "/main.js\").install();\n" +
		"} catch (error) {\n" +
		"  console.error(\"[Babel] Failed to install hook:\", error);\n" +
		"}\n" +
		BlockEnd + "\n"
}

type PayloadEntry struct {
	Path   string `json:"path"`
	Bytes  int    `json:"bytes"`
	SHA256 string `json:"sha256"`
}
type PayloadManifest struct {
	Version string         `json:"version"`
	Files   []PayloadEntry `json:"files"`
}

func ValidatePayload(payload fs.FS) (PayloadManifest, error) {
	var manifest PayloadManifest
	data, err := fs.ReadFile(payload, "manifest.json")
	if err != nil {
		return manifest, err
	}
	if len(data) > 256*1024 {
		return manifest, Message("common.error.manifest", nil, nil)
	}
	if err = json.Unmarshal(data, &manifest); err != nil {
		return manifest, Message("common.error.manifest", nil, err)
	}
	if manifest.Version == "" || len(manifest.Files) == 0 {
		return manifest, Message("common.error.manifest", nil, nil)
	}
	names := map[string]bool{}
	for _, entry := range manifest.Files {
		if !fs.ValidPath(entry.Path) || strings.ContainsAny(entry.Path, "\\:") || names[entry.Path] {
			return manifest, Message("common.error.payloadUnsafe", nil, nil)
		}
		names[entry.Path] = true
		directory := "."
		for _, part := range strings.Split(entry.Path, "/") {
			entries, readErr := fs.ReadDir(payload, directory)
			if readErr != nil {
				return manifest, readErr
			}
			for _, item := range entries {
				if item.Name() == part && item.Type()&fs.ModeSymlink != 0 {
					return manifest, Message("common.error.payloadUnsafe", nil, nil)
				}
			}
			directory = posixpath.Join(directory, part)
		}
		info, statErr := fs.Stat(payload, entry.Path)
		if statErr != nil || !info.Mode().IsRegular() || info.Size() > 4*1024*1024 {
			return manifest, Message("common.error.payloadIntegrity", nil, nil)
		}
		data, err = fs.ReadFile(payload, entry.Path)
		if err != nil {
			return manifest, err
		}
		hash := sha256.Sum256(data)
		if len(data) != entry.Bytes || hex.EncodeToString(hash[:]) != entry.SHA256 {
			return manifest, Message("common.error.payloadIntegrity", nil, nil)
		}
	}
	for _, name := range []string{"main.js", "preload.js", "renderer.js", "shared/settings.js", "shared/defaults.js"} {
		if !names[name] {
			return manifest, Message("common.error.payloadIncomplete", nil, nil)
		}
	}
	for _, entry := range manifest.Files {
		content, _ := fs.ReadFile(payload, entry.Path)
		if strings.Contains(string(content), "@dtm-test-only") {
			return manifest, Message("common.error.payloadIncomplete", nil, nil)
		}
		for _, match := range regexp.MustCompile(`require\(["'](\.[^"']+)["']\)`).FindAllStringSubmatch(string(content), -1) {
			imported := posixpath.Clean(posixpath.Join(posixpath.Dir(entry.Path), match[1]))
			if !strings.HasSuffix(imported, ".js") {
				imported += ".js"
			}
			if strings.HasPrefix(imported, "../shared/") {
				imported = strings.TrimPrefix(imported, "../")
			}
			if !names[imported] {
				return manifest, Message("common.error.payloadIncomplete", nil, nil)
			}
		}
	}
	defaults, _ := fs.ReadFile(payload, "shared/defaults.js")
	match := regexp.MustCompile(`const BABEL_VERSION\s*=\s*["']([^"']+)["']`).FindStringSubmatch(string(defaults))
	if len(match) != 2 || match[1] != manifest.Version {
		return manifest, Message("common.error.version", nil, nil)
	}
	return manifest, nil
}

// Install publishes an immutable payload generation and atomically replaces index.js.
// A missing or in-progress Discord core is refused. The native lock is held for the
// whole mutation, including cleanup of older native generations.
func Install(baseDir string, payload fs.FS) (string, error) {
	return InstallWithHooks(baseDir, payload, InstallHooks{})
}

// InstallTarget is the verified identity of one selected installation:
// the base folder, the selected core, the client executable and the original
// index.js bytes. The three objects are frozen as identity evidence at
// preflight — read through a short-lived open handle so their file IDs are
// captured eagerly — and compared again before any publication or commit.
// No handle is kept afterwards.
type InstallTarget struct {
	Base  string
	Core  string
	Exe   string
	Index []byte

	baseInfo, coreInfo, exeInfo os.FileInfo
}

// frozenFileInfo opens the object briefly and stats the open handle, which
// captures the file identity eagerly. os.Stat alone is not enough on Windows:
// its result keeps the path and only reads the file IDs when os.SameFile is
// called, which would describe whatever the path points at then.
func frozenFileInfo(path string) (os.FileInfo, error) {
	handle, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer handle.Close()
	return handle.Stat()
}

// InstallHooks carry the Windows stop-before-install steps around the shared
// install. A nil hook keeps the plain install used by other callers exactly as
// before. The hooks report and stop only: they never publish, clean up or
// mutate the target themselves, and the install lock is held around them.
type InstallHooks struct {
	// Stop runs after preflight and before anything is published or changed.
	// A failure aborts the install without touching Discord's files.
	Stop func(target InstallTarget) error
	// PreCommit runs one bounded read-only check immediately before the
	// commit. A failure keeps the existing unreferenced-generation policy.
	PreCommit func(target InstallTarget) error
}

// InstallWithHooks runs the shared install with the Windows stop-before-install
// transaction: preflight and identity capture first, then the stop, then a full
// re-check of the target identity — including the already-installed early
// return — then publication and commit behind the unchanged byte checks and
// one bounded final check. A target that changed while Discord was being
// stopped aborts instead of silently retargeting.
func InstallWithHooks(baseDir string, payload fs.FS, hooks InstallHooks) (string, error) {
	baseDir, err := NormalizeDiscordBaseDir(baseDir)
	if err != nil {
		return "", err
	}
	release, err := acquireInstallLock(baseDir)
	if err != nil {
		return "", err
	}
	defer release()
	core, err := ResolveCoreDir(baseDir)
	if err != nil {
		return "", err
	}
	if err = assertCoreReady(core); err != nil {
		return "", err
	}
	indexPath := filepath.Join(core, "index.js")
	snapshot, err := os.ReadFile(indexPath)
	if err != nil {
		return "", err
	}
	base, err := preservedBase(core, string(snapshot))
	if err != nil {
		return "", err
	}
	if !strings.Contains(base, "core.asar") {
		return "", Message("common.error.unrecognized", map[string]any{"path": indexPath}, nil)
	}
	manifest, err := ValidatePayload(payload)
	if err != nil {
		return "", err
	}
	target := InstallTarget{Base: baseDir, Core: core, Index: snapshot}
	if hooks.Stop != nil || hooks.PreCommit != nil {
		exe, ok := RestartExecutable(baseDir)
		if !ok {
			return "", Message("common.error.targetMissing", nil, ErrDiscordNotFound)
		}
		target.Exe = exe
		// Freeze the identity evidence eagerly before Discord is touched.
		if target.baseInfo, err = frozenFileInfo(baseDir); err != nil {
			return "", err
		}
		if target.coreInfo, err = frozenFileInfo(core); err != nil {
			return "", err
		}
		if target.exeInfo, err = frozenFileInfo(exe); err != nil {
			return "", err
		}
	}
	if hooks.Stop != nil {
		if err = hooks.Stop(target); err != nil {
			return "", err
		}
		// Discord may have updated itself while it was being stopped: the full
		// identity is re-resolved and compared before anything is published or
		// finished, including the already-installed early return below.
		if err = recheckTarget(target); err != nil {
			return "", err
		}
	}
	existing, matched := matchingGeneration(core, string(snapshot), manifest)
	legacyWholeFile := strings.Contains(string(snapshot), LoaderMarker) && !strings.Contains(string(snapshot), BlockStart)
	if matched && !legacyWholeFile {
		return core, finishInstalled(baseDir, core)
	}
	name := existing
	if !matched {
		name, err = publishGeneration(payload, core, manifest)
		if err != nil {
			return "", err
		}
	}
	again, err := os.ReadFile(indexPath)
	if err != nil {
		return "", err
	}
	if !bytes.Equal(again, snapshot) {
		return "", Message("common.error.targetChanged", nil, nil)
	}
	if err = runHook("beforeCommit", indexPath); err != nil {
		return "", err
	}
	hooked, err := os.ReadFile(indexPath)
	if err != nil {
		return "", err
	}
	if !bytes.Equal(hooked, snapshot) {
		return "", Message("common.error.targetChanged", nil, nil)
	}
	// The final check immediately before the commit: target identity plus one
	// bounded classifier scan. Nothing is ever killed again here, and a running
	// client is reported as reopened with its own category.
	if hooks.PreCommit != nil {
		if err = recheckTarget(target); err != nil {
			return "", err
		}
		if err = hooks.PreCommit(target); err != nil {
			return "", err
		}
	}
	if err = commitIndex(indexPath, []byte(loaderBlock(name)+base), snapshot); err != nil {
		return "", err
	}
	return core, finishInstalled(baseDir, core)
}

// recheckTarget re-resolves the selected installation and compares the objects
// behind it with the identity evidence frozen before Discord was touched.
// Comparing paths as they resolve now is not enough: an alias or junction can
// be retargeted, or a same-path object replaced, while every version string
// and index byte stays identical. Missing, replaced or retargeted objects
// abort the install instead of silently switching targets, and a stable alias
// of the same objects keeps working.
func recheckTarget(target InstallTarget) error {
	changed := Message("common.error.targetChanged", nil, nil)
	if target.baseInfo == nil || target.coreInfo == nil || target.exeInfo == nil {
		return changed
	}
	current, err := NormalizeDiscordBaseDir(target.Base)
	if err != nil {
		return changed
	}
	selected, err := ResolveCoreDir(target.Base)
	if err != nil {
		return changed
	}
	exe, ok := RestartExecutable(target.Base)
	if !ok {
		return changed
	}
	for _, check := range []struct {
		frozen os.FileInfo
		path   string
	}{
		{target.baseInfo, current},
		{target.coreInfo, selected},
		{target.exeInfo, exe},
	} {
		fresh, err := frozenFileInfo(check.path)
		if err != nil || !os.SameFile(check.frozen, fresh) {
			return changed
		}
	}
	snapshot, err := os.ReadFile(filepath.Join(target.Core, "index.js"))
	if err != nil || !bytes.Equal(snapshot, target.Index) {
		return changed
	}
	return nil
}

func finishInstalled(base, core string) error {
	if err := removeBackupFile(core); err != nil {
		return &CleanupWarning{DetailID: "common.detail.previousFileKept", Err: err}
	}
	if err := cleanupIfIdle(base, core); err != nil {
		return &CleanupWarning{DetailID: "common.detail.payloadKept", Err: err}
	}
	return nil
}

func cleanupIfIdle(base, core string) error {
	known, running := installationActivity(base)
	if !known || running {
		return nil
	}
	return cleanupNative(core)
}

type ProfileTarget struct {
	State     string
	Directory string
	Store     string
}
type UninstallOptions struct {
	RemoveProfileData bool
	ProfileDirectory  string
}
type StepResult struct {
	Path        string
	Action      string
	State       string
	Detail      string
	DetailID    string
	SystemError error
}
type Result struct {
	Steps   []StepResult
	Profile ProfileTarget
}

func ProfileForTarget(base string) ProfileTarget {
	unknown := ProfileTarget{State: "Unknown"}
	if override := os.Getenv("BABEL_CONFIG_DIR"); override != "" {
		if filepath.Base(override) != PayloadDirName {
			return unknown
		}
		return profileState(filepath.Dir(override))
	}
	normalized, err := NormalizeDiscordBaseDir(base)
	if err != nil {
		return unknown
	}
	selected, err := os.Stat(normalized)
	if err != nil {
		return unknown
	}
	local, roaming := os.Getenv("LOCALAPPDATA"), os.Getenv("APPDATA")
	if local == "" || roaming == "" {
		return unknown
	}
	for _, name := range []string{"Discord", "DiscordPTB", "DiscordCanary", "DiscordDevelopment"} {
		candidate := filepath.Join(local, name)
		info, e := os.Stat(candidate)
		if e == nil && os.SameFile(selected, info) {
			return profileState(filepath.Join(roaming, strings.ToLower(name)))
		}
	}
	return unknown
}
func profileState(directory string) ProfileTarget {
	store := filepath.Join(directory, PayloadDirName)
	target := ProfileTarget{State: "Known", Directory: directory, Store: store}
	info, err := os.Lstat(store)
	if errors.Is(err, os.ErrNotExist) {
		target.State = "KnownAbsent"
	} else if err != nil || !info.IsDir() || isReparse(store) {
		target.State = "Unknown"
	}
	return target
}
func validateErase(base, directory string) (ProfileTarget, error) {
	target := ProfileForTarget(base)
	if target.State == "Unknown" || directory == "" {
		return target, Message("common.error.profileUnknown", nil, nil)
	}
	expected, e := filepath.EvalSymlinks(target.Directory)
	if e != nil {
		expected = filepath.Clean(target.Directory)
	}
	supplied, e := filepath.EvalSymlinks(directory)
	if e != nil {
		supplied = filepath.Clean(directory)
	}
	same := expected == supplied
	if expectedInfo, err := os.Stat(target.Directory); err == nil {
		if suppliedInfo, err := os.Stat(directory); err == nil {
			same = os.SameFile(expectedInfo, suppliedInfo)
		}
	}
	if !same || isReparse(target.Store) {
		return target, Message("common.error.profileUnsafe", nil, nil)
	}
	return target, nil
}
func UninstallWithOptions(baseDir string, options UninstallOptions) (Result, error) {
	result := Result{Profile: ProfileForTarget(baseDir)}
	var err error
	baseDir, err = NormalizeDiscordBaseDir(baseDir)
	if err != nil {
		return result, err
	}
	release, err := acquireInstallLock(baseDir)
	if err != nil {
		return result, err
	}
	defer release()
	result.Profile = ProfileForTarget(baseDir)
	if options.RemoveProfileData {
		result.Profile, err = validateErase(baseDir, options.ProfileDirectory)
		if err != nil {
			return result, err
		}
	}
	dirs, err := ResolveAllCoreDirs(baseDir)
	if err != nil {
		return result, err
	}
	known, running := installationActivity(baseDir)
	var failures []error
	step := func(p, action string, operation func() error) bool {
		err := operation()
		state := "done"
		detail := ""
		if errors.Is(err, os.ErrNotExist) {
			state = "already absent"
			err = nil
		}
		if err != nil {
			state = "failed"
			detail = err.Error()
			failures = append(failures, err)
		}
		result.Steps = append(result.Steps, StepResult{Path: p, Action: action, State: state, Detail: detail, SystemError: err})
		return err == nil
	}
	keep := func(p, detailID string) {
		result.Steps = append(result.Steps, StepResult{Path: p, Action: "remove payload", State: "kept", DetailID: detailID})
	}
	for _, core := range dirs {
		index := filepath.Join(core, "index.js")
		backup := filepath.Join(core, BackupName)
		ok := step(index, "detach", func() error {
			data, readErr := os.ReadFile(index)
			if readErr != nil {
				return readErr
			}
			current := string(data)
			if !strings.Contains(current, LoaderMarker) {
				return os.ErrNotExist
			}
			var restored []byte
			if strings.Contains(current, BlockStart) {
				restored = []byte(baseIndex(current))
			} else {
				restored = []byte(VanillaIndex)
				info, statErr := os.Lstat(backup)
				if statErr == nil {
					if !info.Mode().IsRegular() {
						return fmt.Errorf("backup is not a regular file")
					}
					restored, statErr = os.ReadFile(backup)
					if statErr != nil {
						return statErr
					}
				} else if !errors.Is(statErr, os.ErrNotExist) {
					return statErr
				}
			}
			return commitIndex(index, restored, data)
		})
		if !ok {
			result.Steps = append(result.Steps, StepResult{Path: backup, Action: "remove backup", State: "not attempted", DetailID: "common.detail.backupRetained"}, StepResult{Path: filepath.Join(core, PayloadDirName), Action: "remove payload", State: "not attempted", DetailID: "common.detail.payloadRetained"})
			continue
		}
		step(backup, "remove backup", func() error {
			info, statErr := os.Lstat(backup)
			if errors.Is(statErr, os.ErrNotExist) {
				return os.ErrNotExist
			}
			if statErr != nil {
				return statErr
			}
			if !info.Mode().IsRegular() {
				return fmt.Errorf("backup is not a regular file")
			}
			return os.Remove(backup)
		})
		entries, _ := os.ReadDir(core)
		retained := 0
		detail := "common.detail.payloadKept"
		if known && running {
			detail = "common.detail.discordRunning"
		} else if !known {
			detail = "common.detail.identityUnresolved"
		}
		for _, entry := range entries {
			name := entry.Name()
			full := filepath.Join(core, name)
			if known && !running && nativeOwned(name) {
				data, readErr := readCleanupIndex(index)
				if readErr != nil {
					keep(full, "common.detail.payloadKept")
					failures = append(failures, readErr)
					retained++
					continue
				}
				if referencedPayload(string(data)) == name {
					keep(full, "common.detail.payloadKept")
					retained++
					continue
				}
				step(full, "remove payload", func() error { return removeContained(core, full) })
				continue
			}
			if ownedPayload(name) || developerOwned(name) {
				keep(full, detail)
				retained++
			}
		}
		if retained == 0 && !(known && !running) {
			result.Steps = append(result.Steps, StepResult{Path: filepath.Join(core, PayloadDirName), Action: "remove payload", State: "already absent"})
		}
	}
	if !options.RemoveProfileData || len(failures) > 0 {
		reason := "common.detail.kept"
		if len(failures) > 0 {
			reason = "common.detail.incomplete"
		}
		result.Steps = append(result.Steps, StepResult{Path: result.Profile.Store, Action: "profile data", State: "kept", DetailID: reason})
	} else if !known {
		result.Steps = append(result.Steps, StepResult{Path: result.Profile.Store, Action: "profile data", State: "kept", DetailID: "common.detail.identityUnresolved"})
	} else if running {
		result.Steps = append(result.Steps, StepResult{Path: result.Profile.Store, Action: "profile data", State: "kept", DetailID: "common.detail.discordRunning"})
	} else if target, validationErr := validateErase(baseDir, options.ProfileDirectory); validationErr != nil {
		failures = append(failures, validationErr)
		result.Steps = append(result.Steps, StepResult{Path: result.Profile.Store, Action: "profile data", State: "kept", SystemError: validationErr})
	} else {
		step(target.Store, "profile data", func() error {
			if !fileExists(target.Store) {
				return os.ErrNotExist
			}
			return os.RemoveAll(target.Store)
		})
	}
	return result, errors.Join(failures...)
}
func Uninstall(baseDir string) (string, error) {
	result, err := UninstallWithOptions(baseDir, UninstallOptions{})
	return fmt.Sprintf("Babel uninstall checked %d steps", len(result.Steps)), err
}
