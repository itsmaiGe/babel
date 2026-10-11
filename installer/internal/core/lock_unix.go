//go:build !windows

package core

import (
	"os"

	"golang.org/x/sys/unix"
)

func acquireInstallLock(base string) (func(), error) {
	file := base + string(os.PathSeparator) + ".discord-translator-mod.lock"
	fd, err := unix.Open(file, unix.O_CREAT|unix.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err = unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		unix.Close(fd)
		if err == unix.EWOULDBLOCK || err == unix.EAGAIN {
			return nil, Message("common.error.targetLocked", nil, err)
		}
		return nil, err
	}
	return func() { unix.Close(fd) }, nil
}

func replaceFile(temp, target string) error {
	return os.Rename(temp, target)
}
