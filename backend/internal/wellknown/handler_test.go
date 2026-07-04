package wellknown

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DowLucas/strong-notes-backend/internal/config"
)

func TestHandler_AdvertisesInstanceFields(t *testing.T) {
	cfg := &config.Config{
		InstanceMode:   "selfhost",
		MinAppProtocol: 0,
		MaxAppProtocol: 1,
		JobsEnabled:    false,
	}
	h := Handler(cfg, "0.1.0", true)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/.well-known/scaffold-instance", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}

	var got InstanceInfo
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if got.Name != "Scaffold" {
		t.Errorf("name: want Scaffold, got %q", got.Name)
	}
	if got.Version != "0.1.0" {
		t.Errorf("version: want 0.1.0, got %q", got.Version)
	}
	if got.InstanceMode != "selfhost" {
		t.Errorf("instance_mode: want selfhost, got %q", got.InstanceMode)
	}
	if got.Protocol.Min != 0 || got.Protocol.Max != 1 {
		t.Errorf("protocol bounds: want {0,1}, got %+v", got.Protocol)
	}
	if !got.Features.Storage {
		t.Errorf("features.storage: want true, got false")
	}
	if got.Features.Jobs {
		t.Errorf("features.jobs: want false, got true")
	}
}

func TestHandler_ReflectsConfiguredFeatures(t *testing.T) {
	cfg := &config.Config{
		InstanceMode:   "selfhost",
		MinAppProtocol: 1,
		MaxAppProtocol: 3,
		JobsEnabled:    true,
	}
	h := Handler(cfg, "0.1.0", false)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/.well-known/scaffold-instance", nil)
	h.ServeHTTP(rr, req)

	var got InstanceInfo
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Protocol.Min != 1 || got.Protocol.Max != 3 {
		t.Errorf("protocol bounds: want {1,3}, got %+v", got.Protocol)
	}
	if got.Features.Storage {
		t.Errorf("features.storage: want false, got true")
	}
	if !got.Features.Jobs {
		t.Errorf("features.jobs: want true, got false")
	}
}
