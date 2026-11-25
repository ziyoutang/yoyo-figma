import { describe, expect, it } from 'vitest';
import * as server from '../functions/src/heroOptions';
import * as studio from './heroOptions';
import { initialDraft } from './model';

describe('hero options', () => {
  it('match the copy publishHero validates against', () => {
    expect(server).toEqual(studio);
  });

  it('cover the studio defaults', () => {
    for (const [field, values] of Object.entries(studio.choices)) expect(values, field).toContain(initialDraft[field as keyof typeof initialDraft]);
    for (const field of studio.colors) expect(initialDraft[field]).toMatch(/^#[0-9a-f]{6}$/);
    for (const [field, limit] of Object.entries(studio.textLimits)) expect(String(initialDraft[field as keyof typeof initialDraft] ?? '').length, field).toBeLessThanOrEqual(limit);
  });
});
