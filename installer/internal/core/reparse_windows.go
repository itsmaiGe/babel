//go:build windows

package core

import (
	"errors"
	"golang.org/x/sys/windows"
)

func isReparse(path string) bool {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return true
	}
	attributes, err := windows.GetFileAttributes(p)
	if err != nil {
		return !errors.Is(err, windows.ERROR_FILE_NOT_FOUND) && !errors.Is(err, windows.ERROR_PATH_NOT_FOUND)
	}
	return attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0
}
