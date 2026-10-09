import { StageRecord } from '../api/client';

interface PipelineProgressProps {
  stages: StageRecord[];
  currentStage?: string | null;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function PipelineProgress({ stages, currentStage }: PipelineProgressProps) {
  if (!stages || stages.length === 0) {
    return (
      <div className="pipeline-stages">
        <p className="text-muted text-sm">No stage data available.</p>
      </div>
    );
  }

  return (
    <div className="pipeline-stages">
      {stages.map(stage => (
        <div key={stage.name} className="stage-row">
          <span className="stage-name">
            {stage.name === currentStage && stage.status === 'RUNNING' && (
              <span style={{ marginRight: 4 }}>⚡</span>
            )}
            {stage.name.charAt(0) + stage.name.slice(1).toLowerCase()}
          </span>
          <span className={`badge badge-${stage.status.toLowerCase()}`}>{stage.status}</span>
          <div className="stage-bar">
            <div
              className={`stage-bar-fill ${stage.status.toLowerCase()}`}
              style={{ width: `${stage.progress}%` }}
            />
          </div>
          <span className="stage-duration">{formatDuration(stage.duration_ms)}</span>
        </div>
      ))}
    </div>
  );
}
