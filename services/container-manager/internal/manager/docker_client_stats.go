package manager

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
)

// GetContainerStats retrieves a single stats snapshot for the container.
func (d *RealDockerClient) GetContainerStats(ctx context.Context, containerID string) (*ContainerStats, error) {
	resp, err := d.cli.ContainerStatsOneShot(ctx, containerID)
	if err != nil {
		return nil, fmt.Errorf("docker stats %s: %w", containerID, err)
	}
	defer resp.Body.Close()

	var stats container.StatsResponse
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		return nil, fmt.Errorf("decode docker stats %s: %w", containerID, err)
	}

	cpuPercent := calculateCPUPercent(stats)
	rxBytes, txBytes := aggregateNetworkBytes(stats)

	return &ContainerStats{
		CPUPercent:  cpuPercent,
		MemoryBytes: stats.MemoryStats.Usage,
		RxBytes:     rxBytes,
		TxBytes:     txBytes,
	}, nil
}

// ConnectNetwork attaches a running container to an additional Docker network.
func (d *RealDockerClient) ConnectNetwork(ctx context.Context, containerID, networkName string) error {
	if networkName == "" {
		return nil
	}
	err := d.cli.NetworkConnect(ctx, networkName, containerID, nil)
	if err != nil {
		return fmt.Errorf("connect container %s to network %s: %w", containerID, networkName, err)
	}
	return nil
}

// Events subscribes to the Docker events stream.
func (d *RealDockerClient) Events(ctx context.Context, options events.ListOptions) (<-chan events.Message, <-chan error) {
	return d.cli.Events(ctx, options)
}

// ContainerLogs returns the logs from a container.
func (d *RealDockerClient) ContainerLogs(ctx context.Context, containerID string, options container.LogsOptions) (io.ReadCloser, error) {
	return d.cli.ContainerLogs(ctx, containerID, options)
}

// InspectContainerHealth returns the Docker HEALTHCHECK status of a container.
func (d *RealDockerClient) InspectContainerHealth(ctx context.Context, containerID string) (*ContainerHealthStatus, error) {
	info, err := d.cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return nil, fmt.Errorf("docker inspect container %s: %w", containerID, err)
	}
	status := ""
	if info.State != nil && info.State.Health != nil {
		status = info.State.Health.Status
	}
	return &ContainerHealthStatus{Status: status}, nil
}

// calculateCPUPercent computes CPU usage percentage from a stats snapshot.
func calculateCPUPercent(stats container.StatsResponse) float64 {
	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage) - float64(stats.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(stats.CPUStats.SystemUsage) - float64(stats.PreCPUStats.SystemUsage)

	if systemDelta <= 0 || cpuDelta < 0 {
		return 0
	}

	onlineCPUs := float64(stats.CPUStats.OnlineCPUs)
	if onlineCPUs == 0 {
		onlineCPUs = 1
	}

	return (cpuDelta / systemDelta) * onlineCPUs * 100.0
}

// aggregateNetworkBytes sums rx/tx bytes across all network interfaces.
func aggregateNetworkBytes(stats container.StatsResponse) (uint64, uint64) {
	var rx, tx uint64
	for _, netStats := range stats.Networks {
		rx += netStats.RxBytes
		tx += netStats.TxBytes
	}
	return rx, tx
}

// parseCPULimit converts a CPU limit string (e.g. "0.5", "2") to NanoCPUs.
func parseCPULimit(limit string) int64 {
	if limit == "" {
		return 0
	}
	val, err := strconv.ParseFloat(limit, 64)
	if err != nil {
		return 0
	}
	return int64(val * 1e9)
}

func clampCPULimitToHost(requestedNanoCPUs int64, hostCPUCount int64) int64 {
	if requestedNanoCPUs <= 0 || hostCPUCount <= 0 {
		return requestedNanoCPUs
	}
	hostNanoCPUs := hostCPUCount * 1e9
	if requestedNanoCPUs > hostNanoCPUs {
		return hostNanoCPUs
	}
	return requestedNanoCPUs
}

func (d *RealDockerClient) hostCPUCount(ctx context.Context) int64 {
	info, err := d.cli.Info(ctx)
	if err != nil {
		return 0
	}
	if info.NCPU <= 0 {
		return 0
	}
	return int64(info.NCPU)
}

// parseMemoryLimit converts a memory limit string (e.g. "512m", "1g", "1073741824")
// to bytes.
func parseMemoryLimit(limit string) int64 {
	if limit == "" {
		return 0
	}
	limit = strings.TrimSpace(strings.ToLower(limit))

	multiplier := int64(1)
	for _, suffix := range []struct {
		unit       string
		multiplier int64
	}{
		{unit: "tib", multiplier: 1024 * 1024 * 1024 * 1024},
		{unit: "ti", multiplier: 1024 * 1024 * 1024 * 1024},
		{unit: "tb", multiplier: 1024 * 1024 * 1024 * 1024},
		{unit: "t", multiplier: 1024 * 1024 * 1024 * 1024},
		{unit: "gib", multiplier: 1024 * 1024 * 1024},
		{unit: "gi", multiplier: 1024 * 1024 * 1024},
		{unit: "gb", multiplier: 1024 * 1024 * 1024},
		{unit: "g", multiplier: 1024 * 1024 * 1024},
		{unit: "mib", multiplier: 1024 * 1024},
		{unit: "mi", multiplier: 1024 * 1024},
		{unit: "mb", multiplier: 1024 * 1024},
		{unit: "m", multiplier: 1024 * 1024},
		{unit: "kib", multiplier: 1024},
		{unit: "ki", multiplier: 1024},
		{unit: "kb", multiplier: 1024},
		{unit: "k", multiplier: 1024},
	} {
		if strings.HasSuffix(limit, suffix.unit) {
			multiplier = suffix.multiplier
			limit = strings.TrimSuffix(limit, suffix.unit)
			break
		}
	}

	val, err := strconv.ParseFloat(limit, 64)
	if err != nil {
		return 0
	}
	return int64(val * float64(multiplier))
}

func formatNanoCPULimit(limit int64) string {
	if limit <= 0 {
		return ""
	}
	cpuUnits := float64(limit) / 1e9
	formatted := strconv.FormatFloat(cpuUnits, 'f', 3, 64)
	formatted = strings.TrimRight(strings.TrimRight(formatted, "0"), ".")
	if formatted == "" {
		return ""
	}
	return formatted
}

func formatMemoryByteLimit(limit int64) string {
	if limit <= 0 {
		return ""
	}
	type unit struct {
		suffix string
		value  int64
	}
	for _, candidate := range []unit{
		{suffix: "g", value: 1024 * 1024 * 1024},
		{suffix: "m", value: 1024 * 1024},
		{suffix: "k", value: 1024},
	} {
		if limit%candidate.value == 0 {
			return strconv.FormatInt(limit/candidate.value, 10) + candidate.suffix
		}
	}
	return strconv.FormatInt(limit, 10) + "b"
}

func parseDockerStartedAt(value string) time.Time {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || trimmed == "0001-01-01T00:00:00Z" {
		return time.Time{}
	}
	startedAt, err := time.Parse(time.RFC3339Nano, trimmed)
	if err != nil {
		return time.Time{}
	}
	return startedAt.UTC()
}

// parseRepoTag splits a "repository:tag" string into its parts.
func parseRepoTag(repoTag string) (string, string) {
	lastColon := strings.LastIndex(repoTag, ":")
	if lastColon < 0 {
		return repoTag, "latest"
	}
	return repoTag[:lastColon], repoTag[lastColon+1:]
}
