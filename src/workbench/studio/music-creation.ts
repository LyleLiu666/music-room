import type {StudioInput} from '../../service/studio/studio.ts';
import type {ServiceCaller} from '../../service/operations.ts';
import {musicInputLimits} from '../../service/yue2/input.ts';
import {yue2Examples} from '../yue2-examples.ts';
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export function musicStyleGuide(){return `<details class="music-style-guide"><summary>风格怎么写？查看可填入的示例</summary><p class="field-note">依次描述：演唱语言、曲风与情绪、人声特点、主要乐器、编曲变化、速度。中文或英文均可；示例使用英文，方便直接修改。</p><p class="field-note">例如：Mandarin Chinese, warm female vocal, piano pop, soft strings, gentle verses, soaring chorus, 82 BPM。速度和音色是创作期望，需要试听确认。</p><label for="music-style-example">选择风格示例</label><select id="music-style-example">${yue2Examples.map((e,i)=>`<option value="${i}">${e.instrumental?'纯音乐':'演唱'} · ${escape(e.name)}</option>`).join('')}</select><p id="music-style-description" class="field-note"></p><pre id="music-style-preview"></pre><button type="button" class="secondary" id="fill-style-example">填入风格示例</button><p class="field-note">仅在风格为空时填入；不替换歌词，不切换作品形式。</p></details>`;}

export function musicExtraFields(d:StudioInput,canLoadScore:boolean){return `<section class="form-group" id="structure-wrap" ${d.instrumental===false?'hidden':''}><details ${d.structure?'open':''}><summary>纯音乐段落结构（可选）</summary><label class="sr-only" for="music-structure">纯音乐段落结构</label><textarea id="music-structure" rows="4" maxlength="${musicInputLimits.lyrics}" placeholder="[Intro]&#10;[Verse]&#10;[Chorus]&#10;[Outro]">${escape(d.structure)}</textarea><p class="field-note">用段落标签安排顺序，留空由模型安排。乐器和编曲要求写在风格栏；这里无需填写歌词。</p></details></section><details class="advanced music-control-options" ${d.seed!==undefined||d.abc?'open':''}><summary>对照生成与乐谱</summary><label for="music-seed">随机种子（可选）</label><input id="music-seed" type="number" min="0" max="2147483647" step="1" placeholder="留空，每次使用新的随机种子" value="${escape(d.seed??'')}"><p class="field-note">固定数字有助于对照风格修改；不能锁住旋律。实际使用的种子会随版本保存；清空可重新随机。</p><details id="music-abc-settings" ${d.abc?'open':''}><summary>ABC 乐谱（进阶）</summary><p class="field-note">默认由模型规划旋律与和弦。填写乐谱后直接使用这份谱子；请使用 YuE2 的 ABC 格式。修改会生成新版本，原作品保留。</p>${canLoadScore?'<button type="button" class="secondary" id="load-music-score">载入此版本乐谱副本</button>':''}<label class="sr-only" for="music-abc">ABC 乐谱</label><textarea id="music-abc" rows="8" maxlength="${musicInputLimits.abc}" spellcheck="false" placeholder="粘贴 YuE2 生成的 ABC 乐谱，在这里修改…">${escape(d.abc)}</textarea><p id="music-score-note" class="field-note" role="status"></p></details></details><p id="music-input-count" class="field-note"></p><p id="music-context-status" class="field-note" role="status"></p>`;}

export function readMusicExtraFields(form:HTMLFormElement,d:StudioInput){
 const seed=form.querySelector<HTMLInputElement>('#music-seed')!;
 if(seed.value!==''&&seed.validity.valid)d.seed=Number(seed.value);else delete d.seed;
 d.structure=form.querySelector<HTMLTextAreaElement>('#music-structure')!.value;
 d.abc=form.querySelector<HTMLTextAreaElement>('#music-abc')!.value;
 form.querySelector<HTMLElement>('#structure-wrap')!.hidden=d.instrumental===false;
}
export function musicRequest(d:StudioInput){return {style:d.text,lyrics:d.instrumental===false?d.lyrics??'':d.structure?.trim()||'[instrumental]',instrumental:d.instrumental!==false,ending:d.ending??'natural',abc:d.abc?.trim()||undefined};}

