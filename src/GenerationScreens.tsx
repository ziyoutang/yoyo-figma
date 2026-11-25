import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { choices } from './heroOptions';
import type { Draft, ScreenProps } from './model';
import { DAILY_JOBS, jobsLeftToday, meshyProvider, modelUrl, uploadImage } from './jobs';
import { PromptAgent } from './AgentMode.tsx';
import './generation.css';

// three.js loads only when a real model is shown.
const ModelViewer = lazy(() => import('./ModelViewer'));
class ViewerBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p>The model could not be loaded.</p> : this.props.children; }
}

function Bubble({ children, className = '', asset = 'gen-bubble' }: {children: React.ReactNode; className?: string; asset?: string}) {
  return <span className={`gen-bubble ${className}`} aria-hidden="true"><img src={`/assets/${asset}.svg`} alt="" /><span>{children}</span></span>;
}

function DemoTip() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pointerFocus = useRef(false);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, []);
  return <div ref={root} className="gen-connect-decoration" onPointerEnter={event => { if (event.pointerType === 'mouse') setOpen(true); }} onPointerLeave={event => { if (event.pointerType === 'mouse') setOpen(false); }}>
    <button className="gen-robot-button" aria-label={meshyProvider ? 'About credits' : 'About demo credits'} aria-describedby={open ? 'demo-credit-tip' : undefined} aria-expanded={open} onPointerDown={() => { pointerFocus.current = true; }} onFocus={() => { if (!pointerFocus.current) setOpen(true); }} onBlur={() => { pointerFocus.current = false; setOpen(false); }} onClick={() => { setOpen(value => !value); pointerFocus.current = false; }}><Bubble className="gen-robot">🤖</Bubble></button>
    {open && <p id="demo-credit-tip" role="tooltip">{meshyProvider ? <><strong>20 credits per shape, 10 per look</strong>.<br />Up to {DAILY_JOBS} shapes and looks a day.</> : <>This demo uses <strong>0 credits</strong>.<br />Explore the full shape-to-hero flow.</>}</p>}
  </div>;
}

function useModelUrl(modelPath: string) {
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState(false);
  useEffect(() => {
    if (!modelPath) return;
    let live = true;
    setUrl(''); setUrlError(false);
    modelUrl(modelPath).then(next => { if (live) setUrl(next); }, () => { if (live) setUrlError(true); });
    return () => { live = false; };
  }, [modelPath]);
  return { url, urlError };
}

// The clay shape, turnable, beside the look prompt.
function ShapeThumb({ modelPath }: {modelPath: string}) {
  const { url, urlError } = useModelUrl(modelPath);
  return <div className="gen-appearance-model" role="img" aria-label="Your clay shape from Meshy">{url ? <ViewerBoundary><Suspense fallback={<p>Loading model…</p>}><ModelViewer url={url} /></Suspense></ViewerBoundary> : <p>{urlError ? 'The model could not be loaded.' : 'Loading model…'}</p>}</div>;
}

