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
	BlockStart     = "/* " + LoaderMarker + ":start */"
	BlockEnd       = "/* " + LoaderMarker + ":end */"
	PayloadDirName = "discord-translator-mod"
	BackupName     = "index.js.dtm-original"
	VanillaIndex   = "module.exports = require('./core.asar');\n"
)

var (
	appDirRe      = regexp.MustCompile(`^app-(\d+)\.(\d+)\.(\d+)$`)
	coreWrapRe    = regexp.MustCompile(`^discord_desktop_core-(\d+)$`)
	babelBlockRe  = regexp.MustCompile("(?s)" + regexp.QuoteMeta(BlockStart) + ".*?" + regexp.QuoteMeta(BlockEnd) + "\\n?")
)

// DiscordBaseDir returns the platform Discord modules directory (Local on Windows).
func DiscordBaseDir() string {
	if v := os.Getenv("LOCALAPPDATA"); v != "" {
		return filepath.Join(v, "Discord")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "AppData", "Local", "Discord")
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

// baseIndex returns the index content with any Babel hook removed — what we preserve
// and re-prepend (keeping BetterDiscord/Vencord and the core.asar export).
func baseIndex(content string) string {
	if strings.Contains(content, BlockStart) {
		return normalizeIndex(babelBlockRe.ReplaceAllString(content, ""))
	}
	if strings.Contains(content, LoaderMarker) {
		// Legacy whole-file loader replaced everything; its true base was always vanilla.
		return VanillaIndex
	}
	return normalizeIndex(content)
}

func normalizeIndex(content string) string {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return VanillaIndex
	}
	return trimmed + "\n"
}

// loaderBlock is our hook, wrapped in try/catch (a payload failure can never break
// Discord) and fenced by start/end markers so it can be stripped back out on uninstall.
func loaderBlock() string {
	return BlockStart + "\n" +
		"try {\n" +
		"  require(\"./" + PayloadDirName + "/main.js\").install();\n" +
		"} catch (error) {\n" +
		"  console.error(\"[Babel] Failed to install hook:\", error);\n" +
		"}\n" +
		BlockEnd + "\n"
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

	// For the legacy whole-file loader, recover from the pre-Babel backup if present —
	// it may hold BetterDiscord's injection the old loader clobbered.
	legacyFormat := strings.Contains(current, LoaderMarker) && !strings.Contains(current, BlockStart)
	source := current
	if legacyFormat && fileExists(backupPath) {
		if b, err := os.ReadFile(backupPath); err == nil {
			source = string(b)
		}
	}
	base := baseIndex(source)

	// Only patch a recognizable Discord core index (one that loads core.asar); refusing
	// here keeps us from prepending to a corrupt/unexpected file and bricking it.
	if !strings.Contains(base, "core.asar") {
		return "", fmt.Errorf("refusing to patch an unrecognized Discord core index at %s", indexPath)
	}

	if err := copyPayload(payload, payloadDest); err != nil {
		return "", err
	}
	// Additive: our delimited hook first, then the preserved base (other injectors +
	// core export). Coexists with BetterDiscord/Vencord regardless of install order.
	if err := os.WriteFile(indexPath, []byte(loaderBlock()+base), 0o644); err != nil {
		return "", err
	}
	if fileExists(backupPath) {
		os.Remove(backupPath)
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

		if strings.Contains(current, BlockStart) {
			// New format: strip only our block; keep any other injector + the core export.
			if err := os.WriteFile(indexPath, []byte(baseIndex(current)), 0o644); err == nil {
				changed++
			}
		} else if strings.Contains(current, LoaderMarker) {
			// Legacy whole-file loader: restore the pre-Babel backup if present (may hold
			// BetterDiscord); otherwise fall back to vanilla.
			if fileExists(backupPath) {
				if b, err := os.ReadFile(backupPath); err == nil {
					if err := os.WriteFile(indexPath, b, 0o644); err == nil {
						changed++
					}
				}
			} else if err := os.WriteFile(indexPath, []byte(VanillaIndex), 0o644); err == nil {
				changed++
			}
		}

		if fileExists(backupPath) {
			os.Remove(backupPath)
		}

		if fileExists(payloadDest) {
			if err := os.RemoveAll(payloadDest); err == nil {
				changed++
			}
		}
	}

	// Wipe the user's stored config (settings, API keys, cache) so nothing is left behind.
	if store := ConfigStoreDir(); fileExists(store) {
		if err := os.RemoveAll(store); err == nil {
			changed++
		}
	}

	return fmt.Sprintf("Removed Babel from %d desktop core item(s).", changed), nil
}
