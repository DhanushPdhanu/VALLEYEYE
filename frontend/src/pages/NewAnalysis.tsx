import { useState } from 'react';
import { api, ValleyeyeApiError } from '../api/client';

interface NewAnalysisProps {
  onJobCreated: (jobId: string) => void;
}

const DEFAULT_AOI = JSON.stringify({
  type: 'Polygon',
  coordinates: [[[85.2, 27.85], [85.5, 27.85], [85.5, 28.1], [85.2, 28.1], [85.2, 27.85]]]
}, null, 2);

function validateGeoJSON(text: string): { valid: boolean; error?: string; geojson?: Record<string, unknown> } {
  try {
    const obj = JSON.parse(text);
    if (!obj.type) return { valid: false, error: 'Missing "type" field' };
    const validTypes = ['Polygon', 'MultiPolygon', 'Feature', 'FeatureCollection'];
    if (!validTypes.includes(obj.type)) return { valid: false, error: `Type must be one of: ${validTypes.join(', ')}` };
    return { valid: true, geojson: obj };
  } catch (e) {
    return { valid: false, error: `JSON parse error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export default function NewAnalysis({ onJobCreated }: NewAnalysisProps) {
  const [aoiText, setAoiText] = useState(DEFAULT_AOI);
  const [eventDate, setEventDate] = useState('');
  const [noCache, setNoCache] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aoiError, setAoiError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  function handleAoiChange(text: string) {
    setAoiText(text);
    const { valid, error: err } = validateGeoJSON(text);
    setAoiError(valid ? null : err || 'Invalid GeoJSON');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const { valid, error: aoiErr, geojson } = validateGeoJSON(aoiText);
    if (!valid) {
      setAoiError(aoiErr || 'Invalid GeoJSON');
      return;
    }
    if (!eventDate) {
      setError('Please select an event date.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.createJob({
        aoi_geojson: geojson!,
        event_date: eventDate,
      });

      // Persist job ID to history
      const saved = localStorage.getItem('valleyeye_jobs');
      const ids: string[] = saved ? JSON.parse(saved) : [];
      if (!ids.includes(result.job_id)) {
        ids.unshift(result.job_id);
        localStorage.setItem('valleyeye_jobs', JSON.stringify(ids.slice(0, 20)));
      }

      onJobCreated(result.job_id);
    } catch (err) {
      if (err instanceof ValleyeyeApiError) {
        setError(`${err.apiError.code}: ${err.apiError.message}`);
      } else {
        setError('Failed to submit job. Is the backend running?');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-main">
      <div className="page-header">
        <h1 className="page-title">New Analysis</h1>
        <p className="page-subtitle">Define your area of interest and flood event date to start a Sentinel-1 analysis.</p>
      </div>
      <div className="page-content">
        {error && (
          <div className="alert alert-error">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* AOI */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Area of Interest (AOI)</h2>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="alert alert-info">
                <span>ℹ️</span>
                <div>
                  <strong>GeoJSON format required.</strong> Paste a Polygon, MultiPolygon, Feature, or
                  FeatureCollection. Coordinate order is [longitude, latitude] in WGS84.
                  The AOI must be between 0.1 km² and 5000 km².
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">GeoJSON Geometry</label>
                <textarea
                  className={`form-textarea${aoiError ? ' error' : ''}`}
                  rows={12}
                  value={aoiText}
                  onChange={e => handleAoiChange(e.target.value)}
                  placeholder='{"type": "Polygon", "coordinates": [[[lon, lat], ...]]}'
                  spellCheck={false}
                  style={{ fontFamily: 'monospace', fontSize: 12.5 }}
                />
                {aoiError && <span className="form-error">{aoiError}</span>}
                {!aoiError && <span className="form-hint">Valid GeoJSON ✓</span>}
              </div>

              <div>
                <p className="form-hint" style={{ marginBottom: 8 }}>
                  <strong>Example AOIs:</strong>
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => handleAoiChange(JSON.stringify({
                      type: 'Polygon',
                      coordinates: [[[85.2, 27.85], [85.5, 27.85], [85.5, 28.1], [85.2, 28.1], [85.2, 27.85]]]
                    }, null, 2))}
                  >
                    🌏 Trishuli Valley, Nepal
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => handleAoiChange(JSON.stringify({
                      type: 'Polygon',
                      coordinates: [[[85.0, 27.5], [85.8, 27.5], [85.8, 28.3], [85.0, 28.3], [85.0, 27.5]]]
                    }, null, 2))}
                  >
                    🌏 Larger Nepal region
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Event date */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Flood Event Date</h2>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="alert alert-warning">
                <span>📅</span>
                <div>
                  The event date is used to search for Sentinel-1 pre/post-event acquisitions.
                  The system will search within a configurable time window around this date.
                  Event date cannot be in the future.
                </div>
              </div>

              <div className="form-group" style={{ maxWidth: 240 }}>
                <label className="form-label">Event Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={eventDate}
                  max={today}
                  onChange={e => setEventDate(e.target.value)}
                  required
                />
                <span className="form-hint">Date of the flood event (YYYY-MM-DD)</span>
              </div>

              <div>
                <p className="form-hint" style={{ marginBottom: 8 }}>
                  <strong>Case study:</strong>
                </p>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setEventDate('2026-08-10')}
                >
                  📆 Aug 2026 Trishuli Flood
                </button>
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Options</h2>
            </div>
            <div className="card-body">
              <label className="layer-toggle" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={noCache}
                  onChange={e => setNoCache(e.target.checked)}
                />
                <span className="layer-toggle-label">
                  <strong>Bypass stage cache</strong> — force fresh downloads and processing even if cached results exist
                </span>
              </label>
            </div>
          </div>

          {/* Submit */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={submitting || !!aoiError}
            >
              {submitting ? (
                <><span className="spinner" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }} /> Submitting…</>
              ) : (
                '▶ Start Analysis'
              )}
            </button>
          </div>
        </form>

        {/* Info block */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Pipeline Stages</h2>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {[
                ['🛰 Discovery', 'Find Sentinel-1 GRD acquisitions over your AOI'],
                ['🔗 Pairing', 'Select the best pre/post-event scene pair'],
                ['⚙️ Preprocessing', 'SNAP calibration, filtering, terrain correction'],
                ['🧠 Inference', 'SNUNet flood segmentation model'],
                ['🌊 Hazard', 'Flood/debris-candidate vector products'],
                ['🗺 OSM', 'Historical infrastructure data via ohsome API'],
                ['🏗 Infrastructure', 'Building, road, bridge exposure analysis'],
                ['🔌 Connectivity', 'Road-network connectivity analysis'],
                ['📄 Results', 'Final report and artifact packaging'],
              ].map(([name, desc]) => (
                <div key={name} style={{ padding: '10px 12px', background: 'var(--color-surface-alt)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-light)' }}>
                  <div className="font-medium text-sm">{name}</div>
                  <div className="text-xs text-muted mt-4">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
