import {runYuE2Worker} from './worker.ts';
runYuE2Worker().catch(error=>{console.error(error.message);process.exitCode=1;});
