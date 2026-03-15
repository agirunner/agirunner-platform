package manager

import (
	"testing"

	dto "github.com/prometheus/client_model/go"
)

func gatherMetric(t *testing.T, fm *FleetMetrics, name string) *dto.MetricFamily {
	t.Helper()
	families, err := fm.Registry.Gather()
	if err != nil {
		t.Fatalf("gather metrics: %v", err)
	}
	for _, f := range families {
		if f.GetName() == name {
			return f
		}
	}
	return nil
}

func findGaugeValue(mf *dto.MetricFamily, labelValues map[string]string) float64 {
	for _, m := range mf.GetMetric() {
		match := true
		for _, lp := range m.GetLabel() {
			expected, ok := labelValues[lp.GetName()]
			if ok && expected != lp.GetValue() {
				match = false
				break
			}
		}
		if match {
			return m.GetGauge().GetValue()
		}
	}
	return -1
}

func findCounterValue(mf *dto.MetricFamily, labelValues map[string]string) float64 {
	for _, m := range mf.GetMetric() {
		match := true
		for _, lp := range m.GetLabel() {
			expected, ok := labelValues[lp.GetName()]
			if ok && expected != lp.GetValue() {
				match = false
				break
			}
		}
		if match {
			return m.GetCounter().GetValue()
		}
	}
	return -1
}

func TestRecordScalingEventIncrementsCounter(t *testing.T) {
	fm := NewFleetMetrics()

	fm.RecordScalingEvent("tmpl-1", "created")
	fm.RecordScalingEvent("tmpl-1", "created")
	fm.RecordScalingEvent("tmpl-2", "destroyed")

	mf := gatherMetric(t, fm, "agirunner_fleet_scaling_events_total")
	if mf == nil {
		t.Fatal("scaling_events_total metric not found")
	}

	created := findCounterValue(mf, map[string]string{"playbook_id": "tmpl-1", "action": "created"})
	if created != 2 {
		t.Errorf("expected 2 created events for tmpl-1, got %v", created)
	}

	destroyed := findCounterValue(mf, map[string]string{"playbook_id": "tmpl-2", "action": "destroyed"})
	if destroyed != 1 {
		t.Errorf("expected 1 destroyed event for tmpl-2, got %v", destroyed)
	}
}

func TestRecordOrphanCleanedIncrementsCounter(t *testing.T) {
	fm := NewFleetMetrics()

	fm.RecordOrphanCleaned()
	fm.RecordOrphanCleaned()
	fm.RecordOrphanCleaned()

	mf := gatherMetric(t, fm, "agirunner_fleet_orphans_cleaned_total")
	if mf == nil {
		t.Fatal("orphans_cleaned_total metric not found")
	}

	value := mf.GetMetric()[0].GetCounter().GetValue()
	if value != 3 {
		t.Errorf("expected 3 orphans cleaned, got %v", value)
	}
}

func TestUpdateRuntimeGaugesSetsCorrectValues(t *testing.T) {
	fm := NewFleetMetrics()

	containers := []ContainerInfo{
		{ID: "c-1", Labels: map[string]string{labelDCMPlaybookID: "tmpl-1", labelDCMRuntimeID: "rt-1"}},
		{ID: "c-2", Labels: map[string]string{labelDCMPlaybookID: "tmpl-1", labelDCMRuntimeID: "rt-2"}},
		{ID: "c-3", Labels: map[string]string{labelDCMPlaybookID: "tmpl-1", labelDCMRuntimeID: "rt-3", labelDCMDraining: "true"}},
		{ID: "c-4", Labels: map[string]string{labelDCMPlaybookID: "tmpl-2", labelDCMRuntimeID: "rt-4"}},
	}

	heartbeats := map[string]RuntimeHeartbeat{
		"rt-1": {RuntimeID: "rt-1", State: "executing"},
		"rt-2": {RuntimeID: "rt-2", State: "idle"},
	}

	fm.UpdateRuntimeGauges(containers, heartbeats)

	mf := gatherMetric(t, fm, "agirunner_fleet_runtimes_total")
	if mf == nil {
		t.Fatal("runtimes_total metric not found")
	}

	executing := findGaugeValue(mf, map[string]string{"playbook_id": "tmpl-1", "state": "executing"})
	if executing != 1 {
		t.Errorf("expected 1 executing for tmpl-1, got %v", executing)
	}

	idle := findGaugeValue(mf, map[string]string{"playbook_id": "tmpl-1", "state": "idle"})
	if idle != 1 {
		t.Errorf("expected 1 idle for tmpl-1, got %v", idle)
	}

	draining := findGaugeValue(mf, map[string]string{"playbook_id": "tmpl-1", "state": "draining"})
	if draining != 1 {
		t.Errorf("expected 1 draining for tmpl-1, got %v", draining)
	}

	// rt-4 has no heartbeat data, should be classified as "active"
	active := findGaugeValue(mf, map[string]string{"playbook_id": "tmpl-2", "state": "active"})
	if active != 1 {
		t.Errorf("expected 1 active for tmpl-2, got %v", active)
	}
}

