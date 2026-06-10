"""
Formality Classifier - Model wrapper for inference
Can be imported and used in Flask app or other applications
"""

import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import os

class FormalityClassifier:
    """Wrapper for the formality classification model"""
    
    def __init__(self, model_path="./formality_model"):
        """
        Initialize the classifier
        
        Args:
            model_path: Path to saved model directory
        """
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model not found at {model_path}")
        
        self.model_path = model_path
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        
        # Load model and tokenizer
        self.model = AutoModelForSequenceClassification.from_pretrained(model_path)
        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        
        # Move to device and set to eval mode
        self.model = self.model.to(self.device)
        self.model.eval()
        
        self.labels = {0: "informal", 1: "formal"}
    
    def classify(self, text, return_probabilities=False):
        """
        Classify text as formal or informal
        
        Args:
            text: Input text to classify
            return_probabilities: If True, return probabilities for both classes
        
        Returns:
            dict: {
                'label': 'formal' or 'informal',
                'confidence': float (0-1),
                'probabilities': dict (if return_probabilities=True)
            }
        """
        # Tokenize
        inputs = self.tokenizer(
            text,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=128
        )
        
        # Move to device
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        
        # Predict
        with torch.no_grad():
            outputs = self.model(**inputs)
        
        logits = outputs.logits
        prediction = torch.argmax(logits, dim=-1).item()
        probabilities = torch.softmax(logits, dim=-1)[0].cpu().numpy()
        
        result = {
            'label': self.labels[prediction],
            'confidence': float(probabilities[prediction])
        }
        
        if return_probabilities:
            result['probabilities'] = {
                'informal': float(probabilities[0]),
                'formal': float(probabilities[1])
            }
        
        return result
    
    def batch_classify(self, texts, return_probabilities=False):
        """
        Classify multiple texts
        
        Args:
            texts: List of texts to classify
            return_probabilities: If True, return probabilities for both classes
        
        Returns:
            list: List of classification results
        """
        # Tokenize all texts
        inputs = self.tokenizer(
            texts,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=128
        )
        
        # Move to device
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        
        # Predict
        with torch.no_grad():
            outputs = self.model(**inputs)
        
        logits = outputs.logits
        predictions = torch.argmax(logits, dim=-1).cpu().numpy()
        probabilities = torch.softmax(logits, dim=-1).cpu().numpy()
        
        results = []
        for i, text in enumerate(texts):
            result = {
                'text': text,
                'label': self.labels[predictions[i]],
                'confidence': float(probabilities[i, predictions[i]])
            }
            
            if return_probabilities:
                result['probabilities'] = {
                    'informal': float(probabilities[i, 0]),
                    'formal': float(probabilities[i, 1])
                }
            
            results.append(result)
        
        return results


# Flask integration example
"""
from flask import Flask, request, jsonify
from formality_classifier import FormalityClassifier

app = Flask(__name__)
classifier = FormalityClassifier()

@app.route('/classify', methods=['POST'])
def classify_text():
    data = request.json
    text = data.get('text')
    
    if not text:
        return jsonify({'error': 'No text provided'}), 400
    
    result = classifier.classify(text, return_probabilities=True)
    return jsonify(result)

@app.route('/classify-batch', methods=['POST'])
def classify_batch():
    data = request.json
    texts = data.get('texts', [])
    
    if not texts:
        return jsonify({'error': 'No texts provided'}), 400
    
    results = classifier.batch_classify(texts, return_probabilities=True)
    return jsonify({'results': results})

if __name__ == '__main__':
    app.run(debug=True)
"""
