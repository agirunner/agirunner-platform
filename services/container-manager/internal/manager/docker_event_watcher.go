package manager

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
)

// crashLogTailLines controls how many log lines to capture from a crashed container.
const crashLogTailLines = "200"

// interestingContainerActions are the Docker container event actions we care about.
var interestingContainerActions = map[events.Action]string{
	events.ActionDie:     "docker.container.died",
	events.ActionOOM:     "docker.container.oom_killed",
	events.ActionKill:    "docker.container.killed",
	events.ActionStop:    "docker.container.stopped",
	events.ActionStart:   "docker.container.started",
	events.ActionRestart: "docker.container.restarted",
	events.ActionCreate:  "docker.container.created",
}

// interestingImageActions are Docker image event actions we log.
var interestingImageActions = map[events.Action]string{
	events.ActionPull: "docker.image.pulled",
}

// interestingNetworkActions are Docker network event actions we log.
var interestingNetworkActions = map[events.Action]string{
	events.ActionDisconnect: "docker.network.disconnected",
}

// healthStatusActions maps health_status variants to operations.
var healthStatusActions = map[events.Action]string{
	events.ActionHealthStatusUnhealthy: "docker.container.unhealthy",
	events.ActionHealthStatusHealthy:   "docker.container.healthy",
}

// DockerEventWatcher subscribes to the Docker events API and emits structured
// log entries for interesting container lifecycle events. It enriches entries
// with agirunner labels (playbook_id, runtime_id, task_id) when present.
type DockerEventWatcher struct {
	docker                 DockerClient
	emitter                *LogEmitter
	logger                 *slog.Logger
	configMu               sync.RWMutex
	reconnectBackoff       time.Duration
	crashLogCaptureTimeout time.Duration
}

// NewDockerEventWatcher creates a watcher that listens for Docker events and
// emits structured logs via the given LogEmitter.
func NewDockerEventWatcher(
	docker DockerClient,
	emitter *LogEmitter,
	logger *slog.Logger,
	reconnectBackoff time.Duration,
	crashLogCaptureTimeout time.Duration,
) *DockerEventWatcher {
	return &DockerEventWatcher{
		docker:                 docker,
		emitter:                emitter,
		logger:                 logger,
		reconnectBackoff:       reconnectBackoff,
		crashLogCaptureTimeout: crashLogCaptureTimeout,
	}
}

func (w *DockerEventWatcher) SetReconnectBackoff(backoff time.Duration) {
	if w == nil {
		return
	}
	w.configMu.Lock()
	defer w.configMu.Unlock()
	w.reconnectBackoff = backoff
}

func (w *DockerEventWatcher) SetCrashLogCaptureTimeout(timeout time.Duration) {
	if w == nil {
		return
	}
	w.configMu.Lock()
	defer w.configMu.Unlock()
	w.crashLogCaptureTimeout = timeout
}

func (w *DockerEventWatcher) currentReconnectBackoff() time.Duration {
	w.configMu.RLock()
	defer w.configMu.RUnlock()
	return w.reconnectBackoff
}

func (w *DockerEventWatcher) currentCrashLogCaptureTimeout() time.Duration {
	w.configMu.RLock()
	defer w.configMu.RUnlock()
	return w.crashLogCaptureTimeout
}

// Run subscribes to Docker events and processes them until ctx is cancelled.
// On stream errors it reconnects with a backoff delay.
func (w *DockerEventWatcher) Run(ctx context.Context) {
	w.logger.Info("docker event watcher started")
	for {
		w.watchOnce(ctx)
		select {
		case <-ctx.Done():
			w.logger.Info("docker event watcher stopped")
			return
		default:
			backoff := w.currentReconnectBackoff()
			w.logger.Warn("docker event stream disconnected, reconnecting", "backoff", backoff)
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				return
			}
		}
	}
}

// watchOnce subscribes to Docker events and processes them until the stream
// closes or an error occurs.
func (w *DockerEventWatcher) watchOnce(ctx context.Context) {
	msgCh, errCh := w.docker.Events(ctx, events.ListOptions{})
	for {
		select {
		case msg, ok := <-msgCh:
			if !ok {
				return
			}
			w.handleEvent(ctx, msg)
		case err, ok := <-errCh:
			if !ok || err == nil {
				return
			}
			if ctx.Err() != nil {
				return
			}
			w.logger.Warn("docker event stream error", "error", err)
			return
		}
	}
}

