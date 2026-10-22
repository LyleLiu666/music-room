import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {encodeWav} from '../src/wav.ts';

for(const mode of ['blob-quota','retry'])test(`audio loading remains playable after ${mode}`,async()=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'},plugins:[{name:'bootstrap',transformIndexHtml:html=>html.replace('</head>','<script id="music-room-service" type="application/json">{"token":"test","workspace":"loading-player"}</script></head>')}]});await server.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();page.setDefaultTimeout(4000);
 let attempts=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const version={id:'v2',soundId:'s',number:2,state:'succeeded',stage:'已完成',source:{kind:'music',id:'job'},audioPath:'/audio/song.wav',input:{soundId:'s',text:'piano',instrumental:true}};
 await page.addInitScript(()=>{const original=Response.prototype.blob;Response.prototype.blob=function(){if(this.url.includes('/audio/'))return Promise.reject(new TypeError('Failed to fetch'));return original.call(this);};});
 await page.route('**/audio/**',async route=>{attempts++;if(mode==='retry'&&attempts===1)return route.abort('failed');await route.fulfill({contentType:'audio/wav',body:Buffer.from(encodeWav([new Float32Array(22050*3)],22050))});});
 await page.route('**/api/**',route=>{const name=route.request().url().split('/').at(-1);if(name==='resource_status')return route.fulfill({json:{queued:[],paused:false}});return route.fulfill({json:{projects:[{id:'p',title:'音乐'}],sounds:[{id:'s',projectId:'p',title:'歌曲',kind:'music'}],versions:[version],voices:[],conversionVoices:[],engines:{speech:{logs:[]},music:{canGenerate:true,logs:[]},conversion:{}}}});});
 try{
  await page.goto(server.resolvedUrls.local[0]);if(mode==='retry'){await page.locator('#audio-placeholder').getByText('音频读取失败').waitFor();await page.getByRole('button',{name:'重新读取',exact:true}).click();}
  await page.waitForFunction(()=>document.querySelector('#version-audio')?.readyState>=2);
  assert.equal(await page.locator('#audio-placeholder').isVisible(),false);
  await page.locator('#version-audio').evaluate(a=>a.play());await page.waitForFunction(()=>!document.querySelector('#version-audio').paused&&document.querySelector('#version-audio').currentTime>0);assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
