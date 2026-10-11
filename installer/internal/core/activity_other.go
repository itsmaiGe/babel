//go:build !darwin && !windows

package core

func platformActivity(string) (bool, bool) { return false, false }
