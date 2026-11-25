import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { editable } from './heroOptions';
import type { Draft, ScreenProps, Step } from './model';
import { agentLeftToday, agentMessage, askAgent, DAILY_AGENT, outcomeMessages, type AgentJobs, type CopyIdea, type Editable } from './agentMode.ts';

// Agent Mode in the live studio: suggestions on the Prompt screen, the scene edit on Motion and Scene, copy ideas on Layout.
// Claude's text is always rendered as text, never as HTML.
type Props = Pick<ScreenProps, 'draft' | 'update' | 'undo'>;
type Agent = ReturnType<typeof useAgent>;

// One call at a time per control. Each result's `left` updates today's count, with no extra read.
function useAgent(onLeft?: (left: number) => void) {
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function run<J extends keyof AgentJobs>(job: J, request: AgentJobs[J]['request'], ok: (result: AgentJobs[J]['result']) => void) {
    if (running.current) return;
    running.current = true; setBusy(true); setSlow(false); setError('');
    const timer = window.setTimeout(() => setSlow(true), 15_000);
    try {
      const reply = await askAgent(job, request);
      if (!mounted.current) return;
      onLeft?.(reply.left);
      if (reply.status === 'ok') ok(reply.result); else setError(outcomeMessages[reply.status]);
    } catch (caught) { if (mounted.current) setError(agentMessage(caught)); }
    finally { window.clearTimeout(timer); running.current = false; if (mounted.current) { setBusy(false); setSlow(false); } }
  }
  return { busy, slow, error, run };
}

// The status line. An applied change is one undo step, and its Undo shows only while the draft is still the one that
// change made, so it can never undo a later change of the designer's.
function useResult(draft: Draft, update: Props['update']) {
  const [shown, setShown] = useState<{text: string; made: Draft | null} | null>(null);
  const marking = useRef(false);
  useEffect(() => { if (marking.current) { marking.current = false; setShown(prior => prior && { ...prior, made: draft }); } }, [draft]);
  return {
    show(text: string, patch?: Partial<Draft>) { marking.current = Boolean(patch); setShown({ text, made: null }); if (patch) update(patch); },
    clear() { setShown(null); },
    line(undo?: () => void) { return shown && <p>{shown.text}{undo && shown.made === draft && <button type="button" className="text-button" onClick={() => { undo(); setShown(null); }}>Undo</button>}</p>; },
  };
}

function Status({ agent, children }: {agent: Agent; children?: ReactNode}) {
  return <><div className="agent-status" role="status">{agent.busy ? (agent.slow ? 'Still working…' : 'Agent Mode is working…') : children}</div>{agent.error && <p className="field-error" role="alert">{agent.error}</p>}</>;
}

function Disclosure({ className, image = false }: {className: string; image?: boolean}) {
  return <p className={`${className} agent-note`}>{image ? 'Agent Mode sends what you type and your uploaded image to Anthropic\'s Claude. Depth doesn\'t store it.' : 'Agent Mode sends what you type to Anthropic\'s Claude. Depth doesn\'t store it.'}</p>;
}

// Prompt screen: Polish prompt (Agent Mode tab) and Suggest a template (both tabs). Nothing here starts a Meshy job.
export function PromptAgent({ draft, update, undo, onBusy }: Props & {onBusy: (busy: boolean) => void}) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => { let live = true; agentLeftToday().then(next => { if (live) setLeft(next); }); return () => { live = false; }; }, []);
  const polish = useAgent(setLeft), pick = useAgent(setLeft), polished = useResult(draft, update);
  const [suggestion, setSuggestion] = useState<AgentJobs['polish']['result'] | null>(null);
  const [template, setTemplate] = useState<AgentJobs['template']['result'] | null>(null);
  const busy = polish.busy || pick.busy;
  // The description is read-only while a call about it runs.
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy]);
  const agentTab = draft.inputMode === 'agent', idea = draft.prompt.trim();
  const runPolish = () => { setSuggestion(null); polished.clear(); polish.run('polish', { idea }, setSuggestion); };
  const runPick = () => { setTemplate(null); pick.run('template', agentTab ? { idea } : { imagePath: draft.uploadPath }, setTemplate); };
  const same = template?.template === draft.template;
  return <div className="agent-panel" aria-busy={busy}>
    <div className="agent-actions">{agentTab && <button className="secondary" disabled={!idea || polish.busy} onClick={runPolish}>{polish.busy ? 'Working…' : 'Polish prompt'}</button>}<button className="secondary" disabled={(agentTab && !idea) || pick.busy} onClick={runPick}>{pick.busy ? 'Working…' : 'Suggest a template'}</button></div>
    <p className="gen-credit">Agent Mode · no credits{left === null ? '' : ` · ${left} of ${DAILY_AGENT} left today`}</p>
    {agentTab && <Status agent={polish}>{suggestion ? <div className="agent-suggestion"><strong>Suggested prompt</strong><p>{suggestion.prompt}</p><p className="gen-hint">{suggestion.note}</p><div className="agent-actions"><button className="secondary" onClick={() => { polished.show('Prompt replaced', { prompt: suggestion.prompt }); setSuggestion(null); }}>Use this</button><button className="text-button" onClick={() => setSuggestion(null)}>Keep mine</button></div></div> : polished.line(undo)}</Status>}
    <Status agent={pick}>{template && <div className="agent-suggestion"><p>Suggested template: {template.template}{same && '. It’s already your template.'}</p><p className="gen-hint">{template.reason}</p>{!same && <button className="secondary" onClick={() => update({ template: template.template })}>Use it</button>}</div>}</Status>
    <Disclosure className="gen-hint" image={!agentTab}/>
  </div>;
}

