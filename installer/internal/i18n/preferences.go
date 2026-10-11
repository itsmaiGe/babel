package i18n

import (
	"errors"
	"unicode/utf16"
)

// DecodePreferences rejects truncated multi-strings, empty entries and invalid UTF-16.
func DecodePreferences(buffer []uint16, count uint32) ([]string, error) {
	if len(buffer) < 2 || len(buffer) > 32768 || count == 0 || count > 128 || buffer[len(buffer)-1] != 0 || buffer[len(buffer)-2] != 0 {
		return nil, errors.New("invalid UI language multi-string")
	}
	result := []string{}
	start := 0
	for i, value := range buffer {
		if value != 0 {
			continue
		}
		if i == start {
			if len(result) != int(count) || i != len(buffer)-1 {
				return nil, errors.New("invalid UI language count")
			}
			return result, nil
		}
		part := buffer[start:i]
		if len(part) > 128 {
			return nil, errors.New("UI language too long")
		}
		for j := 0; j < len(part); j++ {
			if part[j] >= 0xD800 && part[j] <= 0xDBFF {
				if j+1 >= len(part) || part[j+1] < 0xDC00 || part[j+1] > 0xDFFF {
					return nil, errors.New("invalid UTF-16")
				}
				j++
			} else if part[j] >= 0xDC00 && part[j] <= 0xDFFF {
				return nil, errors.New("invalid UTF-16")
			}
		}
		result = append(result, string(utf16.Decode(part)))
		start = i + 1
	}
	return nil, errors.New("unterminated UI languages")
}