// handleEvent dispatches a Docker event to the appropriate handler.
func (w *DockerEventWatcher) handleEvent(ctx context.Context, msg events.Message) {
	switch msg.Type {
	case events.ContainerEventType:
		w.handleContainerEvent(ctx, msg)
	case events.ImageEventType:
		w.handleImageEvent(msg)
	case events.NetworkEventType:
		w.handleNetworkEvent(msg)
	}
}

// handleContainerEvent processes container lifecycle events.
func (w *DockerEventWatcher) handleContainerEvent(ctx context.Context, msg events.Message) {
	// Check health_status actions first (they have a prefix pattern).
	if operation, ok := healthStatusActions[msg.Action]; ok {
		if !isManagedContainer(msg.Actor.Attributes) {
			return
		}
		w.emitContainerLog(msg, operation, levelForContainerAction(msg.Action, msg.Actor.Attributes))
		return
	}

	operation, ok := interestingContainerActions[msg.Action]
	if !ok {
		return
	}

	if !isManagedContainer(msg.Actor.Attributes) {
		return
	}

	level := levelForContainerAction(msg.Action, msg.Actor.Attributes)
	w.emitContainerLog(msg, operation, level)

	// Capture crash logs only on unexpected exits (not clean shutdown or signal kills).
	if msg.Action == events.ActionDie && isUnexpectedExit(msg.Actor.Attributes["exitCode"]) {
		w.captureCrashLogs(ctx, msg)
	}
}

// handleImageEvent processes image lifecycle events.
func (w *DockerEventWatcher) handleImageEvent(msg events.Message) {
	operation, ok := interestingImageActions[msg.Action]
	if !ok {
		return
	}
	w.emitter.emitOperation("container", operation, "debug", "completed", map[string]any{
		"image":        msg.Actor.ID,
		"action":       string(msg.Action),
		"docker_event": true,
	})
}

// handleNetworkEvent processes network lifecycle events.
func (w *DockerEventWatcher) handleNetworkEvent(msg events.Message) {
	operation, ok := interestingNetworkActions[msg.Action]
	if !ok {
		return
	}
	attrs := msg.Actor.Attributes
	payload := map[string]any{
		"network_id":   msg.Actor.ID,
		"network_name": attrs["name"],
		"container_id": attrs["container"],
		"action":       string(msg.Action),
		"docker_event": true,
	}
	w.emitter.emitOperation("container", operation, "debug", "completed", payload)
}

// emitContainerLog emits a structured log entry for a container event,
// enriched with agirunner labels when present.
func (w *DockerEventWatcher) emitContainerLog(msg events.Message, operation, level string) {
	attrs := msg.Actor.Attributes
	payload := map[string]any{
		"container_id":   msg.Actor.ID,
		"container_name": attrs["name"],
		"image":          attrs["image"],
		"action":         string(msg.Action),
		"docker_event":   true,
	}

	// Include exit code for die events.
	if exitCode, ok := attrs["exitCode"]; ok {
		payload["exit_code"] = exitCode
	}

	// Include signal for kill events.
	if signal, ok := attrs["signal"]; ok {
		payload["signal"] = signal
	}

	res := extractResourceInfo(attrs)
	if res.ResourceID != "" {
		w.emitter.emitOperationWithResource("container", operation, level, "completed", payload, res)
	} else {
		w.emitter.emitOperation("container", operation, level, "completed", payload)
	}
}

// captureCrashLogs fetches the last N lines of logs from a dead container
// and emits them as a separate log entry.
func (w *DockerEventWatcher) captureCrashLogs(ctx context.Context, msg events.Message) {
	containerID := msg.Actor.ID

	logCtx, cancel := context.WithTimeout(ctx, w.currentCrashLogCaptureTimeout())
	defer cancel()

	reader, err := w.docker.ContainerLogs(logCtx, containerID, container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Tail:       crashLogTailLines,
		Timestamps: true,
	})
	if err != nil {
		w.logger.Debug("failed to capture crash logs", "container", containerID, "error", err)
		return
	}
	defer reader.Close()

	lines := readLogLines(reader)
	if len(lines) == 0 {
		return
	}

	attrs := msg.Actor.Attributes
	payload := map[string]any{
		"container_id":   containerID,
		"container_name": attrs["name"],
		"image":          attrs["image"],
		"log_lines":      lines,
		"line_count":     len(lines),
		"docker_event":   true,
	}

	if exitCode, ok := attrs["exitCode"]; ok {
		payload["exit_code"] = exitCode
	}

	res := extractResourceInfo(attrs)
	if res.ResourceID != "" {
		w.emitter.emitOperationWithResource("container", "docker.container.crash_logs", "warn", "completed", payload, res)
	} else {
		w.emitter.emitOperation("container", "docker.container.crash_logs", "warn", "completed", payload)
	}
}

