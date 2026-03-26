package manager

import (
	"encoding/binary"
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

func TestParseProbeOutputStripsControlByteFraming(t *testing.T) {
	raw := appendDockerLogFrame(nil, "__AGIRUNNER_PRE_PROBE_BEGIN__\n")
	raw = appendDockerLogFrame(raw, "os_family=linux\n")
	raw = appendDockerLogFrame(raw, "verified_baseline_commands=sleep,sh,cat,mkdir,mv,chmod,rm,cp,find,sort,awk,sed,grep,head\n")
	raw = appendDockerLogFrame(raw, "git_present=false\n")
	raw = appendDockerLogFrame(raw, "__AGIRUNNER_PRE_PROBE_END__\n")
	raw = appendDockerLogFrame(raw, "__AGIRUNNER_POST_PROBE_BEGIN__\n")
	raw = appendDockerLogFrame(raw, "os_family=linux\n")
	raw = appendDockerLogFrame(raw, "verified_baseline_commands=sleep,sh,cat,mkdir,mv,chmod,rm,cp,find,sort,awk,sed,grep,head\n")
	raw = appendDockerLogFrame(raw, "docker_cli_present=false\n")
	raw = appendDockerLogFrame(raw, "__AGIRUNNER_POST_PROBE_END__\n")

	parsed := parseProbeOutput(raw)

	if parsed.Pre["os_family"] != "linux" {
		t.Fatalf("expected pre-probe os_family to parse, got %q", parsed.Pre["os_family"])
	}
	if parsed.Post["os_family"] != "linux" {
		t.Fatalf("expected post-probe os_family to parse, got %q", parsed.Post["os_family"])
	}
	if parsed.Post["docker_cli_present"] != "false" {
		t.Fatalf("expected post-probe docker_cli_present to parse, got %q", parsed.Post["docker_cli_present"])
	}
	if parsed.Post["verified_baseline_commands"] != "sleep,sh,cat,mkdir,mv,chmod,rm,cp,find,sort,awk,sed,grep,head" {
		t.Fatalf(
			"expected verified_baseline_commands to parse, got %q",
			parsed.Post["verified_baseline_commands"],
		)
	}
}

func appendDockerLogFrame(raw []byte, line string) []byte {
	header := make([]byte, 8)
	header[0] = 1
	binary.BigEndian.PutUint32(header[4:], uint32(len(line)))
	raw = append(raw, header...)
	raw = append(raw, []byte(line)...)
	return raw
}
