// Package core implements the Discord desktop-core patch/unpatch logic for the
// Babel installer. It is a faithful port of scripts/desktop-core-action.js and
// is deliberately GUI-free so it can be unit-tested without a display.
package core

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const (
	// LoaderMarker must match the JS installer so install/uninstall interoperate.
	LoaderMarker   = "DiscordTranslatorMod desktop-core loader"
	PayloadDirName = "discord-translator-mod"
	BackupName     = "index.js.dtm-original"
	VanillaIndex   = "module.exports = require('./core.asar');\n"
)

var (
	appDirRe   = regexp.MustCompile(`^app-(\d+)\.(\d+)\.(\d+)$`)
	coreWrapRe = regexp.MustCompile(`^discord_desktop_core-(\d+)$`)
	vanillaRe  = regexp.MustCompile(`^\s*module\.exports\s*=\s*require\(["']\./core\.asar["']\);\s*$`)
)

// DiscordBaseDir returns the platform Discord user-data directory.
func DiscordBaseDir() string {
	if v := os.Getenv("LOCALAPPDATA"); v != "" {
		return filepath.Join(v, "Discord")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "AppData", "Local", "Discord")
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
		return nil, fmt.Errorf("Discord folder not found at %s. Is Discord installed?", baseDir)
	}

	type versioned struct {
		dir string
		v   [3]int
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
		versions = append(versions, versioned{filepath.Join(baseDir, e.Name()), [3]int{a, b, c}})
	}
	sort.Slice(versions, func(i, j int) bool {
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
		for _, w := range wrappers {
			cd := filepath.Join(w.dir, "discord_desktop_core")
			if fileExists(filepath.Join(cd, "core.asar")) && fileExists(filepath.Join(cd, "package.json")) {
				cores = append(cores, cd)
				break
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
		return "", fmt.Errorf("no Discord desktop core module found under %s", baseDir)
	}
	return dirs[0], nil
}

func loaderIndex() string {
	return "/* " + LoaderMarker + " */\n" +
		"try {\n" +
		"  require(\"./" + PayloadDirName + "/main.js\").install();\n" +
		"} catch (error) {\n" +
		"  console.error(\"[Babel] Failed to install hook:\", error);\n" +
		"}\n" +
		"module.exports = require(\"./core.asar\");\n"
}

func copyPayload(payload fs.FS, dest string) error {
	if err := os.RemoveAll(dest); err != nil {
		return err
	}
	return fs.WalkDir(payload, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p == "." {
			return nil
		}
		target := filepath.Join(dest, filepath.FromSlash(p))
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := fs.ReadFile(payload, p)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}

// Install patches the newest Discord core to load the embedded payload, backing
// up the original loader first. payload is the embedded plugin file tree.
func Install(baseDir string, payload fs.FS) (string, error) {
	core, err := ResolveCoreDir(baseDir)
	if err != nil {
		return "", err
	}
	indexPath := filepath.Join(core, "index.js")
	backupPath := filepath.Join(core, BackupName)
	payloadDest := filepath.Join(core, PayloadDirName)

	current := VanillaIndex
	if b, err := os.ReadFile(indexPath); err == nil {
		current = string(b)
	}

	if !fileExists(backupPath) {
		if !vanillaRe.MatchString(current) && !strings.Contains(current, LoaderMarker) {
			return "", fmt.Errorf("refusing to overwrite an unknown Discord core index at %s", indexPath)
		}
		if err := os.WriteFile(backupPath, []byte(current), 0o644); err != nil {
			return "", err
		}
	}

	if err := copyPayload(payload, payloadDest); err != nil {
		return "", err
	}
	if err := os.WriteFile(indexPath, []byte(loaderIndex()), 0o644); err != nil {
		return "", err
	}

	return "Installed Babel into:\n" + core, nil
}

// Uninstall restores the original loader and removes the payload from every core.
func Uninstall(baseDir string) (string, error) {
	dirs, err := ResolveAllCoreDirs(baseDir)
	if err != nil {
		return "", err
	}
	changed := 0
	for _, core := range dirs {
		indexPath := filepath.Join(core, "index.js")
		backupPath := filepath.Join(core, BackupName)
		payloadDest := filepath.Join(core, PayloadDirName)

		current := ""
		if b, err := os.ReadFile(indexPath); err == nil {
			current = string(b)
		}

		if fileExists(backupPath) {
			if b, err := os.ReadFile(backupPath); err == nil {
				if err := os.WriteFile(indexPath, b, 0o644); err == nil {
					os.Remove(backupPath)
					changed++
				}
			}
		} else if strings.Contains(current, LoaderMarker) {
			if err := os.WriteFile(indexPath, []byte(VanillaIndex), 0o644); err == nil {
				changed++
			}
		}

		if fileExists(payloadDest) {
			if err := os.RemoveAll(payloadDest); err == nil {
				changed++
			}
		}
	}
	return fmt.Sprintf("Removed Babel from %d desktop core item(s).", changed), nil
}
