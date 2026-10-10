/** Update the workspace without detaching the current player or its ancestors.
 * Re-inserting the same audio node preserves its properties, but closes native
 * media menus and can interrupt playback. Keep its entire DOM path connected.
 */
export function renderWorkspace(workspace:HTMLElement,markup:string){
 const next=document.createElement('template');
 next.innerHTML=markup;
 const audio=workspace.querySelector<HTMLAudioElement>('#version-audio');
 const nextAudio=next.content.querySelector<HTMLAudioElement>('#version-audio');
 if(!audio||!nextAudio||audio.dataset.version!==nextAudio.dataset.version||audio.dataset.audioPath!==nextAudio.dataset.audioPath){
  workspace.replaceChildren(next.content);
  return;
 }
 function updateAroundPlayer(current:Node,replacement:Node){
  if(current instanceof HTMLElement&&current.classList.contains('player-space'))return;
  const retained=[...current.childNodes].find(n=>n.contains(audio!))!;
  const incoming=[...replacement.childNodes];
  // Only siblings are replaced; never remove, append or move the retained path.
  for(const child of [...current.childNodes])if(child!==retained)current.removeChild(child);
  let passedPlayer=false;
  for(const child of incoming){
   if(child.contains(nextAudio!)){
    updateAroundPlayer(retained,child);
    passedPlayer=true;
   }else current.insertBefore(child,passedPlayer?null:retained);
  }
 }
 updateAroundPlayer(workspace,next.content);
}
