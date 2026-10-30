#!/usr/bin/env python3
"""Create a new step folder in a lesson and register it in lesson.json.

Usage:
    python3 tools/new-step.py lessons/clicker-button 05-reset "Add a reset button"

The new step starts with a copy of the previous step's code, an empty
subtitle file and an explainer stub (one of each per language in a
multilingual lesson), and a step.json. Edit the code file to what
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

    meta = {"title": title, "typing": {"fromCue": 1, "toCue": 1}}
    if lesson["steps"]:
        prev_dir = steps_dir / lesson["steps"][-1]
        prev_meta = prev_dir / "step.json"
        prev_files = json.loads(prev_meta.read_text()).get("files", {}) if prev_meta.exists() else {}
        # Keep the previous step's code file name (for example code.js after a C# to JS morph).
        if prev_files.get("code") and prev_files["code"] != code_name:
            code_name = prev_files["code"]
            meta["files"] = {"code": code_name}
        prev_code = prev_dir / code_name
        if prev_code.exists():
            shutil.copy(prev_code, step_dir / code_name)
    if not (step_dir / code_name).exists():
        (step_dir / code_name).write_text("")

    (step_dir / "step.json").write_text(json.dumps(meta, indent=2) + "\n")
    # One subtitle and explainer file per language in a multilingual lesson.
    subtitles = files.get("subtitles", "subtitles.vtt")
    explainer = files.get("explainer", "explainer.md")
    for lang in lesson.get("languages") or [None]:
        if subtitles:
            (step_dir / (subtitles.replace("{lang}", lang) if lang else subtitles)).write_text(
                "WEBVTT\n\n1\n00:00.000 --> 00:05.000\nWrite the first subtitle here.\n")
        if explainer:
            (step_dir / (explainer.replace("{lang}", lang) if lang else explainer)).write_text(
                f"## {title}\n\nExplain this step here.\n")

    lesson["steps"].append(step_id)
    lesson_file.write_text(json.dumps(lesson, indent=2) + "\n")
    print(f"Created {step_dir} and added it to {lesson_file}")


if __name__ == "__main__":
    main()
