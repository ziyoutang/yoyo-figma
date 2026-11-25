import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { HeroPreview, type HeroExporter } from './HeroPreview';
import { readBlob, saveFile } from './download';
import type { FigmaLayout } from './figmaLayout';
import { choices, textLimits } from './heroOptions';
import { meshyProvider, modelUrl } from './jobs';
import { CopyAgent, SceneAgent } from './AgentMode.tsx';
import type { Draft, ScreenProps, Step } from './model';
import { embedCode, isHttpsLink, publishedKey, snapshotFromDraft } from './publish';
import { publishHero, publishMessage, unpublishHero, viewerUrl, watchLiveHeroes, type LiveHero } from './publishing';

export function Choices({label,values,value,onChange}:{label:string;values:readonly string[];value:string;onChange:(v:string)=>void}) {return <fieldset className="choices"><legend>{label}</legend><div>{values.map(v=><button key={v} type="button" aria-pressed={value===v} className={value===v?'selected':''} onClick={()=>onChange(v)}>{v}</button>)}</div></fieldset>;}

export function CompositionScreens({step,draft,update,track,go,generate,undo,redo,canUndo,canRedo}:ScreenProps) {
  const [playing,setPlaying]=useState(true);
  const [templatePreview,setTemplatePreview]=useState(true);
  const previewDialog=useRef<HTMLDialogElement>(null);
  // The expanded preview mounts its hero (and 3D canvas) only while open.
  const [expanded,setExpanded]=useState(false);
  const expand=()=>{setExpanded(true);previewDialog.current?.showModal();};
  const [sceneTab,setSceneTab]=useState('Camera');
  const [notice,setNotice]=useState('');
  // A real Meshy model makes the hero 3D and exportable; without one the demo artwork stays.
  const modelPath=draft.lookModelPath||draft.modelPath;
  // Resolved once and shared by every preview of this hero.
  const [url,setUrl]=useState('');
  useEffect(()=>{
    let live=true;
    setUrl('');
    if(modelPath)modelUrl(modelPath).then(next=>{if(live)setUrl(next);},()=>{});
    return ()=>{live=false;};
  },[modelPath]);
  const mainHero=useRef<HeroExporter|null>(null),mobileHero=useRef<HeroExporter|null>(null);
  // PNGs are twice the frame width: 1440 px desktop, 390 px mobile.
  const heroes=()=>draft.frame==='Both'?[[mainHero,2880,'desktop'],[mobileHero,780,'mobile']] as const:[[mainHero,draft.frame==='Mobile'?780:2880,draft.frame==='Mobile'?'mobile':'desktop']] as const;
  const fail=()=>setNotice('The file couldn’t be made. Try again.');
  const downloadPng=async()=>{try{for(const [hero,width,name] of heroes())saveFile(await hero.current!.png(width),`depth-hero-${name}.png`);}catch{fail();}};
  const copyPng=async()=>{const [[hero,width]]=heroes();try{await navigator.clipboard.write([new ClipboardItem({'image/png':hero.current!.png(width)})]);setNotice('Copied the hero PNG.');}catch{fail();}};
  const [glb,setGlb]=useState<{phase:'idle'|'preparing'|'done';percent:number|null}>({phase:'idle',percent:null});
  const downloadGlb=async()=>{
    setGlb({phase:'preparing',percent:null});
    try{
      const response=await fetch(await modelUrl(modelPath));
      if(!response.ok)throw new Error();
      const blob=await readBlob(response,percent=>setGlb({phase:'preparing',percent}));
      saveFile(blob,'depth-model.glb');setGlb({phase:'done',percent:100});
    }catch{setGlb({phase:'idle',percent:null});fail();}
  };
  // Publishing: the user's live heroes come from Firestore, so an Unpublish elsewhere shows at once.
  const [busy,setBusy]=useState<''|'publishing'|'unpublishing'>('');
  // Posters need each preview's 3D layer drawn, so publishing waits for the model to load.
  const [ready,setReady]=useState({main:false,mobile:false});
  const drawnMain=(main:boolean)=>setReady(prior=>prior.main===main?prior:{...prior,main}),drawnMobile=(mobile:boolean)=>setReady(prior=>prior.mobile===mobile?prior:{...prior,mobile});
  const canPublish=!busy&&ready.main&&(draft.frame!=='Both'||ready.mobile);
  const [live,setLive]=useState<LiveHero[]|null>(null);
  useEffect(()=>{if(step!=='complete'||!modelPath)return;return watchLiveHeroes(setLive);},[step,modelPath]);
  const thisHero=live?.find(hero=>hero.heroId===draft.heroId);
  const codeFor=(hero:{heroId:string;frame:Draft['frame'];headline:string})=>embedCode({heroId:hero.heroId,viewer:viewerUrl(hero.heroId),frame:hero.frame,headline:hero.headline});
  const firstLine=(hero:LiveHero)=>hero.headline.split('\n')[0];
  // Publishes or updates the hero. Returns its id, or '' when it failed and the notice says why.
  const publish=async()=>{
    const shown=draft;
    setBusy('publishing');setNotice('');
    try{
      // Posters are the 3D layer at rest: the previews stop playing, then draw twice before the capture. Each preview's
      // Figma layout is measured from the same render.
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const posters:Partial<Record<'desktop'|'mobile',Blob>>={},layout:FigmaLayout={};
      for(const [hero,width,name] of heroes()){posters[name]=await hero.current!.poster(width);layout[name]=await hero.current!.layout();}
      const heroId=await publishHero({heroId:shown.heroId,modelPath,snapshot:snapshotFromDraft(shown),posters,layout});
      track({heroId,publishedKey:publishedKey(shown)});
      return heroId;
    }catch(error){setNotice(publishMessage(error));return '';}
    finally{setBusy('');}
  };
  // The Figma plugin reads the live hero, so Send to Figma publishes or updates first unless the live hero is this draft.
  const current=Boolean(thisHero)&&draft.publishedKey===publishedKey(draft);
  const [heroLink,setHeroLink]=useState('');
  const sendToFigma=async()=>{
    const heroId=current?draft.heroId:await publish();
    if(!heroId)return;
    const link=viewerUrl(heroId);
    setHeroLink(link);
    // A browser may refuse a clipboard write that comes long after the click, as after a publish.
    try{await navigator.clipboard.writeText(link);setNotice('Link copied. In Figma, run Plugins › Development › Depth and paste it.');}
    catch{setNotice('Copy the link below and paste it in the Depth plugin.');}
  };
  const unpublish=async(heroId:string)=>{
    if(!window.confirm('Unpublish this hero? Websites that embed it will stop showing it within a minute.'))return;
    setBusy('unpublishing');setNotice('');
    try{await unpublishHero(heroId);if(heroLink===viewerUrl(heroId))setHeroLink('');}catch(error){setNotice(publishMessage(error,'Unpublishing'));}
    finally{setBusy('');}
  };
  const copyCode=async(code:string)=>{try{await navigator.clipboard.writeText(code);setNotice('Copied the embed code.');}catch{setNotice('The embed code couldn’t be copied. Select it and copy it instead.');}};
  const templates:readonly string[]=choices.template;
  const templateIndex=Math.max(0,templates.indexOf(draft.template));
  const carouselRef=useRef<HTMLDivElement>(null);
  const switchingTemplate=useRef(false);
  const changeTemplate=async(offset:number)=>{
    if(!offset||switchingTemplate.current)return;
    const template=templates[(templateIndex+offset+templates.length)%templates.length];
    const carousel=carouselRef.current;
    if(!carousel||!carousel.animate||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){update({template});return;}
    switchingTemplate.current=true;
    const direction=offset>0?1:-1;
    const elements=Array.from(carousel.querySelectorAll('.template-preview,.template-details,.side-template'));
    const resting={transform:'perspective(1000px) translate3d(0,0,0) rotateY(0deg)',opacity:1};
    const arc=(sign:number)=>({transform:`perspective(1000px) translate3d(${sign*70}px,0,-70px) rotateY(${sign*22}deg)`,opacity:0});
    const outgoing=elements.map(element=>element.animate([resting,arc(-direction)],{duration:180,easing:'ease-in',fill:'forwards'}));
    await Promise.all(outgoing.map(animation=>animation.finished));
    if(carousel.isConnected){
      flushSync(()=>update({template}));
      const incoming=elements.map(element=>element.animate([arc(direction),resting],{duration:280,easing:'cubic-bezier(.16,1,.3,1)'}));
      outgoing.forEach(animation=>animation.cancel());
      await Promise.all(incoming.map(animation=>animation.finished));
    }else outgoing.forEach(animation=>animation.cancel());
    switchingTemplate.current=false;
  };
  const integration=()=>setNotice('This is a frontend demo. A real 3D model and the Figma integration are needed for this action. No file has been generated or placed.');
  const back=(to:Step,label:string)=> <button className="text-button" onClick={()=>go(to)}>{label}</button>;
  const figmaButton=<button className="secondary" disabled={Boolean(busy)||(!current&&!canPublish)} onClick={sendToFigma}>Send to Figma</button>;
  const title=step==='templates'?'Templates':step==='motion'?'How does the object move?':step==='scene'?'Set the Scene':step==='layout'?(modelPath?'Set the Layout':'Place in Figma'):step==='confirm'?(modelPath?'Ready to Finish?':'Ready to Place?'):modelPath?'Your hero is ready.':'Your demo hero is ready.';
  return <section className={`composition-screen step-${step}`}>
    <h1 className="screen-heading">{title}</h1>
    {step==='templates'? <>
      <div className="template-decoration" aria-hidden="true"><span>💡</span><span>📷</span><span>🎬</span></div><div className="template-tabs"><button aria-pressed={!templatePreview} onClick={()=>setTemplatePreview(false)}>Style</button><button aria-pressed={templatePreview} onClick={()=>setTemplatePreview(true)}>Preview</button></div><div className="template-carousel" ref={carouselRef}><img className="side-template left" src="/assets/template-room.png" alt="Quiet Space template"/><img className="side-template right" src="/assets/template-studio.png" alt="Soft Studio template"/><div className="template-preview"><HeroPreview draft={{...draft,motion:templatePreview?'Sway':'Still'}} modelUrl={url} playing={playing}/><span className="template-medal" aria-hidden="true">🥇</span><div className="template-preview-controls"><label className="toggle">{modelPath?'Preview motion':'Sample motion'}<input type="checkbox" checked={playing&&templatePreview} onChange={e=>{setPlaying(e.target.checked);setTemplatePreview(true);}}/></label><button className="icon-button" aria-label="Expand template preview" onClick={expand}>⛶</button></div></div><button className="carousel-arrow prev" aria-label="Previous template" onClick={()=>changeTemplate(-1)}>‹</button><button className="carousel-arrow next" aria-label="Next template" onClick={()=>changeTemplate(1)}>›</button><div className="template-details"><h2>{draft.template}</h2><p>{templateIndex===0?'Bright Product Stage':templateIndex===1?'A Calm Editorial Canvas':'A Softer Spotlight'}</p><button className="primary" onClick={()=>go('motion')}>Select</button></div></div>
      <button className="text-button skip-template" onClick={()=>go('motion')}>Skip Template, Edit It Manually</button><div className="template-dots" aria-label="Choose template">{templates.map(t=><button key={t} aria-label={t} aria-pressed={draft.template===t} onClick={()=>changeTemplate(templates.indexOf(t)-templateIndex)}/>)}</div>
      <div className="actions">{back('render','Back to Render')}<span className="demo-note">{modelPath?'Your composition':'Sample composition'}</span></div>
    </>:<>
      <div className="composition-previews"><div className={`preview-wrap ${['motion','scene'].includes(step)?'wide':''} ${draft.frame==='Mobile'?'mobile-frame':''}`}><HeroPreview draft={draft} modelUrl={url} faded={['motion','scene'].includes(step)&&draft.lowOpacity} playing={playing&&busy!=='publishing'} exporter={mainHero} onReady={drawnMain}/>
      {['motion','scene'].includes(step)&&<div className="preview-toolbar"><label className="toggle">Low Opacity<input type="checkbox" checked={draft.lowOpacity} onChange={e=>update({lowOpacity:e.target.checked})}/></label><div className="preview-history"><button aria-label="Undo edit" disabled={!canUndo} onClick={undo}>↶</button><button aria-label="Redo edit" disabled={!canRedo} onClick={redo}>↷</button></div><button className="secondary" onClick={()=>setPlaying(!playing)}>{playing?'Ⅱ Pause':'▶ Preview'}</button><button className="icon-button" aria-label="Expand preview" onClick={expand}>⛶</button></div>}</div>
      {draft.frame==='Both'&&['layout','confirm','complete'].includes(step)&&<div className="secondary-mobile"><HeroPreview draft={{...draft,frame:'Mobile'}} modelUrl={url} playing={busy!=='publishing'} exporter={mobileHero} onReady={drawnMobile}/></div>}
      {step==='layout'&&<div className="frame-dimensions"><span>{draft.frame==='Mobile'?'Mobile · 390 × 546 px':'Desktop · 1440 × 836 px'}</span>{draft.frame==='Both'&&<span>Mobile · 390 × 546 px</span>}</div>}
      </div><div className="composition-editor">
      {meshyProvider&&['motion','scene'].includes(step)&&<SceneAgent step={step} draft={draft} update={update} undo={undo}/>}
      {step==='motion'&&<><div className="motion-controls"><Choices label="Object Motion" values={choices.motion} value={draft.motion} onChange={motion=>update({motion})}/><div className="sliders"><label>Speed <output>{draft.speed.toFixed(1)}×</output><input type="range" aria-label="Speed" min="0.2" max="2" step="0.1" value={draft.speed} onChange={e=>update({speed:+e.target.value})}/></label><label>Amount <output>{draft.amount}%</output><input type="range" aria-label="Amount" min="0" max="100" value={draft.amount} onChange={e=>update({amount:+e.target.value})}/></label><label>Direction<select value={draft.direction} onChange={e=>update({direction:e.target.value})}>{choices.direction.map(d=><option key={d}>{d}</option>)}</select></label></div></div>{!modelPath&&<p className="demo-note motion-note">Illustrative 2D motion using the original artwork · No true 3D rotation</p>}<div className="actions">{back('templates','Back to Template')}<button className="primary" onClick={()=>go('scene')}>Next</button></div></>}
      {step==='scene'&&<><div className="scene-controls"><div className="scene-tabs">{['Camera','Lighting','Background'].map((t,i)=><button key={t} aria-pressed={sceneTab===t} onClick={()=>setSceneTab(t)}><span aria-hidden="true">{['📷','💡','🖼️'][i]}</span>{t}</button>)}</div><div className="scene-options"><Choices label={sceneTab} values={sceneTab==='Camera'?choices.camera:sceneTab==='Lighting'?choices.lighting:choices.background} value={sceneTab==='Camera'?draft.camera:sceneTab==='Lighting'?draft.lighting:draft.background} onChange={v=>update(sceneTab==='Camera'?{camera:v}:sceneTab==='Lighting'?{lighting:v}:{background:v})}/>
        {sceneTab==='Background'&&draft.background==='Custom'&&<div className="gen-color-options scene-color-options"><label><span>Background color</span><input type="color" aria-label="Background color" value={draft.backgroundColor} onChange={e=>update({backgroundColor:e.target.value})}/><span>{draft.backgroundColor.toUpperCase()}</span></label></div>}
        <div className={`scene-expand ${sceneTab==='Lighting'?'is-open':''}`} inert={sceneTab!=='Lighting'} aria-hidden={sceneTab!=='Lighting'}><div><div className="gen-color-options scene-color-options"><label><span>Lighting color</span><input type="color" aria-label="Lighting color" value={draft.lightingColor} onChange={e=>update({lightingColor:e.target.value})}/><span>{draft.lightingColor.toUpperCase()}</span></label><button className="text-button" onClick={()=>update({lightingColor:'#ffffff'})} disabled={draft.lightingColor==='#ffffff'}>Reset to white</button></div><p className="demo-note scene-lighting-note">{modelPath?'Tints the main light · White keeps neutral lighting':'Illustrative colored glow · White keeps neutral lighting'}</p></div></div>
      </div></div><div className="actions">{back('motion','Back to Object Motion')}<button className="primary" onClick={()=>go('layout')}>Next</button></div></>}
      {step==='layout'&&<><div className="layout-controls"><Choices label="Frame Size" values={choices.frame} value={draft.frame} onChange={frame=>update({frame:frame as typeof draft.frame})}/><Choices label="Layout" values={choices.layout} value={draft.layout} onChange={layout=>update({layout:layout as typeof draft.layout})}/><label className="field">Eyebrow<input maxLength={textLimits.eyebrow} value={draft.eyebrow} onChange={e=>update({eyebrow:e.target.value})}/></label><label className="field">Headline<textarea rows={2} maxLength={textLimits.headline} value={draft.headline} onChange={e=>update({headline:e.target.value})}/></label><label className="field">Subtitle<textarea rows={2} maxLength={textLimits.subtitle} value={draft.subtitle} onChange={e=>update({subtitle:e.target.value})}/></label><label className="field">Button text<input maxLength={textLimits.buttonLabel} value={draft.buttonLabel} onChange={e=>update({buttonLabel:e.target.value})}/></label>{modelPath&&<><label className="field">Button link<input type="url" placeholder="https://" maxLength={textLimits.buttonUrl} value={draft.buttonUrl} onChange={e=>update({buttonUrl:e.target.value})}/></label>{draft.buttonUrl&&!isHttpsLink(draft.buttonUrl)&&<p className="field-error" role="alert">Use a link that starts with https://</p>}</>}{meshyProvider&&<CopyAgent draft={draft} update={update} undo={undo}/>}</div><div className="actions">{back('scene','Back to Scene')}<button className="primary" onClick={()=>go('confirm')}>Next</button></div></>}
      {step==='confirm'&&<><div className="confirmation-card"><p className="success-strip">{modelPath?'Your scene is ready to go!':'Your sample scene is ready to go!'}</p>{modelPath?<><div><h3>Summary</h3><p>{draft.frame} frame · {draft.layout}</p></div><button className="primary" onClick={()=>{update({placed:true});go('complete');}}>Finish</button></>:<><div className="confirmation-columns"><div><h3>Placement summary</h3><p>{draft.frame} frame · {draft.layout}<br/>{draft.placement}<br/>Simulated placement only</p></div><Choices label="Place As" values={['New Frame','Replace Selection']} value={draft.placement} onChange={placement=>update({placement:placement as typeof draft.placement})}/></div><button className="primary" onClick={()=>generate('place')}>Simulate placement</button></>}</div><div className="return-actions">{back('layout','Back to Edit Layout')}<label>Back to a stage <select aria-label="Return to stage" value="" onChange={e=>go(e.target.value as Step)}><option value="" disabled>Stage</option><option value="shape">Shape</option><option value="appearance">Look</option><option value="templates">Templates</option><option value="motion">Motion</option></select></label></div></>}
      {step==='complete'&&<><p className="success-strip">{modelPath?'✓ Done.':'✓ Demo completed. No frame was added to Figma.'}</p><div className="completion-card"><div><h3>{modelPath?'Your Scene':'Your Sample Scene'}</h3><p>{modelPath?'Download it as a PNG, download the 3D model as a GLB, publish it to embed on a website, or send it to Figma.':'Your composition is saved on this device. Live 3D export and Figma placement are not connected in this demo.'}</p>{modelPath?live&&<div className="publish-panel">{busy==='publishing'?<div role="status"><p>Publishing…</p><progress/></div>:thisHero?<><label className="field">Embed code<textarea readOnly rows={3} value={codeFor(thisHero)} onFocus={e=>e.currentTarget.select()}/></label><div className="publish-actions"><button className="secondary" onClick={()=>copyCode(codeFor(thisHero))}>Copy embed code</button>{figmaButton}<a className="secondary" href={viewerUrl(thisHero.heroId)} target="_blank" rel="noopener">Open viewer</a><button className="secondary" disabled={Boolean(busy)} onClick={()=>unpublish(thisHero.heroId)}>Unpublish</button></div>{draft.publishedKey!==publishedKey(draft)&&<button className="primary" disabled={!canPublish} onClick={publish}>Update published hero</button>}</>:<><p className="publish-note">Anyone with the link can view this hero and download its 3D model.</p><button className="primary" disabled={!canPublish} onClick={publish}>{draft.heroId?'Publish again':'Publish'}</button>{figmaButton}</>}{heroLink&&<label className="field">Hero link<input readOnly value={heroLink} onFocus={e=>e.currentTarget.select()}/></label>}</div>:<><div className="code-placeholder">Live scene integration<br/>Coming in a future version</div><button className="secondary" onClick={integration}>About embed code</button></>}{glb.phase==='preparing'&&<div className="glb-status" role="status"><p>Preparing your GLB…{glb.percent!==null&&<> <strong>{glb.percent}%</strong></>}</p><progress max="100" value={glb.percent??undefined}/></div>}{glb.phase==='done'&&<div className="glb-status" role="status"><h3>Your GLB is downloaded</h3><p>Your browser saved depth-model.glb.</p></div>}</div><div className="completion-buttons">{modelPath?<><button className="primary" onClick={downloadPng}>Download PNG</button><button className="secondary" onClick={copyPng}>Copy PNG</button><button className="secondary" disabled={glb.phase==='preparing'} onClick={downloadGlb}>Download GLB</button></>:<><button className="primary" onClick={integration}>About GLB export</button><button className="secondary" onClick={integration}>About Figma placement</button></>}{back('layout','Edit this Hero')}{back('confirm','Back to confirmation')}</div></div>{modelPath&&live&&live.length>0&&<section className="published-heroes" aria-labelledby="published-heroes"><h3 id="published-heroes">Your published heroes</h3><ul>{live.slice(0,10).map(hero=><li key={hero.heroId}><p><strong>{firstLine(hero)}</strong>{hero.heroId===draft.heroId&&<span className="this-hero">This hero</span>}<br/><time dateTime={hero.publishedAt?.toISOString()}>{hero.publishedAt?.toLocaleDateString(undefined,{dateStyle:'medium'})}</time></p><button className="text-button" aria-label={`Copy embed code for ${firstLine(hero)}`} onClick={()=>copyCode(codeFor(hero))}>Copy embed code</button><a className="text-button" aria-label={`Open ${firstLine(hero)}`} href={viewerUrl(hero.heroId)} target="_blank" rel="noopener">Open</a><button className="text-button" aria-label={`Unpublish ${firstLine(hero)}`} disabled={Boolean(busy)} onClick={()=>unpublish(hero.heroId)}>Unpublish</button></li>)}</ul></section>}</>}
    </div></>}
    {notice&&<div className="inline-notice" role="status">{notice}<button className="text-button" onClick={()=>setNotice('')}>Dismiss</button></div>}
    <dialog ref={previewDialog} className={`preview-overlay ${draft.frame==='Mobile'?'preview-mobile':''}`} aria-label="Expanded sample preview" onClose={()=>setExpanded(false)}><button autoFocus className="secondary" onClick={()=>previewDialog.current?.close()}>Close preview</button>{expanded&&<HeroPreview draft={draft} modelUrl={url} playing={playing}/>}</dialog>
  </section>;
}
