package manager

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"
	"unicode"

	dockercontainer "github.com/docker/docker/api/types/container"
)

var requiredExecutionEnvironmentCommands = []string{
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

var preBootstrapExecutionEnvironmentCommands = []string{
	"sleep",
	"sh",
	"cat",
	"mkdir",
	"mv",
	"chmod",
	"rm",
	"cp",
}

type ExecutionEnvironmentVerifyRequest struct {
	Image                    string   `json:"image"`
	CPU                      string   `json:"cpu"`
	Memory                   string   `json:"memory"`
	PullPolicy               string   `json:"pullPolicy"`
	BootstrapCommands        []string `json:"bootstrapCommands"`
	BootstrapRequiredDomains []string `json:"bootstrapRequiredDomains"`
}

type ExecutionEnvironmentVerifyResponse struct {
	CompatibilityStatus         string         `json:"compatibility_status"`
	CompatibilityErrors         []string       `json:"compatibility_errors"`
	VerificationContractVersion string         `json:"verification_contract_version"`
	VerifiedMetadata            map[string]any `json:"verified_metadata"`
	ToolCapabilities            map[string]any `json:"tool_capabilities"`
	ProbeOutput                 map[string]any `json:"probe_output"`
}

func VerifyExecutionEnvironment(
	ctx context.Context,
	dockerHost string,
	input ExecutionEnvironmentVerifyRequest,
) (*ExecutionEnvironmentVerifyResponse, error) {
	docker, err := NewRealDockerClient(strings.TrimSpace(dockerHost))
	if err != nil {
		return nil, fmt.Errorf("create docker client: %w", err)
	}

	if err := docker.PullImage(ctx, strings.TrimSpace(input.Image), normalizeVerifyPullPolicy(input.PullPolicy)); err != nil {
		return buildIncompatibleVerification(
			input,
			map[string]any{
				"step":  "pull_image",
				"error": err.Error(),
			},
			fmt.Sprintf("failed to pull image: %v", err),
		), nil
	}

	containerName := fmt.Sprintf(
		"agirunner-execution-environment-verify-%d",
		time.Now().UTC().UnixNano(),
	)
	script := buildExecutionEnvironmentProbeScript(input.BootstrapCommands)
	resp, err := docker.cli.ContainerCreate(
		ctx,
		&dockercontainer.Config{
			Image: strings.TrimSpace(input.Image),
			Cmd:   []string{"sh", "-lc", script},
		},
		&dockercontainer.HostConfig{
			Resources: dockercontainer.Resources{
				NanoCPUs: parseCPULimit(strings.TrimSpace(input.CPU)),
				Memory:   parseMemoryLimit(strings.TrimSpace(input.Memory)),
			},
		},
		nil,
		nil,
		containerName,
	)
	if err != nil {
		return buildIncompatibleVerification(
			input,
			map[string]any{
				"step":  "create_container",
				"error": err.Error(),
			},
			fmt.Sprintf("failed to create probe container: %v", err),
		), nil
	}

	defer func() {
		removeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = docker.RemoveContainer(removeCtx, resp.ID)
	}()

	if err := docker.cli.ContainerStart(ctx, resp.ID, dockercontainer.StartOptions{}); err != nil {
		return buildIncompatibleVerification(
			input,
			map[string]any{
				"step":         "start_container",
				"container_id": resp.ID,
				"error":        err.Error(),
			},
			fmt.Sprintf("failed to start probe container: %v", err),
		), nil
	}

	statusCh, errCh := docker.cli.ContainerWait(ctx, resp.ID, dockercontainer.WaitConditionNotRunning)
	var exitCode int64
	select {
	case err := <-errCh:
		if err != nil {
			return buildIncompatibleVerification(
				input,
				map[string]any{
					"step":         "wait_container",
					"container_id": resp.ID,
					"error":        err.Error(),
				},
				fmt.Sprintf("failed while waiting for probe container: %s", err.Error()),
			), nil
		}
	case status := <-statusCh:
		exitCode = status.StatusCode
	}

	logsReader, err := docker.ContainerLogs(ctx, resp.ID, dockercontainer.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
	})
	if err != nil {
		return buildIncompatibleVerification(
			input,
			map[string]any{
				"step":         "read_logs",
				"container_id": resp.ID,
				"exit_code":    exitCode,
				"error":        err.Error(),
			},
			fmt.Sprintf("failed to read probe logs: %v", err),
		), nil
	}
	defer logsReader.Close()

	rawLogs, err := io.ReadAll(logsReader)
	if err != nil {
		return buildIncompatibleVerification(
			input,
			map[string]any{
				"step":         "read_logs",
				"container_id": resp.ID,
				"exit_code":    exitCode,
				"error":        err.Error(),
			},
			fmt.Sprintf("failed to read probe output: %v", err),
		), nil
	}

	plainProbeOutput := buildPlainProbeOutput(rawLogs)
	parsedProbes := parseProbeOutput([]byte(plainProbeOutput))
	finalProbe := selectFinalProbe(parsedProbes)
	compatibilityErrors := buildProbeCompatibilityErrors(exitCode, parsedProbes)
	verifiedMetadata := map[string]any{
		"os_family":         readProbeString(finalProbe, "os_family"),
		"distro":            readProbeString(finalProbe, "distro"),
		"distro_version":    readProbeString(finalProbe, "distro_version"),
		"package_manager":   readProbeString(finalProbe, "package_manager"),
		"shell":             readProbeString(finalProbe, "shell"),
		"detected_runtimes": splitCSV(readProbeString(finalProbe, "detected_runtimes")),
		"image_ref":         strings.TrimSpace(input.Image),
	}
	toolCapabilities := map[string]any{
		"verified_baseline_commands": splitCSV(readProbeString(finalProbe, "verified_baseline_commands")),
		"git_present":                readProbeBool(finalProbe, "git_present"),
		"docker_cli_present":         readProbeBool(finalProbe, "docker_cli_present"),
		"shell_glob":                 readProbeBool(finalProbe, "shell_glob"),
		"shell_pipe":                 true,
		"shell_redirect":             true,
	}
	compatibilityStatus := "compatible"
	if len(compatibilityErrors) > 0 {
		compatibilityStatus = "incompatible"
	}

	return &ExecutionEnvironmentVerifyResponse{
		CompatibilityStatus:         compatibilityStatus,
		CompatibilityErrors:         compatibilityErrors,
		VerificationContractVersion: "v1",
		VerifiedMetadata:            verifiedMetadata,
		ToolCapabilities:            toolCapabilities,
		ProbeOutput: map[string]any{
			"container_id": resp.ID,
			"exit_code":    exitCode,
			"raw_output":   plainProbeOutput,
			"parsed":       finalProbe,
			"pre_probe":    parsedProbes.Pre,
			"post_probe":   parsedProbes.Post,
		},
	}, nil
}

