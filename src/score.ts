// Compatibility only: scores are now tools of a sound version in the studio.
const target=new URL('./',location.href);
if(location.hash.length>1){
 let revisionId=location.hash.slice(1);try{revisionId=decodeURIComponent(revisionId);}catch{}
 target.searchParams.set('score',revisionId);
}
location.replace(target.href);
export {};
