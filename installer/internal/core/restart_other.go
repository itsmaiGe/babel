//go:build !windows

package core

import (
	"errors"
	"time"
)

var errRestartUnsupported = errors.New("restart is unsupported on this platform")

func platformRestartElevated() bool { return false }

func platformRestartRelease(procs []RestartProcess) {}

func platformRestartEnumerate(base, exeName string) (RestartScan, error) {
	return RestartScan{}, errRestartUnsupported
}

func platformRestartCloseWindows(pids []uint32) error { return errRestartUnsupported }

func platformRestartTerminate(procs []RestartProcess) error { return errRestartUnsupported }

func platformRestartWaitGone(procs []RestartProcess, timeout time.Duration) (*RestartProcess, error) {
	return nil, errRestartUnsupported
}

func platformRestartLaunch(exe, dir string) error { return errRestartUnsupported }
