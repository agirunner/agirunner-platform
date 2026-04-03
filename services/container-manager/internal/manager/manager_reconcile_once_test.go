package manager

import (
	"context"
	"encoding/json"
	"testing"
)

func TestReconcileOnceRemovesOrphans(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "orphan-worker", "myimage:v1", "ds-orphan", 1),
	}
	platform := &mockPlatformClient{}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 1 || docker.stoppedIDs[0] != "c-1" {
		t.Errorf("expected orphan c-1 stopped, got %v", docker.stoppedIDs)
	}
	if len(docker.removedIDs) != 1 || docker.removedIDs[0] != "c-1" {
		t.Errorf("expected orphan c-1 removed, got %v", docker.removedIDs)
	}
}

func TestReconcileOnceMatchingContainersNoChange(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "worker-a", "myimage:v1", "ds-1", 1),
	}
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{
			makeDesiredState("ds-1", "worker-a", "myimage:v1", 1, 1),
		},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.createdSpecs) != 0 {
		t.Errorf("expected no creates, got %d", len(docker.createdSpecs))
	}
	if len(docker.stoppedIDs) != 0 {
		t.Errorf("expected no stops, got %d", len(docker.stoppedIDs))
	}
	if len(docker.removedIDs) != 0 {
		t.Errorf("expected no removes, got %d", len(docker.removedIDs))
	}
}

func TestReconcileOnceVersionMismatchReplacesContainer(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "worker-a", "myimage:v1", "ds-1", 1),
	}
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{
			makeDesiredState("ds-1", "worker-a", "myimage:v1", 2, 1),
		},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 1 || docker.stoppedIDs[0] != "c-1" {
		t.Errorf("expected old container c-1 stopped, got %v", docker.stoppedIDs)
	}
	if len(docker.removedIDs) != 1 || docker.removedIDs[0] != "c-1" {
		t.Errorf("expected old container c-1 removed, got %v", docker.removedIDs)
	}
	if len(docker.createdSpecs) != 1 {
		t.Fatalf("expected 1 new container created, got %d", len(docker.createdSpecs))
	}
	if docker.createdSpecs[0].Labels[labelVersion] != "2" {
		t.Errorf("expected version label 2, got %s", docker.createdSpecs[0].Labels[labelVersion])
	}
}

func TestReconcileOnceOrchestratorContractMismatchReplacesContainer(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "orchestrator-primary", "agirunner-runtime:local", "ds-1", 1),
	}
	ds := makeDesiredState("ds-1", "orchestrator-primary", "agirunner-runtime:local", 1, 1)
	ds.Role = "orchestrator"
	ds.PoolKind = "orchestrator"
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{ds},
	}
	manager := newTestManager(docker, platform)
	manager.config.PlatformAPIURL = "http://platform-api:8080"
	manager.config.PlatformAPIKey = "test-service-key"
	manager.config.DockerHost = "tcp://socket-proxy:2375"
	manager.config.RuntimeNetwork = "agirunner-platform_platform_net"
	manager.config.RuntimeInternalNetwork = "agirunner-platform_runtime_internal"

	err := manager.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 1 || docker.stoppedIDs[0] != "c-1" {
		t.Fatalf("expected stale orchestrator container to stop, got %v", docker.stoppedIDs)
	}
	if len(docker.removedIDs) != 1 || docker.removedIDs[0] != "c-1" {
		t.Fatalf("expected stale orchestrator container to be removed, got %v", docker.removedIDs)
	}
	if len(docker.createdSpecs) != 1 {
		t.Fatalf("expected replacement orchestrator container, got %d creates", len(docker.createdSpecs))
	}

	spec := docker.createdSpecs[0]
	if spec.Environment[envPlatformAPIURL] != "http://platform-api:8080" {
		t.Fatalf("expected platform api url injected, got %q", spec.Environment[envPlatformAPIURL])
	}
	if spec.NetworkName != "agirunner-platform_platform_net" {
		t.Fatalf("expected runtime network attached, got %q", spec.NetworkName)
	}
	if spec.Environment[envPlatformAdminAPIKey] != "test-service-key" {
		t.Fatalf("expected platform service key injected, got %q", spec.Environment[envPlatformAdminAPIKey])
	}
	if spec.Environment[envRuntimeWorkerName] != "orchestrator-primary" {
		t.Fatalf("expected worker name injected, got %q", spec.Environment[envRuntimeWorkerName])
	}
	if spec.Environment[envPlatformAgentExecMode] != orchestratorExecutionMode {
		t.Fatalf("expected execution mode %q, got %q", orchestratorExecutionMode, spec.Environment[envPlatformAgentExecMode])
	}
	if spec.Environment[envDockerHost] != "tcp://socket-proxy:2375" {
		t.Fatalf("expected docker host injected, got %q", spec.Environment[envDockerHost])
	}
	if spec.Labels[labelExecutionMode] != orchestratorExecutionMode {
		t.Fatalf("expected execution-mode label %q, got %q", orchestratorExecutionMode, spec.Labels[labelExecutionMode])
	}
	if spec.Labels[labelPlatformContract] != orchestratorContractLabel {
		t.Fatalf("expected platform contract label %q, got %q", orchestratorContractLabel, spec.Labels[labelPlatformContract])
	}
	if spec.Labels[labelPlatformAPIURL] != "http://platform-api:8080" {
		t.Fatalf("expected platform api url label, got %q", spec.Labels[labelPlatformAPIURL])
	}
	if spec.Labels[labelRuntimeNetwork] != "agirunner-platform_platform_net" {
		t.Fatalf("expected runtime network label, got %q", spec.Labels[labelRuntimeNetwork])
	}
	if spec.Labels[labelRuntimeInternalNetwork] != "agirunner-platform_runtime_internal" {
		t.Fatalf("expected runtime internal network label, got %q", spec.Labels[labelRuntimeInternalNetwork])
	}
	if len(docker.networkConnects) != 1 {
		t.Fatalf("expected one internal-network connection, got %d", len(docker.networkConnects))
	}
	if docker.networkConnects[0].ContainerID != "container-1" || docker.networkConnects[0].NetworkName != "agirunner-platform_runtime_internal" {
		t.Fatalf("expected container-1 connected to internal network, got %#v", docker.networkConnects[0])
	}
}

