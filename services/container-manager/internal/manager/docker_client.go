package manager

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
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

// ListContainers returns all agirunner-managed containers visible to the
// manager. Callers decide which subset matters for their workflow.
func (d *RealDockerClient) ListContainers(ctx context.Context) ([]ContainerInfo, error) {
	containers, err := d.cli.ContainerList(ctx, container.ListOptions{
		All: true,
	})
	if err != nil {
		return nil, fmt.Errorf("docker container list: %w", err)
	}

	result := make([]ContainerInfo, 0, len(containers))
	for _, c := range containers {
		if !isAgirunnerManagedContainer(c.Labels) {
			continue
		}
		inspect, err := d.cli.ContainerInspect(ctx, c.ID)
		if err != nil {
			return nil, fmt.Errorf("docker inspect container %s: %w", c.ID, err)
		}
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		startedAt := time.Time{}
		if inspect.State != nil {
			startedAt = parseDockerStartedAt(inspect.State.StartedAt)
		}
		cpuLimit := ""
		memoryLimit := ""
		if inspect.HostConfig != nil {
			cpuLimit = formatNanoCPULimit(inspect.HostConfig.Resources.NanoCPUs)
			memoryLimit = formatMemoryByteLimit(inspect.HostConfig.Memory)
		}
		result = append(result, ContainerInfo{
			ID:          c.ID,
			Name:        name,
			Image:       c.Image,
			State:       c.State,
			Status:      c.Status,
			CPULimit:    cpuLimit,
			MemoryLimit: memoryLimit,
			StartedAt:   startedAt,
			Labels:      c.Labels,
		})
	}
	return result, nil
}

// ListApplicationContainers returns Agirunner-owned stack containers with image
// metadata so the platform can report the running product versions accurately.
func (d *RealDockerClient) ListApplicationContainers(ctx context.Context) ([]ApplicationContainerInfo, error) {
	containers, err := d.cli.ContainerList(ctx, container.ListOptions{
		All: true,
	})
	if err != nil {
		return nil, fmt.Errorf("docker container list for application containers: %w", err)
	}

	result := make([]ApplicationContainerInfo, 0, len(containers))
	for _, c := range containers {
		if !isApplicationVersionContainer(c.Labels) {
			continue
		}

		inspect, err := d.cli.ContainerInspect(ctx, c.ID)
		if err != nil {
			return nil, fmt.Errorf("docker inspect application container %s: %w", c.ID, err)
		}

		imageDigest := ""
		imageLabels := map[string]string{}
		if imageInspect, _, imageErr := d.cli.ImageInspectWithRaw(ctx, inspect.Image); imageErr == nil {
			imageDigest = primaryImageDigest(imageInspect.RepoDigests)
			if imageInspect.Config != nil && imageInspect.Config.Labels != nil {
				imageLabels = imageInspect.Config.Labels
			}
		}

		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}

		startedAt := time.Time{}
		if inspect.State != nil {
			startedAt = parseDockerStartedAt(inspect.State.StartedAt)
		}

		result = append(result, ApplicationContainerInfo{
			ID:          c.ID,
			Name:        name,
			Image:       c.Image,
			State:       c.State,
			Status:      c.Status,
			StartedAt:   startedAt,
			Labels:      c.Labels,
			ImageLabels: imageLabels,
			ImageDigest: imageDigest,
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

	hostCPUCount := d.hostCPUCount(ctx)
	hostCfg := &container.HostConfig{
		Resources: container.Resources{
			NanoCPUs: clampCPULimitToHost(parseCPULimit(spec.CPULimit), hostCPUCount),
			Memory:   parseMemoryLimit(spec.MemoryLimit),
		},
	}
	if strings.TrimSpace(spec.LogMaxSize) != "" || strings.TrimSpace(spec.LogMaxFiles) != "" {
		hostCfg.LogConfig = container.LogConfig{
			Type: "json-file",
			Config: map[string]string{
				"max-size": strings.TrimSpace(spec.LogMaxSize),
				"max-file": strings.TrimSpace(spec.LogMaxFiles),
			},
		}
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
	err := d.cli.ContainerRemove(ctx, containerID, managedContainerRemoveOptions())
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
	_ = d.cli.ContainerRemove(ctx, containerID, managedContainerRemoveOptions())

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

func managedContainerRemoveOptions() container.RemoveOptions {
	return container.RemoveOptions{
		Force:         true,
		RemoveVolumes: true,
	}
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

func isApplicationVersionContainer(labels map[string]string) bool {
	if resolveApplicationComponent(labels) != "" {
		return true
	}
	return isAgirunnerManagedContainer(labels)
}

func primaryImageDigest(repoDigests []string) string {
	for _, repoDigest := range repoDigests {
		parts := strings.SplitN(strings.TrimSpace(repoDigest), "@", 2)
		if len(parts) != 2 {
			continue
		}
		digest := strings.TrimSpace(parts[1])
		if digest != "" {
			return digest
		}
	}
	return ""
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
