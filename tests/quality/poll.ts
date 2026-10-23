/** Test-only polling. A failed wait must settle its owned task before another starts. */
export async function waitForRealJob<T>(options:{
 get:()=>Promise<T>|T;
 terminal:(value:T)=>boolean;
 now:()=>Promise<number>|number;
 timeoutMs:number;
 intervalMs:number;
 cancel:()=>Promise<unknown>|unknown;
 progress?:(value:T)=>void;
 pause?:(ms:number)=>Promise<void>;
}):Promise<T>{
 const pause=options.pause??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
 try{
  const started=await options.now();
  for(;;){
   const value=await options.get();options.progress?.(value);
   // A terminal result may already exist when an OS sleep or stall ends.
   if(options.terminal(value))return value;
   if(await options.now()-started>=options.timeoutMs)throw Error('real inference timed out');
   await pause(options.intervalMs);
  }
 }catch(error){
  try{await options.cancel();}catch(cleanup){throw new AggregateError([error,cleanup],'Real job wait and cancellation both failed');}
  throw error;
 }
}
