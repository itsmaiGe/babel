package core

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Test seams. Production leaves both nil. The installer never reads an
// environment variable to decide whether to corrupt a target.
var (
	installHook         func(step, path string) error
	activityOverride    func(base string) (known, running bool)
	afterIndexSync      func(indexPath string) error
	indexReadForCleanup func(path string) ([]byte, error)
)

var (
	generationRe        = regexp.MustCompile(`^discord-translator-mod-g-[nd]-[0-9]+-[0-9a-f]{16}$`)
	stageRe             = regexp.MustCompile(`^\.discord-translator-mod-s-[nd]-[0-9a-f]{16}$`)
	nativeGenerationRe  = regexp.MustCompile(`^discord-translator-mod-g-n-[0-9]+-[0-9a-f]{16}$`)
	nativeStageRe       = regexp.MustCompile(`^\.discord-translator-mod-s-n-[0-9a-f]{16}$`)
	nativeTempRe        = regexp.MustCompile(`^\.discord-translator-mod-i-n-[0-9a-f]{16}$`)
	developerOwnedRe    = regexp.MustCompile(`^(?:discord-translator-mod-g-d-[0-9]+-[0-9a-f]{16}|\.discord-translator-mod-[si]-d-[0-9a-f]{16})$`)
	payloadRefRe        = regexp.MustCompile(`require\(\s*['"]\./(discord-translator-mod(?:-g-[nd]-[0-9]+-[0-9a-f]{16})?)/main(?:\.js)?['"]\s*\)`)
)

func randomHex() (string, error) {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf[:]), nil
}

func runHook(step, path string) error {
	if installHook == nil {
		return nil
	}
	return installHook(step, path)
}

func installationActivity(base string) (bool, bool) {
	if activityOverride != nil {
		return activityOverride(base)
	}
	return platformActivity(base)
}

func manifestEqual(a, b PayloadManifest) bool {
	if a.Version != b.Version || len(a.Files) != len(b.Files) {
		return false
	}
	left := append([]PayloadEntry(nil), a.Files...)
	right := append([]PayloadEntry(nil), b.Files...)
	sort.Slice(left, func(i, j int) bool { return left[i].Path < left[j].Path })
	sort.Slice(right, func(i, j int) bool { return right[i].Path < right[j].Path })
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func referencedPayload(content string) string {
	scope := ""
	if strings.Contains(content, BlockStart) {
		scope = strings.Join(babelBlockRe.FindAllString(content, -1), "\n")
	} else if strings.Contains(content, LoaderMarker) {
		scope = content
	}
	match := payloadRefRe.FindStringSubmatch(scope)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func assertCoreReady(core string) error {
	for _, name := range []string{"index.js", "core.asar", "package.json"} {
		info, err := os.Lstat(filepath.Join(core, name))
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			return Message("common.error.coreIncomplete", nil, nil)
		}
	}
	return nil
}

func preservedBase(core, current string) (string, error) {
	legacy := strings.Contains(current, LoaderMarker) && !strings.Contains(current, BlockStart)
	if !legacy && strings.TrimSpace(current) == "" {
		return "", Message("common.error.coreIncomplete", nil, nil)
	}
	source := current
	if legacy {
		info, err := os.Lstat(filepath.Join(core, BackupName))
		if err == nil {
			if !info.Mode().IsRegular() {
				return "", Message("common.error.coreIncomplete", nil, nil)
			}
			data, readErr := os.ReadFile(filepath.Join(core, BackupName))
			if readErr != nil {
				return "", readErr
			}
			source = string(data)
		} else if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
	}
	return baseIndex(source), nil
}

func matchingGeneration(core, content string, want PayloadManifest) (string, bool) {
	name := referencedPayload(content)
	if name == "" {
		return "", false
	}
	got, err := ValidatePayload(os.DirFS(filepath.Join(core, name)))
	if err != nil || !manifestEqual(got, want) {
		return "", false
	}
	return name, true
}

func writeSynced(path string, data []byte) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	_, err = file.Write(data)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	return err
}

// syncTree syncs directories after writeSynced has already flushed every payload
// file through a writable handle. It must not open those files again: on Windows,
// File.Sync calls FlushFileBuffers, which requires GENERIC_WRITE, so a read-only
// reopen fails the install. Directory fsync stays best-effort; some filesystems
// reject it, and that is not a payload durability failure.
func syncTree(root string) error {
	dirs, err := collectDirectories(root)
	if err != nil {
		return err
	}
	syncDirectories(dirs)
	return nil
}

func collectDirectories(root string) ([]string, error) {
	var dirs []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			dirs = append(dirs, path)
		}
		return nil
	})
	return dirs, err
}