func TestReconcileOnceOrchestratorContractMismatchDefersReplacementWhenActiveTaskPresent(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "orchestrator-primary", "agirunner-runtime:local", "ds-1", 1),
	}
	var ds DesiredState
	if err := json.Unmarshal([]byte(`{
		"id":"ds-1",
		"worker_name":"orchestrator-primary",
		"role":"orchestrator",
		"pool_kind":"orchestrator",
		"runtime_image":"agirunner-runtime:local",
		"replicas":1,
		"enabled":true,
		"version":1,
		"active_task_id":"task-123"
	}`), &ds); err != nil {
		t.Fatalf("expected desired state json to parse, got %v", err)
	}
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{ds},
	}
	manager := newTestManager(docker, platform)
	manager.config.PlatformAPIURL = "http://platform-api:8080"
	manager.config.PlatformAPIKey = "test-service-key"
	manager.config.DockerHost = "tcp://socket-proxy:2375"
	manager.config.RuntimeNetwork = "agirunner-platform_platform_net"
	manager.config.RuntimeInternalNetwork = "agirunner-platform_runtime_internal"

	err := manager.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 0 {
		t.Fatalf("expected no stop while orchestrator has active task, got %v", docker.stoppedIDs)
	}
	if len(docker.removedIDs) != 0 {
		t.Fatalf("expected no removal while orchestrator has active task, got %v", docker.removedIDs)
	}
	if len(docker.createdSpecs) != 0 {
		t.Fatalf("expected no replacement create while orchestrator has active task, got %d", len(docker.createdSpecs))
	}
}

func TestReconcileOnceKeepsOrchestratorContainerWhenContractMatches(t *testing.T) {
	docker := newMockDockerClient()
	existing := makeContainerInfo("c-1", "orchestrator-primary", "agirunner-runtime:local", "ds-1", 1)
	existing.Labels[labelExecutionMode] = orchestratorExecutionMode
	existing.Labels[labelPlatformContract] = orchestratorContractLabel
	existing.Labels[labelPlatformAPIURL] = "http://platform-api:8080"
	existing.Labels[labelDockerHost] = "tcp://socket-proxy:2375"
	existing.Labels[labelRuntimeNetwork] = "agirunner-platform_platform_net"
	existing.Labels[labelRuntimeInternalNetwork] = "agirunner-platform_runtime_internal"
	docker.containers = []ContainerInfo{existing}

	ds := makeDesiredState("ds-1", "orchestrator-primary", "agirunner-runtime:local", 1, 1)
	ds.Role = "orchestrator"
	ds.PoolKind = "orchestrator"
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{ds},
	}
	manager := newTestManager(docker, platform)
	manager.config.PlatformAPIURL = "http://platform-api:8080"
	manager.config.PlatformAPIKey = "test-service-key"
	manager.config.DockerHost = "tcp://socket-proxy:2375"
	manager.config.RuntimeNetwork = "agirunner-platform_platform_net"
	manager.config.RuntimeInternalNetwork = "agirunner-platform_runtime_internal"

	err := manager.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 0 {
		t.Fatalf("expected no orchestrator stop when contract matches, got %v", docker.stoppedIDs)
	}
	if len(docker.createdSpecs) != 0 {
		t.Fatalf("expected no replacement create when contract matches, got %d", len(docker.createdSpecs))
	}
}

