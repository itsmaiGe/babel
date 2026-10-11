package i18n

import (
	"regexp"
	"strings"
)

var languagePattern = regexp.MustCompile(`^[A-Za-z]{2,3}$`)
var scriptPattern = regexp.MustCompile(`^[A-Za-z]{4}$`)
var regionPattern = regexp.MustCompile(`^(?:[A-Za-z]{2}|[0-9]{3})$`)
var variantPattern = regexp.MustCompile(`^(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3})$`)
var extensionPattern = regexp.MustCompile(`^[A-Za-z0-9]{1,8}$`)

func normalize(value string) (language, script, region string, valid bool) {
	if len(value) > 128 {
		return
	}
	parts := strings.Split(strings.ReplaceAll(strings.TrimSpace(value), "_", "-"), "-")
	if !languagePattern.MatchString(parts[0]) {
		return
	}
	for i := 1; i < len(parts); i++ {
		if strings.EqualFold(parts[i], "u") || strings.EqualFold(parts[i], "x") {
			if i == len(parts)-1 {
				return
			}
			for _, part := range parts[i+1:] {
				if !extensionPattern.MatchString(part) {
					return
				}
			}
			parts = parts[:i]
			break
		}
	}
	index := 1
	if index < len(parts) && scriptPattern.MatchString(parts[index]) {
		script = strings.ToLower(parts[index])
		script = strings.ToUpper(script[:1]) + script[1:]
		index++
	}
	if index < len(parts) && regionPattern.MatchString(parts[index]) {
		region = strings.ToUpper(parts[index])
		index++
	}
	for _, part := range parts[index:] {
		if !variantPattern.MatchString(part) {
			return
		}
	}
	language = strings.ToLower(parts[0])
	valid = true
	return
}

func Resolve(preferences any) string {
	var entries []any
	switch values := preferences.(type) {
	case []string:
		for _, value := range values {
			entries = append(entries, value)
		}
	case []any:
		entries = values
	default:
		return "en"
	}
	for index, value := range entries {
		if index >= 128 {
			break
		}
		text, ok := value.(string)
		if !ok {
			continue
		}
		language, script, region, valid := normalize(text)
		if !valid {
			continue
		}
		if language == "zh" || language == "yue" {
			if script == "Hans" || script == "Hant" {
				return "zh-" + script
			}
			if script != "" {
				continue
			}
			if language == "yue" {
				if region == "CN" {
					return "zh-Hans"
				}
				return "zh-Hant"
			}
			if region == "TW" || region == "HK" || region == "MO" {
				return "zh-Hant"
			}
			return "zh-Hans"
		}
		if language == "en" && (script == "" || script == "Latn") {
			return "en"
		}
		if language == "ja" && (script == "" || script == "Jpan") {
			return "ja"
		}
	}
	return "en"
}