func syncDirectories(dirs []string) {
	for i := len(dirs) - 1; i >= 0; i-- {
		dir, err := os.Open(dirs[i])
		if err == nil {
			_ = dir.Sync()
			dir.Close()
		}
	}
}

func publishGeneration(payload fs.FS, core string, want PayloadManifest) (name string, err error) {
	stageHex, err := randomHex()
	if err != nil {
		return "", err
	}
	stagePath := filepath.Join(core, ".discord-translator-mod-s-n-"+stageHex)
	if err = os.Mkdir(stagePath, 0o755); err != nil {
		return "", err
	}
	defer func() {
		if err != nil {
			os.RemoveAll(stagePath)
		}
	}()
	entries := append(append([]PayloadEntry{}, want.Files...), PayloadEntry{Path: "manifest.json"})
	for _, entry := range entries {
		data, readErr := fs.ReadFile(payload, entry.Path)
		if readErr != nil {
			err = readErr
			return "", err
		}
		target := filepath.Join(stagePath, filepath.FromSlash(entry.Path))
		if err = os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return "", err
		}
		if err = writeSynced(target, data); err != nil {
			return "", err
		}
	}
	if err = syncTree(stagePath); err != nil {
		return "", err
	}
	staged, vErr := ValidatePayload(os.DirFS(stagePath))
	if vErr != nil {
		err = vErr
		return "", err
	}
	if !manifestEqual(staged, want) {
		err = Message("common.error.payloadIntegrity", nil, nil)
		return "", err
	}
	if err = runHook("stage", stagePath); err != nil {
		return "", err
	}
	if err = runHook("publish", stagePath); err != nil {
		return "", err
	}
	genHex, gErr := randomHex()
	if gErr != nil {
		err = gErr
		return "", err
	}
	name = fmt.Sprintf("discord-translator-mod-g-n-%d-%s", time.Now().UTC().UnixMilli(), genHex)
	if err = os.Rename(stagePath, filepath.Join(core, name)); err != nil {
		return "", err
	}
	return name, nil
}

func commitIndex(indexPath string, contents, snapshot []byte) error {
	tempHex, err := randomHex()
	if err != nil {
		return err
	}
	temp := filepath.Join(filepath.Dir(indexPath), ".discord-translator-mod-i-n-"+tempHex)
	if err = writeSynced(temp, contents); err != nil {
		os.Remove(temp)
		return err
	}
	if afterIndexSync != nil {
		if hookErr := afterIndexSync(indexPath); hookErr != nil {
			os.Remove(temp)
			return hookErr
		}
	}
	again, err := os.ReadFile(indexPath)
	if err != nil || !bytes.Equal(again, snapshot) {
		os.Remove(temp)
		if err != nil {
			return err
		}
		return Message("common.error.targetChanged", nil, nil)
	}
	if err = runHook("commit", indexPath); err != nil {
		os.Remove(temp)
		return err
	}
	if err = replaceFile(temp, indexPath); err != nil {
		os.Remove(temp)
		return err
	}
	if dir, openErr := os.Open(filepath.Dir(indexPath)); openErr == nil {
		_ = dir.Sync()
		dir.Close()
	}
	_, _ = os.ReadFile(indexPath)
	return nil
}

func removeBackupFile(core string) error {
	backup := filepath.Join(core, BackupName)
	info, err := os.Lstat(backup)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return nil
	}
	return os.Remove(backup)
}

func nativeOwned(name string) bool {
	return name == PayloadDirName || nativeGenerationRe.MatchString(name) || nativeStageRe.MatchString(name) || nativeTempRe.MatchString(name)
}

func ownedPayload(name string) bool {
	return name == PayloadDirName || generationRe.MatchString(name) || stageRe.MatchString(name)
}

func developerOwned(name string) bool { return developerOwnedRe.MatchString(name) }

func removeContained(parent, child string) error {
	info, err := os.Lstat(child)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return Message("common.error.payloadUnsafe", nil, nil)
	}
	rel, err := filepath.Rel(parent, child)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return Message("common.error.payloadUnsafe", nil, nil)
	}
	return os.RemoveAll(child)
}

func readCleanupIndex(path string) ([]byte, error) {
	if indexReadForCleanup != nil {
		return indexReadForCleanup(path)
	}
	return os.ReadFile(path)
}

func cleanupNative(core string) error {
	entries, err := os.ReadDir(core)
	if err != nil {
		return err
	}
	var first error
	for _, entry := range entries {
		if !nativeOwned(entry.Name()) {
			continue
		}
		data, readErr := readCleanupIndex(filepath.Join(core, "index.js"))
		if readErr != nil {
			if first == nil {
				first = readErr
			}
			continue
		}
		if referencedPayload(string(data)) == entry.Name() {
			continue
		}
		if err = removeContained(core, filepath.Join(core, entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) && first == nil {
			first = err
		}
	}
	return first
}
