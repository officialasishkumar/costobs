package main

import "fmt"

func errUnknownKind(kind string) error {
	return fmt.Errorf("unknown rule kind %q", kind)
}

func errMissingConfig(key string) error {
	return fmt.Errorf("missing required config field %q", key)
}

func errBadConfigType(key string) error {
	return fmt.Errorf("config field %q has wrong type (want number)", key)
}
