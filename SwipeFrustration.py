import csv

CSV_PATH = "./Files_For_Graphs/NASA TLX Thesis.csv"

# Comfort survey answers (subject ID -> answer text), normalized to uppercase IDs
comfort_raw = """P01,No
P02,No
P04,Yes
P06,No
P03,I have used it, but I do not consider myself comfortable.
P08,No
P10,I have used it, but I do not consider myself comfortable.
P12,I have used it, but I do not consider myself comfortable.
p05,Yes
P14,I have used it, but I do not consider myself comfortable.
p07,No
p09,I have used it, but I do not consider myself comfortable.
P11,I have used it, but I do not consider myself comfortable.
P13,I have used it, but I do not consider myself comfortable.
P13,I have used it, but I do not consider myself comfortable.
p15,I have used it, but I do not consider myself comfortable.
P16,I have used it, but I do not consider myself comfortable.
P18,No
P22,Yes
P24,Yes
P20,No
P26,Yes
P030,Yes
P017,Yes
P019,No
P021,Yes"""

def normalize_id(pid: str) -> str:
    """Normalize subject IDs like 'p05', 'P030', 'P017' -> 'P005', 'P030', 'P017'.
    The xlsx uses 'P0xx' (3-digit) format, e.g. P001, P002... Survey IDs use
    'P0x'/'p0x' (2-digit) or 'P0xx' (3-digit, already matching)."""
    pid = pid.strip().upper()
    digits = pid.lstrip("P")
    digits = digits.zfill(3)
    return "P" + digits

# Build comfort lookup: normalized ID -> "Yes" or "Not comfortable"
comfort = {}
for line in comfort_raw.strip().splitlines():
    pid, answer = line.split(",", 1)
    pid = normalize_id(pid)
    answer = answer.strip()
    if answer == "Yes":
        comfort[pid] = "comfortable"
    elif answer == "I have used it, but I do not consider myself comfortable.":
        comfort[pid] = "somewhat comfortable"
    else:
        # "No" or "I have used it, but I do not consider myself comfortable."
        comfort[pid] = "not_comfortable"

# Load csv and collect Frustration values for Swipe Typing rows
with open(CSV_PATH, newline="") as f:
    reader = csv.DictReader(f)

    groups = {"comfortable": [], "somewhat comfortable": [], "not_comfortable": [], "unknown": []}

    for row in reader:
        pid = row["Subject ID"]
        input_method = row["Input_method"]
        frustration = row["Frustration"]

        if not input_method or "Swipe" not in input_method:
            continue
        if not frustration:
            continue

        group = comfort.get(normalize_id(pid) if pid else "", "unknown")
        groups[group].append(float(frustration))

def report(name, values):
    if not values:
        print(f"{name}: no data")
        return
    avg = sum(values) / len(values)
    print(f"{name}: n={len(values)}, avg frustration = {avg:.2f}")

print("Swipe Typing rows - Frustration averages by comfort group:\n")
report("Comfortable with swipe ('Yes')", groups["comfortable"])
report("Somewhat comfortable with swipe ('I haven't used it but I would be comfortable')", groups["somewhat comfortable"])
report("Not comfortable with swipe ('No' / used but not comfortable)", groups["not_comfortable"])
report("Unknown comfort (subject not in survey list)", groups["unknown"])