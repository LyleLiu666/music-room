import {runSpeedWorker} from './speed-process.ts';
runSpeedWorker().catch(error=>{console.error(error.message);process.exitCode=1;});
