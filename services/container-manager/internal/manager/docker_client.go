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
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
)

// Pull policy constants control when images are fetched from a registry.
const (
	PullPolicyAlways       = "always"
	PullPolicyIfNotPresent = "if-not-present"
	PullPolicyNever        = "never"
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

// UpdateContainerLabels applies label changes to a container. Docker does not
// natively support label updates on running containers. This implementation
// stops the container, commits a snapshot with the merged labels, removes the
// old container, and creates a replacement from the committed image — keeping
// the same name so the reconciler can track it.
//
// For the rolling-update drain use case this is best-effort — the platform
// drain API is the authoritative signal, and the reconciler tracks draining
// containers via heartbeat state.
func (d *RealDockerClient) UpdateContainerLabels(ctx context.Context, containerID string, labels map[string]string) error {
	inspect, err := d.cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return fmt.Errorf("inspect container %s for label update: %w", containerID, err)
	}

	for k, v := range labels {
		inspect.Config.Labels[k] = v
	}

	// Commit a snapshot that carries the updated labels in its config.
	commitResp, err := d.cli.ContainerCommit(ctx, containerID, container.CommitOptions{
		Config: inspect.Config,
	})
	if err != nil {
		return fmt.Errorf("commit container %s for label update: %w", containerID, err)
	}
	snapshotImage := commitResp.ID

	// Capture the original host config / networking before teardown.
	name := ""
	if len(inspect.Name) > 0 {
		name = strings.TrimPrefix(inspect.Name, "/")
	}

	// Tear down the old container.
	stopTimeout := 10
	_ = d.cli.ContainerStop(ctx, containerID, container.StopOptions{Timeout: &stopTimeout})
	_ = d.cli.ContainerRemove(ctx, containerID, container.RemoveOptions{Force: true})

	// Recreate with the same config but the snapshot image carrying new labels.
	cfg := inspect.Config
	cfg.Image = snapshotImage

	resp, err := d.cli.ContainerCreate(ctx, cfg, inspect.HostConfig, nil, nil, name)
	if err != nil {
		return fmt.Errorf("recreate container %s with updated labels: %w", name, err)
	}

	if startErr := d.cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); startErr != nil {
		return fmt.Errorf("start relabeled container %s: %w", name, startErr)
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

// PullImage pulls an image according to the specified pull policy.
// Supported policies: "always", "if-not-present", "never".
func (d *RealDockerClient) PullImage(ctx context.Context, ref, policy string) error {
	switch policy {
	case PullPolicyNever:
		return d.requireLocalImage(ctx, ref)
	case PullPolicyIfNotPresent:
		if d.imageExistsLocally(ctx, ref) {
			return nil
		}
		return d.pullFromRegistry(ctx, ref)
	case PullPolicyAlways, "":
		return d.pullFromRegistry(ctx, ref)
	default:
		return fmt.Errorf("unknown pull policy %q for image %s", policy, ref)
	}
}

// imageExistsLocally checks whether an image reference exists in the local store.
func (d *RealDockerClient) imageExistsLocally(ctx context.Context, ref string) bool {
	_, _, err := d.cli.ImageInspectWithRaw(ctx, ref)
	return err == nil
}

// requireLocalImage returns an error if the image is not available locally.
func (d *RealDockerClient) requireLocalImage(ctx context.Context, ref string) error {
	if d.imageExistsLocally(ctx, ref) {
		return nil
	}
	return fmt.Errorf("image %s not found locally and pull policy is %q", ref, PullPolicyNever)
}

// pullFromRegistry pulls an image from a remote registry and drains the
// progress stream to completion.
func (d *RealDockerClient) pullFromRegistry(ctx context.Context, ref string) error {
	reader, err := d.cli.ImagePull(ctx, ref, image.PullOptions{})
	if err != nil {
		return fmt.Errorf("pull image %s: %w", ref, err)
	}
	defer reader.Close()

	// Drain the pull progress stream — Docker requires reading to completion.
	if _, err := io.Copy(io.Discard, reader); err != nil {
		return fmt.Errorf("read pull progress for %s: %w", ref, err)
	}
	return nil
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