func buildPlainProbeOutput(raw []byte) string {
	lines := readLogLines(bytes.NewReader(raw))
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n") + "\n"
}

func buildExecutionEnvironmentProbeScript(bootstrapCommands []string) string {
	var builder strings.Builder
	builder.WriteString("set -eu\n")
	builder.WriteString(`
append_csv() {
  current="$1"
  next="$2"
  if [ -z "$next" ]; then
    printf '%s' "$current"
    return
  fi
  if [ -z "$current" ]; then
    printf '%s' "$next"
    return
  fi
  printf '%s,%s' "$current" "$next"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

emit_probe() {
  phase="$1"
  verified_baseline_commands=""
  for candidate in sleep sh cat mkdir mv chmod rm cp find sort awk sed grep head; do
    if has_cmd "$candidate"; then
      verified_baseline_commands=$(append_csv "$verified_baseline_commands" "$candidate")
    fi
  done

  detected_runtimes=""
  for runtime in python3 python node go rustc cargo java php docker git; do
    if has_cmd "$runtime"; then
      case "$runtime" in
        python3|python) detected_runtimes=$(append_csv "$detected_runtimes" "python") ;;
        rustc|cargo) detected_runtimes=$(append_csv "$detected_runtimes" "rust") ;;
        docker|git) : ;;
        *) detected_runtimes=$(append_csv "$detected_runtimes" "$runtime") ;;
      esac
    fi
  done

  package_manager=""
  for manager in apt-get apk dnf microdnf yum; do
    if has_cmd "$manager"; then
      package_manager="$manager"
      break
    fi
  done

  shell_glob=false
  set -- /bin/*
  if [ "${1:-/bin/*}" != '/bin/*' ]; then
    shell_glob=true
  fi

  os_family=linux
  distro=unknown
  distro_version=
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    distro="${ID:-unknown}"
    distro_version="${VERSION_ID:-}"
  fi

  printf '__AGIRUNNER_%s_PROBE_BEGIN__\n' "$phase"
  printf 'os_family=%s\n' "$os_family"
  printf 'distro=%s\n' "$distro"
  printf 'distro_version=%s\n' "$distro_version"
  printf 'package_manager=%s\n' "$package_manager"
  printf 'shell=%s\n' "$(command -v sh || true)"
  printf 'detected_runtimes=%s\n' "$detected_runtimes"
  printf 'verified_baseline_commands=%s\n' "$verified_baseline_commands"
  printf 'git_present=%s\n' "$(has_cmd git && printf true || printf false)"
  printf 'docker_cli_present=%s\n' "$(has_cmd docker && printf true || printf false)"
  printf 'shell_glob=%s\n' "$shell_glob"
  printf '__AGIRUNNER_%s_PROBE_END__\n' "$phase"
}

emit_probe PRE
`)
	for _, command := range bootstrapCommands {
		trimmed := strings.TrimSpace(command)
		if trimmed == "" {
			continue
		}
		builder.WriteString(trimmed)
		builder.WriteString("\n")
	}
	builder.WriteString(`
emit_probe POST
`)
	return builder.String()
}

