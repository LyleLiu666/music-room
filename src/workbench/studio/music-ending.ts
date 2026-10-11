/** Controls travel with the audio element when the player is preserved during polling. */
export function endingPreviewControls(){return '<div class="ending-preview"><button type="button" class="quiet" id="preview-ending" disabled>试听结尾</button><span class="field-note">最后 15 秒；不足 15 秒则从头播放。</span><p id="ending-preview-error" class="field-note" role="alert" hidden></p></div>';}

export function bindEndingPreview(audio:HTMLAudioElement){
 if(audio.dataset.endingBound)return;audio.dataset.endingBound='true';
 const container=audio.closest('.player-space')!,button=container.querySelector<HTMLButtonElement>('#preview-ending')!,error=container.querySelector<HTMLElement>('#ending-preview-error')!;
 const update=()=>{button.disabled=!audio.src||!Number.isFinite(audio.duration)||audio.duration<=0;};
 for(const event of ['loadedmetadata','durationchange','emptied','error'])audio.addEventListener(event,update);
 button.onclick=async()=>{if(button.disabled)return;error.hidden=true;try{audio.currentTime=Math.max(0,audio.duration-15);await audio.play();}catch(cause){if(cause instanceof DOMException&&cause.name==='AbortError')return;error.textContent='暂时无法播放结尾，请使用播放器重试。';error.hidden=false;}};
 update();
}
