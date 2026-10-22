import sys,importlib.util,pathlib,unittest
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('worker',pathlib.Path(__file__).resolve().parent.parent/'public/lyrics-runtime/worker.py');worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
class LyricsWorker(unittest.TestCase):
 def test_repeated_and_new_phrases_are_not_deduplicated(self):
  self.assertEqual(worker.phrases('旧句。新的一整段！旧句。'),['旧句','新的一整段','旧句'])
 def test_reference_is_only_retrieved_context_not_transcript_substitution(self):
  transcript='西风吹老湖水。全新的唱段'
  context=worker.reference_candidates(transcript,'[Chorus]\n西风吹老湖水 吹白鬓霜\n与当前音频无关的句子')
  self.assertIn('西风吹老湖水 吹白鬓霜',context);self.assertEqual(transcript,'西风吹老湖水。全新的唱段')
 def test_unrelated_reference_does_not_prompt_full_lyrics(self):
  self.assertEqual(worker.reference_candidates('啊','春宴散时\n你替我扶正发钗'),'')
 def test_passage_context_covers_short_lines_in_a_dense_verse(self):
  # Real failed V2 chunk: scoring the entire paragraph dropped the intended line.
  reference='\n'.join(['不是我陪得多，也不是陪得少','是你陪的那只手，放没放到该放的地方','看着我，帮着我，替我算好每一步','说这样我就少走弯路——那你告诉我','我的脚，往哪放？','路你都铺平了，我的脚往哪放？','你想替我避开所有坑','我就永远学不会，什么叫坑','你想替我做最好的选择','我就永远长不出自己的判断力','你越怕我摔，我越怕试错'])
  transcript='也不是背的少，是你背的那只手。放没放到该放的地方，看着我放，就我替我算好每一步。说这样我就早走完路。那你告诉我，我的脚往哪放路。你都不停了我的脚往哪放。你想替我避开所有坑，我就永远学不会什么教坑。你想替我做最好的选择，我就永远站不住自己的判断力。你越怕我帅，我越。'
  context=worker.reference_candidates(transcript,reference)
  self.assertIn('路你都铺平了，我的脚往哪放？',context)
  self.assertIn('你想替我避开所有坑',context)
  self.assertIn('你越怕我摔，我越怕试错',context)
 def test_context_retrieval_leaves_unrelated_distant_sections_out(self):
  reference='\n'.join(['春宴散时','你替我扶正发钗','楼道的灯，一亮一灭','金属门在身后，咔哒一声锁死','他们说：孩子，听话','我听见的是归我管三个字','另一首的晚风','吹过远处的山谷'])
  context=worker.reference_candidates('金属门在身后一声锁死。他们说孩子听话',reference)
  self.assertNotIn('春宴散时',context)
  self.assertNotIn('吹过远处的山谷',context)
 def test_context_does_not_append_unsung_adjacent_lines(self):
  reference='你越怕我摔，我越怕试错\n怕到连犯错都要先看你的脸色\n把饭喂到嘴里，还问我为什么不会嚼'
  self.assertEqual(worker.reference_candidates('你越怕我帅，我越',reference),'你越怕我摔，我越怕试错')
 def test_passage_recall_keeps_the_complete_contiguous_reference(self):
  reference='起点是楼道的灯\n第一行中间内容\n第二行中间内容\n第三行中间内容\n终点是关上的门'
  self.assertEqual(worker.reference_candidates('起点是楼道的灯。终点是关上的门',reference),reference)
 def test_passage_recall_preserves_repeated_reference_lines_and_order(self):
  reference='先打开那扇门\n这是我的生活\n这是我的生活\n再沿着那条路走'
  self.assertEqual(worker.reference_candidates('先打开那扇门。这是我的生活。这是我的生活。再沿着那条路走',reference),reference)
 def test_passage_recall_does_not_depend_on_asr_punctuation(self):
  reference='楼道的灯一亮一灭\n金属门在身后一声锁死\n他们说孩子听话\n我听见的是归我管三个字'
  self.assertEqual(worker.reference_candidates(reference,reference),worker.reference_candidates(reference.replace('\n',''),reference))
 def test_ordered_context_retains_the_middle_line_between_repeated_chorus_anchors(self):
  reference='把周末铺在湖边\n野餐垫鼓起一面帆\n你追着帽子跑一圈\n我喊慢一点 慢一点\n把周末铺在湖边\n让水光跳上我们的脸\n等太阳在湖面打个盹\n再把好天气带回家'
  self.assertEqual(worker.reference_candidates('把周末铺在湖边。夜三点的起面粉。你追着帽子跑一圈',reference),'把周末铺在湖边\n野餐垫鼓起一面帆\n你追着帽子跑一圈')
 def test_alignment_uses_reviewed_parts_without_resplitting_original_line_punctuation(self):
  self.assertEqual(worker.alignment_parts({'text':'夜三点的起面粉','parts':['野餐垫鼓起一面帆','我喊慢一点，慢一点']}),['野餐垫鼓起一面帆','我喊慢一点，慢一点'])
  with self.assertRaises(ValueError):worker.alignment_parts({'parts':['一行\n另一行']})
 def test_unrecognized_phase_is_rejected_before_loading_models(self):
  with self.assertRaises(ValueError):worker.run({'phase':'unexpected'})
if __name__=='__main__':unittest.main()
