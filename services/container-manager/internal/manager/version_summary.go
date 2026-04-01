package manager

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	labelStackProject   = "agirunner.stack.project"
	labelComponent      = "agirunner.component"
	labelComposeProject = "com.docker.compose.project"
	labelComposeService = "com.docker.compose.service"
	labelOCIVersion     = "org.opencontainers.image.version"
	labelOCIRevision    = "org.opencontainers.image.revision"

	componentPlatformAPI      = "platform-api"
	componentDashboard        = "dashboard"
	componentContainerManager = "container-manager"
)

type ApplicationContainerInfo struct {
	ID          string
	Name        string
	Image       string
	State       string
	Status      string
	StartedAt   time.Time
	Labels      map[string]string
	ImageLabels map[string]string
	ImageDigest string
}

type ApplicationVersionSummary struct {
	PlatformAPI      *ApplicationVersionComponent     `json:"platform_api"`
	Dashboard        *ApplicationVersionComponent     `json:"dashboard"`
	ContainerManager *ApplicationVersionComponent     `json:"container_manager"`
	Runtimes         []ApplicationRuntimeVersionGroup `json:"runtimes"`
}

type ApplicationVersionComponent struct {
	Component   string     `json:"component"`
	Image       string     `json:"image"`
	ImageDigest *string    `json:"image_digest"`
	Version     string     `json:"version"`
	Revision    string     `json:"revision"`
	Status      string     `json:"status"`
	StartedAt   *time.Time `json:"started_at"`
}

type ApplicationRuntimeVersionGroup struct {
	Image                       string  `json:"image"`
	ImageDigest                 *string `json:"image_digest"`
	Version                     string  `json:"version"`
	Revision                    string  `json:"revision"`
	TotalContainers             int     `json:"total_containers"`
	OrchestratorContainers      int     `json:"orchestrator_containers"`
	SpecialistRuntimeContainers int     `json:"specialist_runtime_containers"`
}

type runtimeVersionAccumulator struct {
	group ApplicationRuntimeVersionGroup
}

func (m *Manager) ReadApplicationVersionSummary(ctx context.Context) (*ApplicationVersionSummary, error) {
	containers, err := m.docker.ListApplicationContainers(ctx)
	if err != nil {
		return nil, fmt.Errorf("list application containers for version summary: %w", err)
	}

	summary := buildApplicationVersionSummary(containers, m.config.StackProjectName)
	return &summary, nil
}

func buildApplicationVersionSummary(
	containers []ApplicationContainerInfo,
	stackProjectName string,
) ApplicationVersionSummary {
	summary := ApplicationVersionSummary{
		Runtimes: make([]ApplicationRuntimeVersionGroup, 0),
	}

	projectName := strings.TrimSpace(stackProjectName)
	if projectName == "" {
		projectName = inferStackProjectName(containers)
	}

	runtimeGroups := make(map[string]*runtimeVersionAccumulator)
	for _, container := range containers {
		if !matchesStackProject(container, projectName) {
			continue
		}

		if component := resolveApplicationComponent(container.Labels); component != "" {
			record := buildApplicationVersionComponent(component, container)
			switch component {
			case componentPlatformAPI:
				summary.PlatformAPI = &record
			case componentDashboard:
				summary.Dashboard = &record
			case componentContainerManager:
				summary.ContainerManager = &record
			}
			continue
		}

		kind, ok := classifyLiveContainer(container.Labels)
		if !ok || (kind != containerKindOrchestrator && kind != containerKindRuntime) {
			continue
		}

		key := runtimeGroupKey(container)
		group, found := runtimeGroups[key]
		if !found {
			runtimeGroups[key] = &runtimeVersionAccumulator{
				group: ApplicationRuntimeVersionGroup{
					Image:       strings.TrimSpace(container.Image),
					ImageDigest: optionalStringPointer(container.ImageDigest),
					Version:     resolveApplicationVersion(container.Image, container.ImageLabels),
					Revision:    resolveApplicationRevision(container.ImageLabels),
				},
			}
			group = runtimeGroups[key]
		}
		group.group.TotalContainers++
		if kind == containerKindOrchestrator {
			group.group.OrchestratorContainers++
		} else {
			group.group.SpecialistRuntimeContainers++
		}
	}

	for _, group := range runtimeGroups {
		summary.Runtimes = append(summary.Runtimes, group.group)
	}
	sort.Slice(summary.Runtimes, func(i, j int) bool {
		left := summary.Runtimes[i]
		right := summary.Runtimes[j]
		if left.Version != right.Version {
			return left.Version > right.Version
		}
		if left.Revision != right.Revision {
			return left.Revision > right.Revision
		}
		return left.Image < right.Image
	})

	return summary
}

