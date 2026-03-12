package manager

import "github.com/prometheus/client_golang/prometheus"

// FleetMetrics holds Prometheus metric collectors for fleet-level observability.
type FleetMetrics struct {
	RuntimesTotal       *prometheus.GaugeVec
	ScalingEventsTotal  *prometheus.CounterVec
	OrphansCleanedTotal prometheus.Counter
	Registry            *prometheus.Registry
}

// NewFleetMetrics creates and registers all fleet Prometheus metrics.
func NewFleetMetrics() *FleetMetrics {
	registry := prometheus.NewRegistry()

	runtimesTotal := prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "agirunner_fleet_runtimes_total",
		Help: "Current number of fleet runtimes by playbook and state",
	}, []string{"playbook_id", "state"})

	scalingEventsTotal := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "agirunner_fleet_scaling_events_total",
		Help: "Cumulative scaling events by playbook and action",
	}, []string{"playbook_id", "action"})

	orphansCleanedTotal := prometheus.NewCounter(prometheus.CounterOpts{
		Name: "agirunner_fleet_orphans_cleaned_total",
		Help: "Cumulative orphan task containers cleaned up",
	})

	registry.MustRegister(runtimesTotal, scalingEventsTotal, orphansCleanedTotal)

	return &FleetMetrics{
		RuntimesTotal:       runtimesTotal,
		ScalingEventsTotal:  scalingEventsTotal,
		OrphansCleanedTotal: orphansCleanedTotal,
		Registry:            registry,
	}
}

// RecordScalingEvent increments the scaling events counter.
func (fm *FleetMetrics) RecordScalingEvent(playbookID, action string) {
	fm.ScalingEventsTotal.WithLabelValues(playbookID, action).Inc()
}

// RecordOrphanCleaned increments the orphan cleanup counter.
func (fm *FleetMetrics) RecordOrphanCleaned() {
	fm.OrphansCleanedTotal.Inc()
}

// SetRuntimeGauge sets the gauge for a given playbook and state.
func (fm *FleetMetrics) SetRuntimeGauge(playbookID, state string, count float64) {
	fm.RuntimesTotal.WithLabelValues(playbookID, state).Set(count)
}

// UpdateRuntimeGauges recalculates runtime gauges from current containers and heartbeats.
func (fm *FleetMetrics) UpdateRuntimeGauges(
	containers []ContainerInfo,
	heartbeats map[string]RuntimeHeartbeat,
) {
	type stateKey struct {
		playbookID string
		state      string
	}
	counts := make(map[stateKey]float64)

	for _, c := range containers {
		playbookID := c.Labels[labelDCMPlaybookID]
		state := classifyContainerState(c, heartbeats)
		counts[stateKey{playbookID, state}]++
	}

	fm.RuntimesTotal.Reset()
	for key, count := range counts {
		fm.RuntimesTotal.WithLabelValues(key.playbookID, key.state).Set(count)
	}
}

// classifyContainerState determines the fleet state of a container.
func classifyContainerState(c ContainerInfo, heartbeats map[string]RuntimeHeartbeat) string {
	if isDrainingContainer(c) {
		return "draining"
	}
	runtimeID := c.Labels[labelDCMRuntimeID]
	if hb, ok := heartbeats[runtimeID]; ok {
		switch hb.State {
		case "executing":
			return "executing"
		case "idle":
			return "idle"
		}
	}
	return "active"
}
