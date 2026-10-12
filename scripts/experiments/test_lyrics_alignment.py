import sys
sys.dont_write_bytecode=True
import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('alignment',pathlib.Path(__file__).with_name('lyrics-alignment.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Lyrics(unittest.TestCase):
 def test_explicit_markers_and_repetitions(self):
  self.assertEqual(module.lyric_lines('[Verse]\n第一句\n\n[Chorus]\n同一句\n同一句'),['第一句','同一句','同一句'])
 def test_rounding_carries_minutes(self):
  self.assertEqual(module.lrc_time(59.999),'01:00.00')
 def test_literal_words_remain(self):
  self.assertEqual(module.lyric_lines('不要沉默\n[不是段落]唱下去'),['不要沉默','[不是段落]唱下去'])
if __name__=='__main__':unittest.main()