// readLogLines reads all lines from the log reader, stripping Docker's
// multiplexed stream 8-byte frame headers. Each frame has:
// [stream_type, 0, 0, 0, size_byte1, size_byte2, size_byte3, size_byte4]
// followed by the payload. We use stdcopy-style reading: consume header,
// then read the payload. Falls back to line-by-line if the stream isn't
// multiplexed (e.g. TTY mode).
func readLogLines(r io.Reader) []string {
	var lines []string
	hdr := make([]byte, 8)

	for {
		// Try to read an 8-byte frame header.
		_, err := io.ReadFull(r, hdr)
		if err != nil {
			break
		}

		streamType := hdr[0]
		if streamType > 2 {
			// Not a multiplexed stream — treat the whole thing as plain text.
			// Reconstruct what we've read and scan line by line.
			combined := io.MultiReader(bytes.NewReader(hdr), r)
			return readPlainLines(combined)
		}

		// Parse payload size (big-endian uint32 in bytes 4-7).
		size := int(hdr[4])<<24 | int(hdr[5])<<16 | int(hdr[6])<<8 | int(hdr[7])
		if size <= 0 || size > 1<<20 {
			break
		}

		payload := make([]byte, size)
		_, err = io.ReadFull(r, payload)
		if err != nil {
			break
		}

		for _, line := range strings.Split(strings.TrimSpace(string(payload)), "\n") {
			line = strings.TrimSpace(line)
			if line != "" {
				lines = append(lines, line)
			}
		}
	}
	return lines
}

// readPlainLines reads lines from a non-multiplexed stream.
func readPlainLines(r io.Reader) []string {
	scanner := bufio.NewScanner(r)
	var lines []string
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

// isManagedContainer checks whether a container's attributes indicate it's
// managed by agirunner (either WDS or DCM).
func isManagedContainer(attrs map[string]string) bool {
	if attrs[labelManagedBy] == "true" {
		return true
	}
	if attrs[labelDCMManaged] == "true" {
		return true
	}
	return false
}

// extractResourceInfo pulls agirunner labels from container attributes
// to enrich log entries with resource context.
func extractResourceInfo(attrs map[string]string) logResourceInfo {
	res := logResourceInfo{}

	if runtimeID, ok := attrs[labelDCMRuntimeID]; ok && runtimeID != "" {
		res.ResourceType = "runtime"
		res.ResourceID = runtimeID
		res.ResourceName = attrs["name"]
	}

	if taskID, ok := attrs["agirunner.task_id"]; ok && taskID != "" {
		res.TaskID = taskID
	}

	if playbookID, ok := attrs[labelDCMPlaybookID]; ok && playbookID != "" {
		if res.ResourceType == "" {
			res.ResourceType = "playbook"
			res.ResourceID = playbookID
		}
	}

	return res
}

// isUnexpectedExit returns true if the exit code indicates a real crash
// (not a clean shutdown or signal-based kill from the reconciler).
func isUnexpectedExit(code string) bool {
	switch code {
	case "0", "137", "143":
		return false
	default:
		return true
	}
}

// levelForContainerAction returns the log level for a container event.
// Most container lifecycle events are routine operational telemetry (debug).
// Only OOM and unhealthy health checks are actionable (error/warn).
// Non-zero exits get warn since they may indicate problems worth investigating.
func levelForContainerAction(action events.Action, attrs map[string]string) string {
	switch action {
	case events.ActionOOM:
		return "error"
	case events.ActionHealthStatusUnhealthy:
		return "warn"
	case events.ActionDie:
		if attrs["exitCode"] == "0" {
			return "debug"
		}
		return "warn"
	case events.ActionKill:
		return "debug"
	default:
		return "debug"
	}
}

// shortID returns the first 12 characters of a container ID.
func shortID(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

// formatEventSummary creates a human-readable summary of a Docker event for logging.
func formatEventSummary(msg events.Message) string {
	name := msg.Actor.Attributes["name"]
	if name == "" {
		name = shortID(msg.Actor.ID)
	}
	return fmt.Sprintf("%s %s %s", msg.Type, msg.Action, name)
}