function ModelPreview({ rendered = false, material = 'Original', color = '#9e8265', secondColor = '#fcffbc', compact = false, modelPath = '', textured = false }: {rendered?: boolean; material?: string; color?: string; secondColor?:string; compact?: boolean; modelPath?: string; textured?: boolean}) {
  const [animate, setAnimate] = useState(false);
  const [grid, setGrid] = useState(false);
  const { url, urlError } = useModelUrl(modelPath);
  const dialog = useRef<HTMLDialogElement>(null);
  if (modelPath) return <>
    <div className={`gen-preview ${compact ? 'gen-preview-compact' : ''}`}>
      <div className="gen-preview-top"><strong>{rendered && material !== 'Original' ? 'MATERIAL PREVIEW' : textured ? 'TEXTURED PREVIEW' : 'CLAY PREVIEW'}</strong></div>
      <div className="gen-artwork gen-model">{url ? <ViewerBoundary><Suspense fallback={<p>Loading model…</p>}>{rendered ? <ModelViewer url={url} material={material} color={color} secondColor={secondColor} textured={textured} /> : <ModelViewer url={url} />}</Suspense></ViewerBoundary> : <p>{urlError ? 'The model could not be loaded.' : 'Loading model…'}</p>}</div>
    </div>
    <p className="gen-sample-caption">Your shape from Meshy · drag to turn it</p>
  </>;
  const artwork = <img className={`gen-ear ${animate ? 'gen-ear-moving' : ''}`} src={rendered ? '/assets/ear.png' : '/assets/ear-clay.png'} alt={rendered ? 'Sample sculpted ear with a warm brown finish' : 'Sample sculpted ear in white clay'} />;
  return <>
    <div className={`gen-preview ${compact ? 'gen-preview-compact' : ''} ${grid ? 'gen-preview-grid' : ''}`} style={{'--material-color': color,'--secondary-glow':secondColor==='#fcffbc'?'transparent':secondColor} as CSSProperties}>
      <div className="gen-preview-top"><strong>{rendered ? 'MATERIAL PREVIEW' : 'CLAY PREVIEW'}</strong><button className="gen-expand" onClick={() => dialog.current?.showModal()} aria-label="Expand sample preview"><img src="/assets/gen-fullscreen.svg" alt="" /></button></div>
      <div className={`gen-artwork gen-material-${material.toLowerCase().replace(' ', '-')}`} style={{filter:color!=='#9e8265'?`drop-shadow(0 0 12px ${color})`:undefined}}>{artwork}</div>
      <div className="gen-preview-bottom"><div className="gen-switches"><label>Guide overlay<input type="checkbox" role="switch" checked={grid} onChange={e=>setGrid(e.target.checked)} /></label><label>Sample motion<input type="checkbox" role="switch" checked={animate} onChange={e=>setAnimate(e.target.checked)} /></label></div><div className="gen-preview-buttons"><button onClick={()=>setAnimate(!animate)}>{animate ? 'Pause' : 'Animate'}</button><button onClick={()=>{setAnimate(false);setGrid(false);}}>Reset</button></div></div>
    </div>
    <p className="gen-sample-caption">Sample artwork · illustrative motion, not a live 3D model{rendered && material !== 'Original' ? ` · ${material} setting` : ''}</p>
    <dialog ref={dialog} className="gen-preview-dialog"><button className="text-button" onClick={()=>dialog.current?.close()}>Close preview</button><div className="gen-expanded-artwork">{artwork}</div><p>Sample artwork. 3D rotation and wireframe require a real model.</p></dialog>
  </>;
}

