import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Draft } from './model';
import type { Capture3D } from './exportHero';
import type { FrameLayout } from './figmaLayout';
import { sceneFromDraft, type Box } from './scene';

// PNGs of this hero, `width` pixels wide: the whole hero, or the 3D layer alone on a transparent background. And its
// layout for Figma, measured as it is drawn now.
export type HeroExporter = {png: (width: number) => Promise<Blob>; poster: (width: number) => Promise<Blob>; layout: () => Promise<FrameLayout>};

// three.js loads only when the hero has a real model.
const Hero3D = lazy(() => import('./Hero3D'));
class HeroBoundary extends Component<{children: ReactNode; onError: () => void}, {failed: boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

// A box as fractions of the hero, or null when the element isn't shown.
function boxOf(element: Element | null, hero: DOMRect): Box | null {
  const r = element?.getBoundingClientRect();
  if (!r || !r.width || !r.height || !hero.width || !hero.height) return null;
  return { x: (r.left - hero.left) / hero.width, y: (r.top - hero.top) / hero.height, w: r.width / hero.width, h: r.height / hero.height };
}

// `modelUrl` is the model's download URL ('' for the sample artwork). With a `poster`, the poster shows until the 3D layer has
// drawn and replaces the sample artwork if the model can't be shown. `paused` stops drawing; `linked` makes the button a link.
// `onReady` hears whether the 3D layer has drawn, so a poster can be taken.
export function HeroPreview({draft, modelUrl='', poster='', faded=false, playing=true, paused=false, linked=false, exporter, onReady}: {draft:Draft; modelUrl?:string; poster?:string; faded?:boolean; playing?:boolean; paused?:boolean; linked?:boolean; exporter?:{current:HeroExporter|null}; onReady?:(ready:boolean)=>void}) {
  const [pointer,setPointer]=useState({x:0,y:0});
  const pointerRef=useRef(pointer);
  const root=useRef<HTMLDivElement>(null);
  const capture=useRef<Capture3D|null>(null);
  // The exporter (and html-to-image) loads only when a PNG is asked for, and measureLayout only when a layout is.
  useEffect(()=>{
    if(!exporter)return;
    exporter.current={
      png:async width=>{const {heroPng}=await import('./exportHero');return heroPng(root.current!,width,capture.current);},
      poster:async width=>{const {layerPng}=await import('./exportHero');return layerPng(root.current!,width,capture.current);},
      layout:async()=>{const {measureLayout}=await import('./measureLayout');return measureLayout(root.current!);},
    };
    return ()=>{exporter.current=null;};
  },[exporter]);
  const url=modelUrl;
  const [failedUrl,setFailedUrl]=useState('');
  const [boxes,setBoxes]=useState<{main:Box|null;ghosts:Box[]}>({main:null,ghosts:[]});
  // With a real model the 3D layer replaces the ear image; the ear's boxes stay in place, empty and hidden, to show where the model goes.
  const real=Boolean(url)&&url!==failedUrl;
  // The sample artwork (and its 3.8 MB image) shows only without a model or poster.
  const ear=!real&&!poster;
  // The canvas fades in over the poster once it has drawn; the poster goes when the fade ends.
  const [drawn,setDrawn]=useState(''),[settled,setSettled]=useState('');
  useEffect(()=>{if(!drawn)return;const timer=setTimeout(()=>setSettled(drawn),300);return ()=>clearTimeout(timer);},[drawn]);
  useEffect(()=>{onReady?.(real&&drawn===url);},[real,drawn,url]);
  const measure=()=>{
    const hero=root.current?.getBoundingClientRect();
    if(!hero)return;
    const next={main:boxOf(root.current!.querySelector('.hero-object'),hero),ghosts:[...root.current!.querySelectorAll('.ghost-ear')].map(ghost=>boxOf(ghost,hero)).filter((box):box is Box=>Boolean(box))};
    setBoxes(prev=>JSON.stringify(prev)===JSON.stringify(next)?prev:next);
  };
  useLayoutEffect(()=>{if(real)measure();});
  useEffect(()=>{
    if(!real||typeof ResizeObserver==='undefined'||!root.current)return;
    const observer=new ResizeObserver(measure);observer.observe(root.current);
    return ()=>observer.disconnect();
  },[real]);
  const cta=`hero-cta ${draft.buttonLabel!=='Explore Collection'?'custom-cta':''}`;
  const reducedMotion=Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const style={ '--background-color':draft.backgroundColor, '--lighting-glow':draft.lightingColor.toLowerCase()==='#ffffff'?'transparent':draft.lightingColor, '--duration':`${4/Math.max(draft.speed,.1)}s`, '--amount':`${draft.amount/2}px`, '--angle':`${draft.amount/6}deg`, '--pointer-x':`${pointer.x*12}px`, '--pointer-y':`${pointer.y*8}px`, '--tilt':`${pointer.x*10}deg`, '--secondary-glow':draft.secondColor==='#fcffbc'?'transparent':draft.secondColor, animationDirection:draft.direction==='Reverse'?'reverse':'normal' } as CSSProperties;
  return <div ref={root} className={`hero-preview template-${draft.template.toLowerCase().replaceAll(' ','-')} bg-${draft.background.toLowerCase()} layout-${draft.layout.toLowerCase().replaceAll(' ','-')} light-${draft.lighting.toLowerCase()} ${faded?'faded':''} ${playing&&ear?'playing':''} camera-${draft.camera.toLowerCase().replaceAll(' ','-')}`} style={style} onPointerMove={e=>{const r=e.currentTarget.getBoundingClientRect();const next={x:(e.clientX-r.left)/r.width-.5,y:(e.clientY-r.top)/r.height-.5};pointerRef.current=next;setPointer(next);}} onPointerLeave={()=>{pointerRef.current={x:0,y:0};setPointer({x:0,y:0});}} aria-label={ear?'Illustrative hero composition':'Hero composition'}>
    <div className="hero-backdrop"/>
    {poster&&(!real||settled!==url)&&<img className="hero-poster" src={poster} alt=""/>}
    {real&&<HeroBoundary key={url} onError={()=>setFailedUrl(url)}><Suspense fallback={null}><div className={`hero-canvas ${poster&&drawn!==url?'waiting':''}`}><Hero3D url={url} scene={sceneFromDraft(draft,{playing,reducedMotion})} box={boxes.main} ghosts={boxes.ghosts} faded={faded} pointer={pointerRef} capture={capture} paused={paused} onFirstFrame={()=>setDrawn(url)}/></div></Suspense></HeroBoundary>}
    <div className="hero-copy">{draft.eyebrow&&<p className="hero-eyebrow">{draft.eyebrow}</p>}<h2>{draft.headline}</h2>{draft.subtitle&&<p className="hero-description">{draft.subtitle}</p>}{linked&&draft.buttonUrl?<a className={cta} href={draft.buttonUrl} target="_top" rel="noopener">{draft.buttonLabel}</a>:<span className={cta}>{draft.buttonLabel}</span>}</div>
    {ear?<><img className="ghost-ear ghost-one" src="/assets/ear.png" alt=""/><img className="ghost-ear ghost-two" src="/assets/ear.png" alt=""/></>:<><div className="ghost-ear ghost-one hero-anchor"/><div className="ghost-ear ghost-two hero-anchor"/></>}
    <div className={`hero-object ${ear?`motion-${draft.motion.toLowerCase().replaceAll(' ','-')}`:'hero-anchor'}`}>{ear&&<img src="/assets/ear.png" alt="Sample sculpted ear model" style={{filter:draft.material==='Metallic'?'grayscale(1) contrast(1.5)':draft.material==='Transparent'?'opacity(.65) saturate(.4)':draft.material==='Original'&&draft.color==='#9e8265'?undefined:`sepia(.4) saturate(1.4) drop-shadow(0 0 12px ${draft.color})`}}/>}</div>
  </div>;
}
