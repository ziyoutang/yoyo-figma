import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firebaseServices } from './firebase';
import type { editable } from './heroOptions';
import type { Draft } from './model';

// Studio only: the agentAssist callable, its messages and today's count. It never starts a Meshy job.
export type Editable = typeof editable[number];
export type CopyIdea = {headline: string; buttonLabel: string};
export type AgentJobs = {
  polish: {request: {idea: string}; result: {prompt: string; note: string}};
  template: {request: {idea: string} | {imagePath: string}; result: {template: string; reason: string}};
  edit: {request: {request: string; current: Pick<Draft, Editable>}; result: {patch: Partial<Pick<Draft, Editable>>; summary: string; unsupported: string}};
  copy: {request: {idea: string; direction: string; template: string; layout: string; current: Pick<Draft, 'eyebrow' | 'headline' | 'subtitle' | 'buttonLabel'>}; result: {ideas: CopyIdea[]}};
};
export type AgentReply<R> = {status: 'ok'; result: R; left: number} | {status: 'declined' | 'unusable'; left: number};

function services() {
  if (!firebaseServices) throw new Error('Firebase is not configured.');
  return firebaseServices;
}

// The server waits up to 90 seconds for Claude, so the call waits longer than the SDK's default of 70.
export async function askAgent<J extends keyof AgentJobs>(job: J, request: AgentJobs[J]['request']) {
  const { data } = await httpsCallable<object, AgentReply<AgentJobs[J]['result']>>(services().functions, 'agentAssist', { timeout: 100_000 })({ job, ...request });
  return data;
}

export const outcomeMessages = {
  declined: 'Agent Mode can’t help with that request. Nothing was changed.',
  unusable: 'Agent Mode couldn’t make a usable suggestion. Nothing was changed. Try rewording it.',
};
const unavailable = 'Agent Mode is unavailable right now. Try again in a minute.';
export function agentMessage(error: unknown) {
  const { code = '', message = '', details } = (error || {}) as {code?: string; message?: string; details?: {cap?: string}};
  const short = code.replace(/^functions\//, '');
  if (short === 'resource-exhausted') return details?.cap === 'monthly' ? 'Agent Mode has reached Depth’s limit for this month. It resets on the 1st.' : 'You’ve used today’s 30 Agent Mode requests. Try again after midnight UTC.';
  if (short === 'invalid-argument' && message) return message;
  if (short === 'unauthenticated') return 'Reload the page and try again.';
  if (short === 'permission-denied') return 'Your account can’t use Agent Mode. Sign in again or ask the project owner.';
  return unavailable;
}

// The daily limit agentAssist enforces, counted per UTC day.
export const DAILY_AGENT = 30;
// Agent Mode calls left today, from the user's own users/{uid} record; null when it can't be read.
export async function agentLeftToday(): Promise<number | null> {
  try {
    const { auth, db } = services(), uid = auth.currentUser?.uid;
    if (!uid) return null;
    const user = (await getDoc(doc(db, 'users', uid))).data();
    const used = user?.agentDay === new Date().toISOString().slice(0, 10) ? Number(user.agentCount) || 0 : 0;
    return Math.max(0, DAILY_AGENT - used);
  } catch { return null; }
}
