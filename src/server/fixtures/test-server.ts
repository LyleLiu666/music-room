// Test-only executable: real HTTP, MCP, background processes and rendering,
// with deterministic admission. Never imported by either production entry point.
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {main} from '../main.ts';
import {testResources} from '../../service/resources/testing.ts';
const root=new URL('../../../dist/',import.meta.url),self=fileURLToPath(import.meta.url);
main(process.argv.slice(2),{read:path=>readFile(new URL(path,root)),has:path=>existsSync(new URL(path,root)),embedded:false},[self],testResources).catch(error=>{console.error(error);process.exitCode=1;});
