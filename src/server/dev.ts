import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {main} from './main.ts';
const root=new URL('../../dist/',import.meta.url);
const self=fileURLToPath(import.meta.url);
main(process.argv.slice(2),{read:path=>readFile(new URL(path,root)),has:path=>existsSync(new URL(path,root)),embedded:false},[self]).catch(error=>{console.error(error.message);process.exitCode=1;});
