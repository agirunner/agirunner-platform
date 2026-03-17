package main

import (
	"log/slog"
	"testing"
)

func TestParseIntWithAliasPrefersDesignName(t *testing.T) {
	t.Setenv("AGIRUNNER_TEST_VAR", "42")
	t.Setenv("TEST_VAR", "99")

	result := parseIntWithAlias("AGIRUNNER_TEST_VAR", "TEST_VAR", 0)
	if result != 42 {
		t.Errorf("expected 42 from primary, got %d", result)
	}
}

func TestParseIntWithAliasFallsBackToLegacy(t *testing.T) {
	t.Setenv("TEST_VAR_LEGACY", "77")

	result := parseIntWithAlias("AGIRUNNER_MISSING_VAR", "TEST_VAR_LEGACY", 0)
	if result != 77 {
		t.Errorf("expected 77 from fallback, got %d", result)
	}
}

func TestParseIntWithAliasFallsBackToDefault(t *testing.T) {
	result := parseIntWithAlias("AGIRUNNER_ABSENT_X", "ALSO_ABSENT_X", 55)
	if result != 55 {
		t.Errorf("expected default 55, got %d", result)
	}
}

func TestParseIntWithAliaPrimaryInvalid(t *testing.T) {
	t.Setenv("AGIRUNNER_BAD_INT", "not-a-number")
	t.Setenv("GOOD_INT", "10")

	result := parseIntWithAlias("AGIRUNNER_BAD_INT", "GOOD_INT", 0)
	if result != 10 {
		t.Errorf("expected 10 from fallback when primary invalid, got %d", result)
	}
}

func TestEnvWithAliasPrefersDesignName(t *testing.T) {
	t.Setenv("AGIRUNNER_TEST_STR", "primary")
	t.Setenv("TEST_STR", "fallback")

	result := envWithAlias("AGIRUNNER_TEST_STR", "TEST_STR", "default")
	if result != "primary" {
		t.Errorf("expected primary, got %s", result)
	}
}

func TestEnvWithAliasFallsBackToLegacy(t *testing.T) {
	t.Setenv("LEGACY_STR_X", "legacy")

	result := envWithAlias("AGIRUNNER_MISSING_STR_X", "LEGACY_STR_X", "default")
	if result != "legacy" {
		t.Errorf("expected legacy, got %s", result)
	}
}

func TestEnvWithAliasFallsBackToDefault(t *testing.T) {
	result := envWithAlias("AGIRUNNER_NOPE_X", "ALSO_NOPE_X", "fallback_default")
	if result != "fallback_default" {
		t.Errorf("expected fallback_default, got %s", result)
	}
}

func TestDefaultProcessLogLevelAlwaysUsesInfo(t *testing.T) {
	t.Setenv("LOG_LEVEL", "debug")

	if level := defaultProcessLogLevel(); level != slog.LevelInfo {
		t.Fatalf("expected slog.LevelInfo, got %v", level)
	}
}
