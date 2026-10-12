import sys
sys.dont_write_bytecode=True
import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('trial',pathlib.Path(__file__).with_name('lyrics-asr.py'));trial=importlib.util.module_from_spec(spec);spec.loader.exec_module(trial)
class Segments(unittest.TestCase):
 def test_chunks_keep_tail_and_overlap(self):
  self.assertEqual(trial.windows(95,40,30),[(0,40),(30,70),(60,95)])
 def test_empty_or_invalid_windows_rejected(self):
  for args in [(0,40,30),(10,0,1),(10,20,30)]:
   with self.assertRaises(ValueError):trial.windows(*args)
 def test_missing_line_is_unresolved_not_zero_or_interpolated(self):
  result=trial.merge_rows(['一','二','三'],[{'index':0,'start':1,'end':2},{'index':2,'start':4,'end':5}],10)
  self.assertEqual(result['unresolved'],[{'index':1,'text':'二','reason':'no-reviewed-match'}]);self.assertEqual(len(result['lines']),2)
 def test_collapsed_or_backwards_times_are_not_success(self):
  r=trial.merge_rows(['一','二'],[{'index':0,'start':3,'end':4},{'index':1,'start':2,'end':2}],10)
  self.assertEqual(r['invalidLines'],1);self.assertEqual(r['startRegressions'],1)
 def test_duplicate_selection_is_error(self):
  with self.assertRaises(ValueError):trial.merge_rows(['一'],[{'index':0,'start':1,'end':2},{'index':0,'start':3,'end':4}],10)
class PerformedLyrics(unittest.TestCase):
 def test_reference_does_not_override_changed_added_repeated_or_reordered_words(self):
  manifest={'mode':'performed-draft','performedLines':[
   {'text':'乙改了','referenceLines':[1],'status':'uncertain'},
   {'text':'新唱词','referenceLines':[],'status':'uncertain'},
   {'text':'甲','referenceLines':[0],'status':'candidate'},
   {'text':'甲','referenceLines':[0],'status':'candidate'}]}
  self.assertEqual(trial.alignment_texts(manifest,['甲','乙','没唱的']),['乙改了','新唱词','甲','甲'])
 def test_reference_corrects_words_without_restricting_extra_sections_or_repeats(self):
  manifest={'mode':'reference-guided-performance','performedLines':[
   {'text':'最有欢乐的人','referenceLines':[1]},
   {'text':'新的一整段','referenceLines':[]},
   {'text':'仰望万丈星光','referenceLines':[0]},
   {'text':'仰望万丈星光','referenceLines':[0]}]}
  self.assertEqual(trial.alignment_texts(manifest,['压弯万丈星光','自由惯了的人','未唱出']),['自由惯了的人','新的一整段','压弯万丈星光','压弯万丈星光'])
 def test_legacy_reference_trial_is_preserved(self):
  self.assertEqual(trial.alignment_texts({},['甲']),['甲'])
 def test_unknown_mode_rejected(self):
  with self.assertRaises(ValueError):trial.alignment_texts({'mode':'typo'},['甲'])
class TimingCorrection(unittest.TestCase):
 def test_local_correction_preserves_other_lines_and_raw_evidence(self):
  rows=[{'index':0,'text':'前句','start':1,'end':2},{'index':1,'text':'别叫醒我','start':145,'end':155}]
  fixed=trial.apply_timing_corrections(rows,[{'index':1,'start':148.2,'end':155,'evidence':'local-vocals.json'}],180)
  self.assertEqual(fixed[0],rows[0]);self.assertEqual(rows[1]['start'],145)
  self.assertEqual(fixed[1]['start'],148.2);self.assertEqual(fixed[1]['timingCorrection']['before']['start'],145)
 def test_invalid_or_unsubstantiated_correction_is_rejected(self):
  for correction in [{'index':0,'start':2,'end':1,'evidence':'x'},{'index':0,'start':1,'end':3,'evidence':''},{'index':3,'start':1,'end':3,'evidence':'x'}]:
   with self.assertRaises(ValueError):trial.apply_timing_corrections([{'index':0,'start':0,'end':1}], [correction],10)
if __name__=='__main__':unittest.main()
