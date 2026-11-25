import { defineSecret, defineString } from 'firebase-functions/params';

export const meshyApiKey = defineSecret('MESHY_API_KEY');
// Emulator runs override this in the ignored functions/.env.local to point at a local fake.
const meshyBaseUrl = defineString('MESHY_BASE_URL', { default: 'https://api.meshy.ai' });

export type MeshyEndpoint = 'text-to-3d' | 'image-to-3d' | 'retexture';
export interface MeshyTask {
  id: string;
  status: string;
  progress: number;
  model_urls?: { glb?: string };
  thumbnail_url?: string;
}

const paths: Record<MeshyEndpoint, string> = {
  'text-to-3d': '/openapi/v2/text-to-3d',
  'image-to-3d': '/openapi/v1/image-to-3d',
  retexture: '/openapi/v1/retexture',
};

export class MeshyError extends Error {
  constructor(readonly status: number) {
    super(`Meshy returned HTTP ${status}.`);
  }
}

async function call(method: string, endpoint: MeshyEndpoint, id?: string, body?: object) {
  const url = `${meshyBaseUrl.value()}${paths[endpoint]}${id ? `/${encodeURIComponent(id)}` : ''}`;
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${meshyApiKey.value()}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new MeshyError(response.status);
  return response;
}

export async function createTask(endpoint: MeshyEndpoint, body: object): Promise<string> {
  const { result } = await (await call('POST', endpoint, undefined, body)).json();
  if (typeof result !== 'string') throw new Error('Meshy returned no task id.');
  return result;
}

export async function getTask(endpoint: MeshyEndpoint, id: string): Promise<MeshyTask> {
  return (await call('GET', endpoint, id)).json();
}

// Deleting a PENDING task refunds its Meshy credits; an IN_PROGRESS task returns 409.
export async function deleteTask(endpoint: MeshyEndpoint, id: string) {
  await call('DELETE', endpoint, id);
}
