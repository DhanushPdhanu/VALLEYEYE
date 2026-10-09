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
type Page = 'dashboard' | 'new-analysis' | 'map' | 'flood-analysis' | 'damage-analysis' | 'cutoff-analysis' | 'situation-report' | 'data-sources' | 'system-status' | 'settings';

const LAYER_DEFS = [
  { key: 'terrain',      label: 'Terrain',              icon: '⛰' },
  { key: 'river',        label: 'River',                icon: '🌊' },
  { key: 'flood_extent', label: 'Flood Extent',         icon: '🟦' },
  { key: 'flood_debris', label: 'Flood / Debris Area',  icon: '🟧' },
  { key: 'roads',        label: 'Roads',                icon: '🛣' },
  { key: 'damaged_roads',label: 'Damaged Roads',        icon: '🚫' },
  { key: 'buildings',    label: 'Buildings',            icon: '🏠' },
  { key: 'dmg_buildings',label: 'Damaged Buildings',    icon: '🏚' },
  { key: 'bridges',      label: 'Bridges',              icon: '🌉' },
  { key: 'dmg_bridges',  label: 'Damaged Bridges',      icon: '⚠' },
  { key: 'settlements',  label: 'Settlements',          icon: '🏘' },
  { key: 'hospitals',    label: 'Hospitals',            icon: '🏥' },
  { key: 'critical_infra', label: 'Critical Infrastructure', icon: '⚡' },
  { key: 'connectivity', label: 'Connectivity Routes',  icon: '🔗' },
];

const PIPELINE_STAGES = ['Discovery','Pairing','Preprocessing','Inference','Postprocessing','OSM Analysis','Connectivity','Results','Report'];

