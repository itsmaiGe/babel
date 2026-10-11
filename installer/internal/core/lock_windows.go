//go:build windows

package core

import (
	"errors"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

func acquireInstallLock(base string) (func(), error) {
	file, err := os.OpenFile(filepath.Join(canonicalPath(base), ".discord-translator-mod.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	var overlapped windows.Overlapped
	err = windows.LockFileEx(windows.Handle(file.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &overlapped)
	if err != nil {
		file.Close()
		if errors.Is(err, windows.ERROR_LOCK_VIOLATION) {
			return nil, Message("common.error.targetLocked", nil, err)
		}
		return nil, err
	}
	return func() { file.Close() }, nil
}

func replaceFile(temp, target string) error {
	from, err := windows.UTF16PtrFromString(temp)
	if err != nil {
		return err
	}
	to, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	return windows.MoveFileEx(from, to, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}
