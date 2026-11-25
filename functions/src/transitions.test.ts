import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextJobUpdate, type JobStatus } from './transitions';

const job = (status: JobStatus, progress = 0) => ({ status, progress });

test('maps Meshy statuses to job statuses', () => {
  assert.deepEqual(nextJobUpdate(job('starting'), { status: 'PENDING' }), { status: 'queued' });
  assert.deepEqual(nextJobUpdate(job('queued'), { status: 'IN_PROGRESS', progress: 40 }), { status: 'running', progress: 40 });
  assert.deepEqual(nextJobUpdate(job('running', 40), { status: 'SUCCEEDED', progress: 100 }), { status: 'ingesting' });
  assert.equal(nextJobUpdate(job('running'), { status: 'FAILED' })?.status, 'failed');
  assert.equal(nextJobUpdate(job('queued'), { status: 'CANCELED' })?.status, 'failed');
  assert.equal(nextJobUpdate(job('queued'), { status: 'EXPIRED' })?.status, 'failed');
});

test('failures carry a short, fixed error message', () => {
  assert.equal(nextJobUpdate(job('running'), { status: 'FAILED' })?.error, 'Meshy could not generate this model.');
  assert.equal(nextJobUpdate(job('queued'), { status: 'EXPIRED' })?.error, 'The Meshy task was canceled or expired.');
});

test('skips stages when Meshy is ahead', () => {
  assert.deepEqual(nextJobUpdate(job('starting'), { status: 'SUCCEEDED' }), { status: 'ingesting' });
  assert.equal(nextJobUpdate(job('queued'), { status: 'FAILED' })?.status, 'failed');
});

test('running progress only moves forward', () => {
  assert.deepEqual(nextJobUpdate(job('running', 40), { status: 'IN_PROGRESS', progress: 60 }), { status: 'running', progress: 60 });
  assert.equal(nextJobUpdate(job('running', 60), { status: 'IN_PROGRESS', progress: 60 }), null);
  assert.equal(nextJobUpdate(job('running', 60), { status: 'IN_PROGRESS', progress: 50 }), null);
});

test('duplicate and out-of-order deliveries change nothing', () => {
  assert.equal(nextJobUpdate(job('queued'), { status: 'PENDING' }), null);
  assert.equal(nextJobUpdate(job('running', 50), { status: 'PENDING' }), null);
  assert.equal(nextJobUpdate(job('ingesting'), { status: 'IN_PROGRESS', progress: 99 }), null);
  assert.equal(nextJobUpdate(job('ingesting'), { status: 'SUCCEEDED' }), null);
});

test('terminal jobs never change', () => {
  for (const status of ['ready', 'failed', 'canceled'] as const) {
    for (const meshy of ['PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED']) {
      assert.equal(nextJobUpdate(job(status), { status: meshy, progress: 100 }), null, `${status} <- ${meshy}`);
    }
  }
});

test('unknown Meshy statuses are ignored', () => {
  assert.equal(nextJobUpdate(job('queued'), { status: 'SOMETHING_NEW' }), null);
});
