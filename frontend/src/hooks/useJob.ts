import { useState, useEffect, useRef, useCallback } from 'react';
import { api, JobRecord, AnalysisDocument, ValleyeyeApiError } from '../api/client';

// Polling interval in ms — reduce once job is done
const POLL_INTERVAL_ACTIVE = 2500;
const POLL_INTERVAL_DONE = 0; // stop

export interface JobState {
  job: JobRecord | null;
  summary: AnalysisDocument | null;
  loading: boolean;
  error: string | null;
  retryable: boolean;
}

/**
 * Polls a job by ID, auto-fetches the summary when succeeded/partial.
 * Stops polling when the job reaches a terminal state.
 */
export function useJob(jobId: string | null): JobState & { refresh: () => void } {
  const [state, setState] = useState<JobState>({
    job: null,
    summary: null,
    loading: false,
    error: null,
    retryable: false,
  });
  const timerRef = useRef<number | null>(null);
  const jobIdRef = useRef(jobId);
  jobIdRef.current = jobId;

  const fetchJob = useCallback(async (id: string) => {
    try {
      const job = await api.getJob(id);
      setState(prev => ({ ...prev, job, loading: false, error: null }));

      if (job.results_available && !job.error) {
        try {
          const summary = await api.getSummary(id);
          setState(prev => ({ ...prev, summary }));
        } catch {
          // summary may not be ready yet; non-fatal
        }
      }

      const isTerminal = job.status === 'SUCCEEDED' || job.status === 'PARTIAL' || job.status === 'FAILED';
      return isTerminal;
    } catch (err) {
      const msg = err instanceof ValleyeyeApiError ? err.apiError.message : 'Failed to fetch job status';
      const retryable = err instanceof ValleyeyeApiError ? err.apiError.retryable : true;
      setState(prev => ({ ...prev, loading: false, error: msg, retryable }));
      return false; // keep polling on network errors
    }
  }, []);

  const startPolling = useCallback((id: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setState(prev => ({ ...prev, loading: true }));

    const poll = async () => {
      const done = await fetchJob(id);
      if (done && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    poll();
    timerRef.current = window.setInterval(poll, POLL_INTERVAL_ACTIVE);
  }, [fetchJob]);

  const refresh = useCallback(() => {
    if (jobIdRef.current) startPolling(jobIdRef.current);
  }, [startPolling]);

  useEffect(() => {
    if (!jobId) {
      if (timerRef.current) clearInterval(timerRef.current);
      setState({ job: null, summary: null, loading: false, error: null, retryable: false });
      return;
    }
    startPolling(jobId);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [jobId, startPolling]);

  // Suppress unused warning
  void POLL_INTERVAL_DONE;

  return { ...state, refresh };
}
