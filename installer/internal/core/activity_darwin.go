//go:build darwin

package core

/*
#include <libproc.h>
#include <stdlib.h>
#include <sys/types.h>
*/
import "C"
import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"unsafe"
)

var errProcessList = errors.New("process list failed")

func platformActivity(base string) (bool, bool) {
	app, ok := darwinChannel(base)
	if !ok {
		return false, false
	}
	running, err := processRunning(app)
	if err != nil {
		return true, true
	}
	return true, running
}

func darwinChannel(base string) (string, bool) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", false
	}
	selected, err := os.Stat(base)
	if err != nil {
		return "", false
	}
	channels := []struct{ dir, app string }{
		{"discord", "Discord"},
		{"discordptb", "Discord PTB"},
		{"discordcanary", "Discord Canary"},
		{"discorddevelopment", "Discord Development"},
	}
	for _, channel := range channels {
		info, statErr := os.Stat(filepath.Join(home, "Library", "Application Support", channel.dir))
		if statErr == nil && os.SameFile(selected, info) {
			return channel.app, true
		}
	}
	return "", false
}

func processRunning(name string) (bool, error) {
	// proc_listallpids returns a pid count. Its buffer argument is a byte size.
	count := C.proc_listallpids(nil, 0)
	if count <= 0 {
		return false, errProcessList
	}
	capacity := count + 64
	bytes := capacity * C.int(unsafe.Sizeof(C.pid_t(0)))
	buf := C.malloc(C.size_t(bytes))
	if buf == nil {
		return false, errProcessList
	}
	defer C.free(buf)
	got := C.proc_listallpids(buf, bytes)
	if got <= 0 || got >= capacity {
		return false, errProcessList
	}
	pids := unsafe.Slice((*C.pid_t)(buf), int(got))
	needle := "/" + name + ".app/"
	for _, pid := range pids {
		var path [4096]C.char
		n := C.proc_pidpath(C.int(pid), unsafe.Pointer(&path[0]), 4096)
		if n <= 0 {
			continue
		}
		text := C.GoStringN(&path[0], n)
		if filepath.Base(text) == name || strings.Contains(text, needle) {
			return true, nil
		}
	}
	return false, nil
}
