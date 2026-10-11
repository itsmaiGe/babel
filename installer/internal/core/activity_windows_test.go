//go:build windows

package core

import (
	"errors"
	"testing"

	"golang.org/x/sys/windows"
)

func TestProcessWalkTreatsOnlyNoMoreFilesAsExhaustion(t *testing.T) {
	running, err := walkProcesses(func() error { return windows.ERROR_NO_MORE_FILES }, nil, nil)
	if err != nil || running {
		t.Fatalf("empty snapshot = %v, %v", running, err)
	}
	if _, err = walkProcesses(func() error { return windows.ERROR_ACCESS_DENIED }, nil, nil); !errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		t.Fatalf("Process32First error = %v", err)
	}
	nextCalls := 0
	running, err = walkProcesses(
		func() error { return nil },
		func() error {
			nextCalls++
			return windows.ERROR_INVALID_HANDLE
		},
		func() (bool, error) { return false, nil },
	)
	if !errors.Is(err, windows.ERROR_INVALID_HANDLE) || nextCalls != 1 {
		t.Fatalf("Process32Next error = %v after %d calls", err, nextCalls)
	}
	running, err = walkProcesses(
		func() error { return nil },
		func() error { return windows.ERROR_NO_MORE_FILES },
		func() (bool, error) { return false, nil },
	)
	if err != nil || running {
		t.Fatalf("exhausted snapshot = %v, %v", running, err)
	}
	advanced := false
	running, err = walkProcesses(
		func() error { return nil },
		func() error { advanced = true; return nil },
		func() (bool, error) { return true, nil },
	)
	if err != nil || !running || advanced {
		t.Fatalf("matched process = %v, %v, advanced %v", running, err, advanced)
	}
	if _, err = walkProcesses(
		func() error { return nil },
		func() error { t.Fatal("next after observation error"); return nil },
		func() (bool, error) { return false, windows.ERROR_ACCESS_DENIED },
	); !errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		t.Fatalf("observation error = %v", err)
	}
}

func TestQueryErrorRetainsDiscordCandidatesOnly(t *testing.T) {
	for _, name := range []string{"Discord.exe", "discordptb.exe", "DiscordCanary.EXE", "DiscordDevelopment.exe"} {
		if err := retainQueryError(name, windows.ERROR_ACCESS_DENIED); !errors.Is(err, windows.ERROR_ACCESS_DENIED) {
			t.Fatalf("%s query error = %v", name, err)
		}
	}
	for _, name := range []string{"csrss.exe", "svchost.exe", "System", "smss.exe", ""} {
		if err := retainQueryError(name, windows.ERROR_ACCESS_DENIED); err != nil {
			t.Fatalf("%s should not retain, got %v", name, err)
		}
	}
	if err := retainQueryError("Discord.exe", nil); err != nil {
		t.Fatalf("successful query = %v", err)
	}
}
