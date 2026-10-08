import {readFile} from 'node:fs/promises';
import {runRenderWorker} from './worker.ts';
runRenderWorker(path=>readFile(new URL(`../../../public/${path}`,import.meta.url))).catch(error=>{console.error(error.message);process.exitCode=1;});
