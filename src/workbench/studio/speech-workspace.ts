/** Arrange existing controls without replacing their draft or generation handlers. */
export function bindSpeechWorkspace(form:HTMLFormElement){
 const text=form.querySelector<HTMLTextAreaElement>('#creation-text')!;
 const reference=form.querySelector('#voice')!.closest<HTMLElement>('.form-group')!;
 const script=text.closest<HTMLElement>('.form-group')!;
 const emotion=form.querySelector('#emotion-strength')!.closest<HTMLElement>('.form-group')!;
 const workspace=document.createElement('div');workspace.className='speech-workspace';
 const side=document.createElement('aside');side.className='speech-reference';side.setAttribute('aria-label','音色与表达');
 script.classList.add('speech-script');reference.before(workspace);workspace.append(script,side);side.append(reference,emotion);
 const toolbar=document.createElement('div');toolbar.className='speech-script-toolbar';
 toolbar.innerHTML='<label class="secondary speech-import" for="speech-script-file">导入文字稿<input id="speech-script-file" type="file" accept=".txt,text/plain"></label><output id="speech-character-count" for="creation-text"></output>';
 text.before(toolbar);text.rows=14;
 const note=document.createElement('p');note.id='speech-import-status';note.className='field-note';note.setAttribute('role','status');note.textContent='先选音色并试听参考，再填写正文。导入 TXT 会追加到现有正文，不会自动生成。';text.after(note);
 const count=toolbar.querySelector('output')!;
 const update=()=>{count.textContent=`${text.value.length} / 8000 字`;text.setCustomValidity(text.value.length&&!text.value.trim()?'请填写要朗读的正文':'');};
 text.addEventListener('input',update);update();
 const file=toolbar.querySelector<HTMLInputElement>('input')!;let request=0;
 file.onchange=async()=>{
  const selected=file.files?.[0],id=++request,original=text.value;file.value='';if(!selected)return;
  try{
   if(!/\.txt$/i.test(selected.name))throw Error('请选择 UTF-8 编码的 TXT 文字稿。');
   if(selected.size>128*1024)throw Error('文件过大，请拆分为不超过 8000 字的文字稿。');
   const imported=(await selected.text()).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
   if(!form.isConnected||id!==request)return;
   if(text.value!==original)throw Error('正文已修改，本次未导入。请重新选择文件。');
   if(!imported)throw Error('文字稿是空的，原稿未改变。');
   if(imported.includes('\uFFFD')||imported.includes('\0'))throw Error('无法读取文字稿，请保存为 UTF-8 TXT 后重试。');
   const next=original?`${original}\n\n${imported}`:imported;
   if(next.length>8000)throw Error('导入后将超过 8000 字，原稿未改变。请拆分后再导入。');
   text.value=next;text.dispatchEvent(new Event('input',{bubbles:true}));note.textContent=original?'已追加文字稿，原有正文保留。试听确认后再选为成品。':'文字稿已导入。选择音色后即可生成新版本。';text.focus();
  }catch(error){if(form.isConnected&&id===request)note.textContent=(error as Error).message;}
 };
}
