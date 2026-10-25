import './sound-library.css';
import type {LibrarySound} from '../../service/studio/sound-library.ts';
import type {CatalogEntry,PlaylistSummary} from '../../service/studio/sound-catalog.ts';
import type {OperationResults} from '../../service/operations.ts';
import type {WorkbenchService} from '../service.ts';
import type {ListeningQueue} from './listening-queue.ts';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const time=(n?:number)=>n===undefined?'':`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
type Hooks={api:WorkbenchService;workspace:HTMLElement;queue:ListeningQueue;modal:(title:string,html:string)=>void;close:()=>void;notify:(text:string)=>void;refresh:()=>Promise<void>;url:(path:string)=>Promise<string>;open:(item:Extract<LibrarySound,{origin:'generated'}>)=>Promise<void>};
/** Browsing is paged; listening belongs to the persistent global queue. */
export class SoundLibraryView{
 private loading=false;private hooks:Hooks;private selected='';private playingId='';private query='';private filter:'all'|'final'|'kept'|'imported'='all';private sort:'newest'|'oldest'|'title'='newest';private page=1;private size:20|50=20;private tab='all';private playlistId='';private revision='';private request=0;private selection=new Set<string>();private result?:OperationResults['sound_library_page'];private searchTimer?:ReturnType<typeof setTimeout>;
 constructor(hooks:Hooks){this.hooks=hooks;hooks.queue.subscribe(()=>{if(this.playingId!==hooks.queue.currentId){this.playingId=hooks.queue.currentId;this.selected=this.playingId;}this.highlight();this.preview();});}
 render(revision=''){
  const root=this.hooks.workspace;
  if(!root.querySelector('#sound-library')){
   root.innerHTML=`<section id="sound-library">
    <header class="sound-library-header">
     <div class="sound-library-title"><h1>声音库</h1><span id="sound-library-count"></span></div>
     <nav class="library-tabs" aria-label="声音库视图"><button data-library-tab="all">全部声音</button><button data-library-tab="playlists">播放列表</button></nav>
     <button class="primary" id="import-library-sound">＋ 外部导入</button>
    </header>
    <div id="sound-library-browser">
     <div class="sound-library-controls">
      <label class="library-search"><input id="sound-library-search" type="search" aria-label="查找声音" placeholder="搜索声音或来源项目"></label>
      <label><select id="sound-library-filter" aria-label="收录类型"><option value="all">全部类型</option><option value="final">成品</option><option value="kept">灵感</option><option value="imported">外部导入</option></select></label>
      <label><select id="sound-library-sort" aria-label="排序"><option value="newest">最新创建</option><option value="oldest">最早创建</option><option value="title">名称顺序</option></select></label>
      <div id="sound-library-toolbar" class="library-toolbar"></div>
     </div>
     <div id="sound-library-context" class="library-toolbar" hidden></div>
     <section id="sound-library-preview" aria-label="声音库试听" hidden><div class="sound-library-preview-heading"><div><h2 id="sound-library-preview-title"></h2><p id="sound-library-preview-source" class="muted"></p></div><button class="quiet" id="sound-library-download">↓ 下载 MP3</button><button class="quiet" id="sound-library-download-original">下载原文件</button><button class="quiet" id="sound-library-open">查看来源版本 ↗</button></div></section>
     <p id="sound-library-status" role="status" hidden></p><div id="sound-library-list" class="sound-library-list" aria-label="已收录声音"></div><footer id="sound-library-pagination" class="library-pagination"></footer>
    </div><div id="sound-playlists" hidden></div>
   </section>`;
   const search=root.querySelector<HTMLInputElement>('#sound-library-search')!,filter=root.querySelector<HTMLSelectElement>('#sound-library-filter')!,sort=root.querySelector<HTMLSelectElement>('#sound-library-sort')!;search.value=this.query;filter.value=this.filter;sort.value=this.sort;
   search.oninput=()=>{this.query=search.value;this.loading=true;this.page=1;clearTimeout(this.searchTimer);this.searchTimer=setTimeout(()=>void this.load(),180);};filter.onchange=()=>{this.filter=filter.value as typeof this.filter;this.page=1;void this.load();};sort.onchange=()=>{this.sort=sort.value as typeof this.sort;this.page=1;void this.load();};
   root.querySelector('#sound-library')!.addEventListener('click',e=>this.click(e));
   root.querySelector('#sound-library')!.addEventListener('change',e=>{const input=e.target as HTMLInputElement;if(input.matches('[data-library-select]')){if(input.checked)this.selection.add(input.dataset.librarySelect!);else this.selection.delete(input.dataset.librarySelect!);this.toolbar();}});
   root.querySelector<HTMLButtonElement>('#import-library-sound')!.onclick=()=>this.importDialog();
   root.querySelector<HTMLButtonElement>('#sound-library-download')!.onclick=()=>void this.run(()=>this.download());root.querySelector<HTMLButtonElement>('#sound-library-download-original')!.onclick=()=>void this.run(()=>this.download(true));
   root.querySelector<HTMLButtonElement>('#sound-library-open')!.onclick=()=>{const item=this.current();if(item?.origin==='generated')void this.run(()=>this.hooks.open(item));};
   void this.load();
  }else if(revision&&revision!==this.revision)void this.load();
 }
 private async run(fn:()=>Promise<unknown>){try{await fn();}catch(error){this.hooks.notify((error as Error).message);}}
 private options(){return {query:this.query,filter:this.filter,sort:this.sort,...(this.playlistId?{playlistId:this.playlistId}:{})};}
 private async load(){
  this.loading=true;const request=++this.request,root=this.hooks.workspace,section=root.querySelector('#sound-library');if(!section)return;
  try{const result=await this.hooks.api.call('sound_library_page',{...this.options(),page:this.page,pageSize:this.size});if(request!==this.request||!section.isConnected)return;this.loading=false;this.result=result;this.page=result.page;this.revision=result.revision;root.querySelector('#sound-library-count')!.textContent=`${result.libraryTotal} 个声音`;root.querySelector<HTMLElement>('#sound-library-status')!.hidden=true;this.rows();this.playlists();this.visibility();this.preview();}
  catch(error){if(request!==this.request||!section.isConnected)return;this.loading=false;const status=root.querySelector<HTMLElement>('#sound-library-status')!;status.hidden=false;status.textContent=(error as Error).message;const retry=document.createElement('button');retry.className='quiet';retry.textContent='重新读取';retry.onclick=()=>void this.load();status.append(retry);}
 }
 private visibility(){const root=this.hooks.workspace;root.querySelector<HTMLElement>('#sound-library-browser')!.hidden=this.tab==='playlists'&&!this.playlistId;root.querySelector<HTMLElement>('#sound-playlists')!.hidden=this.tab!=='playlists'||!!this.playlistId;root.querySelector<HTMLSelectElement>('#sound-library-sort')!.parentElement!.hidden=!!this.playlistId;root.querySelectorAll<HTMLButtonElement>('[data-library-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.libraryTab===this.tab)));}
 private source(item:LibrarySound){return item.origin==='generated'?`${item.projectTitle} / V${item.number}`:`外部导入 · ${item.filename}`;}
 private current(){return this.result?.items.find(i=>i.id===this.selected)?.item??(this.hooks.queue.currentId===this.selected?this.hooks.queue.current?.item:null);}
 private preview(){
  const root=this.hooks.workspace,preview=root.querySelector<HTMLElement>('#sound-library-preview');if(!preview)return;const item=this.current();preview.hidden=!item;if(!item)return;
  root.querySelector('#sound-library-preview-title')!.textContent=item.title;root.querySelector('#sound-library-preview-source')!.textContent=this.source(item);root.querySelector<HTMLButtonElement>('#sound-library-open')!.hidden=item.origin!=='generated';
 }
 private highlight(){this.hooks.workspace.querySelectorAll<HTMLElement>('[data-library-sound]').forEach(b=>{b.classList.toggle('selected',b.dataset.librarySound===this.selected);b.setAttribute('aria-pressed',String(b.dataset.librarySound===this.selected));});}
 private toolbar(){
  const root=this.hooks.workspace,host=root.querySelector('#sound-library-toolbar');if(!host||!this.result)return;const playlist=this.result.playlists.find(p=>p.id===this.playlistId);
  host.innerHTML=`<div class="library-play-group"><button class="secondary" data-library-action="play-all" ${this.result.total?'':'disabled'}>${this.query||this.filter!=='all'?'播放筛选结果':'播放全部'}</button><details><summary aria-label="列表播放选项">⌄</summary><div><button data-library-action="play-in-order" ${this.result.total?'':'disabled'}>顺序播放</button><button data-library-action="shuffle-all" ${this.result.total?'':'disabled'}>随机播放</button></div></details></div>`;
  const context=root.querySelector<HTMLElement>('#sound-library-context')!;context.hidden=!playlist&&!this.selection.size;
  context.innerHTML=`${playlist?`<button class="quiet" data-library-action="back">‹ 播放列表</button><strong>${esc(playlist.title)}</strong><button class="quiet" data-library-action="rename">重命名</button>`:''}${this.selection.size?`<button class="secondary" data-library-action="add-playlist">加入播放列表（${this.selection.size}）</button><button class="quiet" data-library-action="clear-selection">取消选择</button>`:''}`;
 }
 private rows(){
  if(!this.result)return;const root=this.hooks.workspace;
  root.querySelector('#sound-library-list')!.innerHTML=this.result.items.length?this.result.items.map(({id,title,item})=>`<div class="sound-library-row"><input type="checkbox" data-library-select="${esc(id)}" aria-label="选择 ${esc(title)}" ${this.selection.has(id)?'checked':''} ${item?'':'disabled'}><button class="sound-library-card ${id===this.selected?'selected':''}" data-library-sound="${esc(id)}" aria-pressed="${id===this.selected}" ${item?'':'disabled'}><span class="sound-library-play" aria-hidden="true">▶</span><span class="sound-library-copy"><strong>${esc(title)}${item?.origin==='generated'?` <small>V${item.number}</small>`:''}</strong><span>${item?esc(this.source(item)):'声音已不可用，原有位置保留'}</span></span><span class="sound-library-tags">${item?.origin==='imported'?'<span class="tag">外部导入</span>':item?.origin==='generated'?`${item.final?'<span class="tag final">成品</span>':''}${item.kept?'<span class="tag">灵感</span>':''}`:'<span class="tag">不可用</span>'}</span><time>${time(item?.duration)}</time></button><div class="sound-row-actions">${this.playlistId?`<button data-library-action="up" data-id="${esc(id)}" aria-label="上移 ${esc(title)}">↑</button><button data-library-action="down" data-id="${esc(id)}" aria-label="下移 ${esc(title)}">↓</button><button data-library-action="remove" data-id="${esc(id)}" aria-label="从播放列表移除 ${esc(title)}">×</button>`:`<details><summary aria-label="${esc(title)}更多操作">⋯</summary><div><button data-library-action="next" data-id="${esc(id)}">下一首播放</button><button data-library-action="enqueue" data-id="${esc(id)}">加入播放队列</button><button data-library-action="add-one" data-id="${esc(id)}">添加到播放列表</button></div></details>`}</div></div>`).join(''):`<div class="empty-sound"><span>♫</span><h2>${this.playlistId?'播放列表还没有声音':this.result.libraryTotal?'没有找到符合条件的声音':'还没有收录声音'}</h2><p>在全部声音中勾选并添加，或调整查找条件。</p></div>`;
  root.querySelector('#sound-library-pagination')!.innerHTML=`<span>共 ${this.result.total} 项</span><label>每页 <select aria-label="声音库每页数量"><option ${this.size===20?'selected':''}>20</option><option ${this.size===50?'selected':''}>50</option></select> 项</label><nav aria-label="声音分页"><button class="quiet" data-library-action="page" data-page="${this.page-1}" aria-label="上一页声音" ${this.page===1?'disabled':''}>‹</button><span>${this.page} / ${this.result.totalPages}</span><button class="quiet" data-library-action="page" data-page="${this.page+1}" aria-label="下一页声音" ${this.page===this.result.totalPages?'disabled':''}>›</button></nav>`;
  root.querySelector<HTMLSelectElement>('[aria-label="声音库每页数量"]')!.onchange=e=>{this.size=Number((e.target as HTMLSelectElement).value) as 20|50;this.page=1;void this.load();};this.toolbar();
 }
 private playlists(){const host=this.hooks.workspace.querySelector('#sound-playlists');if(!host||!this.result)return;host.innerHTML=`<div class="library-toolbar saved-playlists-toolbar"><button class="secondary" data-library-action="new-playlist">新建播放列表</button></div><div class="saved-playlists">${this.result.playlists.map(p=>`<article><button class="playlist-title" data-library-action="open-playlist" data-id="${esc(p.id)}">${esc(p.title)}</button><span>${p.count} 首</span><button class="quiet" data-library-action="rename-list" data-id="${esc(p.id)}">重命名</button><button class="quiet danger" data-library-action="delete-playlist" data-id="${esc(p.id)}">删除</button></article>`).join('')||'<p class="field-note">创建一个播放列表，把喜欢的具体版本放在一起。</p>'}</div>`;}
 private click(e:Event){
  const b=(e.target as HTMLElement).closest<HTMLElement>('button');if(!b)return;
  if(b.dataset.libraryTab){this.tab=b.dataset.libraryTab;this.playlistId='';this.query='';this.filter='all';this.page=1;this.resetControls();void this.load();return;}
  if(b.dataset.librarySound){if(this.loading){this.hooks.notify('列表正在更新，请稍候');return;}const id=b.dataset.librarySound;void this.run(async()=>{this.selected=id;this.highlight();this.preview();await this.hooks.queue.play(this.options(),id);});return;}
  const action=b.dataset.libraryAction,id=b.dataset.id;
  if(action==='page'){this.page=Number(b.dataset.page);void this.load();}else if(action==='play-all'||action==='shuffle-all'||action==='play-in-order'){const menu=b.closest('details');if(menu)menu.open=false;void this.run(async()=>{await this.hooks.queue.play(this.options(),undefined,action==='shuffle-all'?'shuffle':action==='play-in-order'?'order':undefined);});}
  else if(action==='enqueue'||action==='next')this.hooks.queue.enqueue([id!],action==='next');else if(action==='clear-selection'){this.selection.clear();this.rows();}
  else if(action==='new-playlist')this.nameDialog();else if(action==='rename'||action==='rename-list')this.nameDialog(this.result?.playlists.find(p=>p.id===(id??this.playlistId)));
  else if(action==='open-playlist'){this.tab='playlists';this.playlistId=id!;this.query='';this.filter='all';this.page=1;this.selection.clear();this.resetControls();void this.load();}
  else if(action==='back'){this.playlistId='';void this.load();}else if(action==='add-playlist'||action==='add-one')this.addDialog(action==='add-one'?[id!]:[...this.selection]);
  else if(action==='up'||action==='down'||action==='remove')void this.run(()=>this.editOrder(id!,action));else if(action==='delete-playlist')this.deleteDialog(id!);
 }
 private resetControls(){const root=this.hooks.workspace;const search=root.querySelector<HTMLInputElement>('#sound-library-search'),filter=root.querySelector<HTMLSelectElement>('#sound-library-filter');if(search)search.value=this.query;if(filter)filter.value=this.filter;}
 private async playlistIds(id:string){return (await this.hooks.api.call('sound_library_queue',{playlistId:id})).ids;}
 private async editOrder(id:string,action:string){
  const playlist=this.result!.playlists.find(p=>p.id===this.playlistId)!;if(this.query||this.filter!=='all'){this.hooks.notify('请清空查找条件后调整完整列表顺序');return;}
  const ids=await this.playlistIds(playlist.id),index=ids.indexOf(id),next=index+(action==='up'?-1:1);if(index<0)return;
  if(action==='remove')ids.splice(index,1);else{if(next<0||next>=ids.length)return;[ids[index],ids[next]]=[ids[next],ids[index]];}
  await this.hooks.api.call('sound_playlist_save',{id:playlist.id,title:playlist.title,revision:playlist.revision,ids});await this.load();
 }
 private nameDialog(playlist?:PlaylistSummary){
  this.hooks.modal(playlist?'重命名播放列表':'新建播放列表',`<form id="playlist-name-form"><label for="playlist-name">播放列表名称</label><input id="playlist-name" maxlength="120" required value="${esc(playlist?.title??'')}" placeholder="例如：写代码时听"><button class="primary" type="submit">保存播放列表</button><p role="status" class="field-note"></p></form>`);
  const form=document.querySelector<HTMLFormElement>('#playlist-name-form')!,newId=playlist?.id??`playlist-${crypto.randomUUID()}`;form.onsubmit=e=>{e.preventDefault();void this.submit(form,async()=>{await this.hooks.api.call('sound_playlist_save',{id:newId,title:form.querySelector<HTMLInputElement>('input')!.value.trim(),revision:playlist?.revision??0,ids:playlist?await this.playlistIds(playlist.id):[]});this.hooks.close();await this.load();});};
 }
 private addDialog(ids:string[]){
  const lists=this.result?.playlists??[];this.hooks.modal('添加到播放列表',`<form id="playlist-add-form"><label for="playlist-target">选择播放列表</label><select id="playlist-target"><option value="">新建播放列表…</option>${lists.map(p=>`<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</select><label for="playlist-name">新列表名称</label><input id="playlist-name" maxlength="120" placeholder="选择已有列表时无需填写"><button class="primary" type="submit">确认添加</button><p class="field-note" role="status"></p></form>`);
  const form=document.querySelector<HTMLFormElement>('#playlist-add-form')!,newId=`playlist-${crypto.randomUUID()}`;form.onsubmit=e=>{e.preventDefault();void this.submit(form,async()=>{const selected=form.querySelector<HTMLSelectElement>('select')!.value,playlist=lists.find(p=>p.id===selected),title=playlist?.title??form.querySelector<HTMLInputElement>('input')!.value.trim();if(!title)throw Error('请填写新播放列表的名称');await this.hooks.api.call('sound_playlist_save',{id:playlist?.id??newId,title,revision:playlist?.revision??0,ids:[...(playlist?await this.playlistIds(playlist.id):[]),...ids]});this.selection.clear();this.hooks.close();await this.load();this.hooks.notify('已添加到播放列表');});};
 }
 private async submit(form:HTMLFormElement,fn:()=>Promise<void>){const button=form.querySelector<HTMLButtonElement>('button[type=submit]')!;if(button.disabled)return;button.disabled=true;try{await fn();}catch(error){form.querySelector('[role=status]')!.textContent=(error as Error).message;}finally{button.disabled=false;}}
 private deleteDialog(id:string){const playlist=this.result!.playlists.find(p=>p.id===id)!;this.hooks.modal('删除播放列表',`<p>删除「${esc(playlist.title)}」？声音原文件会继续保留。</p><button class="primary" id="delete-playlist-confirm">删除播放列表</button>`);document.querySelector<HTMLButtonElement>('#delete-playlist-confirm')!.onclick=()=>void this.run(async()=>{await this.hooks.api.call('sound_playlist_remove',{id,revision:playlist.revision});this.hooks.close();await this.load();});}
 private async download(original=false){const item=this.current();if(!item)return;if(!original)this.hooks.notify('正在准备 MP3…');const link=document.createElement('a');link.href=await this.hooks.url(item.audioPath+(original?'':'?format=mp3'));link.download=`${item.title}${item.origin==='generated'?'-V'+item.number:''}.${original?item.extension:'mp3'}`;link.click();}
 private importDialog(){
  const h=this.hooks;h.modal('导入声音',`<form id="sound-import-form"><label for="sound-import-file">选择音频</label><input id="sound-import-file" type="file" accept=".wav,.flac,audio/wav,audio/flac" required><p class="field-note">支持 WAV、FLAC，最长 10 分钟，最大 100 MiB。保存原文件副本，原目录移动或删除后仍可使用。</p><label for="sound-import-title">声音名称</label><input id="sound-import-title" maxlength="120" required placeholder="例如：测试目录里的主题曲"><p id="sound-import-status" class="field-note" role="status"></p><button class="primary" id="sound-import-submit" type="submit">导入声音</button></form>`);
  const form=document.querySelector<HTMLFormElement>('#sound-import-form')!,file=form.querySelector<HTMLInputElement>('#sound-import-file')!,title=form.querySelector<HTMLInputElement>('#sound-import-title')!,button=form.querySelector<HTMLButtonElement>('button')!,status=form.querySelector<HTMLElement>('#sound-import-status')!,dialog=form.closest('dialog')!;dialog.dataset.mode='sound-import';let requestId=crypto.randomUUID(),pending=false;
  file.onchange=()=>{const selected=file.files?.[0];title.value=selected?selected.name.replace(/\.[^.]+$/,'').slice(0,120):'';requestId=crypto.randomUUID();};title.oninput=()=>{requestId=crypto.randomUUID();};
  form.onsubmit=e=>{e.preventDefault();if(pending)return;const selected=file.files?.[0];if(!selected)return;if(selected.size>100*1048576){status.textContent='音频文件不能超过 100 MiB';return;}pending=true;button.disabled=true;file.disabled=true;title.disabled=true;button.textContent='正在导入…';status.textContent='正在校验并保存原文件，请稍候。';const controller=new AbortController(),cancel=()=>controller.abort();dialog.addEventListener('close',cancel,{once:true});
   void(async()=>{try{const query=new URLSearchParams({name:selected.name,title:title.value.trim(),requestId}),response=await h.api.request(`/sound-library/import?${query}`,{method:'POST',headers:{'content-type':'application/octet-stream'},body:selected,signal:controller.signal}),result=await response.json();if(!response.ok)throw Error(result.message??'导入失败，请重试');this.selected=result.id;this.filter='all';this.query='';this.page=1;this.playlistId='';this.tab='all';this.resetControls();dialog.removeEventListener('close',cancel);h.close();await h.refresh();await this.load();h.notify('声音已导入声音库，可以试听或下载。');}catch(e){if(controller.signal.aborted)return;status.textContent=(e as Error).message;}finally{dialog.removeEventListener('close',cancel);pending=false;button.disabled=false;file.disabled=false;title.disabled=false;button.textContent='导入声音';}})();
  };
 }
}
