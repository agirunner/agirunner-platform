package manager

import (
	"testing"
)

func TestPriorityPreemptionSelectsLowestPriority(t *testing.T) {
	grouped := map[string][]ContainerInfo{
		"tmpl-low": {makeDCMContainer("c-1", "tmpl-low", "img:v1", "rt-1")},
	}
	targets := []RuntimeTarget{
		makeRuntimeTarget("tmpl-high", "img:v1", 5, 2, 100),
		makeRuntimeTarget("tmpl-low", "img:v1", 5, 0, 1),
	}

	plans := planPreemptions(targets, grouped, 10)

	if len(plans) != 1 {
		t.Fatalf("expected 1 preemption plan, got %d", len(plans))
	}
	if plans[0].VictimContainerID != "c-1" {
		t.Errorf("expected victim c-1, got %s", plans[0].VictimContainerID)
	}
	if plans[0].BeneficiaryTemplate.TemplateID != "tmpl-high" {
		t.Errorf("expected beneficiary tmpl-high, got %s", plans[0].BeneficiaryTemplate.TemplateID)
	}
}

func TestPriorityNoPreemptionWhenSamePriority(t *testing.T) {
	grouped := map[string][]ContainerInfo{
		"tmpl-a": {makeDCMContainer("c-1", "tmpl-a", "img:v1", "rt-1")},
	}
	targets := []RuntimeTarget{
		makeRuntimeTarget("tmpl-b", "img:v1", 5, 2, 10),
		makeRuntimeTarget("tmpl-a", "img:v1", 5, 0, 10),
	}

	plans := planPreemptions(targets, grouped, 10)

	if len(plans) != 0 {
		t.Errorf("expected 0 preemption plans (same priority), got %d", len(plans))
	}
}

func TestSortTargetsByPriorityDescending(t *testing.T) {
	targets := []RuntimeTarget{
		makeRuntimeTarget("tmpl-low", "img:v1", 5, 0, 1),
		makeRuntimeTarget("tmpl-high", "img:v1", 5, 0, 100),
		makeRuntimeTarget("tmpl-mid", "img:v1", 5, 0, 50),
	}

	sorted := sortTargetsByPriority(targets)

	if sorted[0].TemplateID != "tmpl-high" {
		t.Errorf("expected tmpl-high first, got %s", sorted[0].TemplateID)
	}
	if sorted[1].TemplateID != "tmpl-mid" {
		t.Errorf("expected tmpl-mid second, got %s", sorted[1].TemplateID)
	}
	if sorted[2].TemplateID != "tmpl-low" {
		t.Errorf("expected tmpl-low third, got %s", sorted[2].TemplateID)
	}
}

func TestPriorityPreemptionSkipsDrainingContainers(t *testing.T) {
	draining := makeDCMContainer("c-1", "tmpl-low", "img:v1", "rt-1")
	draining.Labels[labelDCMDraining] = "true"
	grouped := map[string][]ContainerInfo{
		"tmpl-low": {draining},
	}
	targets := []RuntimeTarget{
		makeRuntimeTarget("tmpl-high", "img:v1", 5, 2, 100),
		makeRuntimeTarget("tmpl-low", "img:v1", 5, 0, 1),
	}

	plans := planPreemptions(targets, grouped, 10)

	if len(plans) != 0 {
		t.Errorf("expected 0 plans (draining container), got %d", len(plans))
	}
}
