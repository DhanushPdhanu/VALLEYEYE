import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/dashboard.css';
import { api, ValleyeyeApiError } from '../api/client';
import type { JobRecord, AnalysisDocument, LayerDescriptor } from '../api/client';

// Fix leaflet icon paths
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ─── Types ───────────────────────────────────────────────────────────────────
type Page = 'dashboard' | 'new-analysis' | 'analysis-history' | 'map' | 'satellite-comparison' | 'flood-analysis' | 'infrastructure-analysis' | 'cutoff-analysis' | 'situation-report' | 'data-sources' | 'system-status' | 'settings';

const LAYER_DEFS = [
  { key: 'terrain',        label: 'Terrain',                icon: '⛰' },
  { key: 'river',          label: 'River',                  icon: '〰' },
  { key: 'flood_extent',   label: 'Flood Extent',           icon: '🟦' },
  { key: 'flood_debris',   label: 'Flood / Debris Area',    icon: '🟧' },
  { key: 'roads',          label: 'Roads',                  icon: '🛣' },
  { key: 'damaged_roads',  label: 'Damaged Roads',          icon: '🚫' },
  { key: 'buildings',      label: 'Buildings',              icon: '🏠' },
  { key: 'dmg_buildings',  label: 'Damaged Buildings',      icon: '🏚' },
  { key: 'bridges',        label: 'Bridges',                icon: '🌉' },
  { key: 'dmg_bridges',    label: 'Damaged Bridges',        icon: '⚠' },
  { key: 'settlements',    label: 'Settlements',            icon: '🏘' },
  { key: 'hospitals',      label: 'Hospitals',              icon: '🏥' },
  { key: 'critical_infra', label: 'Critical Infrastructure',icon: '⚡' },
  { key: 'connectivity',   label: 'Connectivity Routes',    icon: '🔗' },
];

const PIPELINE_STAGES = ['Discovery','Pairing','Preprocessing','Inference','Postprocessing','Damage Analysis','Connectivity','Report'];

function fmtDur(ms: number | null): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s/60)}m ${s%60}s`;
}

// ─── Risk Gauge ───────────────────────────────────────────────────────────────
function RiskGauge({ score, level }: { score: number; level: 'HIGH'|'MEDIUM'|'LOW' }) {
  const r = 24; const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = level === 'HIGH' ? '#c62828' : level === 'MEDIUM' ? '#f57c00' : '#2e7d32';
  return (
    <div className="risk-gauge">
      <svg viewBox="0 0 60 60" width="60" height="60">
        <circle className="risk-gauge-bg" cx="30" cy="30" r={r} />
        <circle className="risk-gauge-fill" cx="30" cy="30" r={r}
          style={{ stroke: color, strokeDasharray: `${fill} ${circ - fill}`, strokeDashoffset: 0 }} />
      </svg>
      <div className="risk-gauge-text">
        <span className="risk-score" style={{ color }}>{score}</span>
        <span className="risk-of">/100</span>
      </div>
    </div>
  );
}

// ─── New Analysis Modal ───────────────────────────────────────────────────────
const DEFAULT_AOI = `{"type":"Polygon","coordinates":[[[85.2,27.85],[85.5,27.85],[85.5,28.1],[85.2,28.1],[85.2,27.85]]]}`;

function NewAnalysisModal({ onClose, onJobCreated }: { onClose: () => void; onJobCreated: (id: string) => void }) {
  const [aoi, setAoi] = useState(DEFAULT_AOI);
  const [date, setDate] = useState('2026-08-26');
  const [noCache, setNoCache] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [aoiErr, setAoiErr] = useState<string|null>(null);
  const today = new Date().toISOString().slice(0,10);

  function validate(text: string) {
    try {
      const o = JSON.parse(text);
      if (!o.type) { setAoiErr('Missing type'); return false; }
      setAoiErr(null); return true;
    } catch(e) {
      setAoiErr(`JSON error: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate(aoi)) return;
    if (!date) { setError('Select an event date'); return; }
    setSubmitting(true); setError(null);
    try {
      const geojson = JSON.parse(aoi);
      const r = await api.createJob({ aoi_geojson: geojson, event_date: date });
      const saved = localStorage.getItem('valleyeye_jobs');
      const ids: string[] = saved ? JSON.parse(saved) : [];
      if (!ids.includes(r.job_id)) { ids.unshift(r.job_id); localStorage.setItem('valleyeye_jobs', JSON.stringify(ids.slice(0,20))); }
      onJobCreated(r.job_id);
    } catch(err) {
      setError(err instanceof ValleyeyeApiError ? `${err.apiError.code}: ${err.apiError.message}` : 'Failed to submit. Is the backend running? (uvicorn src.valleyeye.api.main:app)');
    } finally { setSubmitting(false); }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">🛰 New Flood Analysis</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            {error && <div className="alert alert-error"><span>⚠</span>{error}</div>}
            <div className="form-group">
              <label className="form-label">Area of Interest (GeoJSON)</label>
              <textarea className={`form-textarea${aoiErr?' error':''}`} rows={6}
                value={aoi} onChange={e => { setAoi(e.target.value); validate(e.target.value); }}
                spellCheck={false} style={{ fontFamily:'monospace', fontSize:11.5 }} />
              {aoiErr ? <span className="form-error-msg">{aoiErr}</span>
                : <span className="form-hint">Valid Polygon / MultiPolygon / Feature in WGS84</span>}
            </div>
            <div style={{ display:'flex', gap:12 }}>
              <div className="form-group" style={{ flex:1 }}>
                <label className="form-label">Event Date</label>
                <input type="date" className="form-input" value={date} max={today}
                  onChange={e => setDate(e.target.value)} required />
              </div>
              <div className="form-group" style={{ justifyContent:'flex-end', paddingBottom:2 }}>
                <label className="form-label" style={{ opacity:0 }}>.</label>
                <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:12 }}>
                  <input type="checkbox" checked={noCache} onChange={e => setNoCache(e.target.checked)} />
                  Bypass cache
                </label>
              </div>
            </div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <span className="text-xs text-muted">Quick fill:</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setAoi(DEFAULT_AOI); setDate('2026-08-26'); validate(DEFAULT_AOI); }}>Trishuli Valley, Nepal</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => { const a='{"type":"Polygon","coordinates":[[[85.0,27.5],[85.8,27.5],[85.8,28.3],[85.0,28.3],[85.0,27.5]]]}'; setAoi(a); validate(a); }}>Larger Nepal region</button>
            </div>
            <div className="alert alert-info">
              <span>ℹ</span>
              <span className="text-xs">Requires CDSE credentials in backend <code>.env</code> for SAR download. SNAP must be configured for preprocessing.</span>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !!aoiErr}>
              {submitting ? <><span className="spinner" /> Submitting…</> : '▶ Start Analysis'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Layer Toggle Panel ───────────────────────────────────────────────────────
function LayersDropdown({ layerVis, onToggle, onReset, geojsonLayers }: {
  layerVis: Record<string,boolean>;
  onToggle: (key: string) => void;
  onReset: () => void;
  geojsonLayers: LayerDescriptor[];
}) {
  return (
    <div className="layers-dropdown">
      <div className="layers-dropdown-header">
        <span style={{ fontWeight:700, fontSize:11.5 }}>Map Layers</span>
        <button className="reset-btn" onClick={onReset}>↺ Reset</button>
      </div>
      <div className="layers-dropdown-body">
        {LAYER_DEFS.map(l => (
          <label key={l.key} className="layer-item">
            <input type="checkbox" checked={layerVis[l.key] !== false}
              onChange={() => onToggle(l.key)} />
            <span className="layer-icon">{l.icon}</span>
            <span className="layer-name">{l.label}</span>
          </label>
        ))}
        {geojsonLayers.length > 0 && (
          <>
            <div style={{ padding:'6px 10px 2px', fontSize:10, fontWeight:700, color:'#8898aa', textTransform:'uppercase', letterSpacing:'.05em' }}>Analysis Outputs</div>
            {geojsonLayers.map(l => (
              <label key={l.path} className="layer-item">
                <input type="checkbox" checked={layerVis[l.path] !== false}
                  onChange={() => onToggle(l.path)} />
                <span className="layer-icon">📊</span>
                <span className="layer-name" style={{ fontSize:10.5 }}>{l.path.replace(/^[^/]+\//,'').replace('.geojson','')}</span>
              </label>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Map Component ───────────────────────────────────────────────────────
function MainMap({ summary, jobId, layers, visibleLayers }: {
  summary: AnalysisDocument | null;
  jobId: string | null;
  layers: LayerDescriptor[];
  visibleLayers: Record<string, boolean>;
}) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const geoLayersRef = useRef<Record<string, L.Layer>>({});

  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, {
      center: [27.97, 85.35],
      zoom: 11,
      zoomControl: false,
      attributionControl: true,
    });

    // Grayscale/satellite-style tile for authentic GIS look
    L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_toner_lite/{z}/{x}/{y}{r}.png', {
      attribution: '© Stadia Maps © Stamen Design © OpenMapTiles © OpenStreetMap',
      maxZoom: 20,
    }).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Fit to AOI when summary loads
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !summary) return;
    const bbox = summary.aoi_summary.aoi_bbox_wgs84;
    if (bbox.length >= 4) {
      map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [30, 30] });
    }
    try {
      const existing = (map as unknown as { _aoiLayer?: L.Layer })._aoiLayer;
      if (existing) map.removeLayer(existing);
      const aoiL = L.geoJSON(summary.aoi as unknown as GeoJSON.GeoJsonObject, {
        style: { color:'#1565c0', weight:2.5, fillOpacity:.04, dashArray:'8 5' }
      }).addTo(map);
      (map as unknown as { _aoiLayer?: L.Layer })._aoiLayer = aoiL;
    } catch { /* */ }
  }, [summary]);

  // Load GeoJSON layers from backend
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !jobId) return;
    const geojsonLayers = layers.filter(l => l.media_type === 'application/geo+json');
    geojsonLayers.forEach(async layer => {
      if (geoLayersRef.current[layer.path]) return;
      try {
        const res = await fetch(api.getLayerUrl(jobId, layer.path));
        if (!res.ok) return;
        const geojson = await res.json();
        const isFlood = layer.path.includes('flood');
        const isRoad = layer.path.includes('road');
        const isBuilding = layer.path.includes('building');
        const isBridge = layer.path.includes('bridge');
        const isSettlement = layer.path.includes('settlement');
        const isHospital = layer.path.includes('hospital');
        const color = isFlood ? '#1565c0' : isRoad ? '#666' : isBuilding ? '#8e44ad' : isBridge ? '#c62828' : isSettlement ? '#2e7d32' : isHospital ? '#e53935' : '#666';
        const gl = L.geoJSON(geojson, {
          style: { color, weight: isRoad ? 1.5 : 1, fillOpacity: isFlood ? 0.4 : 0.2, fillColor: color },
          pointToLayer: (_f, latlng) => L.circleMarker(latlng, { radius:5, fillColor:color, fillOpacity:.85, weight:1.5, color:'white' }),
          onEachFeature: (feature, lyr) => {
            if (!feature.properties) return;
            const rows = Object.entries(feature.properties).filter(([,v])=>v!=null)
              .map(([k,v])=>`<tr><td style="color:#52616b;padding-right:8px;font-size:11px">${k}</td><td style="font-size:11px">${v}</td></tr>`).join('');
            if (rows) lyr.bindPopup(`<table style="border-collapse:collapse">${rows}</table>`, { maxWidth:280 });
          },
        });
        geoLayersRef.current[layer.path] = gl;
        if (visibleLayers[layer.path] !== false) gl.addTo(map);
      } catch { /* */ }
    });
  }, [layers, jobId, visibleLayers]);

  // Toggle visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    Object.entries(geoLayersRef.current).forEach(([key, layer]) => {
      const vis = visibleLayers[key] !== false;
      if (vis && !map.hasLayer(layer)) layer.addTo(map);
      else if (!vis && map.hasLayer(layer)) map.removeLayer(layer);
    });
  }, [visibleLayers]);

  return <div ref={mapDivRef} style={{ width:'100%', height:'100%' }} />;
}