const labels: Record<Editable, string> = { motion: 'Motion', speed: 'Speed', amount: 'Amount', direction: 'Direction', camera: 'Camera', lighting: 'Lighting', lightingColor: 'Lighting colour', background: 'Background', backgroundColor: 'Background colour', template: 'Template', material: 'Material', color: 'Primary colour', secondColor: 'Secondary colour' };
const valueText = (field: Editable, value: unknown) => field === 'speed' ? `${Number(value).toFixed(1)}×` : field === 'amount' ? `${value}%` : String(value);

// Motion and Scene: one box on both steps. The answer applies as one undo step on top of whatever the designer changed
// meanwhile: a field they changed during the call keeps their value, and an answer for a step they left is dropped.
export function SceneAgent({ step, draft, update, undo }: Props & {step: Step}) {
  const [request, setRequest] = useState('');
  const agent = useAgent(), result = useResult(draft, update);
  const field = useRef<HTMLInputElement>(null);
  // The draft prop is a snapshot, so the answer reads the latest draft and step from these.
  const latest = useRef(draft), shownStep = useRef(step);
  useEffect(() => { latest.current = draft; shownStep.current = step; });
  const apply = (event: FormEvent) => {
    event.preventDefault();
    field.current?.focus();
    if (!request.trim()) return;
    const sent = Object.fromEntries(editable.map(key => [key, draft[key]])) as Pick<Draft, Editable>, from = step;
    result.clear();
    agent.run('edit', { request: request.trim(), current: sent }, ({ patch, summary, unsupported }) => {
      if (shownStep.current !== from) return;
      // A field whose latest value differs from what was sent is dropped; dropping background drops what it shows.
      const now = latest.current, keys = editable.filter(key => key in patch), skipped = new Set<Editable>(keys.filter(key => now[key] !== sent[key]));
      if (skipped.has('background')) for (const key of ['backgroundColor', 'template'] as const) if (key in patch) skipped.add(key);
      const kept = keys.filter(key => !skipped.has(key)), dropped = keys.filter(key => skipped.has(key));
      if (!keys.length && !unsupported) { result.show('Nothing to change.'); return; }
      const lines = kept.length ? [`${kept.map(key => `${labels[key]} ${valueText(key, now[key])} → ${valueText(key, patch[key])}`).join(', ')}.`] : [];
      if (summary && (kept.length || !keys.length)) lines.push(summary);
      lines.push(...dropped.map(key => `Left ${labels[key]} as you set it.`));
      if (unsupported) lines.push(`Not changed: ${unsupported}`);
      result.show(lines.join(' '), kept.length ? Object.fromEntries(kept.map(key => [key, patch[key]])) : undefined);
    });
  };
  return <form className="agent-panel agent-edit" aria-busy={agent.busy} onSubmit={apply}>
    <div className="agent-row"><label className="field">Describe a change<input ref={field} maxLength={300} readOnly={agent.busy} value={request} placeholder="e.g. Float slower with a warmer light" onChange={e => setRequest(e.target.value)}/></label><button className="secondary" type="submit" disabled={!request.trim() || agent.busy}>{agent.busy ? 'Working…' : 'Apply'}</button></div>
    <Status agent={agent}>{result.line(undo)}</Status>
    <Disclosure className="demo-note"/>
  </form>;
}

// Layout: three headline and button-label ideas. Use this writes one pair as one undo step; nothing else changes.
export function CopyAgent({ draft, update, undo }: Props) {
  const [direction, setDirection] = useState('');
  const [ideas, setIdeas] = useState<CopyIdea[]>([]);
  const agent = useAgent(), result = useResult(draft, update);
  const suggest = () => {
    setIdeas([]); result.clear();
    agent.run('copy', { idea: draft.inputMode === 'agent' ? draft.prompt.trim() : '', direction: direction.trim(), template: draft.template, layout: draft.layout, current: { eyebrow: draft.eyebrow, headline: draft.headline, subtitle: draft.subtitle, buttonLabel: draft.buttonLabel } }, reply => setIdeas(reply.ideas));
  };
  return <div className="agent-panel agent-copy" aria-busy={agent.busy}>
    <label className="field">Tone or audience<input maxLength={200} readOnly={agent.busy} value={direction} onChange={e => setDirection(e.target.value)}/></label>
    <div className="agent-actions"><button className="secondary" disabled={agent.busy} onClick={suggest}>{agent.busy ? 'Working…' : 'Suggest copy'}</button></div>
    <Status agent={agent}>{ideas.length > 0 && <ol className="agent-ideas">{ideas.map((idea, i) => <li key={i}><p><strong>{idea.headline}</strong><br/>{idea.buttonLabel}</p><button className="secondary" aria-label={`Use idea ${i + 1}: ${idea.headline.replace(/\s*\n\s*/g, ' ')}`} onClick={() => result.show('Headline and button text replaced', { headline: idea.headline, buttonLabel: idea.buttonLabel })}>Use this</button></li>)}</ol>}{result.line(undo)}</Status>
    <Disclosure className="demo-note"/>
  </div>;
}
