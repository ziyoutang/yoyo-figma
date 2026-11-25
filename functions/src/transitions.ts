export type JobStatus = 'starting' | 'queued' | 'running' | 'ingesting' | 'ready' | 'failed' | 'canceled';
export interface JobUpdate { status: JobStatus; progress?: number; error?: string }

const rank: Record<JobStatus, number> = { starting: 0, queued: 1, running: 2, ingesting: 3, ready: 4, failed: 4, canceled: 4 };
export const isTerminal = (status: JobStatus) => rank[status] === 4;

function fromMeshy(task: { status: string; progress?: number }): JobUpdate | null {
  switch (task.status) {
    case 'PENDING': return { status: 'queued' };
    case 'IN_PROGRESS': return { status: 'running', progress: task.progress ?? 0 };
    case 'SUCCEEDED': return { status: 'ingesting' };
    case 'FAILED': return { status: 'failed', error: 'Meshy could not generate this model.' };
    case 'CANCELED':
    case 'EXPIRED': return { status: 'failed', error: 'The Meshy task was canceled or expired.' };
    default: return null;
  }
}

// The update a Meshy task state implies for a job, or null when it would not move the job forward.
// Duplicate and out-of-order deliveries therefore change nothing.
export function nextJobUpdate(job: { status: JobStatus; progress: number }, task: { status: string; progress?: number }) {
  const update = fromMeshy(task);
  if (!update || isTerminal(job.status)) return null;
  if (rank[update.status] > rank[job.status]) return update;
  if (update.status === 'running' && job.status === 'running' && update.progress! > job.progress) return update;
  return null;
}
