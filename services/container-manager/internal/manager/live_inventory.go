package manager

import (
	"context"
	"fmt"
	"strings"
)

const (
	containerKindOrchestrator = "orchestrator"
	containerKindRuntime      = "runtime"
	containerKindTask         = "task"

	labelTaskID     = "agirunner.task_id"
	labelWorkflowID = "agirunner.workflow_id"
	labelRoleName   = "agirunner.runtime.role"
)

func buildLiveContainerReports(containers []ContainerInfo) []LiveContainerReport {
	reports := make([]LiveContainerReport, 0, len(containers))
	for _, container := range containers {
		if !isLiveContainerState(container.State) {
			continue
		}
		kind, ok := classifyLiveContainer(container.Labels)
		if !ok {
			continue
		}
		reports = append(reports, LiveContainerReport{
			ContainerID:    strings.TrimSpace(container.ID),
			Name:           strings.TrimSpace(container.Name),
			Kind:           kind,
			State:          strings.TrimSpace(container.State),
			Status:         strings.TrimSpace(container.Status),
			Image:          strings.TrimSpace(container.Image),
			CPULimit:       strings.TrimSpace(container.CPULimit),
			MemoryLimit:    strings.TrimSpace(container.MemoryLimit),
			StartedAt:      container.StartedAt,
			DesiredStateID: strings.TrimSpace(container.Labels[labelDesiredStateID]),
			RuntimeID:      firstNonEmptyLiveLabel(container.Labels, labelDCMRuntimeID, legacyParentRuntimeLabel),
			TaskID:         strings.TrimSpace(container.Labels[labelTaskID]),
			WorkflowID:     strings.TrimSpace(container.Labels[labelWorkflowID]),
			RoleName:       strings.TrimSpace(container.Labels[labelRoleName]),
			PlaybookID:     strings.TrimSpace(container.Labels[labelDCMPlaybookID]),
			PlaybookName:   strings.TrimSpace(container.Labels[labelDCMPlaybookName]),
		})
	}
	return reports
}

func (m *Manager) reportLiveContainerInventory(ctx context.Context) error {
	containers, err := m.docker.ListContainers(ctx)
	if err != nil {
		return fmt.Errorf("list containers for live inventory: %w", err)
	}
	if err := m.platform.ReportLiveContainerInventory(buildLiveContainerReports(containers)); err != nil {
		return fmt.Errorf("report live container inventory: %w", err)
	}
	return nil
}

func classifyLiveContainer(labels map[string]string) (string, bool) {
	if strings.TrimSpace(labels[labelDesiredStateID]) != "" && hasManagedLabel(labels, labelManagedBy) {
		return containerKindOrchestrator, true
	}
	switch strings.TrimSpace(labels[labelDCMTier]) {
	case tierRuntime:
		return containerKindRuntime, true
	case tierTask:
		return containerKindTask, true
	default:
		return "", false
	}
}

func isLiveContainerState(state string) bool {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "created", "running", "restarting", "paused":
		return true
	default:
		return false
	}
}

func firstNonEmptyLiveLabel(labels map[string]string, keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(labels[key])
		if value != "" {
			return value
		}
	}
	return ""
}
