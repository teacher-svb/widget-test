#!/usr/bin/env python3
"""Create a new step folder in a lesson and register it in lesson.json.

Usage:
    python3 tools/new-step.py lessons/clicker-button 05-reset "Add a reset button"

The new step starts with a copy of the previous step's code, an empty
subtitle file, an explainer stub and a step.json. Edit the code file to what
it should look like at the END of the step; the player types the difference.
"""
import json
import shutil
import sys
from pathlib import Path


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    lesson_dir = Path(sys.argv[1])
    step_id = sys.argv[2]
    title = sys.argv[3] if len(sys.argv) > 3 else step_id

    lesson_file = lesson_dir / "lesson.json"
    lesson = json.loads(lesson_file.read_text())
    if step_id in lesson["steps"]:
        sys.exit(f"Step {step_id} already exists in {lesson_file}")

    files = lesson.get("files", {})
    code_name = files.get("code", "code.txt")
    steps_dir = lesson_dir / lesson.get("stepsDir", "steps")
    step_dir = steps_dir / step_id
    step_dir.mkdir(parents=True, exist_ok=False)

    if lesson["steps"]:
        prev_code = steps_dir / lesson["steps"][-1] / code_name
        if prev_code.exists():
            shutil.copy(prev_code, step_dir / code_name)
    if not (step_dir / code_name).exists():
        (step_dir / code_name).write_text("")

    (step_dir / "step.json").write_text(json.dumps({"title": title, "typing": {"fromCue": 1, "toCue": 1}}, indent=2) + "\n")
    (step_dir / "subtitles.vtt").write_text("WEBVTT\n\n1\n00:00.000 --> 00:05.000\nWrite the first subtitle here.\n")
    (step_dir / "explainer.md").write_text(f"## {title}\n\nExplain this step here.\n")

    lesson["steps"].append(step_id)
    lesson_file.write_text(json.dumps(lesson, indent=2) + "\n")
    print(f"Created {step_dir} and added it to {lesson_file}")


if __name__ == "__main__":
    main()
