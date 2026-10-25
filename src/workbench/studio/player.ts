import {mountLyrics} from './lyrics.ts';
/** Update the workspace without detaching the current player or its ancestors.
 * Re-inserting the same audio node preserves its properties, but closes native
 * media menus and can interrupt playback. Keep its entire DOM path connected.
 */
export function renderWorkspace(workspace:HTMLElement,markup:string){
 const focused=workspace.contains(document.activeElement)?document.activeElement as HTMLElement:null;
 const focusSelector=focused?.id?`#${CSS.escape(focused.id)}`:focused?['data-action','data-id','data-select-version','aria-label'].filter(key=>focused.hasAttribute(key)).map(key=>`[${key}="${CSS.escape(focused.getAttribute(key)!)}"]`).join(''):'';
 const restoreFocus=()=>{
  // Polling may replace the button that a dialog just returned focus to.
  // Restore only that workspace control, without stealing a newer focus.
  if(focused&&!focused.isConnected&&focusSelector&&document.activeElement===document.body)workspace.querySelector<HTMLElement>(focusSelector)?.focus({preventScroll:true});
 };
 const next=document.createElement('template');
 next.innerHTML=markup;
 const audio=workspace.querySelector<HTMLAudioElement>('#version-audio');
 const nextAudio=next.content.querySelector<HTMLAudioElement>('#version-audio');
 if(!audio||!nextAudio||audio.dataset.version!==nextAudio.dataset.version||audio.dataset.audioPath!==nextAudio.dataset.audioPath){
  workspace.replaceChildren(next.content);
  mountLyrics(workspace.querySelector<HTMLAudioElement>('#version-audio'));
  restoreFocus();return;
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
 mountLyrics(audio);restoreFocus();
}

/** Move the connected player without restarting native playback. */
export function movePlayer(parent:HTMLElement,player:HTMLElement,before:Node|null=null){
 if(parent.moveBefore){
  try{parent.moveBefore(player,before);return;}
  catch(error){
   // Some browsers expose the API but reject a state-preserving move.
   // Ordinary insertion below still validates the DOM relationship.
   if(!(error instanceof DOMException))throw error;
  }
 }
 // Older browsers lack state-preserving DOM moves, or cannot perform this one.
 const audio=player.querySelector('audio'),playing=audio&&!audio.paused;
 parent.insertBefore(player,before);
 if(playing)void audio.play().catch(()=>{});
}
