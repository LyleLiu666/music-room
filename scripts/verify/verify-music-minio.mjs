import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {CreateBucketCommand, S3Client} from '@aws-sdk/client-s3';
import {chromium} from 'playwright';
import {serveHttp} from '../../src/server/http.ts';
import {createWorkspaceBackup, restoreWorkspaceBackup} from '../../src/server/workspace-backup.ts';
import {ProjectStore} from '../../src/service/projects/store.ts';
import {testResources} from '../../src/service/resources/testing.ts';
import {MusicService} from '../../src/service/service.ts';

const docker = args => execFileSync('docker', args, {encoding: 'utf8', timeout: 30_000}).trim();
const testBinary = process.env.MUSIC_ROOM_TEST_BINARY;
const name = 'music-room-minio-test-' + randomUUID();
const root = await realpath(await mkdtemp(join(tmpdir(),'music-room-minio-test-')));
let started = false, paused = false, stopApp, browser, s3;
try {
  const accessKeyId = 'music-test', secretAccessKey = randomBytes(20).toString('hex');
  docker(['run','--pull=never','--detach','--rm','--name',name,'-p','127.0.0.1::9000',
    '-e','MINIO_ROOT_USER='+accessKeyId,'-e','MINIO_ROOT_PASSWORD='+secretAccessKey,
    process.env.MUSIC_ROOM_TEST_MINIO_IMAGE??'minio/minio:latest','server','/data']);
  started = true;
  const endpoint = 'http://' + docker(['port',name,'9000/tcp']);
  const bucket = 'music-room-test', prefix = 'isolated';
  for (let i = 0; ; i++) {
    if (await fetch(endpoint+'/minio/health/live', {signal:AbortSignal.timeout(1000)})
      .then(r=>r.ok,()=>false)) break;
    assert.ok(i < 60, 'isolated MinIO did not become ready');
    await new Promise(r=>setTimeout(r,250));
  }
  s3 = new S3Client({endpoint, region:'us-east-1', forcePathStyle:true, credentials:{accessKeyId,secretAccessKey}});
  await s3.send(new CreateBucketCommand({Bucket:bucket}));
  const home = join(root,'home');
  const workspace = join(home,'Music','MusicRoom'), engine = join(root,'engine'), id = 'a'.repeat(32);
  const configDir = join(home,'Library','Application Support','MusicRoom');
  await mkdir(configDir,{recursive:true,mode:0o700});
  process.env.HOME = home;
  for(const key of Object.keys(process.env))if(key.startsWith('MUSIC_ROOM_MINIO_'))delete process.env[key];
  let allowRelease = false;
  async function configure(directory){
    const name = directory===workspace?'minio.json':'minio-'+createHash('sha256').update(directory).digest('hex')+'.json';
    await writeFile(join(configDir,name),JSON.stringify({endpoint,bucket,prefix,accessKeyId,secretAccessKey,allowRelease}),{mode:0o600});
  }
  const song = join(engine,'data','songs',id,'song'), versionId = 'version-test', soundId = 'sound-test';
  const original = await readFile('src/service/studio/fixtures/tone-440hz.flac'), originalPath = join(song,'audio.flac');
  const hash = createHash('sha256').update(original).digest('hex');
  const rawPath = '/yue2-audio/'+id, objectPath = '/' + [bucket,prefix,id,hash+'.flac'].join('/');
  await mkdir(song,{recursive:true});
  await writeFile(join(engine,'.music-room-yue2.json'),'{"format":"music-room-yue2","version":1}');
  await writeFile(originalPath,original);
  await writeFile(join(song,'score.abc'),'X:1');
  const fixture = await ProjectStore.open(workspace);
  try {
    await fixture.createProject('minio-project','MinIO 验收项目');
    await mkdir(fixture.path('engines'),{recursive:true});
    fixture.atomicJSON(fixture.path('engines','yue2-jobs.json'),{version:1,jobs:[
      {job:{id,kind:'create',status:'done'},directory:engine,upstreamId:id,bytes:original.length,hash},
    ]});
    const createdAt = new Date().toISOString();
    fixture.atomicJSON(fixture.path('studio.json'),{format:'music-room-studio',version:1,
      sounds:[{id:soundId,kind:'music',title:'MinIO 验收音轨',projectId:'minio-project',createdAt,finalVersionId:versionId}],
      versions:[{id:versionId,soundId,number:1,createdAt,state:'succeeded',stage:'生成完成',kept:true,deleted:false,
        source:{kind:'music',id},audioPath:rawPath,duration:2}],
    });
  } finally { await fixture.close(); }

  const assets = {read:path=>readFile(resolve('dist',path)),has:path=>existsSync(resolve('dist',path)),embedded:false};
  let origin, headers;
  async function startApp(directory = workspace) {
    await configure(directory);
    let runtime;
    if (testBinary) {
      const binary = resolve(testBinary);
      execFileSync(binary,['start','--workspace',directory,'--port','0'],{cwd:root,timeout:35_000});
      stopApp = () => execFileSync(binary,['stop','--workspace',directory],{cwd:root,timeout:35_000});
      runtime = JSON.parse(await readFile(join(directory,'.music-room.runtime.json'),'utf8'));
    } else {
      const service = await MusicService.open(directory,()=>{throw Error('unexpected renderer');},assets.read,false,undefined,undefined,undefined,testResources());
      let app;
      stopApp = async () => { await app?.close(); await service.close(); };
      app = await serveHttp(service,assets);
      runtime = app.runtime;
    }
    origin = runtime.url;
    headers = {authorization:'Bearer '+runtime.token,'content-type':'application/json'};
  }
  await startApp();
  const playback = rawPath+'?playback=1';
  const request = (path,body) => fetch(origin+path,{headers,signal:AbortSignal.timeout(30_000),...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const call = async (path,body) => {
    const response = await request(path,body), result = await response.json();
    assert.equal(response.status,200,result.message);return result;
  };
  assert.equal((await fetch(origin+playback)).status,401);
  assert.deepEqual(await call(playback),{url:null});
  assert.equal((await request('/api/music-archive',{jobId:id,release:true})).status,403);
  assert.deepEqual(await call('/api/music-archive',{jobId:id}),{archived:true,local:true});
  assert.deepEqual(await readFile(originalPath),original);
  assert.equal((await fetch(endpoint+objectPath)).status,403);
  const signed = (await call(playback)).url;
  const partial = await fetch(signed,{headers:{range:'bytes=100-199'}});
  assert.equal(partial.status,206);
  assert.equal(partial.headers.get('content-range'),`bytes 100-199/${original.length}`);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()),original.subarray(100,200));

  browser = await chromium.launch({channel:'chrome',headless:true});
  const regressions = [];
  const offline = await browser.newPage();
  offline.setDefaultTimeout(12_000);
  await offline.route(endpoint+'/**',route=>route.abort());
  docker(['pause',name]);
  paused = true;
  try {
    await assert.rejects(fetch(endpoint+'/minio/health/live',{signal:AbortSignal.timeout(750)}));
    await offline.goto(origin);
    await offline.locator('[data-action=project][data-id=minio-project]').click();
    try {
      await offline.waitForFunction(()=>{
        const audio=document.querySelector('#version-audio');
        return audio?.src.startsWith('blob:')&&audio.readyState>=2;
      });
      await offline.locator('#version-audio').evaluate(audio=>audio.play());
    } catch(error) { regressions.push(new Error('Project player should play the local original during a MinIO outage',{cause:error})); }
    await offline.click('[data-action="sound-library"]');
    await offline.locator('[data-library-sound="'+versionId+'"]').click();
    try {
      await offline.waitForFunction(()=>{
        const audio=document.querySelector('#sound-library-audio');
        return audio?.src.startsWith('blob:')&&!audio.paused&&audio.readyState>=2;
      });
    } catch(error) { regressions.push(new Error('Listening queue should play the local original during a MinIO outage',{cause:error})); }
  } finally {
    docker(['unpause',name]);
    paused = false;
    await offline.close();
  }

  await stopApp();
  stopApp = undefined;
  allowRelease = true;
  await startApp();
  assert.deepEqual(await call('/api/music-archive',{jobId:id,release:true}),{archived:true,local:false});
  assert.equal(existsSync(originalPath),false);
  assert.deepEqual(Buffer.from(await (await request(rawPath)).arrayBuffer()),original);
  const mp3 = await request(rawPath+'?format=mp3');
  assert.equal(mp3.status,200);
  assert.equal(mp3.headers.get('content-type'),'audio/mpeg');
  assert.ok((await mp3.arrayBuffer()).byteLength>0);
  assert.equal((await call('/api/yue2_score',{jobId:id})).abc,'X:1');

  const page = await browser.newPage();
  page.setDefaultTimeout(12_000);

  const objectResponses = [], localAudioRequests = [];
  page.on('response',res=>{if(res.url().startsWith(endpoint+objectPath))objectResponses.push(res.status());});
  page.on('request',req=>{if(req.url()===origin+rawPath)localAudioRequests.push(req.url());});
  await page.goto(origin);
  await page.locator('[data-action=project][data-id=minio-project]').click();
  const player = page.locator('#version-audio');
  await player.waitFor();
  await page.waitForFunction(url=>document.querySelector('#version-audio')?.src.startsWith(url)&&
    document.querySelector('#version-audio').readyState>=1,endpoint+objectPath);
  await player.evaluate(async audio=>{await audio.play();audio.pause();audio.currentTime=1.2;});
  await page.waitForFunction(()=>{const a=document.querySelector('#version-audio');return !a.seeking&&Math.abs(a.currentTime-1.2)<0.05;});
  await page.click('[data-action="sound-library"]');
  await page.locator('[data-library-sound="'+versionId+'"]').click();
  await page.waitForFunction(url=>{const a=document.querySelector('#sound-library-audio');return a.src.startsWith(url)&&!a.paused&&a.readyState>=2;},endpoint+objectPath);
  assert.ok(objectResponses.includes(206),'Chrome received a partial FLAC directly from MinIO');
  assert.deepEqual(localAudioRequests,[],'both players avoided downloading FLAC through the app');

  await stopApp();
  stopApp = undefined;
  const backup = join(root,'backup'), restored = join(root,'restored');
  if(testBinary){
    const binary=resolve(testBinary);
    execFileSync(binary,['backup','--workspace',workspace,'--destination',backup],{cwd:root,timeout:35_000});
    execFileSync(binary,['restore-backup','--backup',backup,'--destination',restored],{cwd:root,timeout:35_000});
  }else{
    await createWorkspaceBackup({sourceDirectory:workspace,destinationDirectory:backup});
    await restoreWorkspaceBackup({backupDirectory:backup,destinationDirectory:restored});
  }
  await startApp(restored);
  assert.deepEqual(Buffer.from(await (await request(rawPath)).arrayBuffer()),original);
  assert.equal((await call('/api/yue2_score',{jobId:id})).abc,'X:1');

  await call('/api/studio_update_version',{versionId,deleted:true});
  assert.equal((await request(playback)).status,404);
  await call('/api/studio_update_version',{versionId,deleted:false});
  assert.ok((await call(playback)).url);
  await call('/api/studio_update_version',{versionId,deleted:true});
  await call('/api/studio_purge',{kind:'version',id:versionId});
  assert.equal((await request(playback)).status,404);
  await stopApp();
  stopApp = undefined;
  await startApp(workspace);
  try {
    const sourceAudio=await request(rawPath);
    assert.equal(sourceAudio.status,200,'purging the restore must leave the source audio readable');
    assert.deepEqual(Buffer.from(await sourceAudio.arrayBuffer()),original);
    assert.equal((await call('/api/yue2_score',{jobId:id})).abc,'X:1');
    const sourceRange=await fetch(signed,{headers:{range:'bytes=100-199'}});
    assert.equal(sourceRange.status,206);
    await sourceRange.arrayBuffer();
  } catch(error) { regressions.push(new Error('Purging the restored copy must preserve source audio and score',{cause:error})); }
  if(regressions.length)throw new AggregateError(regressions,'MinIO regressions');
  await call('/api/studio_update_version',{versionId,deleted:true});
  await call('/api/studio_purge',{kind:'version',id:versionId});
  assert.equal((await fetch(signed)).status,404);
  console.log((testBinary?'Standalone binary: ':'Source service: ')+'isolated MinIO and Chrome passed: private bucket, original checksum, direct Range, local playback during outage, seek, MP3, score, restored-copy isolation, trash restore and permanent delete.');
} finally {
  if(paused) docker(['unpause',name]);
  await browser?.close();
  await stopApp?.();
  s3?.destroy();
  if(started) docker(['stop','-t','2',name]);
  await rm(root,{recursive:true,force:true});
}
