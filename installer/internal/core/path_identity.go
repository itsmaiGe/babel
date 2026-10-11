package core

import (
	"os"
	"path/filepath"
	"strings"
)

// canonicalPath resolves symlinks and junctions when the OS can. A selected
// Discord folder may be an alias of the directory whose executable is running.
func canonicalPath(path string) string {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved == "" {
		return filepath.Clean(path)
	}
	return filepath.Clean(resolved)
}

// pathUnderBase reports whether candidate is the installation base or a file
// inside it. Both the selected alias and the queried executable are resolved,
// so a junction is not "known" by file identity and "idle" by a textual prefix.
func pathUnderBase(base, candidate string) bool {
	roots := []string{canonicalPath(base), filepath.Clean(base)}
	files := []string{canonicalPath(candidate), filepath.Clean(candidate)}
	seenRoot := map[string]bool{}
	seenFile := map[string]bool{}
	for _, root := range roots {
		if seenRoot[root] {
			continue
		}
		seenRoot[root] = true
		for _, file := range files {
			if seenFile[root+"\x00"+file] {
				continue
			}
			seenFile[root+"\x00"+file] = true
			if hasInstallPrefix(root, file) {
				return true
			}
		}
	}
	return false
}

func hasInstallPrefix(root, file string) bool {
	root = strings.TrimRight(root, `/\`)
	file = strings.TrimRight(file, `/\`)
	if strings.Contains(root, `\`) || strings.Contains(file, `\`) {
		root = strings.ToLower(strings.ReplaceAll(root, "/", `\`))
		file = strings.ToLower(strings.ReplaceAll(file, "/", `\`))
		return file == root || strings.HasPrefix(file, root+`\`)
	}
	separator := string(os.PathSeparator)
	return file == root || strings.HasPrefix(file, root+separator)
}