export function bindMusicCreation(form:HTMLFormElement,d:StudioInput,call:ServiceCaller,ready:boolean,sourceJob?:string){
 const style=form.querySelector<HTMLTextAreaElement>('#creation-text')!,status=form.querySelector<HTMLElement>('#music-context-status')!;
 const examples=form.querySelector<HTMLSelectElement>('#music-style-example')!,fill=form.querySelector<HTMLButtonElement>('#fill-style-example')!;
 const score=form.querySelector<HTMLTextAreaElement>('#music-abc')!,load=form.querySelector<HTMLButtonElement>('#load-music-score');
 let sequence=0,timer:ReturnType<typeof setTimeout>|undefined,lastKey='',lastIssue:string|undefined;
 const showExample=()=>{const example=yue2Examples[Number(examples.value)];form.querySelector('#music-style-description')!.textContent=example.description;form.querySelector('#music-style-preview')!.textContent=example.style;};
 examples.onchange=showExample;showExample();
 fill.onclick=()=>{if(style.value.trim())return;style.value=yue2Examples[Number(examples.value)].style;style.dispatchEvent(new Event('input',{bubbles:true}));style.focus();};
 if(load)load.onclick=async()=>{if(!sourceJob||score.value.trim())return;load.disabled=true;const note=form.querySelector('#music-score-note')!;note.textContent='正在读取乐谱副本…';try{const result=await call('yue2_score',{jobId:sourceJob});if(!form.isConnected)return;if(score.value.trim()){note.textContent='已保留你正在编辑的乐谱。';return;}score.value=result.abc;score.dispatchEvent(new Event('input',{bubbles:true}));note.textContent='已载入副本，可以编辑后生成新版本。';}catch(error){note.textContent=error instanceof Error?error.message:String(error);}finally{load.disabled=!!score.value.trim();}};
 async function inspect(submitting=false){
  if(!ready||!form.isConnected)return;
  const request=musicRequest(d),key=JSON.stringify(request);
  if(key===lastKey){if(submitting&&lastIssue)throw Error(lastIssue);return;}
  const seq=++sequence;status.textContent='正在检查模型输入容量…';
  try{const result=await call('yue2_inspect_input',request);
   if(submitting){if(!form.isConnected||key!==JSON.stringify(musicRequest(d)))throw Error('创作内容已改变，请重新提交。');if(result.context?.issue)throw Error(result.context.issue);}
   if(seq!==sequence||!form.isConnected)return;
   const c=result.context;lastKey=key;lastIssue=c?.issue;style.setCustomValidity(lastIssue??'');
   status.textContent=c?(c.issue??`输入 ${c.prefixTokens} token，连同规划与生成预留共 ${c.requiredTokens} / ${c.contextTokens} token。`):'提交时检查模型输入容量。';
   if(submitting&&lastIssue)throw Error(lastIssue);
  }catch(error){if(seq===sequence&&form.isConnected){lastKey='';status.textContent=error instanceof Error?error.message:String(error);}if(submitting)throw error;}
 }
 const update=()=>{fill.disabled=!!style.value.trim();if(load)load.disabled=!!score.value.trim();form.querySelector('#music-input-count')!.textContent=`风格 ${d.text.length} 个字符 · ${d.instrumental===false?'歌词 '+(d.lyrics?.length??0):'段落结构 '+(d.structure?.length??0)} 个字符。容量按模型实际分词检查，字符数不等于 token 数。`;if(JSON.stringify(musicRequest(d))===lastKey)return;sequence++;style.setCustomValidity('');if(timer)clearTimeout(timer);timer=setTimeout(()=>void inspect(),400);};
 form.addEventListener('input',update);form.addEventListener('change',update);update();
 return async()=>{if(timer)clearTimeout(timer);await inspect(true);};
}
