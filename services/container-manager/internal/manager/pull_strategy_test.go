package manager

import (
	"context"
	"fmt"
	"testing"
)

func TestPullImageBeforeCreateRuntimeContainers(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 2, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	_ = mgr.reconcileDCM(context.Background())

	if len(docker.pulledImages) == 0 {
		t.Fatal("expected at least one image pull before container creation")
	}
	if docker.pulledImages[0].Image != "runtime:v1" {
		t.Errorf("expected pulled image runtime:v1, got %s", docker.pulledImages[0].Image)
	}
	if docker.pulledImages[0].Policy != PullPolicyAlways {
		t.Errorf("expected pull policy %q, got %q", PullPolicyAlways, docker.pulledImages[0].Policy)
	}
	if len(docker.createdSpecs) != 2 {
		t.Errorf("expected 2 containers created after pull, got %d", len(docker.createdSpecs))
	}
}

func TestPullErrorPreventsContainerCreation(t *testing.T) {
	docker := newMockDockerClient()
	docker.pullErr = fmt.Errorf("registry unavailable")
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 3, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	_ = mgr.reconcileDCM(context.Background())

	if len(docker.createdSpecs) != 0 {
		t.Errorf("expected 0 containers created when pull fails, got %d", len(docker.createdSpecs))
	}
}

func TestNoPullWhenZeroContainersToCreate(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	_ = mgr.reconcileDCM(context.Background())

	for _, p := range docker.pulledImages {
		if p.Image == "runtime:v1" {
			t.Error("should not pull runtime image when no containers to create for cold template")
		}
	}
}

func TestWarmTemplatePrePullsRuntimeImage(t *testing.T) {
	docker := newMockDockerClient()
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "warm"
	target.ActiveWorkflows = 1
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	_ = mgr.reconcileDCM(context.Background())

	found := false
	for _, p := range docker.pulledImages {
		if p.Image == "runtime:v1" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected warm template to pre-pull runtime image")
	}
}

func TestWarmTemplatePrePullsTaskImage(t *testing.T) {
	docker := newMockDockerClient()
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "warm"
	target.TaskImage = "task-runner:v2"
	target.ActiveWorkflows = 1
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	_ = mgr.reconcileDCM(context.Background())

	var pulledRuntime, pulledTask bool
	for _, p := range docker.pulledImages {
		if p.Image == "runtime:v1" {
			pulledRuntime = true
		}
		if p.Image == "task-runner:v2" {
			pulledTask = true
		}
	}
	if !pulledRuntime {
		t.Error("expected warm template to pre-pull runtime image")
	}
	if !pulledTask {
		t.Error("expected warm template to pre-pull task image")
	}
}

func TestWarmTemplateSkipsTaskImagePullWhenEmpty(t *testing.T) {
	docker := newMockDockerClient()
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "warm"
	target.TaskImage = ""
	target.ActiveWorkflows = 1
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	_ = mgr.reconcileDCM(context.Background())

	for _, p := range docker.pulledImages {
		if p.Image == "" {
			t.Error("should not attempt pull with empty image reference")
		}
	}
}

func TestColdTemplateDoesNotPrePull(t *testing.T) {
	docker := newMockDockerClient()
	target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 0, 10)
	target.PoolMode = "cold"
	target.TaskImage = "task-runner:v1"
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{target},
	}
	mgr := newDCMTestManager(docker, platform)

	_ = mgr.reconcileDCM(context.Background())

	for _, p := range docker.pulledImages {
		if p.Image == "task-runner:v1" {
			t.Error("cold template should not pre-pull task image")
		}
	}
}

func TestPullPolicyPassedThroughToDocker(t *testing.T) {
	policies := []string{PullPolicyAlways, PullPolicyIfNotPresent, PullPolicyNever}

	for _, policy := range policies {
		t.Run(policy, func(t *testing.T) {
			docker := newMockDockerClient()
			target := makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 1, 10)
			target.PullPolicy = policy
			platform := &mockPlatformClient{
				runtimeTargets: []RuntimeTarget{target},
			}
			mgr := newDCMTestManager(docker, platform)

			_ = mgr.reconcileDCM(context.Background())

			if len(docker.pulledImages) == 0 {
				t.Fatal("expected at least one pull call")
			}
			if docker.pulledImages[0].Policy != policy {
				t.Errorf("expected policy %q, got %q", policy, docker.pulledImages[0].Policy)
			}
		})
	}
}

func TestPullPolicyConstants(t *testing.T) {
	if PullPolicyAlways != "always" {
		t.Errorf("PullPolicyAlways = %q, want %q", PullPolicyAlways, "always")
	}
	if PullPolicyIfNotPresent != "if-not-present" {
		t.Errorf("PullPolicyIfNotPresent = %q, want %q", PullPolicyIfNotPresent, "if-not-present")
	}
	if PullPolicyNever != "never" {
		t.Errorf("PullPolicyNever = %q, want %q", PullPolicyNever, "never")
	}
}

func TestMultipleTemplatesEachPullOwnImage(t *testing.T) {
	docker := newMockDockerClient()
	platform := &mockPlatformClient{
		runtimeTargets: []RuntimeTarget{
			makeRuntimeTarget("tmpl-1", "runtime:v1", 5, 1, 10),
			makeRuntimeTarget("tmpl-2", "runtime:v2", 5, 1, 10),
		},
	}
	mgr := newDCMTestManager(docker, platform)

	_ = mgr.reconcileDCM(context.Background())

	pulledSet := make(map[string]bool)
	for _, p := range docker.pulledImages {
		pulledSet[p.Image] = true
	}
	if !pulledSet["runtime:v1"] {
		t.Error("expected runtime:v1 to be pulled")
	}
	if !pulledSet["runtime:v2"] {
		t.Error("expected runtime:v2 to be pulled")
	}
	if len(docker.createdSpecs) != 2 {
		t.Errorf("expected 2 total containers created, got %d", len(docker.createdSpecs))
	}
}
