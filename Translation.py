import sys
import pandas as pd
import torch

from transformers import (
    AutoTokenizer,
    AutoModelForSeq2SeqLM
)

model_name = "facebook/nllb-200-distilled-600M"

device = "cuda" if torch.cuda.is_available() else "cpu"

tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForSeq2SeqLM.from_pretrained(
    model_name
).to(device)

tokenizer.src_lang = "ukr_Cyrl"


def translate_batch(texts):

    inputs = tokenizer(
        texts,
        return_tensors="pt",
        padding=True,
        truncation=True,
        max_length=256
    ).to(device)

    bos_id = tokenizer.convert_tokens_to_ids("eng_Latn")

    tokens = model.generate(
        **inputs,
        forced_bos_token_id=bos_id,
        max_length=256
    )

    out = tokenizer.batch_decode(
        tokens,
        skip_special_tokens=True
    )

    return out



def translate_file(path):

    df = pd.read_parquet(path)

    texts = df["text"].tolist()

    out = []

    batch_size = 16

    for i in range(0, len(texts), batch_size):

        batch = texts[i:i+batch_size]

        translated = translate_batch(batch)

        out.extend(translated)

        print(i, "/", len(texts))

    df["text"] = out

    out_path = path.replace(".parquet", "_en.parquet")

    df.to_parquet(out_path)

    print("saved", out_path)


if __name__ == "__main__":

    file_path = sys.argv[1]

    translate_file(file_path)
