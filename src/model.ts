export const steps = ['connect','prompt','shape','fine-tune','appearance','materials','render','templates','motion','scene','layout','confirm','complete'] as const;
export type Step = typeof steps[number];
export type Draft = {
 version: 2; connected: boolean; shapeReady: boolean; lookReady: boolean; placed: boolean;
 prompt: string; previousPrompts: string[]; inputMode: 'quick'|'agent'; uploadName: string;
 lookPrompt: string; material: string; color: string; secondColor: string;
 template: string; motion: string; speed: number; amount: number; direction: string;
 camera: string; lighting: string; background: string; backgroundColor: string; lightingColor: string;
 frame: 'Desktop'|'Mobile'|'Both'; layout: 'Centered'|'Object Right'|'3D only';
 eyebrow: string; headline: string; subtitle: string; buttonLabel: string; buttonUrl: string; lowOpacity: boolean; placement: 'New Frame'|'Replace Selection';
 shapeJobId: string; modelPath: string; uploadPath: string; modelJobId: string; lookJobId: string; lookModelPath: string;
 // The published hero this draft updates, and publishedKey(draft) when it was last published.
 heroId: string; publishedKey: string;
};
export const initialDraft: Draft = {version:2,connected:false,shapeReady:false,lookReady:false,placed:false,prompt:'',previousPrompts:[],inputMode:'agent',uploadName:'',lookPrompt:'',material:'Original',color:'#9e8265',secondColor:'#fcffbc',template:'Studio Glow',motion:'Still',speed:0.8,amount:42,direction:'Auto',camera:'Static',lighting:'Soft',background:'Template',backgroundColor:'#ffffff',lightingColor:'#ffffff',frame:'Desktop',layout:'Object Right',eyebrow:'Made with Meshy',headline:'Design that\nmoves you.',subtitle:'A little dimension goes a long way. Explore the details in every angle.',buttonLabel:'Explore Collection',buttonUrl:'',lowOpacity:true,placement:'New Frame',shapeJobId:'',modelPath:'',uploadPath:'',modelJobId:'',lookJobId:'',lookModelPath:'',heroId:'',publishedKey:''};
// `track` saves without an undo entry, for bookkeeping such as the published hero.
export type ScreenProps = {step:Step; draft:Draft; update:(patch:Partial<Draft>)=>void; track:(patch:Partial<Draft>)=>void; go:(step:Step)=>void; generate:(kind:'shape'|'look'|'place')=>void; undo?:()=>void; redo?:()=>void; canUndo?:boolean; canRedo?:boolean};
export function allowedStep(step:Step,draft:Draft):Step {
 if(step==='connect')return step;
 if(!draft.connected)return 'connect';
 if(step==='prompt')return step;
 if(!draft.shapeReady)return 'prompt';
 if(['shape','fine-tune','appearance','materials'].includes(step))return step;
 if(!draft.lookReady)return 'appearance';
 if(step==='complete'&&!draft.placed)return 'confirm';
 return step;
}
export function storageKey(uid:string){return `depth:draft:v1:${uid}`;}
export function readDraft(uid:string):Draft {
 try {
   const saved=JSON.parse(localStorage.getItem(storageKey(uid))||'null');
   // Version 1 drafts migrate in place: new fields start empty.
   if(saved?.version===1||saved?.version===2) {
     const clean={...initialDraft};
     for(const key of Object.keys(initialDraft) as (keyof Draft)[]) {
       const value=saved[key];
       if(key==='previousPrompts') {if(Array.isArray(value)&&value.every(v=>typeof v==='string'))clean.previousPrompts=value.slice(0,5);}
       else if(typeof value===typeof initialDraft[key]&&(typeof value!=='number'||Number.isFinite(value)))Object.assign(clean,{[key]:value});
     }
     clean.speed=Math.min(2,Math.max(.2,clean.speed));clean.amount=Math.min(100,Math.max(0,clean.amount));clean.version=2;
     // Phase 1 drafts name the shape job only in models/{uid}/{jobId}/model.glb.
     const [root,owner,jobId,file,...rest]=clean.modelPath.split('/');
     if(!clean.modelJobId&&root==='models'&&owner===uid&&jobId&&file==='model.glb'&&!rest.length)clean.modelJobId=jobId;
     return clean;
   }
 }catch{/* Invalid local draft starts clean. */}
 return {...initialDraft};
}