func TestReconcileOncePullsDesiredStateImageBeforeCreate(t *testing.T) {
	docker := newMockDockerClient()
	ds := makeDesiredState("ds-1", "orchestrator-primary", "ghcr.io/agirunner/agirunner-runtime:0.1.0-alpha.2", 1, 1)
	ds.Role = "orchestrator"
	ds.PoolKind = "orchestrator"
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{ds},
	}
	manager := newTestManager(docker, platform)

	err := manager.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.pulledImages) != 1 {
		t.Fatalf("expected one image pull before create, got %d", len(docker.pulledImages))
	}
	if docker.pulledImages[0].Image != ds.RuntimeImage {
		t.Fatalf("expected pulled image %q, got %q", ds.RuntimeImage, docker.pulledImages[0].Image)
	}
	if docker.pulledImages[0].Policy != PullPolicyIfNotPresent {
		t.Fatalf("expected pull policy %q, got %q", PullPolicyIfNotPresent, docker.pulledImages[0].Policy)
	}
	if len(docker.createdSpecs) != 1 {
		t.Fatalf("expected one created container after pull, got %d", len(docker.createdSpecs))
	}
}

func TestReconcileOnceSkipsCreateWhenDesiredStateImagePullFails(t *testing.T) {
	docker := newMockDockerClient()
	docker.pullErr = context.DeadlineExceeded
	ds := makeDesiredState("ds-1", "orchestrator-primary", "ghcr.io/agirunner/agirunner-runtime:0.1.0-alpha.2", 1, 1)
	ds.Role = "orchestrator"
	ds.PoolKind = "orchestrator"
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{ds},
	}
	manager := newTestManager(docker, platform)

	err := manager.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no top-level error, got %v", err)
	}
	if len(docker.pulledImages) != 1 {
		t.Fatalf("expected one image pull attempt, got %d", len(docker.pulledImages))
	}
	if len(docker.createdSpecs) != 0 {
		t.Fatalf("expected no created containers after pull failure, got %d", len(docker.createdSpecs))
	}
}

func TestReconcileOnceReplacesExitedContainers(t *testing.T) {
	docker := newMockDockerClient()
	exited := makeContainerInfo("c-1", "worker-a", "myimage:v1", "ds-1", 1)
	exited.Status = "Exited (1) 5 seconds ago"
	docker.containers = []ContainerInfo{exited}
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{
			makeDesiredState("ds-1", "worker-a", "myimage:v1", 1, 1),
		},
	}
	manager := newTestManager(docker, platform)

	err := manager.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 1 || docker.stoppedIDs[0] != "c-1" {
		t.Fatalf("expected exited container to be stopped/replaced, got %v", docker.stoppedIDs)
	}
	if len(docker.removedIDs) != 1 || docker.removedIDs[0] != "c-1" {
		t.Fatalf("expected exited container to be removed/replaced, got %v", docker.removedIDs)
	}
	if len(docker.createdSpecs) != 1 {
		t.Fatalf("expected replacement container for exited instance, got %d", len(docker.createdSpecs))
	}
}

func TestReconcileOnceDrainingStopsAllContainers(t *testing.T) {
	docker := newMockDockerClient()
	docker.containers = []ContainerInfo{
		makeContainerInfo("c-1", "worker-a-0", "myimage:v1", "ds-1", 1),
		makeContainerInfo("c-2", "worker-a-1", "myimage:v1", "ds-1", 1),
	}
	ds := makeDesiredState("ds-1", "worker-a", "myimage:v1", 1, 2)
	ds.Draining = true
	platform := &mockPlatformClient{
		desiredStates: []DesiredState{ds},
	}
	r := newTestManager(docker, platform)

	err := r.reconcileOnce(context.Background())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(docker.stoppedIDs) != 2 {
		t.Errorf("expected 2 containers stopped for drain, got %d", len(docker.stoppedIDs))
	}
	if len(docker.removedIDs) != 2 {
		t.Errorf("expected 2 containers removed for drain, got %d", len(docker.removedIDs))
	}
	if len(docker.createdSpecs) != 0 {
		t.Errorf("expected no containers created during drain, got %d", len(docker.createdSpecs))
	}
}
