package reconciler

import (
	"testing"

	"github.com/docker/docker/api/types/container"
)

func TestParseCPULimit(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected int64
	}{
		{name: "emptyReturnsZero", input: "", expected: 0},
		{name: "halfCPU", input: "0.5", expected: 500_000_000},
		{name: "oneCPU", input: "1", expected: 1_000_000_000},
		{name: "twoCPUs", input: "2", expected: 2_000_000_000},
		{name: "invalidReturnsZero", input: "abc", expected: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseCPULimit(tt.input)
			if result != tt.expected {
				t.Errorf("parseCPULimit(%q) = %d, want %d", tt.input, result, tt.expected)
			}
		})
	}
}

func TestParseMemoryLimit(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected int64
	}{
		{name: "emptyReturnsZero", input: "", expected: 0},
		{name: "megabytes", input: "512m", expected: 512 * 1024 * 1024},
		{name: "gigabytes", input: "1g", expected: 1024 * 1024 * 1024},
		{name: "kilobytes", input: "1024k", expected: 1024 * 1024},
		{name: "rawBytes", input: "1073741824", expected: 1073741824},
		{name: "invalidReturnsZero", input: "xyz", expected: 0},
		{name: "uppercaseMega", input: "256M", expected: 256 * 1024 * 1024},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseMemoryLimit(tt.input)
			if result != tt.expected {
				t.Errorf("parseMemoryLimit(%q) = %d, want %d", tt.input, result, tt.expected)
			}
		})
	}
}

func TestParseRepoTag(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantRepo string
		wantTag  string
	}{
		{name: "standardTag", input: "myimage:v1", wantRepo: "myimage", wantTag: "v1"},
		{name: "latestDefault", input: "myimage", wantRepo: "myimage", wantTag: "latest"},
		{name: "registryWithPort", input: "registry.example.com:5000/myimage:v2", wantRepo: "registry.example.com:5000/myimage", wantTag: "v2"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo, tag := parseRepoTag(tt.input)
			if repo != tt.wantRepo {
				t.Errorf("parseRepoTag(%q) repo = %q, want %q", tt.input, repo, tt.wantRepo)
			}
			if tag != tt.wantTag {
				t.Errorf("parseRepoTag(%q) tag = %q, want %q", tt.input, tag, tt.wantTag)
			}
		})
	}
}

func TestCalculateCPUPercent(t *testing.T) {
	tests := []struct {
		name     string
		stats    container.StatsResponse
		expected float64
	}{
		{
			name: "zeroDeltaReturnsZero",
			stats: container.StatsResponse{
				Stats: container.Stats{
					CPUStats:    container.CPUStats{CPUUsage: container.CPUUsage{TotalUsage: 100}, SystemUsage: 1000, OnlineCPUs: 2},
					PreCPUStats: container.CPUStats{CPUUsage: container.CPUUsage{TotalUsage: 100}, SystemUsage: 1000},
				},
			},
			expected: 0,
		},
		{
			name: "normalUsage",
			stats: container.StatsResponse{
				Stats: container.Stats{
					CPUStats:    container.CPUStats{CPUUsage: container.CPUUsage{TotalUsage: 200}, SystemUsage: 2000, OnlineCPUs: 2},
					PreCPUStats: container.CPUStats{CPUUsage: container.CPUUsage{TotalUsage: 100}, SystemUsage: 1000},
				},
			},
			expected: 20.0, // (100/1000) * 2 * 100
		},
		{
			name: "zeroOnlineCPUsDefaultsToOne",
			stats: container.StatsResponse{
				Stats: container.Stats{
					CPUStats:    container.CPUStats{CPUUsage: container.CPUUsage{TotalUsage: 200}, SystemUsage: 2000, OnlineCPUs: 0},
					PreCPUStats: container.CPUStats{CPUUsage: container.CPUUsage{TotalUsage: 100}, SystemUsage: 1000},
				},
			},
			expected: 10.0, // (100/1000) * 1 * 100
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := calculateCPUPercent(tt.stats)
			if result != tt.expected {
				t.Errorf("calculateCPUPercent() = %f, want %f", result, tt.expected)
			}
		})
	}
}

func TestAggregateNetworkBytes(t *testing.T) {
	stats := container.StatsResponse{
		Networks: map[string]container.NetworkStats{
			"eth0": {RxBytes: 100, TxBytes: 200},
			"eth1": {RxBytes: 50, TxBytes: 75},
		},
	}

	rx, tx := aggregateNetworkBytes(stats)

	if rx != 150 {
		t.Errorf("expected rx=150, got %d", rx)
	}
	if tx != 275 {
		t.Errorf("expected tx=275, got %d", tx)
	}
}

func TestAggregateNetworkBytesEmpty(t *testing.T) {
	stats := container.StatsResponse{}

	rx, tx := aggregateNetworkBytes(stats)

	if rx != 0 || tx != 0 {
		t.Errorf("expected rx=0 tx=0, got rx=%d tx=%d", rx, tx)
	}
}

func TestRealDockerClientImplementsInterface(t *testing.T) {
	// Compile-time check that RealDockerClient satisfies DockerClient.
	var _ DockerClient = (*RealDockerClient)(nil)
}