type executionEnvironmentProbePhases struct {
	Pre  map[string]string
	Post map[string]string
}

func parseProbeOutput(raw []byte) executionEnvironmentProbePhases {
	lines := readLogLines(bytes.NewReader(raw))
	result := executionEnvironmentProbePhases{
		Pre:  map[string]string{},
		Post: map[string]string{},
	}
	phase := ""
	for _, rawLine := range lines {
		line := sanitizeProbeLine(rawLine)
		switch line {
		case "__AGIRUNNER_PRE_PROBE_BEGIN__":
			phase = "pre"
			continue
		case "__AGIRUNNER_PRE_PROBE_END__":
			phase = ""
			continue
		case "__AGIRUNNER_POST_PROBE_BEGIN__":
			phase = "post"
			continue
		case "__AGIRUNNER_POST_PROBE_END__":
			phase = ""
			continue
		}
		if phase == "" {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		target := result.Pre
		if phase == "post" {
			target = result.Post
		}
		target[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	return result
}

func sanitizeProbeLine(raw string) string {
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, raw))
}

func buildProbeCompatibilityErrors(exitCode int64, parsed executionEnvironmentProbePhases) []string {
	var errors []string
	if exitCode != 0 {
		errors = append(errors, fmt.Sprintf("probe exited with code %d", exitCode))
	}
	if len(parsed.Pre) == 0 {
		errors = append(errors, "pre-bootstrap probe output missing")
	} else {
		errors = appendMissingProbeCommands(errors, parsed.Pre, preBootstrapExecutionEnvironmentCommands)
	}
	if len(parsed.Post) == 0 {
		errors = append(errors, "post-bootstrap probe output missing")
	} else {
		errors = appendMissingProbeCommands(errors, parsed.Post, requiredExecutionEnvironmentCommands)
	}
	return errors
}

func appendMissingProbeCommands(
	errors []string,
	parsed map[string]string,
	requiredCommands []string,
) []string {
	verifiedCommands := splitCSV(parsed["verified_baseline_commands"])
	for _, command := range requiredCommands {
		if !slices.Contains(verifiedCommands, command) {
			errors = append(errors, fmt.Sprintf("missing required baseline command: %s", command))
		}
	}
	return errors
}

func selectFinalProbe(parsed executionEnvironmentProbePhases) map[string]string {
	if len(parsed.Post) > 0 {
		return parsed.Post
	}
	return parsed.Pre
}

func buildIncompatibleVerification(
	input ExecutionEnvironmentVerifyRequest,
	probeOutput map[string]any,
	errors ...string,
) *ExecutionEnvironmentVerifyResponse {
	return &ExecutionEnvironmentVerifyResponse{
		CompatibilityStatus:         "incompatible",
		CompatibilityErrors:         errors,
		VerificationContractVersion: "v1",
		VerifiedMetadata: map[string]any{
			"image_ref": strings.TrimSpace(input.Image),
		},
		ToolCapabilities: map[string]any{
			"verified_baseline_commands": []string{},
			"shell_glob":                 false,
		},
		ProbeOutput: probeOutput,
	}
}

func normalizeVerifyPullPolicy(value string) string {
	switch strings.TrimSpace(value) {
	case PullPolicyAlways:
		return PullPolicyAlways
	case PullPolicyNever:
		return PullPolicyNever
	default:
		return PullPolicyIfNotPresent
	}
}

func readProbeString(values map[string]string, key string) string {
	return strings.TrimSpace(values[key])
}

func readProbeBool(values map[string]string, key string) bool {
	return strings.EqualFold(strings.TrimSpace(values[key]), "true")
}

func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return []string{}
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" || slices.Contains(result, trimmed) {
			continue
		}
		result = append(result, trimmed)
	}
	return result
}
