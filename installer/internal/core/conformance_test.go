package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSharedConformanceCorpus(t *testing.T) {
	data, err := os.ReadFile("../../../test/fixtures/installer-conformance.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name, Format                                                                                           string
		Backup, BackupDirectory, IndexDirectory, RemoveData, Succeeds, DataKept, HookKept, PayloadKept, Repeat bool
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	injector := "require('./other-injector');\nmodule.exports = require('./core.asar');\n"
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			base := filepath.Join(t.TempDir(), "discord")
			target := filepath.Join(base, "app-0.0.999", "modules", "discord_desktop_core-1", "discord_desktop_core")
			store := filepath.Join(base, PayloadDirName)
			payload := filepath.Join(target, PayloadDirName)
			for _, p := range []string{target, store, payload} {
				if err := os.MkdirAll(p, 0755); err != nil {
					t.Fatal(err)
				}
			}
			t.Setenv("BABEL_CONFIG_DIR", store)
			index, backup := filepath.Join(target, "index.js"), filepath.Join(target, BackupName)
			content := injector
			if c.Format == "additive" {
				content = BlockStart + "\nrequire('./discord-translator-mod/main');\n" + BlockEnd + "\n" + injector
			}
			if c.Format == "legacy" {
				content = "/* " + LoaderMarker + " */\n" + VanillaIndex
			}
			if c.IndexDirectory {
				os.Mkdir(index, 0755)
			} else {
				os.WriteFile(index, []byte(content), 0644)
			}
			if c.BackupDirectory {
				os.Mkdir(backup, 0755)
				os.WriteFile(filepath.Join(backup, "recovery"), []byte("saved"), 0644)
			} else if c.Backup {
				os.WriteFile(backup, []byte(injector), 0644)
			}
			for p, s := range map[string]string{filepath.Join(target, "core.asar"): "core", filepath.Join(target, "package.json"): "{}", filepath.Join(payload, "main.js"): "saved", filepath.Join(store, "api-keys.json"): "saved"} {
				os.WriteFile(p, []byte(s), 0644)
			}
			options := UninstallOptions{RemoveProfileData: c.RemoveData, ProfileDirectory: base}
			result, err := UninstallWithOptions(base, options)
			if (err == nil) != c.Succeeds {
				t.Fatalf("success=%v: %v", err == nil, err)
			}
			if fileExists(store) != c.DataKept || fileExists(payload) != c.PayloadKept {
				t.Fatalf("unexpected cleanup: %+v", result)
			}
			if !c.IndexDirectory {
				b, err := os.ReadFile(index)
				if err != nil {
					t.Fatal(err)
				}
				if strings.Contains(string(b), LoaderMarker) != c.HookKept {
					t.Fatal("hook mismatch")
				}
				if (c.Backup || c.Format == "additive" || c.Format == "plain") && !strings.Contains(string(b), "other-injector") {
					t.Fatal("other injector lost")
				}
			}
			if !c.Succeeds {
				found := false
				for _, step := range result.Steps {
					if step.State == "not attempted" {
						found = true
					}
				}
				if !found {
					t.Fatal("recovery steps not retained")
				}
			}
			if c.Repeat {
				_, err = UninstallWithOptions(base, options)
				if err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}
