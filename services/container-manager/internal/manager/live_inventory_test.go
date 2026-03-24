package manager

import (
	"testing"
	"time"
)

func TestBuildLiveContainerReportsUsesDockerTruth(t *testing.T) {
	startedAt := time.Date(2026, 3, 21, 18, 22, 0, 0, time.UTC)
	containers := []ContainerInfo{
		{
			ID:          "orchestrator-container-1",
			Name:        "orchestrator-primary",
			Image:       "agirunner-runtime:local",
			State:       "running",
			Status:      "Up 8 minutes",
			CPULimit:    "1",
			MemoryLimit: "512m",
			StartedAt:   startedAt,
			Labels: map[string]string{
				labelManagedBy:    "true",
				labelDesiredStateID: "worker-desired-1",
			},
		},
		{
			ID:          "runtime-container-1",
			Name:        "runtime-speciali-3262b311",
			Image:       "agirunner-runtime:local",
			State:       "running",
			Status:      "Up 4 minutes",
			CPULimit:    "2",
			MemoryLimit: "1536m",
			StartedAt:   startedAt.Add(2 * time.Minute),
			Labels: map[string]string{
				labelDCMManaged:      "true",
				labelDCMTier:         tierRuntime,
				labelDCMRuntimeID:    "runtime-1",
				labelDCMPlaybookID:   "specialist",
				labelDCMPlaybookName: "Specialist runtimes",
				labelDCMPoolKind:     "specialist",
			},
		},
		{
			ID:          "task-container-1",
			Name:        "task-3d749b2c",
			Image:       "agirunner-runtime-execution:local",
			State:       "running",
			Status:      "Up 90 seconds",
			CPULimit:    "1",
			MemoryLimit: "768m",
			StartedAt:   startedAt.Add(4 * time.Minute),
			Labels: map[string]string{
				legacyRuntimeManagedLabel: "true",
				labelDCMTier:              tierTask,
				"agirunner.task_id":       "00000000-0000-0000-0000-000000000111",
				"agirunner.workflow_id":   "00000000-0000-0000-0000-000000000222",
				"agirunner.runtime.role":  "developer",
				"agirunner.runtime_id":    "runtime-1",
			},
		},
		{
			ID:          "dead-container-1",
			Name:        "dead-task",
			Image:       "unused:latest",
			State:       "exited",
			Status:      "Exited (0) 5 seconds ago",
			CPULimit:    "4",
			MemoryLimit: "2g",
			StartedAt:   startedAt,
			Labels: map[string]string{
				legacyRuntimeManagedLabel: "true",
				labelDCMTier:              tierTask,
				"agirunner.task_id":       "00000000-0000-0000-0000-000000000333",
			},
		},
	}

	reports := buildLiveContainerReports(containers)

	if len(reports) != 3 {
		t.Fatalf("expected 3 live container reports, got %d", len(reports))
	}

	orchestrator := reports[0]
	if orchestrator.Kind != "orchestrator" {
		t.Fatalf("expected first report kind orchestrator, got %q", orchestrator.Kind)
	}
	if orchestrator.CPULimit != "1" || orchestrator.MemoryLimit != "512m" {
		t.Fatalf("expected docker-inspected orchestrator limits, got cpu=%q memory=%q", orchestrator.CPULimit, orchestrator.MemoryLimit)
	}
	if orchestrator.DesiredStateID != "worker-desired-1" {
		t.Fatalf("expected desired state id worker-desired-1, got %q", orchestrator.DesiredStateID)
	}
	if orchestrator.ExecutionBackend != "runtime_only" {
		t.Fatalf("expected orchestrator execution backend runtime_only, got %q", orchestrator.ExecutionBackend)
	}

	runtime := reports[1]
	if runtime.Kind != "runtime" {
		t.Fatalf("expected second report kind runtime, got %q", runtime.Kind)
	}
	if runtime.PlaybookID != "specialist" || runtime.PlaybookName != "Specialist runtimes" {
		t.Fatalf("expected runtime playbook labels to survive, got id=%q name=%q", runtime.PlaybookID, runtime.PlaybookName)
	}
	if runtime.ExecutionBackend != "runtime_plus_task" {
		t.Fatalf("expected specialist runtime execution backend runtime_plus_task, got %q", runtime.ExecutionBackend)
	}

	task := reports[2]
	if task.Kind != "task" {
		t.Fatalf("expected third report kind task, got %q", task.Kind)
	}
	if task.TaskID != "00000000-0000-0000-0000-000000000111" {
		t.Fatalf("expected task label to map into report, got %q", task.TaskID)
	}
	if task.WorkflowID != "00000000-0000-0000-0000-000000000222" {
		t.Fatalf("expected workflow label to map into report, got %q", task.WorkflowID)
	}
	if task.RoleName != "developer" {
		t.Fatalf("expected role label to map into report, got %q", task.RoleName)
	}
	if task.CPULimit != "1" || task.MemoryLimit != "768m" {
		t.Fatalf("expected docker-inspected task limits, got cpu=%q memory=%q", task.CPULimit, task.MemoryLimit)
	}
	if task.ExecutionBackend != "runtime_plus_task" {
		t.Fatalf("expected task execution backend runtime_plus_task, got %q", task.ExecutionBackend)
	}
}