func buildApplicationVersionComponent(
	component string,
	container ApplicationContainerInfo,
) ApplicationVersionComponent {
	return ApplicationVersionComponent{
		Component:   component,
		Image:       strings.TrimSpace(container.Image),
		ImageDigest: optionalStringPointer(container.ImageDigest),
		Version:     resolveApplicationVersion(container.Image, container.ImageLabels),
		Revision:    resolveApplicationRevision(container.ImageLabels),
		Status:      strings.TrimSpace(container.Status),
		StartedAt:   optionalTimePointer(container.StartedAt),
	}
}

func inferStackProjectName(containers []ApplicationContainerInfo) string {
	for _, container := range containers {
		if resolveApplicationComponent(container.Labels) != componentContainerManager {
			continue
		}
		projectName := strings.TrimSpace(container.Labels[labelStackProject])
		if projectName != "" {
			return projectName
		}
		projectName = strings.TrimSpace(container.Labels[labelComposeProject])
		if projectName != "" {
			return projectName
		}
	}
	return ""
}

func matchesStackProject(container ApplicationContainerInfo, projectName string) bool {
	if projectName == "" {
		return true
	}
	return readContainerProjectName(container.Labels) == projectName
}

func readContainerProjectName(labels map[string]string) string {
	if value := strings.TrimSpace(labels[labelStackProject]); value != "" {
		return value
	}
	return strings.TrimSpace(labels[labelComposeProject])
}

func resolveApplicationComponent(labels map[string]string) string {
	if component := strings.TrimSpace(labels[labelComponent]); isKnownApplicationComponent(component) {
		return component
	}
	service := strings.TrimSpace(labels[labelComposeService])
	switch service {
	case componentPlatformAPI, componentDashboard, componentContainerManager:
		return service
	default:
		return ""
	}
}

func isKnownApplicationComponent(component string) bool {
	switch component {
	case componentPlatformAPI, componentDashboard, componentContainerManager:
		return true
	default:
		return false
	}
}

func resolveApplicationVersion(image string, imageLabels map[string]string) string {
	if version := strings.TrimSpace(imageLabels[labelOCIVersion]); version != "" {
		return version
	}
	if tag := parseImageTag(image); tag != "" {
		return tag
	}
	return "unlabeled"
}

func resolveApplicationRevision(imageLabels map[string]string) string {
	if revision := strings.TrimSpace(imageLabels[labelOCIRevision]); revision != "" {
		return revision
	}
	return "unlabeled"
}

func parseImageTag(image string) string {
	trimmed := strings.TrimSpace(image)
	if trimmed == "" {
		return ""
	}
	if strings.Contains(trimmed, "@") {
		trimmed = strings.SplitN(trimmed, "@", 2)[0]
	}
	lastSlash := strings.LastIndex(trimmed, "/")
	lastColon := strings.LastIndex(trimmed, ":")
	if lastColon <= lastSlash {
		return ""
	}
	return strings.TrimSpace(trimmed[lastColon+1:])
}

func runtimeGroupKey(container ApplicationContainerInfo) string {
	return strings.Join([]string{
		strings.TrimSpace(container.Image),
		strings.TrimSpace(container.ImageDigest),
		resolveApplicationVersion(container.Image, container.ImageLabels),
		resolveApplicationRevision(container.ImageLabels),
	}, "::")
}

func optionalStringPointer(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func optionalTimePointer(value time.Time) *time.Time {
	if value.IsZero() {
		return nil
	}
	copy := value
	return &copy
}

func applyStackProjectLabel(labels map[string]string, stackProjectName string) {
	trimmed := strings.TrimSpace(stackProjectName)
	if trimmed == "" {
		return
	}
	labels[labelStackProject] = trimmed
}
