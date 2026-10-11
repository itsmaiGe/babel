//go:build windows

package core

import (
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

func platformActivity(base string) (bool, bool) {
	resolved := canonicalPath(base)
	if !knownWindowsBase(resolved) && !knownWindowsBase(base) {
		return false, false
	}
	running, err := executableUnder(base)
	if err != nil {
		return true, true
	}
	return true, running
}

func knownWindowsBase(base string) bool {
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		return false
	}
	selected, err := os.Stat(base)
	if err != nil {
		return false
	}
	for _, name := range []string{"Discord", "DiscordPTB", "DiscordCanary", "DiscordDevelopment"} {
		info, statErr := os.Stat(filepath.Join(local, name))
		if statErr == nil && os.SameFile(selected, info) {
			return true
		}
	}
	return false
}

func executableUnder(base string) (bool, error) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false, err
	}
	defer windows.CloseHandle(snap)
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	return walkProcesses(
		func() error { return windows.Process32First(snap, &entry) },
		func() error { return windows.Process32Next(snap, &entry) },
		func() (bool, error) { return observeProcess(&entry, base) },
	)
}

// ERROR_NO_MORE_FILES is the only successful end of a Toolhelp snapshot.
// Any other Process32First/Next failure is an incomplete observation.
func walkProcesses(first, next func() error, observe func() (bool, error)) (bool, error) {
	if err := first(); err != nil {
		if err == windows.ERROR_NO_MORE_FILES {
			return false, nil
		}
		return false, err
	}
	for {
		running, err := observe()
		if err != nil {
			return false, err
		}
		if running {
			return true, nil
		}
		if err = next(); err != nil {
			if err == windows.ERROR_NO_MORE_FILES {
				return false, nil
			}
			return false, err
		}
	}
}

func discordCandidateName(name string) bool {
	switch strings.ToLower(name) {
	case "discord.exe", "discordptb.exe", "discordcanary.exe", "discorddevelopment.exe":
		return true
	default:
		return false
	}
}

// A query failure for an unrelated process is skipped. A Discord image whose
// path cannot be read is retained by propagating the error.
func retainQueryError(exeName string, queryErr error) error {
	if queryErr == nil || !discordCandidateName(exeName) {
		return nil
	}
	return queryErr
}

func observeProcess(entry *windows.ProcessEntry32, base string) (bool, error) {
	running, err := processImageUnder(entry.ProcessID, base)
	if err != nil {
		if retained := retainQueryError(windows.UTF16ToString(entry.ExeFile[:]), err); retained != nil {
			return false, retained
		}
		return false, nil
	}
	return running, nil
}

func processImageUnder(pid uint32, base string) (bool, error) {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return false, err
	}
	defer windows.CloseHandle(handle)
	buf := make([]uint16, 32768)
	size := uint32(len(buf))
	if err = windows.QueryFullProcessImageName(handle, 0, &buf[0], &size); err != nil || size > uint32(len(buf)) {
		if err == nil {
			err = windows.ERROR_INSUFFICIENT_BUFFER
		}
		return false, err
	}
	return pathUnderBase(base, windows.UTF16ToString(buf[:size])), nil
}
