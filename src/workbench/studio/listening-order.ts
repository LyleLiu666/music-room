export type PlaybackMode='order'|'list'|'one'|'shuffle';
export type ListeningOrder={ids:string[];index:number;mode:PlaybackMode;orderedIds?:string[]};

/** The queue shows the actual listening order; saved playlists are never shuffled. */
function shuffled(ids:string[],random:()=>number){
 const result=[...ids];
 for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}
 return result;
}
function shuffleFrom(ids:string[],current:string|undefined,random:()=>number){
 return current&&ids.includes(current)?[current,...shuffled(ids.filter(id=>id!==current),random)]:shuffled(ids,random);
}
export function restorePlaybackOrder(ids:string[],index:number,mode:unknown,orderedIds?:unknown):ListeningOrder{
 const restoredMode:PlaybackMode=mode==='list'||mode==='one'||mode==='shuffle'?mode:'order';
 const members=new Set(ids),validSource=Array.isArray(orderedIds)&&orderedIds.length===ids.length&&new Set(orderedIds).size===ids.length&&orderedIds.every(id=>members.has(id));
 return {ids,index,mode:restoredMode,orderedIds:restoredMode==='shuffle'?[...(validSource?orderedIds:ids)]:undefined};
}
export function changePlaybackMode(state:ListeningOrder,mode:PlaybackMode,random:()=>number=Math.random):ListeningOrder{
 if(mode===state.mode)return state;
 const current=state.ids[state.index];
 if(mode==='shuffle')return {...state,mode,orderedIds:[...state.ids],ids:shuffleFrom(state.ids,current,random),index:0};
 const ids=state.mode==='shuffle'?state.orderedIds??state.ids:state.ids;
 return {...state,mode,ids,index:Math.max(0,ids.indexOf(current)),orderedIds:undefined};
}
export function replacePlaybackOrder(state:ListeningOrder,ids:string[],startId?:string,random:()=>number=Math.random):ListeningOrder{
 const source=[...new Set(ids)],shuffle=state.mode==='shuffle';
 return {mode:state.mode,ids:shuffle?shuffleFrom(source,startId,random):source,index:shuffle?0:Math.max(0,source.indexOf(startId??source[0])),orderedIds:shuffle?source:undefined};
}
