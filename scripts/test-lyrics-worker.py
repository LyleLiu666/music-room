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
if __name__=='__main__':unittest.main()
