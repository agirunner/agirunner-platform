package manager

import (
	"reflect"
	"slices"
	"testing"
)

func TestRequiredExecutionEnvironmentCommandsMatchRuntimePostBootstrapContract(t *testing.T) {
	expected := []string{
		"sleep",
		"sh",
		"cat",
		"mkdir",
		"mv",
		"chmod",
		"rm",
		"cp",
		"find",
		"sort",
		"awk",
		"sed",
		"grep",
		"head",
	}

	if !reflect.DeepEqual(expected, requiredExecutionEnvironmentCommands) {
		t.Fatalf("requiredExecutionEnvironmentCommands mismatch: got %v want %v", requiredExecutionEnvironmentCommands, expected)
	}
}

func TestBuildProbeCompatibilityErrorsReportsRuntimeContractCommands(t *testing.T) {
	errors := buildProbeCompatibilityErrors(0, executionEnvironmentProbePhases{
		Pre: map[string]string{
			"verified_baseline_commands": "sleep,sh,cat,mkdir,mv,chmod,rm,cp",
		},
		Post: map[string]string{
			"verified_baseline_commands": "sleep,sh,cat,mkdir,mv,chmod,rm,cp,find,sort,awk,sed,grep",
		},
	})

	if !slices.Contains(errors, "missing required baseline command: head") {
		t.Fatalf("expected missing head error, got %v", errors)
	}
}
