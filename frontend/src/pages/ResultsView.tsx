import { useState, useEffect } from 'react';
import { api, LayerDescriptor, AnalysisDocument } from '../api/client';
import FloodMap from '../components/FloodMap';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface ResultsViewProps {
  jobId: string;
  summary: AnalysisDocument;
}

function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function fmtInt(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-IN');
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('en-IN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
}

type Tab = 'overview' | 'satellite' | 'flood' | 'infrastructure' | 'connectivity' | 'report';

export default function ResultsView({ jobId, summary }: ResultsViewProps) {
  const [tab, setTab] = useState<Tab>('overview');
  const [layers, setLayers] = useState<LayerDescriptor[]>([]);
  const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.getLayers(jobId).then(r => {
      setLayers(r.layers);
      // Default all layers visible
      const vis: Record<string, boolean> = {};
      r.layers.forEach(l => { vis[l.path] = true; });
      setVisibleLayers(vis);
    }).catch(() => {});
  }, [jobId]);

  const geojsonLayers = layers.filter(l => l.media_type === 'application/geo+json');
  const inf = summary.infrastructure;
  const conn = summary.connectivity;
  const hazard = summary.hazards;
  const scenes = summary.scenes;

  return (
    <div className="app-main">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 className="page-title">Analysis Results</h1>
            <p className="page-subtitle text-sm">
              <span className={`badge badge-${summary.status.toLowerCase()}`} style={{ marginRight: 8 }}>{summary.status}</span>
              Event: {summary.event_date} &middot; Job: <code style={{ fontSize: 11 }}>{jobId.slice(0, 8)}…</code>
            </p>
          </div>
          <a href={api.getReportUrl(jobId)} target="_blank" rel="noreferrer" className="btn btn-secondary">
            📄 Open Report
          </a>
        </div>
      </div>
      <div className="page-content">
        {/* Tab bar */}
        <div className="tabs">
          {(['overview', 'satellite', 'flood', 'infrastructure', 'connectivity', 'report'] as Tab[]).map(t => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="stat-grid">
              <div className="stat-card">
                <span className="stat-label">AOI Area</span>
                <span className="stat-value">{fmtNum(summary.aoi_summary.aoi_area_km2)}<span className="stat-unit">km²</span></span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Flooded Area</span>
                <span className="stat-value" style={{ color: 'var(--color-flood)' }}>
                  {fmtNum(hazard.inference.flooded_area_km2)}<span className="stat-unit">km²</span>
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Flood Polygons</span>
                <span className="stat-value">{fmtInt(hazard.hazard.flood_polygon_count)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Affected Buildings</span>
                <span className="stat-value">{fmtInt(inf.exposure.building_summary.affected_count)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Affected Bridges</span>
                <span className="stat-value">{fmtInt(inf.exposure.bridge_affected_count)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Cut-off Settlements</span>
                <span className="stat-value" style={{ color: conn.summary.cut_off ? 'var(--color-error)' : undefined }}>
                  {fmtInt(conn.summary.cut_off)}
                </span>
              </div>
            </div>

            {/* Road summary chart */}
            {(inf.exposure.road_summary.open_km != null || inf.exposure.road_summary.potentially_blocked_km != null) && (
              <div className="card">
                <div className="card-header"><h2 className="card-title">Road Exposure Summary</h2></div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={[
                      { name: 'Open', km: inf.exposure.road_summary.open_km || 0, color: '#2e7d32' },
                      { name: 'Potentially blocked', km: inf.exposure.road_summary.potentially_blocked_km || 0, color: '#e65100' },
                      { name: 'Blocked', km: inf.exposure.road_summary.blocked_km || 0, color: '#c62828' },
                      { name: 'Unknown', km: inf.exposure.road_summary.unknown_coverage_km || 0, color: '#9e9e9e' },
                    ]} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: any) => [`${typeof v === 'number' ? v.toFixed(2) : (v ?? '')} km`, 'Length']} />
                      <Bar dataKey="km" radius={[3, 3, 0, 0]}>
                        {[0,1,2,3].map(i => (
                          <Cell key={i} fill={['#2e7d32','#e65100','#c62828','#9e9e9e'][i]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Connectivity summary */}
            {conn.summary.cut_off != null && (
              <div className="card">
                <div className="card-header"><h2 className="card-title">Settlement Connectivity</h2></div>
                <div className="card-body">
                  <div className="stat-grid">
                    <div className="stat-card"><span className="stat-label">Connected</span><span className="stat-value" style={{ color: 'var(--color-success)' }}>{fmtInt(conn.summary.connected)}</span></div>
                    <div className="stat-card"><span className="stat-label">Detour</span><span className="stat-value" style={{ color: 'var(--color-warning)' }}>{fmtInt(conn.summary.detour)}</span></div>
                    <div className="stat-card"><span className="stat-label">Cut off</span><span className="stat-value" style={{ color: 'var(--color-error)' }}>{fmtInt(conn.summary.cut_off)}</span></div>
                    <div className="stat-card"><span className="stat-label">No baseline access</span><span className="stat-value">{fmtInt(conn.summary.no_baseline_access)}</span></div>
                  </div>
                </div>
              </div>
            )}

            {/* Warnings */}
            {summary.warnings && summary.warnings.length > 0 && (
              <div className="alert alert-warning">
                <span>⚠️</span>
                <div>
                  <strong>Analysis Warnings</strong>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                    {summary.warnings.map((w, i) => <li key={i} className="text-sm">{w}</li>)}
                  </ul>
                </div>
              </div>
            )}

            <div className="alert alert-info">
              <span>ℹ️</span>
              <p className="text-sm">Infrastructure values indicate <strong>potential exposure</strong>, not confirmed physical damage. A road or building intersecting the flood mask does not prove it is impassable or destroyed.</p>
            </div>
          </div>
        )}

        {/* SATELLITE */}
        {tab === 'satellite' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-header"><h2 className="card-title">Pre-Event Scene</h2></div>
              <div className="card-body">
                {scenes.pairing.pre ? (
                  <div>
                    <div className="info-row"><span className="info-key">Scene ID</span><span className="info-val" style={{ fontFamily: 'monospace', fontSize: 12 }}>{scenes.pairing.pre.scene_id}</span></div>
                    <div className="info-row"><span className="info-key">Platform</span><span className="info-val">{scenes.pairing.pre.platform ?? '—'}</span></div>
                    <div className="info-row"><span className="info-key">Acquired</span><span className="info-val">{fmtDate(scenes.pairing.pre.acquired_at)}</span></div>
                    <div className="info-row"><span className="info-key">Mode</span><span className="info-val">{scenes.pairing.pre.instrument_mode ?? '—'}</span></div>
                    <div className="info-row"><span className="info-key">Polarizations</span><span className="info-val">{scenes.pairing.pre.polarizations.join(', ') || '—'}</span></div>
                    <div className="info-row"><span className="info-key">Orbit direction</span><span className="info-val">{scenes.pairing.pre.orbit_direction ?? '—'}</span></div>
                    <div className="info-row"><span className="info-key">AOI coverage</span><span className="info-val">{scenes.pairing.pre.aoi_coverage_fraction != null ? `${(scenes.pairing.pre.aoi_coverage_fraction * 100).toFixed(1)}%` : '—'}</span></div>
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: '24px 0' }}>
                    <span className="empty-state-icon">🛰</span>
                    <p className="empty-state-title">No pre-event scene</p>
                    <p className="empty-state-text">Scene pairing did not complete or no suitable pre-event acquisition was found.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h2 className="card-title">Post-Event Scene</h2></div>
              <div className="card-body">
                {scenes.pairing.post ? (
                  <div>
                    <div className="info-row"><span className="info-key">Scene ID</span><span className="info-val" style={{ fontFamily: 'monospace', fontSize: 12 }}>{scenes.pairing.post.scene_id}</span></div>
                    <div className="info-row"><span className="info-key">Platform</span><span className="info-val">{scenes.pairing.post.platform ?? '—'}</span></div>
                    <div className="info-row"><span className="info-key">Acquired</span><span className="info-val">{fmtDate(scenes.pairing.post.acquired_at)}</span></div>
                    <div className="info-row"><span className="info-key">Mode</span><span className="info-val">{scenes.pairing.post.instrument_mode ?? '—'}</span></div>
                    <div className="info-row"><span className="info-key">Polarizations</span><span className="info-val">{scenes.pairing.post.polarizations.join(', ') || '—'}</span></div>
                    <div className="info-row"><span className="info-key">Orbit direction</span><span className="info-val">{scenes.pairing.post.orbit_direction ?? '—'}</span></div>
                    <div className="info-row"><span className="info-key">AOI coverage</span><span className="info-val">{scenes.pairing.post.aoi_coverage_fraction != null ? `${(scenes.pairing.post.aoi_coverage_fraction * 100).toFixed(1)}%` : '—'}</span></div>
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: '24px 0' }}>
                    <span className="empty-state-icon">🛰</span>
                    <p className="empty-state-title">No post-event scene</p>
                    <p className="empty-state-text">Scene pairing did not complete or no suitable post-event acquisition was found.</p>
                  </div>
                )}
              </div>
            </div>

            {scenes.pairing.score != null && (
              <div className="card">
                <div className="card-header"><h2 className="card-title">Pairing Quality</h2></div>
                <div className="card-body">
                  <div className="info-row"><span className="info-key">Pair score</span><span className="info-val">{scenes.pairing.score.toFixed(3)}</span></div>
                  <div className="info-row"><span className="info-key">Search window</span><span className="info-val">{scenes.pairing.search_window_days ?? '—'} days</span></div>
                  {Object.entries(scenes.pairing.criteria).map(([k, v]) => (
                    <div key={k} className="info-row"><span className="info-key">{k}</span><span className="info-val">{v.toFixed(3)}</span></div>
                  ))}
                  {scenes.pairing.warnings.map((w, i) => (
                    <div key={i} className="alert alert-warning mt-8 text-sm"><span>⚠</span>{w}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="alert alert-info">
              <span>ℹ️</span>
              <p className="text-sm">Sentinel-1 SAR is the primary flood-detection evidence. Sentinel-2 optical is complementary and may be unavailable due to cloud cover or acquisition timing. Raw imagery is not displayed in-browser — metadata and derived products are shown here.</p>
            </div>
          </div>
        )}

        {/* FLOOD */}
        {tab === 'flood' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Flood Extent Map</h2>
                {geojsonLayers.length > 0 && (
                  <span className="text-xs text-muted">{geojsonLayers.length} layers available</span>
                )}
              </div>
              {/* Layer toggles */}
              {geojsonLayers.length > 0 && (
                <div className="card-body" style={{ padding: '8px 18px', borderBottom: '1px solid var(--color-border-light)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {geojsonLayers.map(l => (
                    <label key={l.path} className="layer-toggle">
                      <input
                        type="checkbox"
                        checked={visibleLayers[l.path] !== false}
                        onChange={e => setVisibleLayers(prev => ({ ...prev, [l.path]: e.target.checked }))}
                      />
                      <span className="layer-toggle-label">{l.path.replace(/^[^/]+\//, '')}</span>
                    </label>
                  ))}
                </div>
              )}
              <div style={{ height: 480, position: 'relative' }}>
                {geojsonLayers.length > 0 ? (
                  <FloodMap
                    jobId={jobId}
                    summary={summary}
                    layers={geojsonLayers}
                    visibleLayers={visibleLayers}
                  />
                ) : (
                  <div className="empty-state" style={{ height: '100%' }}>
                    <span className="empty-state-icon">🗺</span>
                    <p className="empty-state-title">No GeoJSON layers available</p>
                    <p className="empty-state-text">Flood layer outputs were not produced. The preprocessing or inference stage may not have completed successfully.</p>
                  </div>
                )}
              </div>
              {/* Legend */}
              {geojsonLayers.length > 0 && (
                <div className="card-body" style={{ paddingTop: 8 }}>
                  <div className="map-legend" style={{ display: 'inline-block' }}>
                    <div className="legend-title">Map Legend</div>
                    <div className="legend-item"><div className="legend-swatch" style={{ background: '#1565c0' }} /><span>Flood extent</span></div>
                    <div className="legend-item"><div className="legend-swatch" style={{ background: '#f57c00' }} /><span>Debris candidates</span></div>
                    <div className="legend-item"><div className="legend-swatch" style={{ background: '#c62828' }} /><span>Bridges (affected)</span></div>
                    <div className="legend-item"><div className="legend-swatch" style={{ background: '#555' }} /><span>Roads</span></div>
                    <div className="legend-item"><div className="legend-swatch" style={{ background: '#8e44ad' }} /><span>Buildings</span></div>
                    <div className="legend-item">
                      <div style={{ width: 16, height: 10, border: '2px dashed #1565c0', background: 'rgba(21,101,192,0.05)', borderRadius: 2 }} />
                      <span>AOI boundary</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Inference stats */}
            <div className="card">
              <div className="card-header"><h2 className="card-title">Inference Statistics</h2></div>
              <div className="card-body">
                <div className="info-row"><span className="info-key">Model</span><span className="info-val">{hazard.inference.model_name ?? '—'}</span></div>
                <div className="info-row"><span className="info-key">Model version</span><span className="info-val">{hazard.inference.model_version ?? '—'}</span></div>
                <div className="info-row"><span className="info-key">Model SHA-256</span><span className="info-val" style={{ fontFamily: 'monospace', fontSize: 11 }}>{hazard.inference.model_sha256?.slice(0, 16) ?? '—'}…</span></div>
                <div className="info-row"><span className="info-key">Flooded area</span><span className="info-val">{fmtNum(hazard.inference.flooded_area_km2)} km²</span></div>
                <div className="info-row"><span className="info-key">Flooded pixels</span><span className="info-val">{fmtInt(hazard.inference.flooded_pixels)}</span></div>
                <div className="info-row"><span className="info-key">Valid pixels</span><span className="info-val">{fmtInt(hazard.inference.valid_pixels)}</span></div>
                <div className="info-row"><span className="info-key">Valid pixel fraction</span><span className="info-val">{hazard.inference.valid_pixel_fraction != null ? `${(hazard.inference.valid_pixel_fraction * 100).toFixed(1)}%` : '—'}</span></div>
                <div className="info-row"><span className="info-key">Processing CRS</span><span className="info-val">{hazard.preprocessing.crs ?? '—'}</span></div>
                {hazard.preprocessing.processing_steps.length > 0 && (
                  <div className="info-row">
                    <span className="info-key">Processing steps</span>
                    <span className="info-val">{hazard.preprocessing.processing_steps.join(' → ')}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="alert alert-warning">
              <span>⚠️</span>
              <p className="text-sm">Debris-change candidates indicate potential backscatter changes only — they do not confirm debris deposition. The flood mask uses a {'>'}0.5 probability threshold on the SNUNet output and may include false positives near open water and urban areas.</p>
            </div>
          </div>
        )}

        {/* INFRASTRUCTURE */}
        {tab === 'infrastructure' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-header"><h2 className="card-title">Building Exposure</h2></div>
              <div className="card-body">
                <div className="stat-grid">
                  <div className="stat-card"><span className="stat-label">Total assessed</span><span className="stat-value">{fmtInt(inf.exposure.building_summary.total_count)}</span></div>
                  <div className="stat-card"><span className="stat-label">Potentially affected</span><span className="stat-value" style={{ color: 'var(--color-warning)' }}>{fmtInt(inf.exposure.building_summary.affected_count)}</span></div>
                  <div className="stat-card"><span className="stat-label">Affected fraction</span><span className="stat-value">{inf.exposure.building_summary.affected_fraction != null ? `${(inf.exposure.building_summary.affected_fraction * 100).toFixed(1)}%` : '—'}</span></div>
                  <div className="stat-card"><span className="stat-label">Affected area</span><span className="stat-value">{fmtNum(inf.exposure.building_summary.affected_area_km2)} <span className="stat-unit">km²</span></span></div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h2 className="card-title">Road Exposure</h2></div>
              <div className="card-body">
                <div className="info-row"><span className="info-key">Total segments</span><span className="info-val">{fmtInt(inf.exposure.road_summary.segment_count ?? inf.exposure.segment_count)}</span></div>
                <div className="info-row"><span className="info-key">Open (km)</span><span className="info-val" style={{ color: 'var(--color-success)' }}>{fmtNum(inf.exposure.road_summary.open_km)}</span></div>
                <div className="info-row"><span className="info-key">Potentially blocked (km)</span><span className="info-val" style={{ color: 'var(--color-warning)' }}>{fmtNum(inf.exposure.road_summary.potentially_blocked_km)}</span></div>
                <div className="info-row"><span className="info-key">Blocked (km)</span><span className="info-val" style={{ color: 'var(--color-error)' }}>{fmtNum(inf.exposure.road_summary.blocked_km)}</span></div>
                <div className="info-row"><span className="info-key">Unknown coverage (km)</span><span className="info-val">{fmtNum(inf.exposure.road_summary.unknown_coverage_km)}</span></div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h2 className="card-title">Bridge Assessment</h2></div>
              <div className="card-body">
                <div className="info-row"><span className="info-key">Total bridges assessed</span><span className="info-val">{fmtInt(inf.exposure.bridge_count)}</span></div>
                <div className="info-row"><span className="info-key">Potentially affected</span><span className="info-val" style={{ color: 'var(--color-error)' }}>{fmtInt(inf.exposure.bridge_affected_count)}</span></div>
                <div className="info-row"><span className="info-key">Flood coverage available</span><span className="info-val">{inf.exposure.coverage_available == null ? '—' : inf.exposure.coverage_available ? 'Yes' : 'No'}</span></div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h2 className="card-title">OSM Data Source</h2></div>
              <div className="card-body">
                <div className="info-row"><span className="info-key">Provider</span><span className="info-val">{inf.osm.provider ?? '—'}</span></div>
                <div className="info-row"><span className="info-key">Snapshot date</span><span className="info-val">{fmtDate(inf.osm.snapshot_at)}</span></div>
                <div className="info-row"><span className="info-key">Feature count</span><span className="info-val">{fmtInt(inf.osm.feature_count)}</span></div>
                <div className="info-row"><span className="info-key">Attribution</span><span className="info-val">{inf.osm.attribution ?? '—'}</span></div>
                <div className="info-row"><span className="info-key">License</span><span className="info-val">{inf.osm.license ?? '—'}</span></div>
              </div>
            </div>

            <div className="alert alert-info">
              <span>ℹ️</span>
              <p className="text-sm">Infrastructure counts reflect <strong>potential exposure</strong> based on geometric intersection with the flood mask. Physical passability or structural damage is not confirmed. Road coverage is marked unknown where satellite coverage is absent.</p>
            </div>
          </div>
        )}

        {/* CONNECTIVITY */}
        {tab === 'connectivity' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {conn.settlement_count != null ? (
              <>
                <div className="stat-grid">
                  <div className="stat-card"><span className="stat-label">Total settlements</span><span className="stat-value">{fmtInt(conn.settlement_count)}</span></div>
                  <div className="stat-card"><span className="stat-label">Connected</span><span className="stat-value" style={{ color: 'var(--color-success)' }}>{fmtInt(conn.summary.connected)}</span></div>
                  <div className="stat-card"><span className="stat-label">Detour</span><span className="stat-value" style={{ color: 'var(--color-warning)' }}>{fmtInt(conn.summary.detour)}</span></div>
                  <div className="stat-card"><span className="stat-label">Cut off</span><span className="stat-value" style={{ color: 'var(--color-error)' }}>{fmtInt(conn.summary.cut_off)}</span></div>
                  <div className="stat-card"><span className="stat-label">No baseline access</span><span className="stat-value">{fmtInt(conn.summary.no_baseline_access)}</span></div>
                </div>

                {conn.most_affected_settlements.length > 0 && (
                  <div className="card">
                    <div className="card-header">
                      <h2 className="card-title">Most Affected Settlements</h2>
                      <span className="text-xs text-muted">Top 5 by severity</span>
                    </div>
                    <div className="card-body p-0">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Settlement</th>
                            <th>Status</th>
                            <th>Before (s)</th>
                            <th>After (s)</th>
                            <th>Detour ratio</th>
                          </tr>
                        </thead>
                        <tbody>
                          {conn.most_affected_settlements.map(s => (
                            <tr key={s.settlement_id}>
                              <td>{s.name || s.settlement_id}</td>
                              <td>
                                <span className={`badge badge-${s.status === 'CUT_OFF' ? 'failed' : 'running'}`}>
                                  {s.status}
                                </span>
                              </td>
                              <td className="text-sm">{s.before_time_s != null ? s.before_time_s.toFixed(0) : '—'}</td>
                              <td className="text-sm">{s.after_time_s != null ? s.after_time_s.toFixed(0) : '∞'}</td>
                              <td className="text-sm">{s.detour_ratio != null ? `×${s.detour_ratio.toFixed(2)}` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state" style={{ padding: '48px 24px' }}>
                <span className="empty-state-icon">🔌</span>
                <p className="empty-state-title">Connectivity data not available</p>
                <p className="empty-state-text">The connectivity analysis stage did not produce results. This may be due to missing OSM data or the stage not completing.</p>
              </div>
            )}

            <div className="alert alert-info">
              <span>ℹ️</span>
              <p className="text-sm">Connectivity is analyzed using the OSM road network. CUT_OFF means no viable road path exists after removing flood-blocked edges. DETOUR means a longer route exists. Settlements without baseline OSM road access are reported separately. Rescue priorities should not be inferred from these results alone — field verification is required.</p>
            </div>
          </div>
        )}

        {/* REPORT */}
        {tab === 'report' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Situation Report</h2>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p className="text-sm text-secondary">
                  The situation report is generated from verified analysis results and includes flood extent,
                  infrastructure exposure, connectivity, and data provenance.
                </p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <a
                    href={api.getReportUrl(jobId)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-primary"
                  >
                    📄 Open Report (HTML)
                  </a>
                  <a
                    href={api.getProvenanceUrl(jobId)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-ghost"
                  >
                    🔍 Provenance / Manifest
                  </a>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h2 className="card-title">Data Provenance</h2></div>
              <div className="card-body">
                <div className="info-row"><span className="info-key">Schema version</span><span className="info-val">{summary.schema_version}</span></div>
                <div className="info-row"><span className="info-key">Job ID</span><span className="info-val" style={{ fontFamily: 'monospace', fontSize: 12 }}>{summary.job_id}</span></div>
                <div className="info-row"><span className="info-key">Event date</span><span className="info-val">{summary.event_date}</span></div>
                <div className="info-row"><span className="info-key">Analysis status</span><span className="info-val">{summary.status}</span></div>
                <div className="info-row"><span className="info-key">Model</span><span className="info-val">{hazard.inference.model_name ?? '—'}</span></div>
                <div className="info-row"><span className="info-key">OSM snapshot</span><span className="info-val">{fmtDate(inf.osm.snapshot_at)}</span></div>
                <div className="info-row"><span className="info-key">OSM attribution</span><span className="info-val">{inf.osm.attribution ?? '—'}</span></div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h2 className="card-title">Limitations & Uncertainty</h2></div>
              <div className="card-body">
                <ul style={{ paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
                  <li>Flood extent is derived from SAR change detection — open water and urban areas may cause false positives.</li>
                  <li>Infrastructure counts are based on geometric intersection, not physical inspection or damage assessment.</li>
                  <li>Road blockage is estimated using flood mask overlap fractions, not structural surveys.</li>
                  <li>Connectivity analysis is based on the pre-event OSM road network — roads added or removed after the snapshot date are not included.</li>
                  <li>SNUNet model was trained on Kuro Siwo dataset — regional generalization to other flood events should be validated.</li>
                  <li>Results are intended as decision-support evidence, not ground truth for confirmed damage or casualties.</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
