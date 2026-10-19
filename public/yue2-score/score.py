"""Deterministic checks of the explicit native score protocol; no intent routing."""
import json, re, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'vendor'))
from abc_tools import parse_abc, report, compare, json_value
from instrumentalize import convert_score, section_starts

def inspect_score(text):
 score=parse_abc(text)
 result=report(score)
 result['sections']=[{'start':str(t),'label':label} for t,label in section_starts(text,score).items()]
 return result

def transfer(text,overlap):
 abc,check=convert_score(text,overlap=overlap)
 return dict(abc=abc,check=check)

def check_edit(before,after,kind):
 a,b=parse_abc(before),parse_abc(after)
 if kind not in ('harmony','tempo'): raise ValueError('请选择和弦或速度约束')
 checks=compare(a,b,allow_tempo_change=kind=='tempo')
 if not checks['match']: raise ValueError('保留约束失败: '+', '.join(checks['differences']))
 if section_starts(before,a)!=section_starts(after,b): raise ValueError('段落边界或名称发生变化')
 for name in ('Vocal','Ins'):
  if a.voices[name].keys!=b.voices[name].keys: raise ValueError('调号时间线发生变化')
  if kind=='tempo' and a.voices[name].chords!=b.voices[name].chords: raise ValueError('仅改速度不能改变和弦')
 return dict(kind=kind,passed=True,scope='音高、拍位置、时值、拍号、调号、段落及指定保留项')

def section_edit(text,lyrics,index,action,instrumental=False):
 score=parse_abc(text)
 sections=list(section_starts(text,score).items())
 if action not in ('repeat','delete') or not isinstance(index,int) or index<0 or index>=len(sections): raise ValueError('请选择已有明确段落和操作')
 # Native explicit comments are the protocol. We never infer boundaries from music or prose.
 chunks=re.split(r'(?=^% )',text,flags=re.M)
 if len(chunks)!=len(sections)+1 or sections[0][0]!=0: raise ValueError('段落边界不完整，需先补齐明确边界')
 if re.search(r'^[MK]:', ''.join(chunks[1:]), re.M) or '[K:' in text: raise ValueError('含中途变调/变拍的段落暂不支持复制删除')
 start=sections[index][0]; end=sections[index+1][0] if index+1<len(sections) else score.voices['Vocal'].time
 for voice in score.voices.values():
  if any(t<boundary<t+d for t,p,d in voice.notes for boundary in (start,end)):
   raise ValueError('段落边界存在延音，请先明确断句')
 if instrumental:
  lyric_chunks=['['+label+']' for _,label in sections]
 else:
  lyric_chunks=[x.strip() for x in re.split(r'(?=^\[[a-zA-Z][a-zA-Z0-9 _-]*\])',lyrics,flags=re.M) if x.strip()]
  labels=[re.match(r'^\[([^\]]+)\]',x) for x in lyric_chunks]
  if len(labels)!=len(sections) or any(not m or m[1].lower()!=s[1] for m,s in zip(labels,sections)): raise ValueError('歌词段落必须与乐谱段落逐一对应')
 if action=='repeat': chunks.insert(index+2,chunks[index+1]); lyric_chunks.insert(index+1,lyric_chunks[index])
 else: del chunks[index+1]; del lyric_chunks[index]
 abc=''.join(chunks)
 parse_abc(abc)
 return dict(abc=abc,lyrics='\n'.join(lyric_chunks),check=dict(action=action,section=index,passed=True))

def dispatch(data):
 op=data['op']
 if op=='tempo':
  bpm=data['bpm']
  if not isinstance(bpm,int) or not 20<=bpm<=300: raise ValueError('速度须在 20–300 BPM 之间')
  abc,count=re.subn(r'^Q:1/4=\d+\s*$', 'Q:1/4='+str(bpm),data['abc'],flags=re.M)
  if count!=1: raise ValueError('需要唯一的 Q:1/4 速度标记')
  return dict(abc=abc,check=check_edit(data['abc'],abc,'tempo'))
 if op=='inspect': return inspect_score(data['abc'])
 if op=='transfer': return transfer(data['abc'],data.get('overlap','error'))
 if op=='check': return check_edit(data['before'],data['abc'],data['kind'])
 if op=='section': return section_edit(data['abc'],data['lyrics'],data['index'],data['action'],data.get('instrumental',False))
 raise ValueError('Unknown score operation')
if __name__=='__main__':
 try: print(json.dumps(dispatch(json.load(sys.stdin)),default=json_value,ensure_ascii=False))
 except Exception as exc: print(str(exc),file=sys.stderr);sys.exit(1)
