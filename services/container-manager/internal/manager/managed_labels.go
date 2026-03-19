package manager

import "strings"

const (
	legacyRuntimeManagedLabel    = "agirunner.runtime.managed"
	legacyParentRuntimeLabel     = "agirunner.parent_runtime"
	legacyRuntimeInstanceIDLabel = "agirunner.runtime.instance_id"
)

func isAgirunnerManagedContainer(labels map[string]string) bool {
	return hasManagedLabel(labels, labelManagedBy) ||
		hasManagedLabel(labels, labelDCMManaged) ||
		hasManagedLabel(labels, legacyRuntimeManagedLabel)
}

func hasManagedLabel(labels map[string]string, key string) bool {
	return strings.EqualFold(strings.TrimSpace(labels[key]), "true")
}

func liveParentIdentifiers(containers []ContainerInfo) map[string]bool {
	identifiers := make(map[string]bool, len(containers)*3)
	for _, container := range containers {
		addLiveParentIdentifier(identifiers, container.ID)
		if container.Labels[labelDCMTier] == tierRuntime {
			addLiveParentIdentifier(identifiers, container.Labels[labelDCMRuntimeID])
		}
	}
	return identifiers
}

func addLiveParentIdentifier(identifiers map[string]bool, value string) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return
	}
	identifiers[trimmed] = true
	if len(trimmed) >= 12 {
		identifiers[trimmed[:12]] = true
	}
}
