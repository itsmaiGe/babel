//go:build !windows

package ui

import "io/fs"

func Run(payload fs.FS, version string, err error) { panic("the Go installer UI runs on Windows") }
