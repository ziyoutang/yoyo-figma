import { getFirestore, FieldValue, type DocumentReference, type Timestamp, type Transaction } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import type { MeshyTask } from './meshy';
import { isTerminal, nextJobUpdate } from './transitions';

export const utcDay = (date: Date) => date.toISOString().slice(0, 10);
export const jobDay = (createdAt: Timestamp) => utcDay(createdAt.toDate());

// Gives back the credits and daily count reserved for a job. Call inside a transaction, after its other reads.
export async function refund(tx: Transaction, uid: string, credits: number, day: string) {
  const user = await tx.get(getFirestore().doc(`users/${uid}`));
  tx.update(user.ref, { creditsUsed: FieldValue.increment(-credits), ...(user.get('day') === day && { dayCount: FieldValue.increment(-1) }) });
  tx.update(getFirestore().doc(`usage/${day.slice(0, 7)}`), { credits: FieldValue.increment(-credits), calls: FieldValue.increment(-1) });
}

// The task id makes Cloud Tasks drop duplicates; sweepJobs passes a suffix to retry a stuck ingest.
export async function enqueueIngest(jobId: string, suffix = '') {
  try {
    await getFunctions().taskQueue('locations/us-west1/functions/ingestModel').enqueue({ jobId }, { id: `ingest-${jobId}${suffix}` });
  } catch (error) {
    if ((error as { code?: string }).code !== 'functions/task-already-exists') throw error;
  }
}

export async function applyTask(jobRef: DocumentReference, task: MeshyTask) {
  const update = await getFirestore().runTransaction(async tx => {
    const job = await tx.get(jobRef);
    const update = nextJobUpdate({ status: job.get('status'), progress: job.get('progress') }, task);
    if (update) tx.update(jobRef, { ...update, updatedAt: FieldValue.serverTimestamp() });
    return update;
  });
  if (update?.status === 'ingesting') await enqueueIngest(jobRef.id);
}

export async function failJob(jobRef: DocumentReference, error: string) {
  await getFirestore().runTransaction(async tx => {
    if (isTerminal((await tx.get(jobRef)).get('status'))) return;
    tx.update(jobRef, { status: 'failed', error, updatedAt: FieldValue.serverTimestamp() });
  });
}
