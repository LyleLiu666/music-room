import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const assets=resolve(process.argv[2]??'test-results/speed-native-trial');
const html=join(dirname(fileURLToPath(import.meta.url)),'index.html');
const allowed=new Set(['original-v16.wav','old-saved-v17.wav','voice-085-apple.wav']);
const server=createServer(async(req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
 if(name!=='index.html'&&!allowed.has(name)){res.writeHead(404).end();return;}
 try{const bytes=await readFile(name==='index.html'?html:join(assets,name));res.writeHead(200,{'content-type':name.endsWith('.wav')?'audio/wav':'text/html; charset=utf-8','content-length':bytes.length,'cache-control':'no-store'});res.end(bytes);}catch{res.writeHead(404).end();}
});
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));