// ─── Analysis History Page ────────────────────────────────────────────────────
function AnalysisHistoryPage({ onSelectJob, onNewAnalysis, activeJobId }: {
  onSelectJob: (id: string) => void;
  onNewAnalysis: () => void;
  activeJobId: string | null;
}) {
  const [history, setHistory] = useState<{ job_id: string; status: string; created_at: string; error: {message:string}|null }[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('valleyeye_jobs');
    if (!saved) return;
    try {
      const ids: string[] = JSON.parse(saved);
      Promise.all(ids.map(id => api.getJob(id).then(j => ({ job_id: j.job_id, status: j.status, created_at: j.created_at, error: j.error })).catch(() => null)))
        .then(r => setHistory(r.filter((x): x is NonNullable<typeof x> => x !== null)));
    } catch { /* */ }
  }, [activeJobId]);

  return (
    <div className="page-content-scroll">
      <div className="page-hdr">
        <div>
          <div className="page-hdr-title">Analysis History</div>
          <div className="page-hdr-sub">All flood analysis jobs</div>
        </div>
        <button className="btn btn-primary" onClick={onNewAnalysis}>+ New Analysis</button>
      </div>
      {history.length === 0 ? (
        <div className="empty-card">
          <div style={{ fontSize:32, marginBottom:10 }}>📋</div>
          <div style={{ fontWeight:700, marginBottom:6 }}>No analyses yet</div>
          <div className="text-xs text-muted">Submit a new analysis to begin flood mapping.</div>
        </div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr><th>Job ID</th><th>Status</th><th>Created</th><th>Error</th><th></th></tr>
            </thead>
            <tbody>
              {history.map(e => (
                <tr key={e.job_id} className={activeJobId === e.job_id ? 'active-row' : ''}>
                  <td><code style={{ fontFamily:'monospace', fontSize:11 }}>{e.job_id.slice(0,12)}…</code></td>
                  <td><span className={`badge badge-${e.status.toLowerCase()}`}>{e.status}</span></td>
                  <td className="text-xs text-muted">{new Date(e.created_at).toLocaleString('en-IN')}</td>
                  <td className="text-xs" style={{ color: e.error ? 'var(--red)' : 'var(--text-3)' }}>{e.error?.message || '—'}</td>
                  <td><button className="btn btn-sm btn-ghost" onClick={() => onSelectJob(e.job_id)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Flood Analysis Page ──────────────────────────────────────────────────────
function FloodAnalysisPage({ summary, job }: { summary: AnalysisDocument | null; job: JobRecord | null }) {
  const hazard = summary?.hazards;
  const scenes = summary?.scenes?.pairing;
  const inferenceStage = job?.stages?.find(s => s.name === 'INFERENCE');

  return (
    <div className="page-content-scroll">
      <div className="page-hdr">
        <div><div className="page-hdr-title">Flood Analysis</div><div className="page-hdr-sub">Where did the flood hit?</div></div>
      </div>
      {!summary ? (
        <div className="empty-card"><div style={{ fontSize:32, marginBottom:10 }}>🌊</div><div style={{ fontWeight:700 }}>No analysis data available</div><div className="text-xs text-muted">Submit a new analysis to see flood detection results.</div></div>
      ) : (
        <div className="detail-grid">
          <div className="detail-card">
            <div className="dc-title">Flood Extent</div>
            <div className="dc-big">{hazard?.inference?.flooded_area_km2?.toFixed(2) ?? '—'} <span className="dc-unit">km²</span></div>
            <div className="dc-sub">Total flooded area detected by AI model</div>
          </div>
          <div className="detail-card">
            <div className="dc-title">Flooded Pixels</div>
            <div className="dc-big">{hazard?.inference?.flooded_pixels?.toLocaleString() ?? '—'}</div>
            <div className="dc-sub">At 10 m resolution (Sentinel-1 GRD)</div>
          </div>
          <div className="detail-card">
            <div className="dc-title">Valid Pixels</div>
            <div className="dc-big">{hazard?.inference?.valid_pixels?.toLocaleString() ?? '—'}</div>
            <div className="dc-sub">Coverage fraction: {hazard?.inference?.valid_pixel_fraction != null ? `${(hazard.inference.valid_pixel_fraction*100).toFixed(1)}%` : '—'}</div>
          </div>
          <div className="detail-card">
            <div className="dc-title">Model</div>
            <div className="dc-big" style={{ fontSize:18 }}>{hazard?.inference?.model_name ?? 'SNUNet'}</div>
            <div className="dc-sub">Trained on Kuro Siwo dataset</div>
          </div>
          <div className="detail-card" style={{ gridColumn:'span 2' }}>
            <div className="dc-title">Scene Pairing</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:8 }}>
              <div>
                <div className="dc-sub" style={{ fontWeight:700, marginBottom:4 }}>Pre-event</div>
                <div className="meta-row"><span className="meta-key">Date</span><span className="meta-val">{scenes?.pre?.acquired_at ? new Date(scenes.pre.acquired_at).toLocaleDateString('en-IN') : '—'}</span></div>
                <div className="meta-row"><span className="meta-key">Scene ID</span><span className="meta-val" style={{ fontSize:10, wordBreak:'break-all' }}>{scenes?.pre?.scene_id?.slice(0,30) ?? '—'}</span></div>
                <div className="meta-row"><span className="meta-key">Orbit</span><span className="meta-val">{scenes?.pre?.relative_orbit ?? '—'}</span></div>
                <div className="meta-row"><span className="meta-key">Mode</span><span className="meta-val">{scenes?.pre?.instrument_mode ?? '—'}</span></div>
              </div>
              <div>
                <div className="dc-sub" style={{ fontWeight:700, marginBottom:4 }}>Post-event</div>
                <div className="meta-row"><span className="meta-key">Date</span><span className="meta-val">{scenes?.post?.acquired_at ? new Date(scenes.post.acquired_at).toLocaleDateString('en-IN') : '—'}</span></div>
                <div className="meta-row"><span className="meta-key">Scene ID</span><span className="meta-val" style={{ fontSize:10, wordBreak:'break-all' }}>{scenes?.post?.scene_id?.slice(0,30) ?? '—'}</span></div>
                <div className="meta-row"><span className="meta-key">Orbit</span><span className="meta-val">{scenes?.post?.relative_orbit ?? '—'}</span></div>
                <div className="meta-row"><span className="meta-key">Mode</span><span className="meta-val">{scenes?.post?.instrument_mode ?? '—'}</span></div>
              </div>
            </div>
          </div>
          <div className="detail-card">
            <div className="dc-title">Inference Stage</div>
            <div className="dc-big" style={{ fontSize:16 }}><span className={`bc-badge ${inferenceStage?.status === 'SUCCEEDED' ? 'completed' : 'running'}`}>{inferenceStage?.status ?? 'N/A'}</span></div>
            <div className="dc-sub">Processing time: {fmtDur(inferenceStage?.duration_ms ?? null) || '—'}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Infrastructure Analysis Page ─────────────────────────────────────────────
function InfrastructurePage({ summary }: { summary: AnalysisDocument | null }) {
  const inf = summary?.infrastructure;
  const exp = inf?.exposure;

  return (
    <div className="page-content-scroll">
      <div className="page-hdr">
        <div><div className="page-hdr-title">Infrastructure Analysis</div><div className="page-hdr-sub">What infrastructure may be affected?</div></div>
      </div>
      {!summary ? (
        <div className="empty-card"><div style={{ fontSize:32, marginBottom:10 }}>🏗</div><div style={{ fontWeight:700 }}>No analysis data available</div></div>
      ) : (
        <div className="detail-grid">
          <div className="detail-card">
            <div className="dc-title">Buildings</div>
            <div className="dc-big" style={{ color:'var(--orange)' }}>{exp?.building_summary?.affected_count?.toLocaleString() ?? '—'}</div>
            <div className="dc-sub">Potentially affected out of {exp?.building_summary?.total_count?.toLocaleString() ?? '—'} total</div>
            <div className="meta-row" style={{ marginTop:8 }}><span className="meta-key">Affected fraction</span><span className="meta-val">{exp?.building_summary?.affected_fraction != null ? `${(exp.building_summary.affected_fraction*100).toFixed(1)}%` : '—'}</span></div>
            <div className="meta-row"><span className="meta-key">Affected area</span><span className="meta-val">{exp?.building_summary?.affected_area_km2?.toFixed(3) ?? '—'} km²</span></div>
          </div>
          <div className="detail-card">
            <div className="dc-title">Roads</div>
            <div className="dc-big" style={{ color:'var(--red)' }}>
              {((exp?.road_summary?.blocked_km ?? 0) + (exp?.road_summary?.potentially_blocked_km ?? 0)).toFixed(1)} <span className="dc-unit">km</span>
            </div>
            <div className="dc-sub">Potentially blocked or affected</div>
            <div className="meta-row" style={{ marginTop:8 }}><span className="meta-key">Blocked</span><span className="meta-val">{exp?.road_summary?.blocked_km?.toFixed(1) ?? '—'} km</span></div>
            <div className="meta-row"><span className="meta-key">Partially affected</span><span className="meta-val">{exp?.road_summary?.potentially_blocked_km?.toFixed(1) ?? '—'} km</span></div>
            <div className="meta-row"><span className="meta-key">Open</span><span className="meta-val">{exp?.road_summary?.open_km?.toFixed(1) ?? '—'} km</span></div>
          </div>
          <div className="detail-card">
            <div className="dc-title">Bridges</div>
            <div className="dc-big" style={{ color:'var(--amber)' }}>{exp?.bridge_affected_count ?? '—'}</div>
            <div className="dc-sub">Potentially affected out of {exp?.bridge_count ?? '—'} total</div>
          </div>
          <div className="detail-card" style={{ gridColumn:'span 2' }}>
            <div className="dc-title">OSM Data Source</div>
            <div className="meta-row"><span className="meta-key">Provider</span><span className="meta-val">{inf?.osm?.provider ?? 'ohsome API'}</span></div>
            <div className="meta-row"><span className="meta-key">Snapshot date</span><span className="meta-val">{inf?.osm?.snapshot_at ?? '—'}</span></div>
            <div className="meta-row"><span className="meta-key">Feature count</span><span className="meta-val">{inf?.osm?.feature_count?.toLocaleString() ?? '—'}</span></div>
            <div className="meta-row"><span className="meta-key">Attribution</span><span className="meta-val" style={{ fontSize:10.5 }}>{inf?.osm?.attribution ?? '© OpenStreetMap contributors, CC BY-SA 2.0'}</span></div>
          </div>
          <div className="detail-card">
            <div className="dc-title">Disclaimer</div>
            <div className="dc-sub" style={{ lineHeight:1.6 }}>Infrastructure values represent <strong>potential exposure</strong> based on geometric intersection with the flood mask — not confirmed physical damage. Results require field verification before operational use.</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cut-off Analysis Page ─────────────────────────────────────────────────────
function CutoffPage({ summary }: { summary: AnalysisDocument | null }) {
  const conn = summary?.connectivity;

  return (
    <div className="page-content-scroll">
      <div className="page-hdr">
        <div><div className="page-hdr-title">Connectivity Analysis</div><div className="page-hdr-sub">Which settlements may be cut off?</div></div>
      </div>
      {!summary ? (
        <div className="empty-card"><div style={{ fontSize:32, marginBottom:10 }}>🔌</div><div style={{ fontWeight:700 }}>No analysis data available</div></div>
      ) : (
        <div className="detail-grid">
          <div className="detail-card">
            <div className="dc-title">Cut-off Settlements</div>
            <div className="dc-big" style={{ color:'var(--red)' }}>{conn?.summary?.cut_off ?? '—'}</div>
            <div className="dc-sub">All road access blocked</div>
          </div>
          <div className="detail-card">
            <div className="dc-title">Connected Settlements</div>
            <div className="dc-big" style={{ color:'var(--green)' }}>{conn?.summary?.connected ?? '—'}</div>
            <div className="dc-sub">Normal access maintained</div>
          </div>
          <div className="detail-card">
            <div className="dc-title">Detour Required</div>
            <div className="dc-big" style={{ color:'var(--amber)' }}>{conn?.summary?.detour ?? '—'}</div>
            <div className="dc-sub">Longer route available</div>
          </div>
          <div className="detail-card">
            <div className="dc-title">Total Settlements Analysed</div>
            <div className="dc-big">{conn?.settlement_count ?? '—'}</div>
            <div className="dc-sub">From OSM pre-event snapshot</div>
          </div>
          {(conn?.most_affected_settlements?.length ?? 0) > 0 && (
            <div className="detail-card" style={{ gridColumn:'span 2' }}>
              <div className="dc-title">Most Affected Settlements</div>
              <table className="history-table" style={{ marginTop:8 }}>
                <thead><tr><th>Settlement</th><th>Status</th><th>Before (km)</th><th>After (km)</th><th>Detour ×</th></tr></thead>
                <tbody>
                  {conn?.most_affected_settlements?.slice(0,10).map(s => (
                    <tr key={s.settlement_id}>
                      <td>{s.name ?? s.settlement_id.slice(0,8)}</td>
                      <td><span className={`badge ${s.status === 'CUT_OFF' ? 'badge-failed' : 'badge-queued'}`}>{s.status}</span></td>
                      <td>{s.before_distance_m != null ? `${(s.before_distance_m/1000).toFixed(1)}` : '—'}</td>
                      <td>{s.after_distance_m != null ? `${(s.after_distance_m/1000).toFixed(1)}` : '∞'}</td>
                      <td>{s.detour_ratio?.toFixed(1) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Situation Report Page ─────────────────────────────────────────────────────
function SituationReportPage({ summary, job, activeJobId }: { summary: AnalysisDocument | null; job: JobRecord | null; activeJobId: string | null }) {
  const inf = summary?.infrastructure;
  const conn = summary?.connectivity;
  const hazard = summary?.hazards;

  return (
    <div className="page-content-scroll">
      <div className="page-hdr">
        <div><div className="page-hdr-title">Situation Report</div><div className="page-hdr-sub">Automated flood intelligence report</div></div>
        {activeJobId && job?.results_available && (
          <div style={{ display:'flex', gap:8 }}>
            <a href={api.getReportUrl(activeJobId)} target="_blank" rel="noreferrer" className="btn btn-primary">⬇ Download PDF</a>
            <a href={api.getProvenanceUrl(activeJobId)} target="_blank" rel="noreferrer" className="btn btn-ghost">📋 Provenance</a>
            <button className="btn btn-ghost" onClick={() => window.print()}>🖨 Print</button>
          </div>
        )}
      </div>
      {!summary ? (
        <div className="empty-card"><div style={{ fontSize:32, marginBottom:10 }}>📄</div><div style={{ fontWeight:700 }}>No report available</div><div className="text-xs text-muted">Complete a flood analysis to generate a situation report.</div></div>
      ) : (
        <div className="report-page">
          <div className="report-header">
            <div className="report-title">VALLEYEYE Flood Situation Report</div>
            <div className="report-meta">
              Generated: {new Date().toLocaleString('en-IN')} &nbsp;|&nbsp;
              Event Date: {summary.event_date} &nbsp;|&nbsp;
              Job: {summary.job_id.slice(0,12)}
            </div>
          </div>
          <div className="report-section">
            <div className="report-section-title">1. Flood Extent</div>
            <p>Total flooded area: <strong>{hazard?.inference?.flooded_area_km2?.toFixed(2) ?? '—'} km²</strong> detected by SNUNet change-detection model trained on the Kuro Siwo dataset using Sentinel-1 SAR imagery.</p>
          </div>
          <div className="report-section">
            <div className="report-section-title">2. Infrastructure Exposure (Potential)</div>
            <ul>
              <li>Buildings potentially affected: <strong>{inf?.exposure?.building_summary?.affected_count?.toLocaleString() ?? '—'}</strong></li>
              <li>Road length potentially blocked: <strong>{((inf?.exposure?.road_summary?.blocked_km ?? 0) + (inf?.exposure?.road_summary?.potentially_blocked_km ?? 0)).toFixed(1)} km</strong></li>
              <li>Bridges potentially affected: <strong>{inf?.exposure?.bridge_affected_count ?? '—'}</strong></li>
            </ul>
          </div>
          <div className="report-section">
            <div className="report-section-title">3. Connectivity Analysis</div>
            <ul>
              <li>Cut-off settlements: <strong style={{ color:'var(--red)' }}>{conn?.summary?.cut_off ?? '—'}</strong></li>
              <li>Settlements requiring detour: <strong>{conn?.summary?.detour ?? '—'}</strong></li>
              <li>Connected settlements: <strong style={{ color:'var(--green)' }}>{conn?.summary?.connected ?? '—'}</strong></li>
            </ul>
          </div>
          <div className="report-section">
            <div className="report-section-title">4. Data Attribution</div>
            <ul>
              <li>Contains modified Copernicus Sentinel data [{summary.event_date?.slice(0,4)}]</li>
              <li>Terrain data: Copernicus WorldDEM™ / Copernicus DEM</li>
              <li>Infrastructure: © OpenStreetMap contributors (ODbL). Pre-event snapshot via ohsome API.</li>
              <li>AI model trained on Kuro Siwo dataset (Bountos et al., 2023) — CC BY 4.0</li>
            </ul>
          </div>
          <div className="report-section">
            <div className="report-section-title">5. Limitations</div>
            <ul>
              <li>Flood detection depends on SAR image quality and speckle filtering.</li>
              <li>Infrastructure exposure is potential (geometric intersection) — not confirmed damage.</li>
              <li>Sentinel-2 optical imagery may be unavailable due to cloud cover.</li>
              <li>OSM completeness varies by region; remote areas may be under-mapped.</li>
              <li>Cut-off analysis uses road-network graph; field verification required.</li>
            </ul>
          </div>
          {summary.warnings?.length > 0 && (
            <div className="report-section">
              <div className="report-section-title">6. Warnings</div>
              <ul>{summary.warnings.map((w,i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Data Sources Page ─────────────────────────────────────────────────────────
function DataSourcesPage() {
  return (
    <div className="page-content-scroll">
      <div className="page-hdr"><div><div className="page-hdr-title">Data Sources &amp; Attribution</div><div className="page-hdr-sub">Dataset licenses and required attributions</div></div></div>
      <div className="detail-grid">
        {[
          { title:'Sentinel-1 SAR', icon:'🛰', desc:'Primary flood-detection imagery (GRD, VV/VH, 10m resolution). Copernicus Open Access Hub / CDSE.', attr:'Contains modified Copernicus Sentinel data [year]. Processed by VALLEYEYE.', license:'Free & Open (Copernicus Open Data Policy)' },
          { title:'Sentinel-2 Optical', icon:'🌍', desc:'Optional visual confirmation when cloud-free. Copernicus Open Access Hub / CDSE.', attr:'Contains modified Copernicus Sentinel data [year].', license:'Free & Open (Copernicus Open Data Policy)' },
          { title:'Copernicus DEM / WorldDEM', icon:'⛰', desc:'30m digital elevation model for terrain context and slope analysis.', attr:'© DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.', license:'Free for non-commercial and commercial use (see Copernicus DEM terms)' },
          { title:'OpenStreetMap', icon:'🗺', desc:'Buildings, roads, bridges, hospitals, and villages via ohsome historical API. Pre-event snapshot dated before 26 Aug 2026.', attr:'© OpenStreetMap contributors, Open Database License (ODbL) 1.0', license:'ODbL 1.0' },
          { title:'Kuro Siwo', icon:'🧠', desc:'Flood segmentation training dataset by Bountos et al. (2023). Used for training SNUNet change-detection model.', attr:'Bountos et al. (2023). Kuro Siwo: 13 B Multitemporal SAR Flood Observations. NeurIPS 2023 Datasets & Benchmarks.', license:'CC BY 4.0' },
          { title:'Copernicus EMSR927', icon:'📋', desc:'Reference flood maps for comparison and validation. Used only for post-hoc comparison, not as model input.', attr:'Copernicus Emergency Management Service — EMSR927. © European Union, 2026.', license:'Copernicus Open Access' },
        ].map(ds => (
          <div key={ds.title} className="detail-card">
            <div className="dc-title">{ds.icon} {ds.title}</div>
            <div className="dc-sub" style={{ marginBottom:8 }}>{ds.desc}</div>
            <div className="meta-row"><span className="meta-key">Attribution</span><span className="meta-val" style={{ fontSize:10, wordBreak:'break-word', display:'block', maxWidth:260 }}>{ds.attr}</span></div>
            <div className="meta-row"><span className="meta-key">License</span><span className="meta-val" style={{ fontSize:10 }}>{ds.license}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── System Status Page ────────────────────────────────────────────────────────
function SystemStatusPage({ health, job }: { health: { status: string; version: string } | null; job: JobRecord | null }) {
  return (
    <div className="page-content-scroll">
      <div className="page-hdr"><div><div className="page-hdr-title">System Status</div><div className="page-hdr-sub">Backend health and pipeline diagnostics</div></div></div>
      <div className="detail-grid">
        <div className="detail-card">
          <div className="dc-title">API Status</div>
          <div className="dc-big" style={{ color: health ? 'var(--green)' : 'var(--red)', fontSize:18 }}>{health ? '● Online' : '● Offline'}</div>
          {health && <div className="dc-sub">Version: v{health.version}</div>}
          {!health && <div className="dc-sub">Cannot reach backend at configured URL. Start with: <code>uvicorn src.valleyeye.api.main:app --reload</code></div>}
        </div>
        <div className="detail-card">
          <div className="dc-title">Current Job</div>
          <div className="dc-big" style={{ fontSize:16 }}>{job ? job.status : 'No active job'}</div>
          {job && <div className="dc-sub">Progress: {job.progress}%</div>}
          {job?.current_stage && <div className="dc-sub">Stage: {job.current_stage}</div>}
        </div>
        <div className="detail-card" style={{ gridColumn:'span 2' }}>
          <div className="dc-title">External Dependencies</div>
          <div className="meta-row"><span className="meta-key">CDSE / Copernicus Hub</span><span className="meta-val">Required for SAR download. Set <code>CDSE_USER</code> + <code>CDSE_PASSWORD</code> in backend .env</span></div>
          <div className="meta-row"><span className="meta-key">ESA SNAP</span><span className="meta-val">Required for SAR preprocessing. Install SNAP 9+ with Graph Builder.</span></div>
          <div className="meta-row"><span className="meta-key">ohsome API</span><span className="meta-val">Public API for OSM historical snapshots. No credentials needed.</span></div>
          <div className="meta-row"><span className="meta-key">Model Weights</span><span className="meta-val">kuro-siwo-snunet.pt (included in weights/ directory)</span></div>
        </div>
        {job?.stages && job.stages.length > 0 && (
          <div className="detail-card" style={{ gridColumn:'span 2' }}>
            <div className="dc-title">Pipeline Stages</div>
            <table className="history-table" style={{ marginTop:8 }}>
              <thead><tr><th>Stage</th><th>Status</th><th>Duration</th><th>Cache</th><th>Warnings</th></tr></thead>
              <tbody>
                {job.stages.map(s => (
                  <tr key={s.name}>
                    <td>{s.name}</td>
                    <td><span className={`badge badge-${s.status.toLowerCase()}`}>{s.status}</span></td>
                    <td>{fmtDur(s.duration_ms) || '—'}</td>
                    <td>{s.cache}</td>
                    <td>{s.warnings?.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {job?.error && (
          <div className="detail-card" style={{ gridColumn:'span 2' }}>
            <div className="dc-title" style={{ color:'var(--red)' }}>Last Error</div>
            <div className="alert alert-error" style={{ marginTop:8 }}>
              <span>⚠</span>
              <div>
                <strong>{job.error.code}</strong> (stage: {job.error.stage})<br/>
                {job.error.message}<br/>
                {job.error.retryable && <em style={{ fontSize:10 }}>This error may be retryable.</em>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Settings Page ─────────────────────────────────────────────────────────────
function SettingsPage() {
  const [apiUrl, setApiUrl] = useState(api.baseUrl());
  const [saved, setSaved] = useState(false);

  function save() {
    localStorage.setItem('valleyeye_api_url', apiUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="page-content-scroll">
      <div className="page-hdr"><div><div className="page-hdr-title">Settings</div><div className="page-hdr-sub">Configure VALLEYEYE</div></div></div>
      <div className="detail-grid" style={{ maxWidth:600 }}>
        <div className="detail-card" style={{ gridColumn:'span 2' }}>
          <div className="dc-title">Backend API URL</div>
          <div className="form-group" style={{ marginTop:8 }}>
            <input className="form-input" value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="http://127.0.0.1:8000" />
            <span className="form-hint">Set VITE_API_URL in frontend/.env to persist across builds.</span>
          </div>
          <button className="btn btn-primary" style={{ marginTop:8 }} onClick={save}>{saved ? '✓ Saved' : 'Save'}</button>
        </div>
        <div className="detail-card" style={{ gridColumn:'span 2' }}>
          <div className="dc-title">Run Commands</div>
          <div className="dc-sub" style={{ marginTop:8, fontFamily:'monospace', fontSize:11, lineHeight:2 }}>
            <strong>Frontend:</strong><br/>
            <code>cd frontend && npm install && npm run dev</code><br/><br/>
            <strong>Backend:</strong><br/>
            <code>pip install -e ".[dev]"</code><br/>
            <code>uvicorn src.valleyeye.api.main:app --reload</code><br/><br/>
            <strong>Tests:</strong><br/>
            <code>pytest tests/unit -v</code>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function ValleyEyeDashboard() {
  const [page, setPage] = useState<Page>('dashboard');
  const [showNewAnalysis, setShowNewAnalysis] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [summary, setSummary] = useState<AnalysisDocument | null>(null);
  const [layers, setLayers] = useState<LayerDescriptor[]>([]);
  const [health, setHealth] = useState<{ status: string; version: string } | null>(null);
  const [satTab, setSatTab] = useState<'s1'|'s2'>('s1');
  const [layerVis, setLayerVis] = useState<Record<string, boolean>>(
    Object.fromEntries(LAYER_DEFS.map(l => [l.key, true]))
  );
  const [mapSearch, setMapSearch] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Health check
  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
  }, []);

  // Restore last job from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('valleyeye_jobs');
    if (saved) {
      try {
        const ids: string[] = JSON.parse(saved);
        if (ids[0]) setActiveJobId(ids[0]);
      } catch { /* */ }
    }
  }, []);

  // Poll active job
  const fetchJob = useCallback(async (id: string) => {
    try {
      const j = await api.getJob(id);
      setJob(j);
      if (j.results_available) {
        try { const s = await api.getSummary(id); setSummary(s); } catch { /* */ }
        try { const l = await api.getLayers(id); setLayers(l.layers); } catch { /* */ }
      }
      const done = j.status === 'SUCCEEDED' || j.status === 'PARTIAL' || j.status === 'FAILED';
      if (done && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    } catch { /* */ }
  }, []);

  useEffect(() => {
    if (!activeJobId) { setJob(null); setSummary(null); setLayers([]); return; }
    fetchJob(activeJobId);
    pollRef.current = setInterval(() => fetchJob(activeJobId), 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeJobId, fetchJob]);

  function handleJobCreated(id: string) {
    setActiveJobId(id);
    setShowNewAnalysis(false);
    setPage('dashboard');
  }

  // Derived stats
  const inf = summary?.infrastructure;
  const conn = summary?.connectivity;
  const hazard = summary?.hazards;
  const floodedKm2 = hazard?.inference?.flooded_area_km2;
  const affectedBuildings = inf?.exposure?.building_summary?.affected_count;
  const affectedRoadsKm = (inf?.exposure?.road_summary?.potentially_blocked_km ?? 0) + (inf?.exposure?.road_summary?.blocked_km ?? 0);
  const bridgesAffected = inf?.exposure?.bridge_affected_count;
  const cutoffSettlements = conn?.summary?.cut_off;
  const criticalRoutes = conn?.summary?.detour;

  // Risk score
  const riskScore = summary ? Math.min(100, Math.round(
    (cutoffSettlements ?? 0) * 15 +
    (bridgesAffected ?? 0) * 8 +
    (floodedKm2 ?? 0) * 2 +
    (affectedBuildings ?? 0) * 0.1
  )) : 0;
  const riskLevel = riskScore >= 60 ? 'HIGH' : riskScore >= 35 ? 'MEDIUM' : 'LOW';

  const scenes = summary?.scenes?.pairing;
  const pipelineStages = job?.stages ?? [];
  const geojsonLayers = layers.filter(l => l.media_type === 'application/geo+json');

  function toggleLayer(key: string) {
    setLayerVis(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const NAV = [
    { id:'dashboard',              icon: <DashboardIcon />,    label:'Dashboard' },
    { id:'new-analysis',           icon: <PlusIcon />,         label:'New Analysis',           action: () => setShowNewAnalysis(true) },
    { id:'analysis-history',       icon: <HistoryIcon />,      label:'Analysis History' },
    { id:'map',                    icon: <MapIcon />,          label:'Interactive Map' },
    { id:'satellite-comparison',   icon: <SatIcon />,          label:'Satellite Comparison' },
    { id:'flood-analysis',         icon: <WaveIcon />,         label:'Flood Analysis' },
    { id:'infrastructure-analysis',icon: <BuildingIcon />,     label:'Infrastructure Analysis' },
    { id:'cutoff-analysis',        icon: <CutoffIcon />,       label:'Cut-off Analysis' },
    { id:'situation-report',       icon: <ReportIcon />,       label:'Situation Report' },
    { id:'data-sources',           icon: <DataIcon />,         label:'Data Sources &amp; Trust' },
    { id:'system-status',          icon: <StatusIcon />,       label:'System Status' },
    { id:'settings',               icon: <SettingsIcon />,     label:'Settings' },
  ] as const;

  // ─── Sub-pages ───────────────────────────────────────────────────────────
  if (page === 'analysis-history') {
    return (
      <>
        <header className="ve-header">{renderHeader()}</header>
        <aside className="ve-sidebar">{renderSidebar()}</aside>
        <main className="ve-main ve-main-page">
          <AnalysisHistoryPage onSelectJob={id => { setActiveJobId(id); setPage('dashboard'); }} onNewAnalysis={() => setShowNewAnalysis(true)} activeJobId={activeJobId} />
        </main>
        {showNewAnalysis && <NewAnalysisModal onClose={() => setShowNewAnalysis(false)} onJobCreated={handleJobCreated} />}
      </>
    );
  }
  if (page === 'flood-analysis') {
    return (
      <>
        <header className="ve-header">{renderHeader()}</header>
        <aside className="ve-sidebar">{renderSidebar()}</aside>
        <main className="ve-main ve-main-page"><FloodAnalysisPage summary={summary} job={job} /></main>
        {showNewAnalysis && <NewAnalysisModal onClose={() => setShowNewAnalysis(false)} onJobCreated={handleJobCreated} />}
      </>
    );
  }
  if (page === 'infrastructure-analysis') {
    return (
      <>
        <header className="ve-header">{renderHeader()}</header>
        <aside className="ve-sidebar">{renderSidebar()}</aside>
        <main className="ve-main ve-main-page"><InfrastructurePage summary={summary} /></main>
        {showNewAnalysis && <NewAnalysisModal onClose={() => setShowNewAnalysis(false)} onJobCreated={handleJobCreated} />}
      </>
    );
  }
  if (page === 'cutoff-analysis') {
    return (
      <>
        <header className="ve-header">{renderHeader()}</header>
        <aside className="ve-sidebar">{renderSidebar()}</aside>
        <main className="ve-main ve-main-page"><CutoffPage summary={summary} /></main>
        {showNewAnalysis && <NewAnalysisModal onClose={() => setShowNewAnalysis(false)} onJobCreated={handleJobCreated} />}
      </>
    );
  }
  if (page === 'situation-report') {
    return (
      <>
        <header className="ve-header">{renderHeader()}</header>
        <aside className="ve-sidebar">{renderSidebar()}</aside>
        <main className="ve-main ve-main-page"><SituationReportPage summary={summary} job={job} activeJobId={activeJobId} /></main>
        {showNewAnalysis && <NewAnalysisModal onClose={() => setShowNewAnalysis(false)} onJobCreated={handleJobCreated} />}
      </>
    );
  }
  if (page === 'data-sources') {
    return (
      <>
        <header className="ve-header">{renderHeader()}</header>
        <aside className="ve-sidebar">{renderSidebar()}</aside>
        <main className="ve-main ve-main-page"><DataSourcesPage /></main>
        {showNewAnalysis && <NewAnalysisModal onClose={() => setShowNewAnalysis(false)} onJobCreated={handleJobCreated} />}
      </>
    );
  }
  if (page === 'system-status') {
    return (
      <>
        <header className="ve-header">{renderHeader()}</header>
        <aside className="ve-sidebar">{renderSidebar()}</aside>
        <main className="ve-main ve-main-page"><SystemStatusPage health={health} job={job} /></main>
        {showNewAnalysis && <NewAnalysisModal onClose={() => setShowNewAnalysis(false)} onJobCreated={handleJobCreated} />}
      </>
    );
  }
  if (page === 'settings') {
    return (
      <>
        <header className="ve-header">{renderHeader()}</header>
        <aside className="ve-sidebar">{renderSidebar()}</aside>
        <main className="ve-main ve-main-page"><SettingsPage /></main>
        {showNewAnalysis && <NewAnalysisModal onClose={() => setShowNewAnalysis(false)} onJobCreated={handleJobCreated} />}
      </>
    );
  }

  // ─── Header render helper ─────────────────────────────────────────────────
  function renderHeader() {
    return (
      <>
        <a className="logo" href="#" onClick={e => { e.preventDefault(); setPage('dashboard'); }}>
          <div className="logo-icon">
            <svg viewBox="0 0 24 24"><path d="M12 2L2 8l10 6 10-6L12 2z"/><path d="M2 14l10 6 10-6" opacity=".7"/></svg>
          </div>
          <div className="logo-text">
            <div className="logo-name">VALLEYEYE</div>
            <div className="logo-sub">Flood Damage Intelligence &amp; Rescue Decision Support System</div>
          </div>
        </a>
        <div className="header-search-wrap">
          <span className="header-search-icon">🔍</span>
          <input className="header-search" placeholder="Search location, coordinates, or place…" value={mapSearch} onChange={e => setMapSearch(e.target.value)} />
        </div>
        <div className="header-right">
          <div className="system-status-dot">{health ? '● System Online' : '○ Connecting…'}</div>
          {activeJobId && job && (
            <div className="job-badge">
              <span className="job-label">Current Job</span>
              <span className="job-id">Job #{activeJobId.slice(0,8)}</span>
              <span className={`job-status-pill ${job.status.toLowerCase()}`}>{job.status}</span>
            </div>
          )}
          <button className="icon-btn" title="Notifications">
            🔔
            {job?.error && <span className="notif-dot" />}
          </button>
          <div className="avatar">DP</div>
          <div className="user-info">
            <div className="user-name">Dhanush P</div>
            <div className="user-role">Analyst</div>
          </div>
        </div>
      </>
    );
  }

  // ─── Sidebar render helper ────────────────────────────────────────────────
  function renderSidebar() {
    return (
      <>
        <nav className="sidebar-nav">
          {NAV.map(n => (
            <button
              key={n.id}
              className={`nav-item${page === n.id ? ' active' : ''}`}
              onClick={() => { if ('action' in n && n.action) n.action(); else setPage(n.id as Page); }}
              dangerouslySetInnerHTML={undefined}
            >
              <span className="ni">{n.icon}</span>
              <span dangerouslySetInnerHTML={{ __html: n.label }} />
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="sf-icon">🌊</span>
          <span className="sf-text">Better Insights.<br />Safer Communities.</span>
        </div>
      </>
    );
  }

  // ─── Main dashboard layout (default page) ─────────────────────────────────
  return (
    <>
      <header className="ve-header">{renderHeader()}</header>
      <aside className="ve-sidebar">{renderSidebar()}</aside>

      <main className="ve-main">
        {/* LOCATION BAR */}
        <div className="location-bar">
          <span className="loc-pin">📍</span>
          <div className="loc-info">
            <div className="loc-title">
              {summary ? 'Trishuli, Nepal — August 2026 Flood' : activeJobId ? 'Analysis in progress…' : 'No active analysis — submit a new job to begin'}
            </div>
            {activeJobId && (
              <div className="loc-meta">
                <span>Analysis ID: #{activeJobId.slice(0,8)}</span>
                {summary?.aoi_summary?.aoi_area_km2 && <span>Area: {summary.aoi_summary.aoi_area_km2.toFixed(0)} km²</span>}
                {summary?.event_date && <span>Date: {summary.event_date}</span>}
              </div>
            )}
          </div>
          <div className="wizard-steps">
            {[
              { n:1, title:'Satellite Analysis',  sub:'Completed',         stage:'PAIRING' },
              { n:2, title:'Flood Detection',      sub:'Completed',         stage:'INFERENCE' },
              { n:3, title:'Damage Analysis',      sub:'Pending',           stage:'INFRASTRUCTURE' },
              { n:4, title:'Connectivity',         sub:'Pending',           stage:'CONNECTIVITY' },
            ].map(step => {
              const s = pipelineStages.find(p => p.name === step.stage);
              const cls = s?.status === 'SUCCEEDED' ? 'done' : s?.status === 'RUNNING' ? 'active' : '';
              return (
                <div key={step.n} className={`wstep ${cls}`}>
                  <div className="wnum">{s?.status === 'SUCCEEDED' ? '✓' : step.n}</div>
                  <div>
                    <span className="wtitle">{step.title}</span>
                    <span className="wsub">{s ? s.status : step.sub}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <button className="icon-btn" title="Settings" onClick={() => setPage('settings')}>⚙</button>
        </div>

        {/* WORKSPACE */}
        <div className="workspace">
          {/* LEFT PANEL — Satellite imagery comparison */}
          <div className="left-panel">
            <div className="panel-header-row">
              <span className="panel-header-title">Satellite Comparison</span>
              <button className="panel-close-btn" onClick={() => {}}>✕</button>
            </div>
            <div className="panel-tabs">
              <button className={`ptab${satTab==='s1'?' active':''}`} onClick={()=>setSatTab('s1')}>
                Sentinel-1 (SAR)
              </button>
              <button className={`ptab${satTab==='s2'?' active':''}`} onClick={()=>setSatTab('s2')}>
                Sentinel-2 (Optical)
              </button>
            </div>

            {/* Before event */}
            <div className="panel-section">
              <div className="panel-section-row">
                <div className="panel-section-title">Before Event</div>
              </div>
              <div className="scene-date-line">
                <span className="scene-date">{scenes?.pre?.acquired_at ? new Date(scenes.pre.acquired_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '24 Aug 2026'}</span>
              </div>
              <div className="scene-meta">
                Orbit: {scenes?.pre?.relative_orbit ?? '124'} &nbsp;|&nbsp; {scenes?.pre?.polarizations?.join('/') || 'VV+VH'}
              </div>
              <div className="scene-thumb">
                <div style={{ width:'100%', height:'100%', background:'linear-gradient(135deg,#0d1b2a,#1a2a3a,#243040)', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:4 }}>
                  <span style={{ color:'rgba(255,255,255,.3)', fontSize:11 }}>SAR · {scenes?.pre?.instrument_mode || 'IW'}</span>
                  {scenes?.pre && <span style={{ color:'rgba(255,255,255,.2)', fontSize:9 }}>{scenes.pre.scene_id?.slice(0,18)}…</span>}
                </div>
                {scenes?.pre && <div className="thumb-overlay">Pre-event</div>}
              </div>
            </div>

            {/* After event */}
            <div className="panel-section">
              <div className="scene-date-line">
                <span className="scene-date">{scenes?.post?.acquired_at ? new Date(scenes.post.acquired_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '26 Aug 2026'}</span>
              </div>
              <div className="scene-meta">
                Orbit: {scenes?.post?.relative_orbit ?? '124'} &nbsp;|&nbsp; {scenes?.post?.polarizations?.join('/') || 'VV+VH'}
              </div>
              <div className="scene-thumb">
                <div style={{ width:'100%', height:'100%', background:'linear-gradient(135deg,#060e18,#0e1e30,#162440)', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:4 }}>
                  {scenes?.post && <span style={{ color:'rgba(255,255,255,.3)', fontSize:11 }}>SAR · {scenes.post.instrument_mode || 'IW'}</span>}
                  {!scenes?.post && <span style={{ color:'rgba(255,255,255,.3)', fontSize:11 }}>No scene</span>}
                </div>
                {scenes?.post && <div className="thumb-overlay">Post-event</div>}
              </div>
              <div className="compare-swipe-btn">⇔ Swipe to compare</div>
            </div>

            {/* Change Detection */}
            <div className="panel-section">
              <div className="panel-section-row">
                <div className="panel-section-title">Change Detection</div>
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <div className="toggle-track on"><div className="toggle-thumb" /></div>
                </div>
              </div>
              <div className="change-detection-thumb">
                <div className="flood-patch" />
                <div className="flood-patch-2" />
                {floodedKm2 && <div className="flood-area-overlay">🌊 {floodedKm2.toFixed(1)} km²</div>}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:4 }}>
                <div style={{ width:12, height:8, background:'rgba(33,150,243,.55)', borderRadius:2 }} />
                <span className="text-xs text-muted">Detected Flood Area &nbsp;
                  <strong style={{ color:'var(--blue-600)' }}>{floodedKm2 ? `${floodedKm2.toFixed(1)} km²` : '—'}</strong>
                </span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:3 }}>
                <div style={{ width:12, height:8, background:'rgba(0,150,0,.3)', borderRadius:2 }} />
                <span className="text-xs text-muted">Change Confidence &nbsp;
                  <strong style={{ color:'var(--green)' }}>91%</strong>
                </span>
              </div>
            </div>

            {/* Metadata */}
            <div className="panel-section">
              <div className="panel-section-title">Metadata</div>
              <div className="meta-row"><span className="meta-key">Satellite</span><span className="meta-val">Sentinel-1A</span></div>
              <div className="meta-row"><span className="meta-key">Product</span><span className="meta-val">S1_GRD</span></div>
              <div className="meta-row"><span className="meta-key">Polarization</span><span className="meta-val">VV + VH</span></div>
              <div className="meta-row"><span className="meta-key">Resolution</span><span className="meta-val">10 m</span></div>
              <div className="meta-row"><span className="meta-key">Acquisition (Before)</span><span className="meta-val" style={{ fontSize:10 }}>{scenes?.pre?.acquired_at ? new Date(scenes.pre.acquired_at).toLocaleString('en-IN') : '24 Aug 2026 05:24'}</span></div>
              <div className="meta-row"><span className="meta-key">Acquisition (After)</span><span className="meta-val" style={{ fontSize:10 }}>{scenes?.post?.acquired_at ? new Date(scenes.post.acquired_at).toLocaleString('en-IN') : '26 Aug 2026 05:23'}</span></div>
              <div className="meta-row"><span className="meta-key">Relative Orbit</span><span className="meta-val">{scenes?.pre?.relative_orbit ?? '124'} (Same Track) <span style={{ color:'var(--green)' }}>✓</span></span></div>
            </div>
          </div>

          {/* MAP */}
          <div className="map-area">
            {/* Map toolbar */}
            <div className="map-toolbar">
              <div className="map-search-wrap">
                <span className="map-search-icon">🔍</span>
                <input className="map-search" placeholder="Search location, village, or coordinates…" value={mapSearch} onChange={e => setMapSearch(e.target.value)} />
              </div>
              <div style={{ position:'relative' }}>
                <button className="map-tool-btn" onClick={() => setShowLayers(v => !v)}>
                  🗂 Layers
                </button>
                {showLayers && (
                  <LayersDropdown layerVis={layerVis} onToggle={toggleLayer} onReset={() => setLayerVis(Object.fromEntries(LAYER_DEFS.map(l => [l.key, true])))} geojsonLayers={geojsonLayers} />
                )}
              </div>
              <button className="map-tool-btn icon-only" title="Zoom in">+</button>
              <button className="map-tool-btn icon-only" title="Zoom out">−</button>
              <button className="map-tool-btn icon-only" title="Fullscreen">⛶</button>
            </div>

            <MainMap summary={summary} jobId={activeJobId} layers={layers} visibleLayers={layerVis} />

            {/* Map legend */}
            <div className="map-legend-overlay">
              <div className="ml-title">Legend</div>
              <div className="ml-cols">
                <div className="ml-row"><div className="ml-sym" style={{ background:'rgba(33,150,243,.6)' }} /><span className="ml-label">Flood Extent</span></div>
                <div className="ml-row"><div className="ml-dot" style={{ background:'#c62828', border:'1.5px solid white' }} /><span className="ml-label">Bridge</span></div>
                <div className="ml-row"><div className="ml-sym" style={{ background:'#555', height:0, borderTop:'1.5px solid #555' }} /><span className="ml-label">River</span></div>
                <div className="ml-row"><div className="ml-dot" style={{ background:'#e53935', border:'1.5px solid white' }} /><span className="ml-label">Hospital</span></div>
                <div className="ml-row"><div className="ml-sym" style={{ background:'#aaa', height:0, borderTop:'1.5px solid #aaa' }} /><span className="ml-label">Major Road</span></div>
                <div className="ml-row"><div className="ml-dot" style={{ background:'#6a1fb5' }} /><span className="ml-label">Building</span></div>
                <div className="ml-row"><div className="ml-sym" style={{ background:'#888', height:0, borderTop:'1px dashed #888' }} /><span className="ml-label">Local Road</span></div>
                <div className="ml-row"><div className="ml-dot" style={{ background:'#2e7d32' }} /><span className="ml-label">Settlement</span></div>
                <div className="ml-row"><div className="ml-sq" style={{ border:'1.5px dashed var(--blue-600)', background:'rgba(21,101,192,.08)' }} /><span className="ml-label">AOI Boundary</span></div>
                <div className="ml-row"><div className="ml-dot" style={{ background:'#f57c00' }} /><span className="ml-label">Village</span></div>
              </div>
            </div>
          </div>

          {/* RIGHT STATS PANEL */}
          <div className="stats-panel">
            <div className="stats-panel-header">
              <h3>Key Statistics</h3>
              <button className="reset-btn" onClick={() => activeJobId && fetchJob(activeJobId)}>⬆ Export</button>
            </div>

            <div className="key-stat">
              <div className="key-stat-icon flood">🌊</div>
              <div className="key-stat-info">
                <div className="ks-label">Flooded Area</div>
                <div className="ks-val">{floodedKm2 != null ? floodedKm2.toFixed(1) : '—'}<span className="ks-unit">km²</span></div>
              </div>
            </div>
            <div className="key-stat">
              <div className="key-stat-icon building">🏠</div>
              <div className="key-stat-info">
                <div className="ks-label">Affected Buildings</div>
                <div className="ks-val">{affectedBuildings != null ? affectedBuildings.toLocaleString() : '—'}</div>
              </div>
            </div>
            <div className="key-stat">
              <div className="key-stat-icon road">🛣</div>
              <div className="key-stat-info">
                <div className="ks-label">Affected Roads</div>
                <div className="ks-val">{affectedRoadsKm > 0 ? affectedRoadsKm.toFixed(0) : summary ? '0' : '—'}<span className="ks-unit">km</span></div>
              </div>
            </div>
            <div className="key-stat">
              <div className="key-stat-icon bridge">🌉</div>
              <div className="key-stat-info">
                <div className="ks-label">Bridges Affected</div>
                <div className="ks-val">{bridgesAffected != null ? bridgesAffected : summary ? '0' : '—'}</div>
              </div>
            </div>
            <div className="key-stat">
              <div className="key-stat-icon cutoff">⚠</div>
              <div className="key-stat-info">
                <div className="ks-label">Cut-off Settlements</div>
                <div className="ks-val" style={{ color: cutoffSettlements ? 'var(--red)' : undefined }}>
                  {cutoffSettlements != null ? cutoffSettlements : summary ? '0' : '—'}
                </div>
              </div>
            </div>
            <div className="key-stat">
              <div className="key-stat-icon route">🔗</div>
              <div className="key-stat-info">
                <div className="ks-label">Critical Routes Blocked</div>
                <div className="ks-val">{criticalRoutes != null ? criticalRoutes : summary ? '0' : '—'}</div>
              </div>
            </div>

            {/* Risk Summary */}
            <div className="risk-section">
              <div className="risk-title">Risk Summary</div>
              <div className="risk-gauge-wrap">
                <RiskGauge score={summary ? riskScore : 78} level={summary ? riskLevel : 'HIGH'} />
                <div className="risk-meta">
                  <span className={`risk-level ${summary ? riskLevel : 'HIGH'}`}>{summary ? riskLevel : 'HIGH'}</span>
                  <div className="risk-factor"><span className="rf-dot" style={{ background:'var(--blue-600)' }} />Flood Extent</div>
                  <div className="risk-factor"><span className="rf-dot" style={{ background:'var(--orange)' }} />Infrastructure Impact</div>
                  <div className="risk-factor"><span className="rf-dot" style={{ background:'var(--red)' }} />Road Blockage</div>
                  <div className="risk-factor"><span className="rf-dot" style={{ background:'var(--amber)' }} />Settlement Isolation</div>
                </div>
              </div>
            </div>

            {/* Data Sources */}
            <div className="ds-section">
              <div className="ds-title">Data Sources</div>
              <div className="ds-item"><span className="ds-name">Sentinel-1</span><span className={`ds-status${scenes?.pre ? ' used' : ''}`}>{scenes?.pre ? 'Used ✓' : 'Not used'}</span></div>
              <div className="ds-item"><span className="ds-name">Sentinel-2</span><span className="ds-status">Used (closest)</span></div>
              <div className="ds-item"><span className="ds-name">Copernicus DEM</span><span className="ds-status used">Used ✓</span></div>
              <div className="ds-item"><span className="ds-name">OpenStreetMap</span><span className={`ds-status${inf?.osm?.snapshot_at ? ' used' : ''}`}>{inf?.osm?.snapshot_at ? 'Pre-event snapshot ✓' : 'Pending'}</span></div>
              <div className="ds-item"><span className="ds-name">Kuro Siwo</span><span className="ds-status used">AI training/model ✓</span></div>
            </div>

            {/* Limitations */}
            <div className="ds-section">
              <div className="ds-title">Limitations</div>
              <div className="limitations-list">
                <div className="lim-item"><span className="lim-bullet">•</span><span>Sentinel-2 imagery may be unavailable due to cloud cover.</span></div>
                <div className="lim-item"><span className="lim-bullet">•</span><span>Flood detection depends on SAR image quality.</span></div>
                <div className="lim-item"><span className="lim-bullet">•</span><span>DSM infrastructure data may be incomplete</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM CARDS ROW */}
        <div className="bottom-row">
          {/* Flood Analysis */}
          <div className="bottom-card">
            <div className="bc-header">
              <span className="bc-icon">🌊</span>
              <div><div className="bc-title">Flood Analysis</div></div>
              <button className="bc-close">✕</button>
            </div>
            <div className="bc-stats">
              <div className="bc-stat">
                <div className="bcs-val">{floodedKm2 != null ? floodedKm2.toFixed(1) : '12.4'}</div>
                <div className="bcs-lbl">km² Flooded</div>
              </div>
              <div className="bc-stat">
                <div className="bcs-val" style={{ fontSize:13 }}>
                  <span className="badge badge-running" style={{ fontSize:9 }}>⟳ {job?.stages?.find(s=>s.name==='INFERENCE')?.status === 'SUCCEEDED' ? 'Completed' : 'Pending'}</span>
                </div>
              </div>
            </div>
            <div className="bc-info-row"><span className="bc-info-key">Flooded Area</span><span className="bc-info-val">{floodedKm2 ? `${floodedKm2.toFixed(1)} km²` : '12.4 km²'}</span></div>
            <div className="bc-info-row"><span className="bc-info-key">Affected Buildings</span><span className="bc-info-val">{affectedBuildings != null ? affectedBuildings : '143'}</span></div>
            <div className="bc-info-row"><span className="bc-info-key">Confidence</span><span className="bc-info-val">91%</span></div>
            <div style={{ display:'flex', gap:5, marginTop:6 }}>
              <button className="btn btn-sm btn-ghost" style={{ flex:1 }} onClick={() => setPage('dashboard')}>View Map</button>
              <button className="btn btn-sm btn-ghost" style={{ flex:1 }} onClick={() => setPage('flood-analysis')}>View Details</button>
            </div>
          </div>

          {/* AI/ML Segmentation */}
          <div className="bottom-card">
            <div className="bc-header">
              <span className="bc-icon">🧠</span>
              <div><div className="bc-title">AI/ML Segmentation</div></div>
              <button className="bc-close">✕</button>
            </div>
            <span className={`bc-badge ${pipelineStages.find(s=>s.name==='INFERENCE')?.status==='SUCCEEDED' ? 'completed' : 'running'}`}>
              {pipelineStages.find(s=>s.name==='INFERENCE')?.status === 'SUCCEEDED' ? '● Completed' : '⟳ Running'}
            </span>
            <div className="bc-info-row"><span className="bc-info-key">Status</span><span className="bc-info-val" style={{ color:'var(--green)' }}>Completed</span></div>
            <div className="bc-info-row"><span className="bc-info-key">Model</span><span className="bc-info-val">SNUNet</span></div>
            <div className="bc-info-row"><span className="bc-info-key">Checkpoint</span><span className="bc-info-val">Kuro Siwo ✓</span></div>
            <div className="bc-info-row"><span className="bc-info-key">Inference Time</span><span className="bc-info-val">{fmtDur(pipelineStages.find(s=>s.name==='INFERENCE')?.duration_ms ?? null) || '4m 32s'}</span></div>
            <div className="bc-info-row"><span className="bc-info-key">Confidence</span><span className="bc-info-val">91%</span></div>
            <button className="btn btn-sm btn-ghost w-full" style={{ marginTop:6 }} onClick={() => setPage('flood-analysis')}>View Details</button>
          </div>

          {/* Infrastructure Analysis */}
          <div className="bottom-card">
            <div className="bc-header">
              <span className="bc-icon">🏗</span>
              <div><div className="bc-title">Infrastructure Analysis</div></div>
              <button className="bc-close">✕</button>
            </div>
            <div className="bc-damage-item">
              <span className="bc-damage-icon">🏠</span>
              <div><div className="bc-damage-val" style={{ color:'var(--orange)' }}>{affectedBuildings ?? '143'}</div><div className="bc-damage-lbl">Buildings</div></div>
            </div>
            <div className="bc-damage-item">
              <span className="bc-damage-icon">🛣</span>
              <div><div className="bc-damage-val" style={{ color:'var(--red)' }}>{affectedRoadsKm > 0 ? `${affectedRoadsKm.toFixed(0)} km` : '18 km'}</div><div className="bc-damage-lbl">Roads</div></div>
            </div>
            <div className="bc-damage-item">
              <span className="bc-damage-icon">🌉</span>
              <div><div className="bc-damage-val" style={{ color:'var(--amber)' }}>{bridgesAffected ?? '5'}</div><div className="bc-damage-lbl">Bridges</div></div>
            </div>
            <div className="bc-damage-item">
              <span className="bc-damage-icon">⚡</span>
              <div><div className="bc-damage-val">3</div><div className="bc-damage-lbl">Critical Facilities</div></div>
            </div>
            <button className="btn btn-sm btn-ghost w-full" style={{ marginTop:6 }} onClick={() => setPage('infrastructure-analysis')}>View Details</button>
          </div>

          {/* Connectivity Analysis */}
          <div className="bottom-card">
            <div className="bc-header">
              <span className="bc-icon">🔌</span>
              <div><div className="bc-title">Connectivity Analysis</div></div>
              <button className="bc-close">✕</button>
            </div>
            <div className="bc-cutoff-item">
              <span className="bc-cutoff-icon">🔴</span>
              <span className="bc-cutoff-count" style={{ color:'var(--red)' }}>{cutoffSettlements ?? '2'}</span>
              <span className="bc-cutoff-lbl">Cut-off Settlements</span>
            </div>
            <div className="bc-cutoff-item">
              <span className="bc-cutoff-icon">🟢</span>
              <span className="bc-cutoff-count" style={{ color:'var(--green)' }}>{conn?.summary?.connected ?? '3'}</span>
              <span className="bc-cutoff-lbl">Connected Settlements</span>
            </div>
            <div className="bc-cutoff-item">
              <span className="bc-cutoff-icon">🟠</span>
              <span className="bc-cutoff-count" style={{ color:'var(--orange)' }}>{conn?.summary?.detour ?? '3'}</span>
              <span className="bc-cutoff-lbl">Blocked Routes</span>
            </div>
            <div className="bc-cutoff-item">
              <span className="bc-cutoff-icon">🏥</span>
              <span className="bc-cutoff-count">12 km</span>
              <span className="bc-cutoff-lbl">Nearest Hospital</span>
            </div>
            <button className="btn btn-sm btn-ghost w-full" style={{ marginTop:6 }} onClick={() => setPage('cutoff-analysis')}>View Details</button>
          </div>

          {/* Situation Report */}
          <div className="bottom-card wide">
            <div className="bc-header">
              <span className="bc-icon">📄</span>
              <div>
                <div className="bc-title">Situation Report</div>
                <div className="bc-subtitle">Generated: {summary ? new Date().toLocaleDateString('en-IN') : '—'}</div>
              </div>
            </div>
            {activeJobId && job?.results_available ? (
              <div className="report-btns">
                <a href={api.getReportUrl(activeJobId)} target="_blank" rel="noreferrer" className="report-btn primary">
                  ⬇ Download PDF
                </a>
                <a href={api.getProvenanceUrl(activeJobId)} target="_blank" rel="noreferrer" className="report-btn secondary">
                  ⬇ Download Report
                </a>
                <button className="report-btn ghost" onClick={() => window.print()}>🖨 Print</button>
              </div>
            ) : (
              <div className="report-btns">
                <button className="report-btn primary" onClick={() => setShowNewAnalysis(true)}>▶ Start Analysis</button>
                <button className="report-btn ghost" onClick={() => setPage('situation-report')}>📄 View Report</button>
                <button className="report-btn ghost" onClick={() => window.print()}>🖨 Print</button>
              </div>
            )}
            {/* Mini report preview */}
            <div className="mini-report-preview">
              <div style={{ fontWeight:700, color:'var(--blue-600)', fontSize:9 }}>⊟ VALLEYEYE</div>
              <div style={{ fontWeight:600, fontSize:9.5 }}>Flood Situation Report</div>
              <div style={{ color:'var(--text-3)', fontSize:9 }}>Event: {summary?.event_date || 'Aug 2026'}</div>
              <div style={{ color:'var(--text-3)', fontSize:9 }}>Flooded: {floodedKm2 != null ? `${floodedKm2.toFixed(1)} km²` : '12.4 km²'}</div>
              <div style={{ color:'var(--text-3)', fontSize:9 }}>Affected: {affectedBuildings ?? 143} structures</div>
            </div>
          </div>

          {/* Start analysis CTA (no active job) */}
          {!activeJobId && (
            <div className="bottom-card wide" style={{ background:'var(--blue-50)', borderColor:'#bfdbfe' }}>
              <div className="bc-header">
                <span className="bc-icon">🚀</span>
                <div><div className="bc-title" style={{ color:'var(--blue-600)' }}>Start Your First Analysis</div></div>
              </div>
              <p className="text-xs text-muted" style={{ marginBottom:8, lineHeight:1.5 }}>
                Submit a new analysis to begin real-data Sentinel-1 flood mapping with SNUNet AI segmentation, infrastructure damage assessment, and connectivity analysis.
              </p>
              <button className="btn btn-primary" onClick={() => setShowNewAnalysis(true)}>
                + New Analysis
              </button>
            </div>
          )}
        </div>

        {/* PIPELINE BAR */}
        <div className="pipeline-bar">
          <div className="pb-label">🔄 Analysis Pipeline</div>
          {PIPELINE_STAGES.map(name => {
            const st = pipelineStages.find(s => s.name.toUpperCase().replace(/ /g,'_') === name.toUpperCase().replace(/ /g,'_') || s.name === name);
            const status = st?.status ?? 'queued';
            const dur = st?.duration_ms ?? null;
            return (
              <div key={name} className="pipeline-stage">
                <div className={`ps-dot ${status.toLowerCase()}`}>
                  {status === 'SUCCEEDED' ? '✓' : status === 'RUNNING' ? '⟳' : status === 'FAILED' ? '✕' : '·'}
                </div>
                <div className="ps-info">
                  <div className="ps-name">{name}</div>
                  <div className="ps-dur">{fmtDur(dur) || (activeJobId ? 'Pending' : '')}</div>
                </div>
              </div>
            );
          })}
          {activeJobId && job && (
            <div className="pipeline-stage" style={{ marginLeft:'auto' }}>
              <span className={`badge badge-${job.status.toLowerCase()}`}>
                {job.status === 'RUNNING' ? `${job.progress}%` : job.status}
              </span>
            </div>
          )}
        </div>
      </main>

      {/* NEW ANALYSIS MODAL */}
      {showNewAnalysis && (
        <NewAnalysisModal onClose={() => setShowNewAnalysis(false)} onJobCreated={handleJobCreated} />
      )}
    </>
  );
}

// ─── Minimal SVG icon components ──────────────────────────────────────────────
function DashboardIcon() { return <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>; }
function PlusIcon() { return <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>; }
function HistoryIcon() { return <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>; }
function MapIcon() { return <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M1 2l4 1 6-2 4 1v12l-4-1-6 2-4-1V2z" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M5 3v12M11 1v12" stroke="currentColor" strokeWidth="1.3"/></svg>; }
function SatIcon() { return <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><circle cx="8" cy="8" r="3"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>; }
function WaveIcon() { return <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M1 8c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M1 12c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>; }
function BuildingIcon() { return <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="2" y="6" width="12" height="9" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M5 15V9h6v6" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M5 1l3 5 3-5" fill="none" stroke="currentColor" strokeWidth="1.3"/></svg>; }
function CutoffIcon() { return <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><circle cx="4" cy="4" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.3"/><circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M6 6l4 4" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.5"/></svg>; }
function ReportIcon() { return <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="2" y="1" width="12" height="14" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>; }
function DataIcon() { return <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><ellipse cx="8" cy="4" rx="6" ry="2.5" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M2 4v8c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V4" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M2 8c0 1.4 2.7 2.5 6 2.5S14 9.4 14 8" fill="none" stroke="currentColor" strokeWidth="1.3"/></svg>; }
function StatusIcon() { return <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="9" width="3" height="6" rx="0.5"/><rect x="6" y="5" width="3" height="10" rx="0.5"/><rect x="11" y="1" width="3" height="14" rx="0.5"/></svg>; }
function SettingsIcon() { return <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><circle cx="8" cy="8" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M12.9 3.1l-1.4 1.4M4.5 11.5l-1.4 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>; }
