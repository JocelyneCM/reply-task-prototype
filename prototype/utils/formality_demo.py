"""Simple demo to run the formality model on sample sentences.

Run as a module from the repository root:
    PYTHONPATH=. python3 -m prototype.utils.formality_demo

Edit SAMPLE_SENTENCES below to try different inputs.
"""
from typing import List, Dict
import os
import sys

# Allow this file to be run either as a module (`-m prototype.utils.formality_demo`)
# or directly as a script (`python prototype/utils/formality_demo.py`). When run
# directly there is no parent package, so prefer an absolute import after
# inserting the repository root on `sys.path`.
if __package__ is None:
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    if root not in sys.path:
        sys.path.insert(0, root)
    from prototype.utils.formality_service import load_model, predict_batch
else:
    from .formality_service import load_model, predict_batch


SAMPLE_SENTENCES: List[str] = [
    "Hey, can you send that file over?",
    "Could you please send the file at your earliest convenience?",
    "Thanks! I'll take a look and get back to you.",
    "I would appreciate it if you could review the document and provide feedback.",
    "wassup homie",
    "I'd like that file before end of day.",
    "asda we are here"
]


def run(sentences: List[str]) -> List[Dict]:
    load_model()
    return predict_batch(sentences)


def main() -> None:
    print("Running formality demo on sample sentences...\n")
    results = run(SAMPLE_SENTENCES)
    for text, res in zip(SAMPLE_SENTENCES, results):
        label = res.get("label")
        score = res.get("score")
        print("Sentence:")
        print("  ", text)
        print("Formality:")
        print("  ", label, f"(confidence={score:.4f})")
        print()


if __name__ == "__main__":
    main()