export default function GenerationScreens({step,draft,update,go,generate,undo}: ScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  // Agent Mode makes the description read-only while it works on it.
  const [agentBusy, setAgentBusy] = useState(false);
  // Shapes and looks left today; it refreshes whenever this screen mounts, such as after a job ends.
  const [jobsLeft, setJobsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!meshyProvider) return;
    let live = true;
    jobsLeftToday().then(next => { if (live) setJobsLeft(next); });
    return () => { live = false; };
  }, []);
  const left = jobsLeft === null ? '' : ` · ${jobsLeft} of ${DAILY_JOBS} left today`;
  const startShape = () => generate('shape');
  const selectedSample = ['soldier','box','tree','basket','mobile'].find(name => draft.uploadName === `${name} sample`);
  const promptValid = draft.inputMode === 'agent' ? Boolean(draft.prompt.trim()) : meshyProvider ? Boolean(draft.uploadPath) && !uploading : Boolean(draft.uploadName);
  const savedHint = <p className="gen-hint">Your description stays in this local draft. Demo generation always uses the sample ear.</p>;
  const shapeHint = meshyProvider ? <p className="gen-hint">Meshy makes the shape from this description.</p> : savedHint;
  async function pick(file: Blob, uploadName: string, patch: Partial<Draft> = {}) {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setUploadError('Choose a JPG, PNG, or WebP image.');return;}
    if(!meshyProvider){setUploadError('');update({uploadName,...patch});return;}
    if(file.size > 20 * 1024 * 1024){setUploadError('Choose an image under 20 MB.');return;}
    setUploadError('');setUploading(true);update({uploadName,uploadPath:'',...patch});
    try{update({uploadPath:await uploadImage(file)});}catch{setUploadError('Upload failed. Check your connection and try again.');}finally{setUploading(false);}
  }
  async function pickSample(name: string) {
    if(!meshyProvider){update({uploadName:`${name} sample`,prompt:`A detailed ${name}`});return;}
    try{const response=await fetch(`/assets/sample-${name}.png`);if(!response.ok)throw new Error();await pick(new Blob([await response.blob()],{type:'image/png'}),`${name} sample`,{prompt:`A detailed ${name}`});}
    catch{setUploadError('Upload failed. Check your connection and try again.');}
  }
  const back = (target: ScreenProps['step']) => <button className="text-button" onClick={()=>go(target)}>Back</button>;

  if(step === 'connect') return <section className="gen-screen gen-connect" aria-labelledby="screen-title">
    <DemoTip />
    <Bubble className="gen-numbers">🔢</Bubble><Bubble className="gen-developer">🧑‍💻</Bubble>
    <img className="gen-meshy-logo" src="/assets/meshy-logo.png" alt="Meshy" />
    <h1 id="screen-title" className="screen-heading">Connect to Meshy</h1><p className="gen-connect-intro">Bring a shape into your design.<br />{meshyProvider ? 'Start with a description or an image.' : 'Start with the interactive demo.'}</p>
    {meshyProvider ? <div className="gen-card gen-connect-card"><h2>Meshy API Key</h2><div className="gen-demo-key">Held by Depth’s server — nothing to paste</div><p className="gen-hint">20 credits per shape, 10 per look.</p><button className="primary" onClick={()=>{update({connected:true});go('prompt');}}>Continue →</button></div>
    : <div className="gen-card gen-connect-card"><h2>Meshy API Key</h2><div className="gen-demo-key">Demo mode — no API key needed</div><p className="gen-hint">No real keys are collected. Generation is simulated.</p><button className="primary" onClick={()=>{update({connected:true});go('prompt');}}>Continue with demo →</button></div>}
    <div className="gen-connect-help"><Bubble>🔑</Bubble><div className="gen-help-anchor"><button className="text-button" aria-expanded={showHelp} onClick={()=>setShowHelp(!showHelp)}>{meshyProvider ? 'How does this work?' : 'How does this demo work?'}</button>{showHelp && <p className="gen-help" role="status">{meshyProvider ? 'Meshy makes your shape and its look through Depth’s server: 20 credits per shape, 10 per look. Figma placement is coming in a later update.' : 'Explore every step with the original sample artwork. Model generation, Meshy connection, and Figma placement are demonstrations; no external API calls or credits are used.'}</p>}</div><Bubble>❓</Bubble></div>
  </section>;

  if(step === 'prompt') return <section className={`gen-screen gen-prompt gen-prompt-${draft.inputMode}`} aria-labelledby="screen-title">
    <h1 id="screen-title" className="screen-heading">What are you making?</h1>
    <div className="gen-tabs" aria-label="Input method"><button aria-pressed={draft.inputMode==='quick'} onClick={()=>update({inputMode:'quick'})}>Quick Generate</button><button aria-pressed={draft.inputMode==='agent'} onClick={()=>update({inputMode:'agent'})}>Agent Mode</button></div>
    <div className="gen-card gen-prompt-card">{draft.inputMode==='agent' ? <><label className="sr-only" htmlFor="shape-prompt">Describe your shape</label><textarea id="shape-prompt" className="field" value={draft.prompt} readOnly={agentBusy} onChange={e=>update({prompt:e.target.value})} placeholder="e.g. A sculpted chrome sneaker with a bold, futuristic sole…" rows={5}/>{shapeHint}<p className="gen-credit">{meshyProvider ? `20 credits${left}` : 'Demo · 0 credits'}</p>{meshyProvider && <PromptAgent draft={draft} update={update} undo={undo} onBusy={setAgentBusy}/>}</> : <><input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a photo or sketch" onChange={e=>{const file=e.target.files?.[0];if(file)pick(file,file.name);}}/><button className="gen-upload" disabled={uploading} aria-label={draft.uploadName || 'Upload a photo or sketch'} onClick={()=>inputRef.current?.click()}><img className={selectedSample ? 'gen-upload-sample' : undefined} src={selectedSample ? `/assets/sample-${selectedSample}.png` : '/assets/gen-upload.svg'} alt={selectedSample ? `${selectedSample} sample preview` : ''}/><strong>{draft.uploadName || 'Upload a photo or sketch'}</strong></button>{meshyProvider ? (uploading ? <p className="gen-hint" role="status">Uploading…</p> : draft.uploadPath && <p className="gen-hint">Uploaded. Meshy makes the shape from this image.</p>) : draft.uploadName && <p className="gen-hint">Filename saved locally; no file is uploaded. The demo uses the sample ear.</p>}{uploadError && <p role="alert">{uploadError}</p>}{meshyProvider && <p className="gen-credit">{`20 credits${left}`}</p>}{meshyProvider && draft.uploadPath && !uploading && <PromptAgent draft={draft} update={update} undo={undo} onBusy={setAgentBusy}/>}</>}</div>
    <div className="gen-generate-row">{draft.inputMode==='quick'&&<span>Sample detail</span>}<button className="primary" disabled={!promptValid} onClick={startShape}>{meshyProvider ? 'Generate · 20 credits' : 'Generate demo'}</button>{draft.inputMode==='quick'&&<span>{meshyProvider ? 'jpg/png/webp · 20 MB' : 'jpg/png/webp'}</span>}</div>
    {draft.inputMode==='agent' ? <div className="gen-prompt-tips"><button onClick={()=>update({prompt:[draft.prompt,'Realistic sculpted style'].filter(Boolean).join(', ')})}><strong>Style?</strong> e.g. Cartoonish, Realistic, low-fidelity, high-fidelity, detailed</button><button onClick={()=>update({prompt:[draft.prompt,'Soft rounded corners'].filter(Boolean).join(', ')})}><strong>Numerics?</strong> e.g. 40% realistic, 80% rounded corners</button><button onClick={()=>update({prompt:[draft.prompt,'Centered, upright pose'].filter(Boolean).join(', ')})}><strong>Technical/Pose Constraints?</strong></button><span>add to description!</span></div> : <div className="gen-samples"><div className="gen-sample-fan">{['soldier','box','tree','basket','mobile'].map((name,i)=><button key={name} className={`gen-sample gen-sample-${i}`} aria-label={`Try ${name} sample`} disabled={uploading} onClick={()=>pickSample(name)}><img src={`/assets/sample-${name}.png`} alt={`${name} sample artwork`}/></button>)}</div><p>Try a Sample!</p></div>}
    <div className="gen-back">{back('connect')}</div>
  </section>;

  if(step==='shape'||step==='render'||step==='fine-tune') {
    const fine=step==='fine-tune',rendered=step==='render';
    return <section className={`gen-screen gen-review ${fine?'gen-fine':step==='shape'?'gen-shape-review':''}`} aria-labelledby="screen-title"><h1 id="screen-title" className="screen-heading">{fine?'Fine Tune Your Shape':rendered?'Review Your Render':'Review Your Shape'}</h1><div className="gen-editor-preview"><ModelPreview rendered={rendered} compact={fine} material={draft.material} color={draft.color} secondColor={draft.secondColor} modelPath={rendered ? draft.lookModelPath || draft.modelPath : draft.modelPath} textured={rendered && Boolean(draft.lookModelPath)}/></div><div className="gen-editor-controls">
      {fine && <div className="gen-card gen-fine-card"><label className="sr-only" htmlFor="fine-prompt">Refine your shape description</label><textarea id="fine-prompt" className="field" value={draft.prompt} rows={4} onChange={e=>update({prompt:e.target.value})} placeholder="e.g. A sculpted ear with 3 piercings with a wider ear panel…"/><div className="gen-history"><strong>Previous prompt: {draft.previousPrompts[0]||'No earlier prompt yet'}</strong><details><summary>Version history</summary><ol>{draft.previousPrompts.map((prompt,i)=><li key={i}><button className="text-button" onClick={()=>update({prompt})}>{prompt}</button></li>)}</ol></details></div>{shapeHint}<button className="primary gen-full" disabled={!draft.prompt.trim()} onClick={startShape}>{meshyProvider ? 'Regenerate shape · 20 credits' : 'Regenerate demo shape'}</button></div>}
      <div className="gen-review-actions"><button className="primary" onClick={()=>go(rendered?'templates':'appearance')}>{rendered?'Looks Good, Choose a Template!':'Looks Good, Continue!'}</button>{!fine&&<button className="secondary" onClick={()=>go(rendered?'materials':'fine-tune')}>{rendered?'Good, But Edit Manual Options!':'Good, But Fine Tune!'}</button>}{fine?back('shape'):<button className="text-button" onClick={()=>go(rendered?'appearance':'prompt')}>Not at all… Edit Prompt</button>}</div></div>
    </section>;
  }

  if(step==='appearance')return <section className="gen-screen gen-appearance" aria-labelledby="screen-title"><div className="gen-appearance-heading"><Bubble className="gen-brick" asset="gen-brick-bubble">🧱</Bubble><Bubble className="gen-palette" asset="gen-palette-bubble">🎨</Bubble><Bubble className="gen-tools" asset="gen-tools-bubble">🛠️</Bubble><Bubble className="gen-small-palette" asset="gen-small-palette-bubble">🎨</Bubble><Bubble className="gen-small-brick" asset="gen-small-brick-bubble">🧱</Bubble><Bubble className="gen-dot" asset="gen-dot-bubble">🟤</Bubble><h1 id="screen-title" className="screen-heading">How Should it Look?</h1></div><div className="gen-appearance-content">{draft.modelPath ? <ShapeThumb modelPath={draft.modelPath}/> : <img className="gen-appearance-ear" src="/assets/ear-clay.png" alt="Sample clay ear"/>}<div className="gen-card"><label className="sr-only" htmlFor="look-prompt">Describe the look</label><textarea id="look-prompt" className="field" rows={7} value={draft.lookPrompt} onChange={e=>update({lookPrompt:e.target.value})} placeholder="e.g. Deep teal enamel with polished chrome detail…"/>{meshyProvider ? <><p className="gen-hint">{draft.inputMode === 'quick' ? 'Leave it empty to use your photo.' : 'Leave it empty to use your shape description.'}</p><p className="gen-credit">{`10 credits${left}`}</p></> : savedHint}<div className="gen-material-words" aria-hidden="true"><span>Material</span><span>tints</span><span>texture</span><span>Color</span></div></div></div><div className="gen-review-actions"><button className="primary" onClick={()=>generate('look')}>Looks Good, Continue!</button><button className="gen-manual-button" onClick={()=>go('materials')}>Add Manual Options</button><button className="text-button" onClick={()=>{update({lookReady:true});go('templates');}}>Skip, use the template’s look</button>{back('shape')}</div></section>;

  if(step==='materials')return <section className="gen-screen gen-materials" aria-labelledby="screen-title"><h1 id="screen-title" className="screen-heading">How Should it Look?</h1><div className="gen-editor-preview"><ModelPreview compact rendered={meshyProvider} material={draft.material} color={draft.color} secondColor={draft.secondColor} modelPath={draft.lookModelPath || draft.modelPath} textured={Boolean(draft.lookModelPath)}/></div><div className="gen-editor-controls"><div className="gen-look-description">{draft.lookPrompt||'Choose a material and colors for your object…'}</div><div className="gen-material-controls"><div className="gen-material-row"><Bubble>🧱</Bubble><div className="gen-material-options" aria-label="Material">{choices.material.map(material=><button key={material} aria-pressed={draft.material===material} onClick={()=>update({material})}>{material}</button>)}</div></div><div className="gen-material-row"><Bubble>🎨</Bubble><div className="gen-color-options"><label><input type="color" aria-label="Primary material color" value={draft.color} onChange={e=>update({color:e.target.value})}/><span>{draft.color.toUpperCase()}</span></label><label><input type="color" aria-label="Secondary material color" value={draft.secondColor} onChange={e=>update({secondColor:e.target.value})}/><span>{draft.secondColor.toUpperCase()}</span></label></div></div></div><p className="gen-hint gen-center">Material changes are free and only affect this preview.</p><div className="gen-review-actions"><button className="primary" onClick={()=>{if(!meshyProvider){generate('look');return;}update({lookReady:true});go('render');}}>Looks Good, Continue!</button>{back('appearance')}</div></div></section>;
  return null;
}
