"""Tests for the pure rules in classify_numbers.py (which outlines may stay
visible as the jersey number). Synthetic strings only - no real names.

Run: .venv_ocr/Scripts/python.exe -m unittest scripts/privacy/test_classify_numbers.py
"""
import pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import classify_numbers as cn  # noqa: E402


class DigitRules(unittest.TestCase):
    def test_only_digits_of_the_given_number_count(self):
        self.assertEqual(cn.digits_only("10", "10"), "10")
        self.assertEqual(cn.digits_only("1O", "10"), "10")       # O read for zero
        self.assertEqual(cn.digits_only("I", "10"), "1")         # I read for one
        self.assertIsNone(cn.digits_only("3", "10"))             # a misread letter fragment is not the number
        self.assertIsNone(cn.digits_only("16", "10"))
        self.assertIsNone(cn.digits_only("L0", "10"))            # any other letter disqualifies
        self.assertIsNone(cn.digits_only("PLAYER", "10"))

    def test_clean_maps_look_alikes_only(self):
        self.assertEqual(cn.clean("i|o"), "110")
        self.assertEqual(cn.clean("ab-1"), "AB1")

    def test_numbers_and_words_are_separated_by_shape(self):
        self.assertLessEqual(1.3, cn.MAX_ASPECT)                 # a two-digit number
        self.assertGreater(3.5, cn.MAX_ASPECT)                   # a word outline


if __name__ == "__main__":
    unittest.main()