func TestNewFleetMetricsRegistersAllCollectors(t *testing.T) {
	fm := NewFleetMetrics()
	if fm.RuntimesTotal == nil {
		t.Error("RuntimesTotal is nil")
	}
	if fm.ScalingEventsTotal == nil {
		t.Error("ScalingEventsTotal is nil")
	}
	if fm.OrphansCleanedTotal == nil {
		t.Error("OrphansCleanedTotal is nil")
	}
	if fm.RuntimeOrphansDetectedTotal == nil {
		t.Error("RuntimeOrphansDetectedTotal is nil")
	}
	if fm.RuntimeOrphansCleanedTotal == nil {
		t.Error("RuntimeOrphansCleanedTotal is nil")
	}
	if fm.Registry == nil {
		t.Error("Registry is nil")
	}

	families, err := fm.Registry.Gather()
	if err != nil {
		t.Fatalf("gather error: %v", err)
	}
	if len(families) == 0 {
		t.Error("expected at least one metric family registered")
	}
}

func TestRecordRuntimeOrphanCountersIncrement(t *testing.T) {
	fm := NewFleetMetrics()

	fm.RecordRuntimeOrphanDetected()
	fm.RecordRuntimeOrphanDetected()
	fm.RecordRuntimeOrphanCleaned()

	detected := gatherMetric(t, fm, "agirunner_fleet_runtime_orphans_detected_total")
	if detected == nil {
		t.Fatal("runtime_orphans_detected_total metric not found")
	}
	if value := detected.GetMetric()[0].GetCounter().GetValue(); value != 2 {
		t.Fatalf("expected 2 detected runtime orphans, got %v", value)
	}

	cleaned := gatherMetric(t, fm, "agirunner_fleet_runtime_orphans_cleaned_total")
	if cleaned == nil {
		t.Fatal("runtime_orphans_cleaned_total metric not found")
	}
	if value := cleaned.GetMetric()[0].GetCounter().GetValue(); value != 1 {
		t.Fatalf("expected 1 cleaned runtime orphan, got %v", value)
	}
}

func TestSetRuntimeGaugeSetsExplicitValue(t *testing.T) {
	fm := NewFleetMetrics()

	fm.SetRuntimeGauge("tmpl-5", "idle", 42)

	mf := gatherMetric(t, fm, "agirunner_fleet_runtimes_total")
	if mf == nil {
		t.Fatal("runtimes_total metric not found")
	}

	value := findGaugeValue(mf, map[string]string{"playbook_id": "tmpl-5", "state": "idle"})
	if value != 42 {
		t.Errorf("expected gauge value 42, got %v", value)
	}
}

func TestScalingEventPreemptedAction(t *testing.T) {
	fm := NewFleetMetrics()

	fm.RecordScalingEvent("tmpl-1", "preempted")

	mf := gatherMetric(t, fm, "agirunner_fleet_scaling_events_total")
	if mf == nil {
		t.Fatal("scaling_events_total metric not found")
	}

	value := findCounterValue(mf, map[string]string{"playbook_id": "tmpl-1", "action": "preempted"})
	if value != 1 {
		t.Errorf("expected 1 preempted event, got %v", value)
	}
}
