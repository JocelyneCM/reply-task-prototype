"""
Quick test script to demonstrate formality classification
Run this after training the model with gyafcTrainer.py
"""

from formality_classifier import FormalityClassifier

def main():
    print("Loading model...")
    classifier = FormalityClassifier()
    print("Model loaded successfully!\n")
    
    # Test sentences
    test_sentences = [
        # Informal examples
        "hey, what's up? can u help me with this?",
        "yo, this is so cool lol",
        "i don't think that page gave me viruses",
        
        # Formal examples
        "Dear Sir or Madam, I would like to inquire about your services.",
        "The methodology employed in this study demonstrates significant efficacy.",
        "It is imperative that we address this matter with utmost urgency.",
    ]
    
    print("Testing single classification:")
    print("=" * 60)
    
    for sentence in test_sentences:
        result = classifier.classify(sentence, return_probabilities=True)
        print(f"\nText: {sentence}")
        print(f"Label: {result['label'].upper()}")
        print(f"Confidence: {result['confidence']:.4f}")
        print(f"  - Informal: {result['probabilities']['informal']:.4f}")
        print(f"  - Formal: {result['probabilities']['formal']:.4f}")
    
    # Batch classification
    print("\n" + "=" * 60)
    print("\nBatch classification example:")
    batch_texts = [
        "wanna grab coffee later?",
        "I would appreciate the opportunity to discuss this matter.",
        "omg that's hilarious",
    ]
    
    batch_results = classifier.batch_classify(batch_texts, return_probabilities=True)
    
    for result in batch_results:
        print(f"\n'{result['text']}'")
        print(f"  → {result['label'].upper()} ({result['confidence']:.4f})")

if __name__ == "__main__":
    main()
