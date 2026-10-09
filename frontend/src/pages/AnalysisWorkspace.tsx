import { useEffect, useState } from 'react';
import { useJob } from '../hooks/useJob';
import PipelineProgress from '../components/PipelineProgress';
import { api } from '../api/client';

interface AnalysisWorkspaceProps {
  jobId: string;
  onViewResults: () => void;
}

export default function AnalysisWorkspace({ jobId, onViewResults }: AnalysisWorkspaceProps) {
  const { job, summary, loading, error, retryable, refresh } = useJob(jobId);
  const [cancelling, setCancelling] = useState(false);

  // Auto-navigate to results when complete
  useEffect(() => {
    if (job?.status === 'SUCCEEDED' || job?.status === 'PARTIAL') {
      // Delay slightly to let the user see the success state
      const t = setTimeout(() => onViewResults(), 1500);
      return () => clearTimeout(t);
    }
  }, [job?.status, onViewResults]);

  async function handleCancel() {
    if (!window.confirm('Cancel this analysis job?')) return;
    setCancelling(true);
    try {
      await api.cancelJob(jobId);
      refresh();
    } catch { /* ignore */ }
    setCancelling(false);
  }

  const isTerminal = job?.status === 'SUCCEEDED' || job?.status === 'PARTIAL' || job?.status === 'FAILED';
  const canCancel = job && !isTerminal;

  return (
    <div className="app-main">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page-title">Analysis Workspace</h1>
            <p className="page-subtitle" style={{ fontFamily: 'monospace', fontSize: 12 }}>{jobId}</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={refresh}>
              ↺ Refresh
            </button>
            {canCancel && (
              <button className="btn btn-danger btn-sm" onClick={handleCancel} disabled={cancelling}>
                {cancelling ? '…' : '✕ Cancel'}
              </button>
            )}
            {job?.results_available && (
              <button className="btn btn-primary btn-sm" onClick={onViewResults}>
                View Results →
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="page-content">
        {error && (
          <div className="alert alert-error">
            <span>⚠️</span>
            <div>
              {error}
              {retryable && (
                <><br /><button className="btn btn-sm btn-ghost mt-8" onClick={refresh}>Retry</button></>
              )}
            </div>
          </div>
        )}

        {/* Status card */}
        {job && (
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Job Status</h2>
              <span className={`badge badge-${job.status.toLowerCase()}`}>{job.status}</span>
            </div>
            <div className="card-body">
              <div className="stat-grid">
                <div className="stat-card">
                  <span className="stat-label">Overall Progress</span>
                  <span className="stat-value">{job.progress}<span className="stat-unit">%</span></span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Current Stage</span>
                  <span className="stat-value" style={{ fontSize: 15 }}>{job.current_stage || '—'}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Created</span>
                  <span className="stat-value" style={{ fontSize: 13 }}>
                    {new Date(job.created_at).toLocaleTimeString('en-IN')}
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Stages</span>
                  <span className="stat-value">{job.stages.filter(s => s.status === 'SUCCEEDED').length} <span className="stat-unit">/ {job.stage_count}</span></span>
                </div>
              </div>

              {/* Overall bar */}
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="text-xs text-muted">Progress</span>
                  <span className="text-xs text-muted">{job.progress}%</span>
                </div>
                <div className="stage-bar" style={{ height: 10 }}>
                  <div
                    className={`stage-bar-fill ${job.status.toLowerCase()}`}
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !job && (
          <div className="card">
            <div className="card-body">
              <div className="empty-state">
                <span className="spinner spinner-lg" />
                <p className="empty-state-title">Loading job status…</p>
              </div>
            </div>
          </div>
        )}

        {/* Error details */}
        {job?.error && (
          <div className="alert alert-error">
            <span>🔴</span>
            <div>
              <strong>{job.error.code}</strong> — {job.error.message}
              <br />
              <span className="text-xs">Stage: {job.error.stage}</span>
              {job.error.retryable && <span className="text-xs"> · Retryable</span>}
              {Object.keys(job.error.details).length > 0 && (
                <pre style={{ marginTop: 6, fontSize: 11, background: 'rgba(198,40,40,0.06)', padding: 8, borderRadius: 4 }}>
                  {JSON.stringify(job.error.details, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* Warnings */}
        {job?.warnings && job.warnings.length > 0 && (
          <div className="alert alert-warning">
            <span>⚠️</span>
            <div>
              <strong>Warnings</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {job.warnings.map((w, i) => <li key={i} className="text-sm">{w}</li>)}
              </ul>
            </div>
          </div>
        )}

        {/* Pipeline stages */}
        {job?.stages && (
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Pipeline Stages</h2>
            </div>
            <div className="card-body">
              <PipelineProgress stages={job.stages} currentStage={job.current_stage} />
            </div>
          </div>
        )}

        {/* Success / Partial state */}
        {(job?.status === 'SUCCEEDED' || job?.status === 'PARTIAL') && (
          <div className={`alert alert-${job.status === 'SUCCEEDED' ? 'success' : 'warning'}`}>
            <span>{job.status === 'SUCCEEDED' ? '✅' : '⚠️'}</span>
            <div>
              <strong>{job.status === 'SUCCEEDED' ? 'Analysis complete' : 'Partial results available'}</strong>
              {' '}— Navigating to results…
            </div>
          </div>
        )}

        {/* Artifacts */}
        {job && Object.keys(job.artifacts).length > 0 && (
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Artifacts ({Object.keys(job.artifacts).length})</h2>
            </div>
            <div className="card-body p-0">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(job.artifacts).map(([key, artifact]) => (
                    <tr key={key}>
                      <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{artifact.path}</td>
                      <td className="text-xs text-muted">{artifact.media_type}</td>
                      <td className="text-xs text-muted">{(artifact.size_bytes / 1024).toFixed(1)} KB</td>
                      <td>
                        <a
                          href={api.getLayerUrl(jobId, artifact.path)}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-sm btn-ghost"
                        >
                          ↓
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Preview of summary if available */}
        {summary && (
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Quick Summary</h2>
            </div>
            <div className="card-body">
              <div className="stat-grid">
                {summary.hazards.inference.flooded_area_km2 != null && (
                  <div className="stat-card">
                    <span className="stat-label">Flooded Area</span>
                    <span className="stat-value">
                      {summary.hazards.inference.flooded_area_km2.toFixed(2)}
                      <span className="stat-unit">km²</span>
                    </span>
                  </div>
                )}
                {summary.infrastructure.exposure.building_summary.affected_count != null && (
                  <div className="stat-card">
                    <span className="stat-label">Affected Buildings</span>
                    <span className="stat-value">
                      {summary.infrastructure.exposure.building_summary.affected_count.toLocaleString()}
                    </span>
                  </div>
                )}
                {summary.connectivity.summary.cut_off != null && (
                  <div className="stat-card">
                    <span className="stat-label">Cut-off Settlements</span>
                    <span className="stat-value" style={{ color: 'var(--color-error)' }}>
                      {summary.connectivity.summary.cut_off}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
