//go:build windows

package i18n

import (
	"golang.org/x/sys/windows"
	"runtime"
	"unsafe"
)

func SystemLocale() string {
	proc := windows.NewLazySystemDLL("kernel32.dll").NewProc("GetUserPreferredUILanguages")
	if proc.Find() != nil {
		return "en"
	}
	var count, size uint32
	ok, _, _ := proc.Call(8, uintptr(unsafe.Pointer(&count)), 0, uintptr(unsafe.Pointer(&size)))
	if ok == 0 || size < 2 || size > 32768 {
		return "en"
	}
	buffer := make([]uint16, size)
	ok, _, _ = proc.Call(8, uintptr(unsafe.Pointer(&count)), uintptr(unsafe.Pointer(&buffer[0])), uintptr(unsafe.Pointer(&size)))
	runtime.KeepAlive(buffer)
	if ok == 0 || size > uint32(len(buffer)) {
		return "en"
	}
	preferences, err := DecodePreferences(buffer[:size], count)
	if err != nil {
		return "en"
	}
	return Resolve(preferences)
}
