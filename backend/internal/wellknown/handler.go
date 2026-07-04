package wellknown

import (
	"encoding/json"
	"net/http"

	"github.com/DowLucas/strong-notes-backend/internal/config"
)

// ProtocolVersion is the single wire-protocol the current server build speaks.
// Bump only when adding a required new endpoint or making a breaking shape
// change. Additive/optional changes do not bump — advertise those via
// instance.features instead.
const ProtocolVersion = 1

// InstanceInfo is the body served at /.well-known/scaffold-instance. The app
// reads it on launch to learn the server's instance mode, protocol bounds, and
// which optional features are enabled.
type InstanceInfo struct {
	Name         string   `json:"name"`
	Version      string   `json:"version"`
	InstanceMode string   `json:"instance_mode"`
	Protocol     Protocol `json:"protocol"`
	Features     Features `json:"features"`
}

type Protocol struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

type Features struct {
	Storage bool `json:"storage"`
	Jobs    bool `json:"jobs"`
}

// Handler serves the instance descriptor. storageEnabled reflects whether an
// S3/MinIO client was wired up at boot.
func Handler(cfg *config.Config, version string, storageEnabled bool) http.HandlerFunc {
	info := buildInfo(cfg, version, storageEnabled)
	b, _ := json.Marshal(info)

	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(b)
	}
}

func buildInfo(cfg *config.Config, version string, storageEnabled bool) InstanceInfo {
	return InstanceInfo{
		Name:         "Scaffold",
		Version:      version,
		InstanceMode: cfg.InstanceMode,
		Protocol: Protocol{
			Min: cfg.MinAppProtocol,
			Max: cfg.MaxAppProtocol,
		},
		Features: Features{
			Storage: storageEnabled,
			Jobs:    cfg.JobsEnabled,
		},
	}
}
