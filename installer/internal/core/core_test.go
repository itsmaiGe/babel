package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

// fakeDiscord builds a minimal Discord user-data tree with the given app
// versions, each having a valid discord_desktop_core, and returns the base dir.
func fakeDiscord(t *testing.T, versions ...string) string {
	t.Helper()
	base := t.TempDir()
	for _, v := range versions {
		core := filepath.Join(base, "app-"+v, "modules", "discord_desktop_core-1", "discord_desktop_core")
		if err := os.MkdirAll(core, 0o755); err != nil {
			t.Fatal(err)
		}
		write(t, filepath.Join(core, "core.asar"), "asar")
		write(t, filepath.Join(core, "package.json"), "{}")
		write(t, filepath.Join(core, "index.js"), VanillaIndex)
	}
	return base
}

func write(t *testing.T, p, content string) {
	t.Helper()
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func samplePayload() fstest.MapFS {
	return fstest.MapFS{
		"main.js":          {Data: []byte("exports.install=()=>{}")},
		"preload.js":       {Data: []byte("// preload")},
		"renderer.js":      {Data: []byte("// renderer")},
		"shared/util.js":   {Data: []byte("// shared")},
	}
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

func TestInstallThenUninstallRoundTrips(t *testing.T) {
	base := fakeDiscord(t, "1.0.0")
	// Redirect the config store to a temp dir so the test never deletes the real
	// user config, and so we can assert uninstall wipes it.
	configStore := filepath.Join(t.TempDir(), "babel-store")
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
	if _, err := os.Stat(filepath.Join(core, BackupName)); err != nil {
		t.Fatal("backup not created")
	}
	if _, err := os.Stat(filepath.Join(core, PayloadDirName, "main.js")); err != nil {
		t.Fatal("payload main.js not copied")
	}
	if _, err := os.Stat(filepath.Join(core, PayloadDirName, "shared", "util.js")); err != nil {
		t.Fatal("nested payload not copied")
	}

	if _, err := Uninstall(base); err != nil {
		t.Fatal(err)
	}
	idx, _ = os.ReadFile(indexPath)
	if strings.TrimSpace(string(idx)) != strings.TrimSpace(VanillaIndex) {
		t.Fatalf("index not restored, got %q", string(idx))
	}
	if _, err := os.Stat(filepath.Join(core, BackupName)); err == nil {
		t.Fatal("backup not removed")
	}
	if _, err := os.Stat(filepath.Join(core, PayloadDirName)); err == nil {
		t.Fatal("payload not removed")
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
	if _, err := Install(base, samplePayload()); err != nil {
		t.Fatal(err)
	}
	// Second install should still succeed (index already carries our marker).
	if _, err := Install(base, samplePayload()); err != nil {
		t.Fatalf("second install failed: %v", err)
	}
}
