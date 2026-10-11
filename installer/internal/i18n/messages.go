package i18n

import (
	"regexp"
	"strconv"
)

var placeholder = regexp.MustCompile(`\{([A-Za-z][\w]*)\}`)

// T substitutes named values once. Values containing braces are never parsed again.
func T(locale, id string, params map[string]any) string {
	table := catalogs[locale]
	message := table[id]
	if message == "" {
		message = catalogs["en"][id]
	}
	terminal := table["common.unavailable"]
	if terminal == "" {
		terminal = catalogs["en"]["common.unavailable"]
	}
	if terminal == "" {
		terminal = "Unavailable"
	}
	if message == "" {
		return terminal
	}
	valid := true
	result := placeholder.ReplaceAllStringFunc(message, func(token string) string {
		switch value := params[token[1:len(token)-1]].(type) {
		case string:
			return value
		case int:
			return strconv.Itoa(value)
		default:
			valid = false
			return ""
		}
	})
	if !valid {
		return terminal
	}
	return result
}
