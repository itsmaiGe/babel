// Babel's native Win32 manager embeds the complete verified plugin payload.
package main

import (
	"babel-installer/internal/core"
	"babel-installer/internal/i18n"
	"babel-installer/internal/ui"
	"embed"
	"encoding/json"
	"io/fs"
	"os"
)

//go:embed all:payload
var embedded embed.FS

func main() {
	if len(os.Args) == 3 && os.Args[1] == "--verify-localization" {
		result := map[string]map[string]string{}
		for _, locale := range []string{"en", "zh-Hans", "zh-Hant", "ja"} {
			result[locale] = map[string]string{}
			for _, id := range []string{"win.title", "win.install", "win.permission", "common.detail.kept"} {
				result[locale][id] = i18n.T(locale, id, nil)
			}
		}
		data, err := json.Marshal(result)
		if err != nil {
			panic(err)
		}
		if err := os.WriteFile(os.Args[2], data, 0600); err != nil {
			panic(err)
		}
		return
	}
	payload, err := fs.Sub(embedded, "payload")
	if err != nil {
		panic(err)
	}
	manifest, err := core.ValidatePayload(payload)
	if len(os.Args) == 3 && os.Args[1] == "--verify-payload" {
		if err != nil {
			panic(err)
		}
		data, marshalErr := json.Marshal(manifest)
		if marshalErr != nil {
			panic(marshalErr)
		}
		if writeErr := os.WriteFile(os.Args[2], data, 0600); writeErr != nil {
			panic(writeErr)
		}
		return
	}
	ui.Run(payload, manifest.Version, err)
}
