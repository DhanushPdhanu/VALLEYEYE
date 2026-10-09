import { useState, useEffect } from 'react';
import { api } from '../api/client';
import type { JobRecord } from '../api/client';

interface JobHistoryEntry {
  job_id: string;
  status: string;
  event_date: string;
  created_at: string;
  error: { message: string } | null;
  aoi?: string;
}

interface DashboardProps {
  onSelectJob: (jobId: string) => void;
  onNewAnalysis: () => void;
  activeJobId: string | null;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return iso; }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>{status}</span>
  );
}

export default function Dashboard({ onSelectJob, onNewAnalysis, activeJobId }: DashboardProps) {
  const [health, setHealth] = useState<{ status: string; version: string } | null>(null);
  const [ready, setReady] = useState<{ checks: Record<string, string> } | null>(null);
  const [history, setHistory] = useState<JobHistoryEntry[]>([]);
  const [systemError, setSystemError] = useState<string | null>(null);

  useEffect(() => {
    // Load system status
    api.health().then(setHealth).catch(() => setSystemError('Backend unreachable'));
    api.ready().then(setReady).catch(() => {});

    // Load job history from localStorage
    const saved = localStorage.getItem('valleyeye_jobs');
    if (saved) {
      try {
        const ids: string[] = JSON.parse(saved);
        // Fetch latest status for each known job
        Promise.all(
          ids.map(id =>
            api.getJob(id).then((job: JobRecord) => ({
              job_id: job.job_id,
              status: job.status,
              event_date: '',
              created_at: job.created_at,
              error: job.error,
            } as JobHistoryEntry)).catch(() => null)
          )
        ).then(results => {
          const valid = results.filter((r): r is JobHistoryEntry => r !== null);
          setHistory(valid.sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          ));
        });
      } catch { /* ignore */ }
    }
  }, [activeJobId]);

  const cdseStatus = ready?.checks.cdse_credentials;

  return (
    <div className="app-main">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">VALLEYEYE Flood Intelligence System</p>
      </div>
      <div className="page-content">
        {systemError && (
          <div className="alert alert-error">
            <span>⚠️</span>
            <span>{systemError} — ensure the backend is running at the configured URL.</span>
          </div>
        )}

        {/* System Status Row */}
        <div className="stat-grid">
          <div className="stat-card">
            <span className="stat-label">API</span>
            <span className="stat-value" style={{ fontSize: 16 }}>
              {health ? (
                <span style={{ color: 'var(--color-success)' }}>● Online</span>
              ) : (
                <span style={{ color: 'var(--color-error)' }}>● Offline</span>
              )}
            </span>
            {health && <span className="text-xs text-muted">v{health.version}</span>}
          </div>
          <div className="stat-card">
            <span className="stat-label">CDSE Credentials</span>
            <span className="stat-value" style={{ fontSize: 14 }}>
              {cdseStatus === 'configured' ? (
                <span style={{ color: 'var(--color-success)' }}>✓ Set</span>
              ) : cdseStatus === 'optional' ? (
                <span style={{ color: 'var(--color-warning)' }}>⚠ Not set</span>
              ) : (
                <span style={{ color: 'var(--color-text-muted)' }}>–</span>
              )}
            </span>
            {cdseStatus === 'optional' && (
              <span className="text-xs text-muted">Required for SAR download</span>
            )}
          </div>
          <div className="stat-card">
            <span className="stat-label">Model</span>
            <span className="stat-value" style={{ fontSize: 13 }}>SNUNet</span>
            <span className="text-xs text-muted">Kuro Siwo checkpoint</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Data Source</span>
            <span className="stat-value" style={{ fontSize: 13 }}>Sentinel-1</span>
            <span className="text-xs text-muted">SAR GRD · CDSE</span>
          </div>
        </div>

        {/* Quick action */}
        <div className="card">
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <p className="card-title" style={{ marginBottom: 4 }}>Start a New Flood Analysis</p>
              <p className="text-sm text-muted">Define an AOI and event date to begin Sentinel-1 flood mapping.</p>
            </div>
            <button className="btn btn-primary btn-lg" onClick={onNewAnalysis}>
              + New Analysis
            </button>
          </div>
        </div>

        {/* Job history */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Analysis History</h2>
            {history.length > 0 && (
              <span className="badge badge-queued">{history.length}</span>
            )}
          </div>
          <div className="card-body p-0">
            {history.length === 0 ? (
              <div className="empty-state" style={{ padding: '32px 24px' }}>
                <span className="empty-state-icon">📋</span>
                <p className="empty-state-title">No analyses yet</p>
                <p className="empty-state-text">Submitted analyses will appear here after you run your first job.</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Job ID</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Error</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(entry => (
                    <tr key={entry.job_id}>
                      <td>
                        <code style={{ fontSize: 11, fontFamily: 'monospace' }}>
                          {entry.job_id.slice(0, 8)}…
                        </code>
                      </td>
                      <td><StatusBadge status={entry.status} /></td>
                      <td className="text-sm text-secondary">{formatDate(entry.created_at)}</td>
                      <td className="text-sm" style={{ color: entry.error ? 'var(--color-error)' : 'var(--color-text-muted)' }}>
                        {entry.error?.message || '—'}
                      </td>
                      <td>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => onSelectJob(entry.job_id)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* About */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">About VALLEYEYE</h2>
          </div>
          <div className="card-body">
            <p className="text-sm" style={{ lineHeight: '1.6', color: 'var(--color-text-secondary)' }}>
              VALLEYEYE is a real-data flood intelligence system that uses Sentinel-1 SAR imagery and
              the SNUNet change-detection model (trained on the Kuro Siwo dataset) to map flood extent,
              identify potentially affected infrastructure, and detect settlements that may be cut off
              by flood-related road disruptions. All results are derived from actual satellite observations
              and OSM data — no results are simulated or fabricated.
            </p>
            <div className="mt-12">
              <div className="info-row">
                <span className="info-key">Model</span>
                <span className="info-val">SNUNet (Kuro Siwo checkpoint)</span>
              </div>
              <div className="info-row">
                <span className="info-key">Primary imagery</span>
                <span className="info-val">Sentinel-1 GRD (VV/VH)</span>
              </div>
              <div className="info-row">
                <span className="info-key">Infrastructure data</span>
                <span className="info-val">OpenStreetMap via ohsome API</span>
              </div>
              <div className="info-row">
                <span className="info-key">Exposure classification</span>
                <span className="info-val">Potential exposure only — not confirmed damage</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
