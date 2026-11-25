import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import GenerationScreens from './GenerationScreens';
import { CompositionScreens } from './CompositionScreens';
import { allowedStep, readDraft, storageKey, steps, type Draft, type Step } from './model';
import { signOutUser } from './firebase';
import { jobService, meshyProvider, type JobEvents, type JobKind, type JobRun, type JobStatus } from './jobs';

const titles:Record<Step,string>={connect:'Connect to Meshy',prompt:'3D Model Generation',shape:'Review Shape','fine-tune':'Fine-tune Shape',appearance:'Give It a Look',materials:'Manual Options',render:'Review Render',templates:'Templates',motion:'3D Model Motion',scene:'Scene Motion',layout:meshyProvider?'Layout':'Place in Figma',confirm:meshyProvider?'Ready to Finish':'Ready to Place',complete:meshyProvider?'Complete':'Demo Complete'};
export function Workflow({uid}:{uid:string}) {
  const [draft,setDraft]=useState(()=>readDraft(uid));
  const [save,setSave]=useState('Saved on this device');
  const [signOutError,setSignOutError]=useState('');
  const [menu,setMenu]=useState(false);
  const [progress,setProgress]=useState(0);
  const [status,setStatus]=useState<JobStatus>('starting');
  const [failure,setFailure]=useState('');
  const run=useRef<JobRun|null>(null);
  const draftRef=useRef(draft);
  const past=useRef<Draft[]>([]),future=useRef<Draft[]>([]);
  const navigate=useNavigate();
  const location=useLocation();
  const headingRef=useRef<HTMLDivElement>(null);
  const slug=location.pathname.split('/')[1];
  const step:Step=steps.includes(slug as Step)?slug as Step:'connect';
  const permitted=allowedStep(step,draft);
  const state=new URLSearchParams(location.search).get('state');
  const previousState=useRef(state);
  // A Meshy shape or look job saved in the draft resumes after a refresh.
  const [job,setJob]=useState<{kind:JobKind;origin:Step}|null>(()=>!meshyProvider?null:draft.shapeJobId?{kind:'shape',origin:state==='processing'&&step==='fine-tune'?step:'prompt'}:draft.lookJobId?{kind:'look',origin:'appearance'}:null);
  function persist(next:Draft) {
    draftRef.current=next;setDraft(next);
    try {localStorage.setItem(storageKey(uid),JSON.stringify(next));setSave('Saved on this device');}
    catch {setSave('Not saved — device storage unavailable');}
  }
  function update(patch:Partial<Draft>) {
    past.current.push(draftRef.current);if(past.current.length>50)past.current.shift();future.current=[];
    persist({...draftRef.current,...patch});
  }
  function go(to:Step){setMenu(false);navigate('/'+to);}
  // Job bookkeeping skips undo history.
  function track(patch:Partial<Draft>){persist({...draftRef.current,...patch});}
  // Ends this tab's running job; leaving the processing screen calls it after canceling.
  const untrack=useRef(()=>{});
  // Each job keeps its own id and shape, because another tab may run a job on the same draft.
  function events(kind:JobKind,jobId=''):JobEvents {
    const field=kind==='shape'?'shapeJobId':'lookJobId',shapeJobId=draftRef.current.modelJobId;
    const own=(id:string):Partial<Draft>=>kind==='shape'?{shapeJobId:id}:{lookJobId:id};
    const clear=()=>{run.current=null;if(jobId&&draftRef.current[field]===jobId)track(own(''));};
    untrack.current=clear;
    return {
      progress(percent,next){setProgress(percent);if(next)setStatus(next);},
      id:id=>{jobId=id;track(own(id));},
      done(modelPath=''){
        // A finished shape or look is paid for: Undo can't go back past it.
        clear();past.current=[];future.current=[];
        // A new shape makes any look still in flight obsolete.
        // A new shape also starts a new published hero; the old one stays live.
        if(kind==='shape'){track({shapeReady:true,modelPath,modelJobId:jobId,lookReady:false,lookModelPath:'',lookJobId:'',heroId:'',publishedKey:''});navigate('/shape?state=ready',{replace:true});}
        else if(draftRef.current.modelJobId!==shapeJobId)setFailure('This look was made for an earlier shape, so it wasn’t applied.');
        else {track({lookReady:true,lookModelPath:modelPath});navigate('/render?state=ready',{replace:true});}
      },
      failed(message){clear();setFailure(message);},
    };
  }
  function generate(kind:JobKind) {
    const origin=step;
    if(kind==='shape'&&draft.prompt.trim()&&!draft.previousPrompts.includes(draft.prompt.trim()))update({previousPrompts:[draft.prompt.trim(),...draft.previousPrompts].slice(0,5)});
    setProgress(0);setJob({kind,origin});navigate('/'+origin+'?state=processing',{replace:state==='processing'});
    if(meshyProvider&&kind!=='place') {
      const current=draftRef.current;
      setFailure('');setStatus('starting');
      run.current=jobService.start(kind,kind==='look'?{kind,shapeJobId:current.modelJobId,prompt:current.lookPrompt.trim()}:origin!=='fine-tune'&&current.inputMode==='quick'?{source:'image',imagePath:current.uploadPath}:{source:'text',prompt:current.prompt.trim()},events(kind));
    }
  }
  useEffect(()=>{
    if(state!=='processing'||!job||(meshyProvider&&job.kind!=='place'))return;
    const run=jobService.start(job.kind,null,{progress:setProgress,done(){
      const target=job.kind==='shape'?'shape':job.kind==='look'?'render':'complete';
      update(job.kind==='shape'?{shapeReady:true}:job.kind==='look'?{lookReady:true}:{placed:true});
      navigate('/'+target+(target==='complete'?'':'?state=ready'),{replace:true});
    }});
    return ()=>run.cancel();
  },[state,job,location.key]);
  // Leaving the processing screen cancels the job, as Cancel does.
  useEffect(()=>{if(previousState.current==='processing'&&state!=='processing'){setJob(null);setFailure('');if(run.current){run.current.cancel();untrack.current();}}previousState.current=state;},[state]);
  useEffect(()=>{
    const jobId=job?.kind==='look'?draftRef.current.lookJobId:draftRef.current.shapeJobId;
    if(job&&jobId){if(state!=='processing')navigate(`/${job.origin}?state=processing`,{replace:true});run.current=jobService.resume!(jobId,events(job.kind,jobId));}
    return ()=>{run.current?.stop();run.current=null;};
  },[]);
  useEffect(()=>{try{localStorage.setItem(storageKey(uid),JSON.stringify(draftRef.current));}catch{setSave('Not saved — device storage unavailable');}},[uid]);
  // Another tab saved this draft: load it, so this tab never saves an older copy over it.
  useEffect(()=>{
    const load=(event:StorageEvent)=>{if(event.key!==storageKey(uid))return;past.current=[];future.current=[];const next=readDraft(uid);draftRef.current=next;setDraft(next);};
    window.addEventListener('storage',load);
    return ()=>window.removeEventListener('storage',load);
  },[uid]);
  useEffect(()=>{headingRef.current?.focus();window.scrollTo({top:0,behavior:'instant'});},[location.pathname,state]);
  if(!slug||!steps.includes(slug as Step)||permitted!==step)return <Navigate to={'/'+permitted} replace/>;
  // A refresh never resumes or re-runs a simulated job.
  if(state==='processing'&&!job)return <Navigate to={'/'+step} replace/>;
  // Undo and redo restore whole drafts but keep the published hero, or the next publish would make a second one.
  const published=()=>({heroId:draftRef.current.heroId,publishedKey:draftRef.current.publishedKey});
  function undo(){const prior=past.current.pop();if(prior){future.current.push(draftRef.current);persist({...prior,...published()});}}
  function redo(){const next=future.current.pop();if(next){past.current.push(draftRef.current);persist({...next,...published()});}}
  const real=meshyProvider&&job?.kind!=='place',look=job?.kind==='look';
  const props={step,draft,update,track,go,generate,undo,redo,canUndo:past.current.length>0,canRedo:future.current.length>0};
  async function logout(){try{await signOutUser();}catch{setSignOutError('Sign-out failed. Please try again.');}}
  return <div className="app-shell"><header className="app-header"><button className="home-button" aria-label="Go to first step" onClick={()=>go('connect')}><img src="/assets/depth-logo.svg" alt=""/><span className="wordmark">Depth</span></button><span className="header-slash">/</span><div className="stage-menu"><button className="stage-button" aria-label={`Choose stage, current: ${titles[step]}`} aria-expanded={menu} onClick={()=>setMenu(!menu)}>{state==='processing'?'Processing…':titles[step]} <span aria-hidden="true">⌄</span></button>{menu&&<nav aria-label="Workflow stages">{steps.filter(s=>allowedStep(s,draft)===s).map(s=><button key={s} aria-current={s===step?'step':undefined} onClick={()=>go(s)}>{titles[s]}</button>)}<button className="menu-signout" onClick={logout}>Sign out</button></nav>}</div><span className={`save-status ${save.startsWith('Not')?'save-error':''}`} role="status">{save}</span></header>
  {signOutError&&<p role="alert" className="inline-notice">{signOutError}</p>}
  <main ref={headingRef} tabIndex={-1} className="workflow-main">
  {state==='processing'&&job&&failure?<section className="processing-screen processing-failed"><h1 className="screen-heading">{look?'That look didn’t work.':'That shape didn’t work.'}</h1><p role="alert" className="processing-label">{failure}</p><button className="primary" onClick={()=>generate(job.kind)}>Try again</button><button className="text-button" onClick={()=>go(job.origin)}>{look?'Edit look':'Edit prompt'}</button></section>
  :state==='processing'&&job?<section className={`processing-screen processing-${job.kind}`}><h1 className="screen-heading">{job.kind==='shape'?'Shaping your idea…':job.kind==='look'?'Polishing your model…':'Preparing your demo hero…'}</h1><div className="processing-orbit"><img src={job.kind==='place'?'/assets/placement-logo.svg':'/assets/processing-logo.svg'} alt=""/></div>{real?<p className="processing-label">{status==='running'?<>{look?'Texturing':'Shaping'} <strong>{progress}%</strong></>:status==='ingesting'?'Saving the model…':status==='queued'?'Queued…':'Starting…'}</p>:<p className="processing-label">{job.kind==='place'?'Simulating placement':'Running sample generation'} <strong>{progress}%</strong></p>}<progress max="100" value={progress}/><p className="demo-note">{real?`${look?'10 credits per look':'20 credits per shape'}. Once Meshy has started, canceling may not give them back.`:'Demo only. No paid API call or Figma change.'}</p><button className="secondary" onClick={()=>{const origin=job.origin;setJob(null);navigate('/'+origin,{replace:true});}}>Cancel</button></section>
  :state==='ready'&&['shape','render'].includes(step)?<section className="processing-screen ready-screen"><h1 className="screen-heading">{step==='shape'?'Your shape is ready.':'Your render is ready.'}</h1><div className="processing-orbit">{meshyProvider?<img src="/assets/processing-logo.svg" alt=""/>:<img src={step==='shape'?'/assets/ear-clay.png':'/assets/ear.png'} alt="Sample model"/>}<span className="ready-check">✓</span></div><p className="demo-note">{!meshyProvider?'Sample artwork loaded · Simulated generation':step==='shape'?'Clay shape from Meshy · 20 credits used':'Textured by Meshy · 10 credits used'}</p><button className="primary" onClick={()=>navigate('/'+step,{replace:true})}>{step==='shape'?'Review Shape':'Review Render'}</button><button className="text-button" onClick={()=>go(step==='shape'?'prompt':'appearance')}>Edit {step==='shape'?'prompt':'appearance'}</button></section>
  :['connect','prompt','shape','fine-tune','appearance','materials','render'].includes(step)?<GenerationScreens {...props}/>:<CompositionScreens {...props}/>}</main><footer className="app-footer">{meshyProvider?<>Depth · {save} · Shapes and looks by Meshy</>:<>Depth frontend demo · {save} · Generation & placement simulated</>}</footer></div>;
}