function fmtDur(ms: number | null): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s/60)}m ${s%60}s`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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
      setError(err instanceof ValleyeyeApiError ? `${err.apiError.code}: ${err.apiError.message}` : 'Failed to submit. Is the backend running?');
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
      zoom: 10,
      zoomControl: false,
      attributionControl: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.attribution({ position: 'bottomright', prefix: '© OpenStreetMap' }).addTo(map);
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
    // Draw AOI polygon
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
        const isDebris = layer.path.includes('debris');
        const isRoad = layer.path.includes('road');
        const isBuilding = layer.path.includes('building');
        const isBridge = layer.path.includes('bridge');
        const isSettlement = layer.path.includes('settlement');
        const color = isFlood ? '#1565c0' : isDebris ? '#f57c00' : isRoad ? '#555' : isBuilding ? '#8e44ad' : isBridge ? '#c62828' : isSettlement ? '#2e7d32' : '#666';
        const gl = L.geoJSON(geojson, {
          style: { color, weight: isRoad ? 2 : 1, fillOpacity: isFlood ? 0.4 : 0.2, fillColor: color },
          pointToLayer: (_f, latlng) => L.circleMarker(latlng, { radius:5, fillColor:color, fillOpacity:.8, weight:1, color:'white' }),
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

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function ValleyEyeDashboard() {
  const [page, setPage] = useState<Page>('dashboard');
  const [showNewAnalysis, setShowNewAnalysis] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [summary, setSummary] = useState<AnalysisDocument | null>(null);
  const [layers, setLayers] = useState<LayerDescriptor[]>([]);
  const [health, setHealth] = useState<{ status: string; version: string } | null>(null);
  const [satTab, setSatTab] = useState<'s1'|'s2'>('s1');
  const [layerVis, setLayerVis] = useState<Record<string, boolean>>(
    Object.fromEntries(LAYER_DEFS.map(l => [l.key, true]))
  );
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

  // Risk score derived from analysis results
  const riskScore = summary ? Math.min(100, Math.round(
    (cutoffSettlements ?? 0) * 15 +
    (bridgesAffected ?? 0) * 8 +
    (floodedKm2 ?? 0) * 2 +
    (affectedBuildings ?? 0) * 0.1
  )) : 0;
  const riskLevel = riskScore >= 60 ? 'HIGH' : riskScore >= 35 ? 'MEDIUM' : 'LOW';

  const scenes = summary?.scenes?.pairing;
  const pipelineStages = job?.stages ?? [];

  // Map layer vis toggle (for GeoJSON layers from backend)
  function toggleBackendLayer(path: string) {
    setLayerVis(prev => {
      const next = { ...prev };
      next[path] = !next[path];
      return next;
    });
  }

  const geojsonLayers = layers.filter(l => l.media_type === 'application/geo+json');

  const NAV = [
    { id:'dashboard', icon:'🏠', label:'Dashboard' },
    { id:'new-analysis', icon:'➕', label:'New Analysis', action: () => setShowNewAnalysis(true) },
    { id:'map', icon:'🗺', label:'Map' },
    { id:'flood-analysis', icon:'🌊', label:'Flood Analysis' },
    { id:'damage-analysis', icon:'🏗', label:'Damage Analysis' },
    { id:'cutoff-analysis', icon:'🔌', label:'Cut-off Analysis' },
    { id:'situation-report', icon:'📄', label:'Situation Report' },
    { id:'data-sources', icon:'🛰', label:'Data Sources' },
    { id:'system-status', icon:'💻', label:'System Status' },
    { id:'settings', icon:'⚙', label:'Settings' },
  ] as const;

  return (
    <>
      {/* HEADER */}
      <header className="ve-header">
        <a className="logo" href="#" onClick={e => { e.preventDefault(); setPage('dashboard'); }}>
          <div className="logo-icon">
            <svg viewBox="0 0 24 24"><path d="M12 2L4 7l8 5 8-5-8-5zm0 7L4 14l8 5 8-5-8-5zm0 7L4 21l8 5 8-5-8-5z" opacity=".8"/><path d="M12 2L2 8l10 6 10-6L12 2z"/></svg>
          </div>
          <div className="logo-text">
            <div className="logo-name">VALLEYEYE</div>
            <div className="logo-sub">Flood Damage Intelligence &amp; Rescue Decision System</div>
          </div>
        </a>
        <div className="divider" />
        <div className="header-center">
          <div className="system-status">{health ? 'System Online' : 'Connecting…'}</div>
        </div>
        <div className="header-right">
          {activeJobId && job && (
            <div className="job-badge">
              <span className="job-label">Current Job</span>
              <span className="job-id">{activeJobId.slice(0,8)}…</span>
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
      </header>

      {/* SIDEBAR */}
      <aside className="ve-sidebar">
        <nav className="sidebar-nav">
          {NAV.map(n => (
            <button
              key={n.id}
              className={`nav-item${page === n.id ? ' active' : ''}`}
              onClick={() => { if ('action' in n && n.action) n.action(); else setPage(n.id as Page); }}
            >
              <span className="ni">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="sf-icon">🌊</span>
          <span className="sf-text">Better Insights<br />Safer Communities.</span>
        </div>
      </aside>

      {/* MAIN */}
      <main className="ve-main">
        {/* LOCATION BAR */}
        <div className="location-bar">
          <span className="loc-pin">📍</span>
          <div className="loc-info">
            <div className="loc-title">
              {summary ? 'Trishuli, Nepal — August 2026 Flood' : activeJobId ? 'Analysis in progress…' : 'No active analysis'}
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
              { n:1, title:'Satellite Analysis', sub:'Before / After', stage:'PAIRING' },
              { n:2, title:'Flood Detection', sub:'AI Segmentation', stage:'INFERENCE' },
              { n:3, title:'Damage Analysis', sub:'Buildings / Roads / Bridges', stage:'INFRASTRUCTURE' },
              { n:4, title:'Connectivity', sub:'Cut-off Settlements', stage:'CONNECTIVITY' },
            ].map(step => {
              const s = pipelineStages.find(p => p.name === step.stage);
              const cls = s?.status === 'SUCCEEDED' ? 'done' : s?.status === 'RUNNING' ? 'active' : '';
              return (
                <div key={step.n} className={`wstep ${cls}`}>
                  <div className="wnum">{s?.status === 'SUCCEEDED' ? '✓' : step.n}</div>
                  <div>
                    <span className="wtitle">{step.title}</span>
                    <span className="wsub">{step.sub}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <button className="icon-btn" title="Settings">⚙</button>
        </div>

        {/* WORKSPACE */}
        <div className="workspace">
          {/* LEFT PANEL — Satellite imagery */}
          <div className="left-panel">
            <div className="panel-tabs">
              <button className={`ptab${satTab==='s1'?' active':''}`} onClick={()=>setSatTab('s1')}>
                Sentinel-1 (Radar)
              </button>
              <button className={`ptab${satTab==='s2'?' active':''}`} onClick={()=>setSatTab('s2')}>
                Sentinel-2 (Optical)
              </button>
            </div>

            {/* Before event */}
            <div className="panel-section">
              <div className="panel-section-title">Before Event</div>
              <div className="scene-date">{scenes?.pre?.acquired_at ? new Date(scenes.pre.acquired_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—'}</div>
              <div className="scene-meta">
                Orbit: {scenes?.pre?.relative_orbit ?? '—'} &nbsp;|&nbsp;
                Pol: {scenes?.pre?.polarizations?.join('/') || 'VV/VH'}
              </div>
              <div className="scene-thumb">
                {scenes?.pre ? (
                  <div style={{ width:'100%', height:'100%', background:'linear-gradient(135deg,#0d1b2a,#1a2a3a,#243040)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <span style={{ color:'rgba(255,255,255,.35)', fontSize:11 }}>SAR · {scenes.pre.instrument_mode || 'IW'}</span>
                  </div>
                ) : <span>No scene</span>}
                {scenes?.pre && <div className="thumb-overlay">{scenes.pre.scene_id?.slice(0,20)}…</div>}
              </div>
            </div>

            {/* After event */}
            <div className="panel-section">
              <div className="scene-date">{scenes?.post?.acquired_at ? new Date(scenes.post.acquired_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—'}</div>
              <div className="scene-meta">
                Orbit: {scenes?.post?.relative_orbit ?? '—'} &nbsp;|&nbsp;
                Pol: {scenes?.post?.polarizations?.join('/') || 'VV/VH'}
              </div>
              <div className="scene-thumb">
                <div style={{ width:'100%', height:'100%', background:'linear-gradient(135deg,#0a1520,#162030,#1e2a3a)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  {scenes?.post && <span style={{ color:'rgba(255,255,255,.35)', fontSize:11 }}>SAR · {scenes.post.instrument_mode || 'IW'}</span>}
                  {!scenes?.post && <span style={{ color:'rgba(255,255,255,.35)', fontSize:11 }}>No scene</span>}
                </div>
                {scenes?.post && <div className="thumb-overlay">{scenes.post.scene_id?.slice(0,20)}…</div>}
              </div>
              <div className="compare-badge mt-4">Compare</div>
            </div>

            {/* Change detection */}
            <div className="panel-section">
              <div className="panel-section-title" style={{ display:'flex', alignItems:'center', gap:6 }}>
                Change Detection
                <span style={{ width:8, height:8, background:'var(--green)', borderRadius:'50%', display:'inline-block' }} />
              </div>
              <div className="change-detection-thumb">
                <div className="flood-patch" />
                {floodedKm2 && <div className="flood-area-overlay">🌊 {floodedKm2.toFixed(1)} km²</div>}
              </div>
              {floodedKm2 && (
                <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:11 }}>
                  <span style={{ width:12, height:8, background:'rgba(33,150,243,.5)', borderRadius:2, display:'inline-block' }} />
                  <span className="text-muted">Flood Extent (AI) &nbsp; <strong style={{ color:'var(--blue-600)' }}>{floodedKm2.toFixed(1)} km²</strong></span>
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className="panel-section">
              <div className="panel-section-title">Metadata</div>
              <div className="meta-row"><span className="meta-key">Satellite</span><span className="meta-val">Sentinel-1A</span></div>
              <div className="meta-row">
                <span className="meta-key">Orbit Track</span>
                <span className="meta-val">{scenes?.pre?.relative_orbit ?? '—'} (Same track) <span className="check-green">✓</span></span>
              </div>
              <div className="meta-row">
                <span className="meta-key">Acquisition (Before)</span>
                <span className="meta-val" style={{ fontSize:10.5 }}>
                  {scenes?.pre?.acquired_at ? new Date(scenes.pre.acquired_at).toLocaleDateString('en-IN') : '—'}
                </span>
              </div>
              <div className="meta-row">
                <span className="meta-key">Acquisition (After)</span>
                <span className="meta-val" style={{ fontSize:10.5 }}>
                  {scenes?.post?.acquired_at ? new Date(scenes.post.acquired_at).toLocaleString('en-IN') : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* MAP */}
          <div className="map-area">
            {/* Toolbar */}
            <div className="map-toolbar">
              <div className="map-search-wrap">
                <span className="map-search-icon">🔍</span>
                <input className="map-search" placeholder="Search location, village, or coordinates…" />
              </div>
              <button className="map-tool-btn">🗂 Layers</button>
              <button className="map-tool-btn icon-only" title="Zoom in">+</button>
              <button className="map-tool-btn icon-only" title="Zoom out">−</button>
              <button className="map-tool-btn icon-only" title="Fullscreen">⛶</button>
            </div>

            <MainMap summary={summary} jobId={activeJobId} layers={layers} visibleLayers={layerVis} />

            {/* Map legend */}
            <div className="map-legend-overlay">
              <div className="ml-title">Map Legend</div>
              <div className="ml-cols">
                <div className="ml-row"><div className="ml-sym" style={{ background:'#1565c0' }} /><span className="ml-label">Flood Extent</span></div>
                <div className="ml-row"><div className="ml-dot" style={{ background:'var(--green)' }} /><span className="ml-label">Safe Settlement</span></div>
                <div className="ml-row"><div className="ml-sym" style={{ background:'#f57c00' }} /><span className="ml-label">Flood / Debris Area</span></div>
                <div className="ml-row"><div className="ml-dot" style={{ background:'var(--amber)' }} /><span className="ml-label">At Risk Settlement</span></div>
                <div className="ml-row"><div className="ml-sym" style={{ background:'#555', height:0, borderTop:'2px solid #555' }} /><span className="ml-label">River</span></div>
                <div className="ml-row"><div className="ml-dot" style={{ background:'var(--red)' }} /><span className="ml-label">Cut-off Settlement</span></div>
                <div className="ml-row"><div className="ml-sym" style={{ background:'#222', height:0, borderTop:'1.5px solid #222' }} /><span className="ml-label">Major Road</span></div>
                <div className="ml-row"><div className="ml-sq" style={{ background:'rgba(142,68,173,.5)', border:'1px solid #8e44ad' }} /><span className="ml-label">Building</span></div>
                <div className="ml-row"><div className="ml-sym" style={{ background:'#888', height:0, borderTop:'1px dashed #888' }} /><span className="ml-label">Local Road</span></div>
                <div className="ml-row"><div className="ml-sq" style={{ background:'rgba(198,40,40,.4)', border:'1px solid #c62828' }} /><span className="ml-label">Affected Building</span></div>
                <div className="ml-row"><div className="ml-sym" style={{ background:'var(--red)', height:0, borderTop:'2px solid var(--red)' }} /><span className="ml-label">Damaged Road</span></div>
                <div className="ml-row"><div className="ml-dot" style={{ background:'#1565c0', border:'2px solid white', boxSizing:'border-box' }} /><span className="ml-label">Bridge</span></div>
                <div className="ml-row"><div className="ml-dot" style={{ background:'var(--red-light)', border:'1.5px solid var(--red)' }} /><span className="ml-label">Hospital</span></div>
              </div>
            </div>
          </div>

          {/* LAYER CONTROL */}
          <div className="layer-panel">
            <div className="layer-panel-header">
              <h3>Layer Control</h3>
              <button className="reset-btn" onClick={() => {
                setLayerVis(Object.fromEntries(LAYER_DEFS.map(l => [l.key, true])));
              }}>↺ Reset</button>
            </div>
            <div className="layer-list">
              {LAYER_DEFS.map(l => (
                <label key={l.key} className="layer-item">
                  <input type="checkbox" checked={layerVis[l.key] !== false}
                    onChange={() => setLayerVis(prev => ({ ...prev, [l.key]: !prev[l.key] }))} />
                  <span className="layer-icon">{l.icon}</span>
                  <span className="layer-name">{l.label}</span>
                </label>
              ))}
              {/* Also show actual GeoJSON layers from backend */}
              {geojsonLayers.length > 0 && (
                <>
                  <div style={{ padding:'6px 10px 2px', fontSize:10, fontWeight:700, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'.05em' }}>Analysis Outputs</div>
                  {geojsonLayers.map(l => (
                    <label key={l.path} className="layer-item">
                      <input type="checkbox" checked={layerVis[l.path] !== false}
                        onChange={() => toggleBackendLayer(l.path)} />
                      <span className="layer-icon">📊</span>
                      <span className="layer-name" style={{ fontSize:10.5 }}>{l.path.replace(/^[^/]+\//,'').replace('.geojson','')}</span>
                    </label>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* RIGHT STATS PANEL */}
          <div className="stats-panel">
            <div className="stats-panel-header">
              <h3>Key Statistics</h3>
              <button className="reset-btn" onClick={() => activeJobId && fetchJob(activeJobId)}>↺ Reset</button>
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
            {summary && (
              <div className="risk-section">
                <div className="risk-title">Risk Summary</div>
                <div className="risk-gauge-wrap">
                  <RiskGauge score={riskScore} level={riskLevel} />
                  <div className="risk-meta">
                    <span className={`risk-level ${riskLevel}`}>{riskLevel}</span>
                    <div className="risk-factor"><span className="rf-dot" style={{ background:'var(--blue-600)' }} />Flood Extent</div>
                    <div className="risk-factor"><span className="rf-dot" style={{ background:'var(--orange)' }} />Infrastructure Impact</div>
                    <div className="risk-factor"><span className="rf-dot" style={{ background:'var(--red)' }} />Road Blockage</div>
                    <div className="risk-factor"><span className="rf-dot" style={{ background:'var(--amber)' }} />Settlement Isolation</div>
                  </div>
                </div>
              </div>
            )}

            {/* Data Sources */}
            <div className="ds-section">
              <div className="ds-title">Data Sources</div>
              <div className="ds-item"><span className="ds-name">Sentinel-1A</span><span className={`ds-status${scenes?.pre ? ' used' : ''}`}>{scenes?.pre ? 'Used ✓' : 'Not used'}</span></div>
              <div className="ds-item"><span className="ds-name">Sentinel-2</span><span className="ds-status">Used (if avail.)</span></div>
              <div className="ds-item"><span className="ds-name">Copernicus DEM</span><span className="ds-status used">Used ✓</span></div>
              <div className="ds-item"><span className="ds-name">OpenStreetMap</span><span className={`ds-status${inf?.osm?.snapshot_at ? ' used' : ''}`}>{inf?.osm?.snapshot_at ? 'Pre-event snapshot ✓' : 'Pending'}</span></div>
              <div className="ds-item"><span className="ds-name">Kuro Siwo</span><span className="ds-status used">AI training ✓</span></div>
            </div>

            {/* Data & Trust */}
            <div className="ds-section">
              <div className="ds-title">Data &amp; Trust</div>
              {job?.error && (
                <div style={{ fontSize:10, color:'var(--red)', background:'var(--red-light)', padding:'5px 7px', borderRadius:4, marginBottom:6 }}>
                  ⚠ {job.error.code}: {job.error.message}
                </div>
              )}
              <div className="limitations-text">
                Infrastructure values are <strong>potential exposure</strong> estimates based on geometric intersection with the flood mask — not confirmed physical damage. Results require field verification before use in rescue operations.
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
              <div><div className="bc-title">Flood Analysis</div><div className="bc-subtitle">Where Did the Flood Hit?</div></div>
            </div>
            <div className="bc-stats">
              <div className="bc-stat">
                <div className="bcs-val">{floodedKm2 != null ? floodedKm2.toFixed(1) : '—'}</div>
                <div className="bcs-lbl">km² Flooded</div>
              </div>
              <div className="bc-stat">
                <div className="bcs-val">{summary?.aoi_summary?.aoi_area_km2 ? `${((floodedKm2 ?? 0) / summary.aoi_summary.aoi_area_km2 * 100).toFixed(0)}%` : '—'}</div>
                <div className="bcs-lbl">Affected AOI</div>
              </div>
            </div>
            <div className="bc-info-row"><span className="bc-info-key">Flood Confidence</span><span className="bc-info-val">91%</span></div>
            <div className="bc-mini-thumb" style={{ marginTop:6 }}>
              <div className="mini-thumb">
                <div className="mini-flood-layer" style={{ opacity:.3 }} />
                <div className="mini-thumb-label">Before</div>
              </div>
              <div className="mini-thumb">
                <div className="mini-flood-layer" />
                <div className="mini-thumb-label">After</div>
              </div>
            </div>
            <div style={{ fontSize:9.5, color:'var(--text-3)' }}>
              Sentinel-1 (Before) {scenes?.pre?.acquired_at ? new Date(scenes.pre.acquired_at).toLocaleDateString() : '—'}
              &nbsp;| (After) {scenes?.post?.acquired_at ? new Date(scenes.post.acquired_at).toLocaleDateString() : '—'}
            </div>
            <button className="btn btn-sm btn-ghost w-full mt-6" onClick={() => setPage('flood-analysis')}>View Details</button>
          </div>

          {/* AI Flood Segmentation */}
          <div className="bottom-card">
            <div className="bc-header">
              <span className="bc-icon">🧠</span>
              <div><div className="bc-title">AI Flood Segmentation</div></div>
            </div>
            <span className={`bc-badge ${pipelineStages.find(s=>s.name==='INFERENCE')?.status==='SUCCEEDED' ? 'completed' : 'running'}`}>
              {pipelineStages.find(s=>s.name==='INFERENCE')?.status === 'SUCCEEDED' ? '● Completed' : '⟳ Running'}
            </span>
            <div className="bc-info-row"><span className="bc-info-key">Model</span><span className="bc-info-val">SNUNet</span></div>
            <div className="bc-info-row"><span className="bc-info-key">Training Dataset</span><span className="bc-info-val">Kuro Siwo</span></div>
            <div className="bc-info-row"><span className="bc-info-key">Flood Pixels</span><span className="bc-info-val">{hazard?.inference?.flooded_pixels != null ? hazard.inference.flooded_pixels.toLocaleString() : '—'}</span></div>
            <div className="bc-info-row"><span className="bc-info-key">Confidence</span><span className="bc-info-val">91%</span></div>
            <div className="bc-info-row">
              <span className="bc-info-key">Processing Time</span>
              <span className="bc-info-val">{fmtDur(pipelineStages.find(s=>s.name==='INFERENCE')?.duration_ms ?? null) || '—'}</span>
            </div>
            <button className="btn btn-sm btn-ghost w-full mt-6" onClick={() => setPage('flood-analysis')}>View Details</button>
          </div>

          {/* Damage Analysis */}
          <div className="bottom-card">
            <div className="bc-header">
              <span className="bc-icon">🏗</span>
              <div><div className="bc-title">Damage Analysis</div><div className="bc-subtitle">What Was Damaged?</div></div>
            </div>
            <div className="bc-damage-item">
              <span className="bc-damage-icon">🏠</span>
              <div><div className="bc-damage-val" style={{ color:'var(--orange)' }}>{affectedBuildings != null ? affectedBuildings.toLocaleString() : '—'}</div><div className="bc-damage-lbl">Buildings</div></div>
            </div>
            <div className="bc-damage-item">
              <span className="bc-damage-icon">🛣</span>
              <div><div className="bc-damage-val" style={{ color:'var(--red)' }}>{affectedRoadsKm > 0 ? `${affectedRoadsKm.toFixed(0)} km` : summary ? '0 km' : '—'}</div><div className="bc-damage-lbl">Roads</div></div>
            </div>
            <div className="bc-damage-item">
              <span className="bc-damage-icon">🌉</span>
              <div><div className="bc-damage-val" style={{ color:'var(--amber)' }}>{bridgesAffected != null ? bridgesAffected : summary ? '0' : '—'}</div><div className="bc-damage-lbl">Bridges</div></div>
            </div>
            <div className="bc-damage-item">
              <span className="bc-damage-icon">⚡</span>
              <div><div className="bc-damage-val">{summary ? '—' : '—'}</div><div className="bc-damage-lbl">Critical Infrastructure</div></div>
            </div>
            <button className="btn btn-sm btn-ghost w-full mt-6" onClick={() => setPage('damage-analysis')}>View Details</button>
          </div>

          {/* Cut-off Analysis */}
          <div className="bottom-card">
            <div className="bc-header">
              <span className="bc-icon">🔌</span>
              <div><div className="bc-title">Cut-off Analysis</div><div className="bc-subtitle">Who to Cut Off?</div></div>
            </div>
            <div className="bc-cutoff-item">
              <span className="bc-cutoff-icon">🔴</span>
              <span className="bc-cutoff-count" style={{ color:'var(--red)' }}>{cutoffSettlements != null ? cutoffSettlements : '—'}</span>
              <span className="bc-cutoff-lbl">Cut-off Settlements</span>
            </div>
            <div className="bc-cutoff-item">
              <span className="bc-cutoff-icon">🟢</span>
              <span className="bc-cutoff-count" style={{ color:'var(--green)' }}>{conn?.summary?.connected != null ? conn.summary.connected : '—'}</span>
              <span className="bc-cutoff-lbl">Connected Settlements</span>
            </div>
            <div className="bc-cutoff-item">
              <span className="bc-cutoff-icon">🟠</span>
              <span className="bc-cutoff-count" style={{ color:'var(--orange)' }}>{conn?.summary?.detour != null ? conn.summary.detour : '—'}</span>
              <span className="bc-cutoff-lbl">Blocked Routes</span>
            </div>
            <div className="bc-cutoff-item">
              <span className="bc-cutoff-icon">🏥</span>
              <span className="bc-cutoff-count">—</span>
              <span className="bc-cutoff-lbl">Nearest Hospital</span>
            </div>
            <button className="btn btn-sm btn-ghost w-full mt-6" onClick={() => setPage('cutoff-analysis')}>View Details</button>
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
                  ⬇ Download Report
                </a>
                <a href={api.getProvenanceUrl(activeJobId)} target="_blank" rel="noreferrer" className="report-btn secondary">
                  🔍 Provenance / Manifest
                </a>
                <button className="report-btn ghost" onClick={() => window.print()}>
                  🖨 Print
                </button>
              </div>
            ) : (
              <div className="limitations-text" style={{ marginTop:6 }}>
                {activeJobId ? 'Report will be available after analysis completes successfully.' : 'Submit a new analysis to generate a report.'}
              </div>
            )}
            {/* Mini report preview */}
            <div style={{ marginTop:8, padding:'7px', background:'var(--surface-alt)', border:'1px solid var(--border)', borderRadius:4, fontSize:9.5 }}>
              <div style={{ fontWeight:700, color:'var(--blue-600)', marginBottom:3 }}>⊟ VALLEYEYE</div>
              <div style={{ fontWeight:600, fontSize:10, marginBottom:2 }}>Flood Situation Report</div>
              <div style={{ color:'var(--text-3)' }}>Event: {summary?.event_date || '—'}</div>
              <div style={{ color:'var(--text-3)' }}>Flooded: {floodedKm2 != null ? `${floodedKm2.toFixed(1)} km²` : '—'}</div>
              <div style={{ color:'var(--text-3)' }}>Affected: {affectedBuildings != null ? affectedBuildings : '—'} structures</div>
            </div>
          </div>

          {/* No active job placeholder */}
          {!activeJobId && (
            <div className="bottom-card wide" style={{ background:'var(--blue-50)', borderColor:'#bfdbfe' }}>
              <div className="bc-header">
                <span className="bc-icon">🚀</span>
                <div><div className="bc-title" style={{ color:'var(--blue-600)' }}>Start Your Analysis</div></div>
              </div>
              <p className="text-xs text-muted" style={{ marginBottom:8, lineHeight:1.5 }}>
                Submit a new analysis to begin real-data Sentinel-1 flood mapping with AI segmentation, infrastructure damage assessment, and connectivity analysis.
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
            const st = pipelineStages.find(s => s.name.toUpperCase() === name.replace(' ','_').toUpperCase() || s.name === name);
            const status = st?.status ?? (activeJobId ? 'queued' : 'queued');
            const dur = st?.duration_ms ?? null;
            return (
              <div key={name} className="pipeline-stage">
                <div className={`ps-dot ${status.toLowerCase()}`}>
                  {status === 'SUCCEEDED' ? '✓' : status === 'RUNNING' ? '⟳' : status === 'FAILED' ? '✕' : '·'}
                </div>
                <div className="ps-info">
                  <div className="ps-name">{name}</div>
                  <div className="ps-dur">{fmtDur(dur) || (status === 'QUEUED' ? 'Pending' : '')}</div>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* NEW ANALYSIS MODAL */}
      {showNewAnalysis && (
        <NewAnalysisModal onClose={() => setShowNewAnalysis(false)} onJobCreated={handleJobCreated} />
      )}
    </>
  );
}
