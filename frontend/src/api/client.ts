// VALLEYEYE API Client
// Centralised HTTP client for all backend communication.
// Backend URL is read from VITE_API_URL (defaults to localhost:8000).

const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

export interface ApiError {
  code: string;
  message: string;
  stage: string;
  retryable: boolean;
  details: Record<string, unknown>;
  request_id: string;
}

class ValleyeyeApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly apiError: ApiError,
  ) {
    super(apiError.message);
    this.name = 'ValleyeyeApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let errBody: { error?: ApiError } = {};
    try {
      errBody = await res.json();
    } catch {
      // ignore parse failure
    }
    const apiErr: ApiError = errBody.error || {
      code: 'HTTP_ERROR',
      message: `HTTP ${res.status}`,
      stage: 'UNKNOWN',
      retryable: res.status >= 500,
      details: {},
      request_id: res.headers.get('X-Request-ID') || '',
    };
    throw new ValleyeyeApiError(res.status, apiErr);
  }
  return res.json() as Promise<T>;
}

// ── Health ────────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: string;
  version: string;
}

export interface ReadyResponse {
  status: string;
  checks: Record<string, string>;
}

export const api = {
  health(): Promise<HealthResponse> {
    return request('/health');
  },

  ready(): Promise<ReadyResponse> {
    return request('/ready');
  },

  // ── Jobs ──────────────────────────────────────────────────────────────────

  createJob(payload: {
    aoi_geojson: Record<string, unknown>;
    event_date: string;
  }): Promise<{
    job_id: string;
    status: string;
    status_url: string;
    no_cache: boolean;
  }> {
    return request('/api/v1/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getJob(jobId: string): Promise<JobRecord> {
    return request(`/api/v1/jobs/${jobId}`);
  },

  cancelJob(jobId: string): Promise<JobRecord> {
    return request(`/api/v1/jobs/${jobId}/cancel`, { method: 'POST' });
  },

  getSummary(jobId: string): Promise<AnalysisDocument> {
    return request(`/api/v1/jobs/${jobId}/summary`);
  },

  getLayers(jobId: string): Promise<{ layers: LayerDescriptor[] }> {
    return request(`/api/v1/jobs/${jobId}/layers`);
  },

  getLayerUrl(jobId: string, artifactPath: string): string {
    return `${API_BASE}/api/v1/jobs/${jobId}/layers/${artifactPath}`;
  },

  getReportUrl(jobId: string): string {
    return `${API_BASE}/api/v1/jobs/${jobId}/report`;
  },

  getProvenanceUrl(jobId: string): string {
    return `${API_BASE}/api/v1/jobs/${jobId}/provenance`;
  },

  baseUrl(): string {
    return API_BASE;
  },
};

export { ValleyeyeApiError };

// ── Type definitions matching the backend schemas ─────────────────────────────

export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
export type StageStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

export interface StageRecord {
  name: string;
  status: StageStatus;
  progress: number;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  cache: 'hit' | 'miss' | 'bypass' | 'unavailable';
  warnings: string[];
}

export interface JobError {
  code: string;
  message: string;
  stage: string;
  retryable: boolean;
  details: Record<string, unknown>;
}

export interface ArtifactDescriptor {
  path: string;
  sha256: string;
  size_bytes: number;
  media_type: string;
}

export interface JobRecord {
  job_id: string;
  status: JobStatus;
  current_stage: string | null;
  progress: number;
  no_cache: boolean;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  warnings: string[];
  error: JobError | null;
  stages: StageRecord[];
  artifacts: Record<string, ArtifactDescriptor>;
  stage_count: number;
  results_available: boolean;
}

export interface LayerDescriptor {
  path: string;
  sha256: string;
  size_bytes: number;
  media_type: string;
  url: string;
}

export interface SceneSummary {
  scene_id: string;
  platform: string | null;
  acquired_at: string | null;
  product_type: string | null;
  instrument_mode: string | null;
  polarizations: string[];
  orbit_direction: string | null;
  relative_orbit: number | null;
  aoi_coverage_fraction: number | null;
}

export interface AnalysisDocument {
  schema_version: string;
  job_id: string;
  status: 'SUCCEEDED' | 'PARTIAL';
  aoi: Record<string, unknown>;
  aoi_summary: {
    aoi_area_km2: number | null;
    aoi_bbox_wgs84: number[];
    coordinate_reference_system: string;
  };
  event_date: string;
  scenes: {
    discovery: {
      initial_window_days: number | null;
      scene_count: number | null;
    };
    pairing: {
      pre: SceneSummary | null;
      post: SceneSummary | null;
      score: number | null;
      criteria: Record<string, number>;
      alternatives: Record<string, unknown>[];
      warnings: string[];
      search_window_days: number | null;
    };
  };
  hazards: {
    preprocessing: {
      crs: string | null;
      processing_steps: string[];
    };
    inference: {
      valid_pixel_fraction: number | null;
      valid_pixels: number | null;
      flooded_pixels: number | null;
      flooded_area_km2: number | null;
      model_sha256: string | null;
      model_name: string | null;
      model_version: string | null;
    };
    hazard: {
      flood_polygon_count: number | null;
      debris_candidate_count: number | null;
      flood_layer: string | null;
      debris_candidate_layer: string | null;
    };
  };
  infrastructure: {
    osm: {
      provider: string | null;
      snapshot_at: string | null;
      feature_count: number | null;
      attribution: string | null;
      license: string | null;
      quality: Record<string, number>;
      layer: string | null;
      provenance: Record<string, unknown>;
    };
    exposure: {
      building_summary: {
        total_count: number | null;
        affected_count: number | null;
        total_area_km2: number | null;
        affected_area_km2: number | null;
        affected_fraction: number | null;
      };
      bridge_affected_count: number | null;
      bridge_count: number | null;
      road_summary: {
        segment_count: number | null;
        open_km: number | null;
        potentially_blocked_km: number | null;
        blocked_km: number | null;
        unknown_coverage_km: number | null;
      };
      segment_count: number | null;
      road_layer: string | null;
      building_layer: string | null;
      bridge_layer: string | null;
      coverage_available: boolean | null;
    };
  };
  connectivity: {
    summary: {
      connected: number | null;
      detour: number | null;
      cut_off: number | null;
      no_baseline_access: number | null;
    };
    settlement_count: number | null;
    layer: string | null;
    most_affected_settlements: Array<{
      settlement_id: string;
      name: string | null;
      status: 'DETOUR' | 'CUT_OFF';
      before_distance_m: number | null;
      after_distance_m: number | null;
      before_time_s: number | null;
      after_time_s: number | null;
      detour_ratio: number | null;
      nearest_source_before: string | null;
      nearest_source_after: string | null;
      blocking_road_ids: string[];
    }>;
  };
  provenance: Record<string, unknown>;
  warnings: string[];
}
