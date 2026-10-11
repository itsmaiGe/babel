package i18n

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestSharedFixtures(t *testing.T) {
	data, err := os.ReadFile("testdata/locale-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Preferences any    `json:"preferences"`
		Expected    string `json:"expectedJSGo"`
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range cases {
		if result := Resolve(fixture.Preferences); result != fixture.Expected {
			t.Fatalf("%v: %s != %s", fixture.Preferences, result, fixture.Expected)
		}
	}
}
func TestCatalogs(t *testing.T) {
	for locale, table := range catalogs {
		if len(table) != len(catalogs["en"]) {
			t.Fatal("incomplete", locale)
		}
		for id := range catalogs["en"] {
			value := T(locale, id, map[string]any{"path": "fixture {braces}", "message": "OS cause"})
			if value == "" || value == id || strings.Contains(value, "{path}") {
				t.Fatal(locale, id, value)
			}
		}
		if T(locale, "missing", nil) != table["common.unavailable"] {
			t.Fatal("fallback", locale)
		}
		if T(locale, "common.target", nil) != table["common.unavailable"] {
			t.Fatal("bad parameter", locale)
		}
	}
}
func TestPreferencesDecode(t *testing.T) {
	preferences, err := DecodePreferences([]uint16{'j', 'a', '-', 'J', 'P', 0, 'e', 'n', 0, 0}, 2)
	if err != nil || Resolve(preferences) != "ja" {
		t.Fatal(preferences, err)
	}
	for _, fixture := range []struct {
		buffer []uint16
		count  uint32
	}{{nil, 0}, {[]uint16{'e', 'n', 0}, 1}, {[]uint16{'e', 'n', 0, 0}, 2}, {[]uint16{0xD800, 0, 0}, 1}, {[]uint16{'e', 'n', 0, 0, 0}, 1}} {
		if _, err := DecodePreferences(fixture.buffer, fixture.count); err == nil {
			t.Fatal("accepted malformed multi-string", fixture)
		}
	}
}
