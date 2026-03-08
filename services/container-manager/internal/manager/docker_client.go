package manager

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
)

// RealDockerClient implements DockerClient using the Docker Engine API
// via a socket proxy.
type RealDockerClient struct {
	cli *client.Client
}

// NewRealDockerClient creates a DockerClient that connects to the Docker
// daemon at the given host URL (e.g. tcp://socket-proxy:2375).
func NewRealDockerClient(host string) (*RealDockerClient, error) {
	cli, err := client.NewClientWithOpts(
		client.WithHost(host),
		client.WithAPIVersionNegotiation(),
	)
	if err != nil {
		return nil, fmt.Errorf("create docker client: %w", err)
	}
	return &RealDockerClient{cli: cli}, nil
}

// ListContainers returns all containers managed by the container manager.
func (d *RealDockerClient) ListContainers(ctx context.Context) ([]ContainerInfo, error) {
	f := filters.NewArgs()
	f.Add("label", labelManagedBy)

	containers, err := d.cli.ContainerList(ctx, container.ListOptions{
		All:     true,
		Filters: f,
	})
	if err != nil {
		return nil, fmt.Errorf("docker container list: %w", err)
	}

	result := make([]ContainerInfo, 0, len(containers))
	for _, c := range containers {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		result = append(result, ContainerInfo{
			ID:     c.ID,
			Name:   name,
			Image:  c.Image,
			Status: c.Status,
			Labels: c.Labels,
		})
	}
	return result, nil
}

// CreateContainer creates and starts a container from the given spec.
func (d *RealDockerClient) CreateContainer(ctx context.Context, spec ContainerSpec) (string, error) {
	env := make([]string, 0, len(spec.Environment))
	for k, v := range spec.Environment {
		env = append(env, k+"="+v)
	}

	cfg := &container.Config{
		Image:  spec.Image,
		Env:    env,
		Labels: spec.Labels,
	}

	hostCfg := &container.HostConfig{
		Resources: container.Resources{
			NanoCPUs: parseCPULimit(spec.CPULimit),
			Memory:   parseMemoryLimit(spec.MemoryLimit),
		},
	}

	var netCfg *network.NetworkingConfig
	if spec.NetworkName != "" {
		netCfg = &network.NetworkingConfig{
			EndpointsConfig: map[string]*network.EndpointSettings{
				spec.NetworkName: {},
			},
		}
	}

	resp, err := d.cli.ContainerCreate(ctx, cfg, hostCfg, netCfg, nil, spec.Name)
	if err != nil {
		return "", fmt.Errorf("docker create container %q: %w", spec.Name, err)
	}

	if err := d.cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		return resp.ID, fmt.Errorf("docker start container %q: %w", spec.Name, err)
	}

	return resp.ID, nil
}

// StopContainer gracefully stops a container with the given timeout.
func (d *RealDockerClient) StopContainer(ctx context.Context, containerID string, timeout time.Duration) error {
	timeoutSeconds := int(timeout.Seconds())
	err := d.cli.ContainerStop(ctx, containerID, container.StopOptions{
		Timeout: &timeoutSeconds,
	})
	if err != nil {
		return fmt.Errorf("docker stop container %s: %w", containerID, err)
	}
	return nil
}

// RemoveContainer forcefully removes a container.
func (d *RealDockerClient) RemoveContainer(ctx context.Context, containerID string) error {
	err := d.cli.ContainerRemove(ctx, containerID, container.RemoveOptions{
		Force: true,
	})
	if err != nil {
		return fmt.Errorf("docker remove container %s: %w", containerID, err)
	}
	return nil
}

// ListImages returns all available Docker images.
func (d *RealDockerClient) ListImages(ctx context.Context) ([]ContainerImage, error) {
	images, err := d.cli.ImageList(ctx, image.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("docker image list: %w", err)
	}

	var result []ContainerImage
	for _, img := range images {
		for _, repoTag := range img.RepoTags {
			repo, tag := parseRepoTag(repoTag)
			size := img.Size
			ci := ContainerImage{
				Repository: repo,
				Tag:        &tag,
				SizeBytes:  &size,
			}
			if len(img.RepoDigests) > 0 {
				digest := img.RepoDigests[0]
				ci.Digest = &digest
			}
			result = append(result, ci)
		}
	}
	return result, nil
}

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

// parseMemoryLimit converts a memory limit string (e.g. "512m", "1g", "1073741824")
// to bytes.
func parseMemoryLimit(limit string) int64 {
	if limit == "" {
		return 0
	}
	limit = strings.TrimSpace(strings.ToLower(limit))

	multiplier := int64(1)
	if strings.HasSuffix(limit, "g") {
		multiplier = 1024 * 1024 * 1024
		limit = strings.TrimSuffix(limit, "g")
	} else if strings.HasSuffix(limit, "m") {
		multiplier = 1024 * 1024
		limit = strings.TrimSuffix(limit, "m")
	} else if strings.HasSuffix(limit, "k") {
		multiplier = 1024
		limit = strings.TrimSuffix(limit, "k")
	}

	val, err := strconv.ParseFloat(limit, 64)
	if err != nil {
		return 0
	}
	return int64(val * float64(multiplier))
}

// parseRepoTag splits a "repository:tag" string into its parts.
func parseRepoTag(repoTag string) (string, string) {
	lastColon := strings.LastIndex(repoTag, ":")
	if lastColon < 0 {
		return repoTag, "latest"
	}
	return repoTag[:lastColon], repoTag[lastColon+1:]
}
