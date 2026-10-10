import {runCommandWorker} from './commands.ts';
runCommandWorker().catch(error=>{console.error(error.message);process.exitCode=1;});
