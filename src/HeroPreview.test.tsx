// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialDraft } from './model';

const mocks = vi.hoisted(() => ({ layer: vi.fn(), measure: vi.fn() }));
vi.mock('./Hero3D', () => ({ default: ({ url, onFirstFrame }: { url: string; onFirstFrame?: () => void }) => {
  if (url.includes('broken')) throw new Error('WebGL unavailable');
  return <button data-testid="hero3d" onClick={onFirstFrame}>{url}</button>;
} }));
vi.mock('./exportHero', () => ({ heroPng: vi.fn(), layerPng: mocks.layer }));
vi.mock('./measureLayout', () => ({ measureLayout: mocks.measure }));

import { HeroPreview, type HeroExporter } from './HeroPreview';

const draft = { ...initialDraft, modelPath: 'models/u/job/model.glb', buttonLabel: 'Shop', buttonUrl: 'https://example.test/shop' };
const images = () => [...document.querySelectorAll('img')].map(image => image.getAttribute('src'));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('HeroPreview', () => {
  it('loads no sample artwork with a model, keeping its boxes as empty anchors', async () => {
    render(<HeroPreview draft={draft} modelUrl="https://example.test/model.glb"/>);
    await screen.findByTestId('hero3d');
    expect(images()).toEqual([]);
    expect([...document.querySelectorAll('.hero-object, .ghost-ear')].every(anchor => anchor.classList.contains('hero-anchor') && !anchor.children.length)).toBe(true);
  });

  it('shows the sample artwork without a model', () => {
    render(<HeroPreview draft={initialDraft}/>);
    expect(images()).toEqual(['/assets/ear.png', '/assets/ear.png', '/assets/ear.png']);
    expect(screen.getByRole('img', { name: 'Sample sculpted ear model' })).toBeTruthy();
  });

  it('shows the poster until the 3D layer has drawn, then fades the canvas in over it', async () => {
    vi.useFakeTimers();
    render(<HeroPreview draft={draft} modelUrl="https://example.test/model.glb" poster="https://example.test/poster.webp"/>);
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(images()).toEqual(['https://example.test/poster.webp']);
    expect(document.querySelector('.hero-canvas')!.classList.contains('waiting')).toBe(true);
    fireEvent.click(screen.getByTestId('hero3d'));
    expect(document.querySelector('.hero-canvas')!.classList.contains('waiting')).toBe(false);
    expect(images()).toEqual(['https://example.test/poster.webp']);
    act(() => { vi.advanceTimersByTime(300); });
    expect(images()).toEqual([]);
  });

  it('keeps the poster, and no sample artwork, when the model can\'t be shown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<HeroPreview draft={draft} modelUrl="https://example.test/broken.glb" poster="https://example.test/poster.webp"/>);
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(screen.queryByTestId('hero3d')).toBeNull();
    expect(images()).toEqual(['https://example.test/poster.webp']);
  });

  it('makes the button a link that opens in the host page only when asked', () => {
    const { rerender } = render(<HeroPreview draft={draft}/>);
    expect(screen.queryByRole('link')).toBeNull();
    rerender(<HeroPreview draft={draft} linked/>);
    expect(screen.getByRole('link', { name: 'Shop' }).outerHTML).toBe('<a class="hero-cta custom-cta" href="https://example.test/shop" target="_top" rel="noopener">Shop</a>');
    rerender(<HeroPreview draft={{ ...draft, buttonUrl: '' }} linked/>);
    expect(screen.queryByRole('link')).toBeNull();
  });

  // jsdom has no browser link styles, so this checks the rule that removes the link underline from the button.
  it('styles the linked button like the plain one, without an underline', () => {
    expect(readFileSync('src/styles.css', 'utf8')).toMatch(/\.hero-cta\{[^}]*text-decoration:none/);
  });

  it('exports the 3D layer alone as the poster', async () => {
    const exporter: { current: HeroExporter | null } = { current: null };
    mocks.layer.mockResolvedValue(new Blob(['png']));
    render(<HeroPreview draft={draft} modelUrl="https://example.test/model.glb" exporter={exporter}/>);
    await exporter.current!.poster(780);
    expect(mocks.layer).toHaveBeenCalledWith(document.querySelector('.hero-preview'), 780, null);
  });

  it('measures its layout for Figma as it is drawn', async () => {
    const exporter: { current: HeroExporter | null } = { current: null };
    mocks.measure.mockReturnValue({ backdrop: { type: 'solid', color: '#ffffff' }, copy: null });
    render(<HeroPreview draft={draft} modelUrl="https://example.test/model.glb" exporter={exporter}/>);
    expect(await exporter.current!.layout()).toEqual({ backdrop: { type: 'solid', color: '#ffffff' }, copy: null });
    expect(mocks.measure).toHaveBeenCalledWith(document.querySelector('.hero-preview'));
  });
});
