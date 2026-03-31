package manager

import (
	"context"
	"fmt"
	"slices"
	"strings"
)

func (m *Manager) reportActualState(ctx context.Context, containers []ContainerInfo) {
	activeByDS := make(map[string][]string)

	for _, c := range containers {
		dsID, ok := c.Labels[labelDesiredStateID]
		if !ok {
			continue
		}

		activeByDS[dsID] = append(activeByDS[dsID], c.ID)

		stats, err := m.docker.GetContainerStats(ctx, c.ID)
		if err != nil {
			m.logger.Error("failed to get container stats", "container", c.ID, "error", err)
			continue
		}

		state := ActualState{
			DesiredStateID:  dsID,
			ContainerID:     c.ID,
			ContainerStatus: c.Status,
		}
		if stats != nil {
			state.CPUUsagePercent = float32(stats.CPUPercent)
			state.MemoryUsageBytes = int64(stats.MemoryBytes)
			state.NetworkRxBytes = int64(stats.RxBytes)
			state.NetworkTxBytes = int64(stats.TxBytes)
		}

		if err := m.platform.ReportActualState(state); err != nil {
			m.logger.Error("failed to report actual state", "container", c.ID, "error", err)
		}
	}

	for dsID, containerIDs := range activeByDS {
		if err := m.platform.PruneActualState(dsID, containerIDs); err != nil {
			m.logger.Error("failed to prune stale actual state", "desired_state_id", dsID, "error", err)
		}
	}
}

func (m *Manager) reportImages(ctx context.Context) {
	images, err := m.docker.ListImages(ctx)
	if err != nil {
		m.logger.Error("failed to list images", "error", err)
		return
	}
	fingerprint := fingerprintImages(images)
	if fingerprint == m.lastReportedImages {
		return
	}
	allReported := true
	for _, img := range images {
		if err := m.platform.ReportImage(img); err != nil {
			allReported = false
			m.logger.Error("failed to report image", "repository", img.Repository, "error", err)
		}
	}
	if allReported {
		m.lastReportedImages = fingerprint
	}
}

func fingerprintImages(images []ContainerImage) string {
	if len(images) == 0 {
		return ""
	}

	parts := make([]string, 0, len(images))
	for _, img := range images {
		tag := ""
		if img.Tag != nil {
			tag = *img.Tag
		}
		digest := ""
		if img.Digest != nil {
			digest = *img.Digest
		}
		size := ""
		if img.SizeBytes != nil {
			size = fmt.Sprintf("%d", *img.SizeBytes)
		}
		parts = append(parts, fmt.Sprintf("%s|%s|%s|%s", img.Repository, tag, digest, size))
	}
	slices.Sort(parts)
	return strings.Join(parts, "\n")
}
