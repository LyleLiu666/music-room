import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'public'/'yue2-score'))
import unittest
from score import inspect_score, transfer, check_edit, section_edit
HEADER='X:1\nT:\nM:4/4\nL:1/32\nQ:1/4=90\nV: Vocal clef=treble name="Vocal Melody" snm="Vocal"\nV: Ins clef=treble name="Ins Melody" snm="Inst."\nK:C\n'
ABC=HEADER+'% verse\nV: Vocal\n"C"C32|\nV: Ins\nZ|\n% outro\nV: Vocal\nz32|\nV: Ins\nE32|\n'
class ScoreTests(unittest.TestCase):
 def test_transfer(self):
  out=transfer(ABC,'error'); self.assertEqual(inspect_score(out['abc'])['voices']['Vocal']['sounding_notes'],0)
  self.assertEqual(out['check']['unaltered_ins_notes'],1)
 def test_overlap(self):
  abc=ABC.replace('Z|','G32|')
  with self.assertRaises(ValueError): transfer(abc,'error')
  self.assertEqual(len(transfer(abc,'vocal')['check']['affected_ins_notes']),1)
 def test_harmony_preserves_notes(self):
  check_edit(ABC,ABC.replace('"C"','"Am"'),'harmony')
  with self.assertRaises(ValueError): check_edit(ABC,ABC.replace('C32','D32'),'harmony')
 def test_tempo_only(self):
  check_edit(ABC,ABC.replace('=90','=120'),'tempo')
  with self.assertRaises(ValueError): check_edit(ABC,ABC.replace('"C"','"Am"'),'tempo')
 def test_sections_and_lyrics(self):
  out=section_edit(ABC,'[verse]\nhello\n[outro]',0,'repeat')
  self.assertEqual(len(inspect_score(out['abc'])['sections']),3)
  self.assertEqual(out['lyrics'].count('hello'),2)
  with self.assertRaises(ValueError): section_edit(ABC,'[instrumental]',0,'repeat',False)
 def test_reject_section_drift(self):
  with self.assertRaises(ValueError): check_edit(ABC,ABC.replace('% verse','% chorus'),'harmony')
 def test_reject_unsupported(self):
  with self.assertRaises(ValueError): inspect_score(ABC.replace('C32','(3CDE'))
 def test_ties_and_accidentals(self):
  tied=ABC.replace('"C"C32|','"C"^C32-|').replace('z32|','^C32|').replace('E32|','Z|')
  r=transfer(tied,'error')
  self.assertEqual(r['check']['vocal_notes_before'],1)
  self.assertEqual(inspect_score(r['abc'])['voices']['Ins']['notes'][0]['duration_quarters'],'8')
  with self.assertRaises(ValueError): section_edit(tied,'[verse]\n[outro]',0,'repeat')
 def test_repeated_section_label_and_delete(self):
  out=section_edit(ABC,'[verse]\nhello\n[outro]',0,'repeat')
  reduced=section_edit(out['abc'],out['lyrics'],1,'delete')
  self.assertEqual(reduced['abc'],ABC)
  self.assertEqual(reduced['lyrics'],'[verse]\nhello\n[outro]')
if __name__=='__main__': unittest.main()
