import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { firebaseServices } from './firebase';

export type JobKind='shape'|'look'|'place';
export type JobStatus='starting'|'queued'|'running'|'ingesting';
export type JobInput={source:'text';prompt:string}|{source:'image';imagePath:string}|{kind:'look';shapeJobId:string;prompt:string};
export type JobEvents={progress(percent:number,status?:JobStatus):void;done(modelPath?:string):void;failed?(message:string):void;id?(jobId:string):void};
// stop() only stops listening; cancel() also cancels the job.
export type JobRun={stop():void;cancel():void};
export type JobService={start(kind:JobKind,input:JobInput|null,on:JobEvents):JobRun;resume?(jobId:string,on:JobEvents):JobRun};

// Simulated generation: progress climbs to 96% and the job finishes after 2.2 seconds. No API is called.
export const demoJobs:JobService={start(_kind,_input,on){
  let percent=0;
  const timer=window.setInterval(()=>{percent=Math.min(96,percent+12);on.progress(percent);},250);
  const complete=window.setTimeout(()=>on.done(),2200);
  const clear=()=>{window.clearInterval(timer);window.clearTimeout(complete);};
  return {stop:clear,cancel:clear};
}};

function services() {
  if(!firebaseServices)throw new Error('Firebase is not configured.');
  return firebaseServices;
}
const messages:Record<string,string>={
  'invalid-argument':'Check the prompt (up to 600 characters) or the image, then try again.',
  unauthenticated:'Depth couldn’t verify this browser. Reload the page and try again.',
  'permission-denied':'Your account can’t generate shapes. Sign in again or ask the project owner.',
  unavailable:'Meshy couldn’t start this model. Try again in a moment.',
  'failed-precondition':'Meshy can no longer texture this shape. Make the shape again.',
};
export function jobMessage(error:unknown) {
  const {code='',message=''}=(error||{}) as {code?:string;message?:string};
  const short=code.replace(/^functions\//,'');
  if(short==='resource-exhausted')return /month/i.test(message)?'This month’s shape credits are used up. Try again next month.':/day|daily/i.test(message)?'You’ve reached today’s limit of 10 shapes and looks. Try again tomorrow.':'The generation limit is reached. Try again later.';
  return messages[short]||'Something went wrong. Please try again.';
}
function cancelJob(jobId:string) {
  httpsCallable(services().functions,'cancelGeneration')({jobId}).catch(()=>{/* The server sweep ends unwatched jobs. */});
}

// Real shapes and looks: startGeneration creates the job, jobs/{id} reports its progress. Placement stays simulated, and only demo mode runs it.
export const meshyJobs:JobService={
  start(kind,input,on){
    if(kind==='place'||!input)return demoJobs.start(kind,input,on);
    let jobId='',stopped=false,canceled=false,watch:JobRun|null=null;
    on.progress(0,'starting');
    httpsCallable<JobInput,{jobId:string}>(services().functions,'startGeneration',{limitedUseAppCheckTokens:true})(input).then(({data})=>{
      jobId=data.jobId;
      if(canceled){cancelJob(jobId);return;}
      on.id?.(jobId);
      if(!stopped)watch=meshyJobs.resume!(jobId,on);
    },error=>{if(!stopped)on.failed?.(jobMessage(error));});
    return {stop(){stopped=true;watch?.stop();},cancel(){stopped=canceled=true;watch?.stop();if(jobId)cancelJob(jobId);}};
  },
  resume(jobId,on){
    const unsubscribe=onSnapshot(doc(services().db,'jobs',jobId),snapshot=>{
      const job=snapshot.data();
      if(!job){if(!snapshot.metadata.fromCache){unsubscribe();on.failed?.('This model could not be found.');}return;}
      if(job.status==='ready'){unsubscribe();on.done(job.modelPath||'');}
      else if(job.status==='failed'||job.status==='canceled'){unsubscribe();on.failed?.(job.status==='canceled'?'This model was canceled.':job.error||'Meshy couldn’t make this model.');}
      else on.progress(job.status==='ingesting'?100:Math.round(Number(job.progress)||0),job.status);
    },()=>on.failed?.('We lost track of this model. Check your connection and try again.'));
    return {stop:unsubscribe,cancel(){unsubscribe();cancelJob(jobId);}};
  },
};

export const meshyProvider=import.meta.env.VITE_JOB_PROVIDER==='meshy';
export const jobService=meshyProvider?meshyJobs:demoJobs;

// The daily limit startGeneration enforces, counted per UTC day.
export const DAILY_JOBS=10;
// Shapes and looks left today, from the user's own users/{uid} record; null when it can't be read.
export async function jobsLeftToday():Promise<number|null> {
  try{
    const {auth,db}=services(),uid=auth.currentUser?.uid;
    if(!uid)return null;
    const user=(await getDoc(doc(db,'users',uid))).data();
    const used=user?.day===new Date().toISOString().slice(0,10)?Number(user.dayCount)||0:0;
    return Math.max(0,DAILY_JOBS-used);
  }catch{return null;}
}

export async function uploadImage(file:Blob,prefix='') {
  const {auth,storage}=services(),uid=auth.currentUser?.uid;
  if(!uid)throw new Error('Not signed in.');
  const path=`uploads/${uid}/${prefix}${crypto.randomUUID()}.${file.type==='image/jpeg'?'jpg':file.type.split('/')[1]}`;
  await uploadBytes(ref(storage,path),file,{contentType:file.type});
  return path;
}
export function modelUrl(path:string){return getDownloadURL(ref(services().storage,path));}
