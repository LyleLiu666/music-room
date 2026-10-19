import type {WorkbenchService} from '../service.ts';
import type {MusicEditDraft,MusicEditKind,MusicEditChange} from '../../service/studio/music-edits.ts';
import type {StudioVersion} from '../../service/studio/studio.ts';
import type {ScoreSummary} from '../../service/yue2/score.ts';
import './music-edits.css';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const fraction=(s:string)=>{const [a,b]=String(s).split('/').map(Number);return a/(b??1);};
const summary=(s:ScoreSummary)=>`${s.bpm} BPM · ${s.sections.length} 个段落 · 约 ${Math.round(s.nominal_duration_seconds)} 秒（按谱估算）`;
const download=(name:string,text:string)=>{const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
export function mountMusicEdits(host:HTMLElement,api:WorkbenchService,version:StudioVersion,initial:MusicEditKind,generated:(v:StudioVersion)=>Promise<void>){
 let draft:MusicEditDraft,disposed=false,loading=0,busy=false,dirty=false,audio:AudioContext|undefined;
 const $=<T extends HTMLElement=HTMLElement>(selector:string)=>host.querySelector<T>(selector)!;
 const key=(kind:MusicEditKind)=>`music-room-edit:${api.bootstrap.workspace}:${version.id}:${kind}`;
 const stop=()=>{const old=audio;audio=undefined;if(old&&old.state!=='closed')void old.close();};
 async function play(s:ScoreSummary){stop();audio=new AudioContext();const context=audio;await context.resume();if(disposed||audio!==context)return;const at=context.currentTime+.1,seconds=60/s.bpm;let count=0,end=0;
  for(const voice of Object.values(s.voices))for(const n of voice.notes){const start=fraction(n.onset_quarters)*seconds,duration=Math.min(fraction(n.duration_quarters)*seconds,120-start);if(start>=120||duration<=0||count++>=2000)continue;end=Math.max(end,start+duration);const oscillator=context.createOscillator(),gain=context.createGain();oscillator.type='triangle';oscillator.frequency.value=440*2**((n.midi_pitch-69)/12);gain.gain.setValueAtTime(0,at+start);gain.gain.linearRampToValueAtTime(.08,at+start+Math.min(.01,duration/3));gain.gain.setValueAtTime(.08,at+start+Math.max(duration/3,duration-.03));gain.gain.linearRampToValueAtTime(0,at+start+duration);oscillator.connect(gain).connect(context.destination);oscillator.start(at+start);oscillator.stop(at+start+duration+.01);}
  setTimeout(()=>{if(audio===context)stop();},(end+.3)*1000);
 }
 function notice(text:string,error=false){const node=$('#edit-notice');if(node){node.textContent=text;node.classList.toggle('error',error);}}
 async function run(action:()=>Promise<void>){if(busy||disposed)return;busy=true;controls();try{await action();}catch(e){if(!disposed)notice((e as Error).message,true);}finally{busy=false;if(!disposed)controls();}}
 function controls(){const fields=$<HTMLFieldSetElement>('#edit-fields');if(fields)fields.disabled=busy;const generate=$<HTMLButtonElement>('#edit-generate');if(generate)generate.disabled=busy||dirty||!draft?.candidate;const selector=$<HTMLSelectElement>('#edit-kind');if(selector)selector.disabled=busy;}
 const fields=()=>Object.fromEntries([...host.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('[data-edit-field]')].map(n=>[n.id,n.value]));
 function remember(){try{localStorage.setItem(key(draft.kind),JSON.stringify(fields()));}catch{/* The checked draft is still saved by the service. */}}
 function markDirty(event:Event){remember();if((event.target as HTMLElement).id!=='edit-instruction'){dirty=true;stop();result();notice('内容已更改，请重新检查并保存草稿。');controls();}}
 function change():MusicEditChange{
  switch(draft.kind){case 'transfer':return {kind:'transfer',overlap:$<HTMLSelectElement>('#edit-overlap').value as 'error'|'vocal'};
   case 'harmony':return {kind:'harmony',abc:$<HTMLTextAreaElement>('#edit-abc').value};
   case 'tempo':return {kind:'tempo',bpm:Number($<HTMLInputElement>('#edit-bpm').value)};
   case 'section':return {kind:'section',index:Number($<HTMLSelectElement>('#edit-section').value),action:$<HTMLSelectElement>('#edit-section-action').value as 'repeat'|'delete'};}
 }
 function render(){
  const candidate=draft.candidate,c=candidate?.change;
  host.innerHTML=`<div class="music-editor"><p class="form-intro">基于 V${draft.sourceNumber} 修改。检查通过的草稿会保存在本机；生成后作为同一作品的新版本，可在版本列表里比较和选为成品。</p>${initial==='transfer'?'':`<label for="edit-kind">修改范围</label><select id="edit-kind"><option value="harmony">只改和弦 · 交给 AI / LLM</option><option value="tempo">只改速度 · 直接设置</option><option value="section">重复或删除段落 · 直接设置</option></select>`}
  <div class="music-edit-columns"><form id="music-edit-form"><fieldset id="edit-fields"><legend>${initial==='transfer'?'转为器乐演奏':'修改乐谱'}</legend>
  ${draft.kind==='transfer'?`<p>把谱中人声声部的主旋律转到器乐声部，并使用纯音乐设置生成。</p><label for="edit-overlap">旋律与已有器乐重叠时</label><select id="edit-overlap" data-edit-field><option value="error">先提示冲突，保留原有器乐</option><option value="vocal">优先主旋律，替换重叠的器乐音符</option></select><p class="field-note">“优先主旋律”会改动重叠处的原有器乐，请先试听乐谱。</p>`:''}
  ${draft.kind==='harmony'?`<label for="edit-instruction">给 AI / LLM 的修改要求</label><textarea id="edit-instruction" data-edit-field rows="3" maxlength="10000" placeholder="例如：保持旋律不变，把和声调整得更明亮。"></textarea><div class="music-edit-buttons"><button type="button" class="secondary" id="edit-copy">复制要求与原谱</button><button type="button" class="quiet" id="edit-export">下载要求与原谱</button></div><p class="field-note">交给你使用的任意 AI / LLM，取回完整 ABC 后粘贴或导入。这里不会自动调用 AI，无需安装特定应用。</p><label for="edit-abc">AI 返回的完整 ABC</label><textarea id="edit-abc" data-edit-field rows="7" maxlength="100000" required spellcheck="false" placeholder="粘贴完整乐谱文本"></textarea><label class="music-edit-file">或导入 ABC 文件<input id="edit-file" type="file" accept=".abc,.txt,text/plain"></label>`:''}
  ${draft.kind==='tempo'?`<label for="edit-bpm">新速度（BPM）</label><input id="edit-bpm" data-edit-field type="number" min="20" max="300" step="1" required value="${c?.kind==='tempo'?c.bpm:draft.summary.bpm}"><p class="field-note">只修改谱的速度，音符和和弦保持不变，再由音乐模型生成新版本。</p>`:''}
  ${draft.kind==='section'?`<label for="edit-section">选择段落</label><select id="edit-section" data-edit-field>${draft.summary.sections.map((s,i)=>`<option value="${i}">${i+1}. ${esc(s.label)}</option>`).join('')}</select><label for="edit-section-action">操作</label><select id="edit-section-action" data-edit-field><option value="repeat">在原段落后再重复一次</option><option value="delete">删除这个段落</option></select><p class="field-note">同步处理对应歌词。段落标记不完整或歌词无法逐段对应时，会说明原因。</p>`:''}
  <label for="edit-style">新版的创作要求</label><textarea id="edit-style" data-edit-field rows="3" required maxlength="100000">${esc(candidate?.input.text??draft.sourceInput.text)}</textarea><p class="field-note">${draft.kind==='transfer'?'新版固定使用纯音乐设置，不沿用原歌词。请在描述里写明希望由什么乐器演奏。':`沿用原版的${draft.sourceInput.instrumental?'纯音乐':'带歌词音乐'}设置、随机种子与生成质量。`}</p><button id="edit-prepare" class="secondary" type="submit">检查并保存草稿</button></fieldset></form>
  <section class="music-edit-preview"><h3>原谱 · V${draft.sourceNumber}</h3><p>${summary(draft.summary)}</p><div class="music-edit-buttons"><button id="edit-play-source" class="quiet" type="button">试听原谱</button><button id="edit-stop" class="quiet" type="button">停止</button><button id="edit-download-source" class="quiet" type="button">下载原谱 ABC</button></div><div id="edit-result"></div><p class="field-note">简易试听用合成音播放前 120 秒的旋律音符，用于核对音符和节奏，不播放和弦伴奏，也不是最终音色。最终效果请生成后试听。</p><details><summary>查看原始 ABC</summary><pre class="music-edit-code">${esc(draft.sourceAbc)}</pre></details></section></div>
  <p id="edit-notice" role="status" aria-live="polite"></p><div class="music-edit-footer"><span>原版及已选成品保持不变</span><button id="edit-generate" class="primary" type="button">生成新版本</button></div></div>`;
  if(initial!=='transfer'){$<HTMLSelectElement>('#edit-kind').value=draft.kind;$('#edit-kind').onchange=()=>void load($<HTMLSelectElement>('#edit-kind').value as MusicEditKind);}
  if(c?.kind==='transfer')$<HTMLSelectElement>('#edit-overlap').value=c.overlap;
  if(draft.kind==='harmony')$<HTMLTextAreaElement>('#edit-abc').value=candidate?.abc??'';
  if(c?.kind==='section'){$<HTMLSelectElement>('#edit-section').value=String(c.index);$<HTMLSelectElement>('#edit-section-action').value=c.action;}
  dirty=false;
  try{const saved=JSON.parse(localStorage.getItem(key(draft.kind))??'{}');for(const [id,value] of Object.entries(saved)){const field=host.querySelector<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('#'+CSS.escape(id));if(field&&field.hasAttribute('data-edit-field')&&typeof value==='string'){if(field.value!==value&&id!=='edit-instruction')dirty=true;field.value=value;}}}catch{}
  for(const field of host.querySelectorAll<HTMLElement>('[data-edit-field]'))field.oninput=markDirty;
  $('#music-edit-form').onsubmit=e=>{e.preventDefault();void run(async()=>{
   stop();const next=await api.call('studio_music_edit_prepare',{draftId:draft.id,revision:draft.revision,style:$<HTMLTextAreaElement>('#edit-style').value,change:change()});if(disposed)return;draft=next;dirty=false;
   if(draft.kind==='harmony')$<HTMLTextAreaElement>('#edit-abc').value=draft.candidate!.abc;
   remember();result();notice('检查通过，草稿已保存。可以试听乐谱，再生成新版本。');
  });};
  $('#edit-generate').onclick=()=>void run(async()=>{stop();notice('正在提交生成任务…');const v=await api.call('studio_music_edit_generate',{draftId:draft.id,revision:draft.revision});if(!disposed)await generated(v);});
  $('#edit-play-source').onclick=()=>void run(()=>play(draft.summary));$('#edit-stop').onclick=stop;
  $('#edit-download-source').onclick=()=>download(`V${draft.sourceNumber}-原谱.abc`,draft.sourceAbc);
  if(draft.kind==='harmony'){
   const brief=()=>{const instruction=$<HTMLTextAreaElement>('#edit-instruction').value.trim();if(!instruction)throw Error('请先填写给 AI / LLM 的修改要求');return api.call('studio_music_edit_brief',{draftId:draft.id,instruction});};
   $('#edit-copy').onclick=()=>void run(async()=>{const b=await brief();await navigator.clipboard.writeText(b.text);notice('已复制，请交给你使用的 AI / LLM。');});
   $('#edit-export').onclick=()=>void run(async()=>{const b=await brief();download(`V${draft.sourceNumber}-AI改谱要求.txt`,b.text);notice('已导出要求与原谱。');});
   $('#edit-file').onchange=()=>void run(async()=>{const file=$<HTMLInputElement>('#edit-file').files?.[0];if(!file)return;if(file.size>400000)throw Error('ABC 文件过大');const text=await file.text();if(text.length>100000)throw Error('ABC 超过允许长度');if(disposed)return;$<HTMLTextAreaElement>('#edit-abc').value=text;dirty=true;remember();notice('已导入，请检查并保存草稿。');});
  }
  result();notice(dirty?'已恢复未检查的修改，请重新检查。':candidate?'已恢复检查通过的草稿。':'先设置修改内容，再检查并保存草稿。');controls();
 }
 function result(){const c=draft.candidate;$('#edit-result').innerHTML=c?`<h3>${dirty?'上次已检查的草稿':'新版草稿'}</h3><p>${summary(c.summary)}</p><p>${c.input.instrumental?'纯音乐 · 不带歌词':'带歌词音乐'} · 已通过乐谱约束检查</p><div class="music-edit-buttons"><button class="secondary" id="edit-play-result" type="button">试听新版乐谱</button><button class="quiet" id="edit-download-result" type="button">下载新版 ABC</button></div><details><summary>查看新版 ABC</summary><pre class="music-edit-code">${esc(c.abc)}</pre></details>`:'<h3>新版草稿</h3><p class="field-note">检查通过后，这里会显示修改后的乐谱摘要。</p>';
  if(c){$('#edit-play-result').onclick=()=>void run(()=>play(c.summary));$('#edit-download-result').onclick=()=>download(`V${draft.sourceNumber}-修改草稿.abc`,c.abc);}
 }
 async function load(kind:MusicEditKind){const ticket=++loading;stop();host.innerHTML='<p role="status">正在读取此版本保存的乐谱…</p>';try{const value=await api.call('studio_music_edit_open',{versionId:version.id,kind});if(disposed||ticket!==loading)return;draft=value;render();}catch(e){if(!disposed&&ticket===loading)host.innerHTML=`<p role="alert">${esc((e as Error).message)}</p><p class="field-note">只有已保存且可读取的 ABC 乐谱才能用于改谱；音频文件本身不等于乐谱。</p>`;}}
 void load(initial);
 return {dispose:()=>{disposed=true;loading++;stop();}};
}
