#!/usr/bin/env python3
"""Add a language to a lesson, ready to translate.

Usage:
    python3 tools/add-language.py lessons/clicker-button en
    python3 tools/add-language.py lessons/clicker-button en --from nl

For every step it copies the subtitles and the explainer of the source language
(default: the lesson's defaultLanguage) to the new language. Translate them in
place, cue by cue: keep the same number of cues, so typing ("fromCue",
"toCue") stays in sync and the subtitles can be shown over the audio of another
language. Step titles and chapters become { "nl": "...", "en": "..." } with the
source text in both, to translate as well. Audio is not copied; generate it with
    python3 tools/narrate.py lessons/clicker-button --lang en

A lesson without "languages" is converted first: its subtitles, explainers and
audio are renamed to the {lang} form (subtitles.vtt -> subtitles.nl.vtt), and
lesson.json gets "languages" and "defaultLanguage". The source language then
comes from --from or the lesson's "lang" (nl-BE -> nl).
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

FILE_DEFAULTS = {"subtitles": "subtitles.vtt", "explainer": "explainer.md", "audio": None}
LANG_KEYS = ("subtitles", "explainer", "audio")


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def with_lang(name: str) -> str:
    """subtitles.vtt -> subtitles.{lang}.vtt"""
    if "{lang}" in name:
        return name
    stem, dot, ext = name.rpartition(".")
    return f"{stem}.{{lang}}.{ext}" if dot else f"{name}.{{lang}}"


def named(name: str, lang: str) -> str:
    return name.replace("{lang}", lang)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def write_json(path: Path, data: dict):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def convert(lesson_dir: Path, lesson: dict, base: str) -> int:
    """Rename every step's language files to the {lang} form for `base`."""
    files = {**FILE_DEFAULTS, **lesson.get("files", {})}
    templates = {k: with_lang(files[k] or ("audio.mp3" if k == "audio" else "")) for k in LANG_KEYS}
    steps_dir = lesson_dir / lesson.get("stepsDir", "steps")
    renamed = 0
    for sid in lesson["steps"]:
        step_dir = steps_dir / sid
        meta_path = step_dir / "step.json"
        meta = read_json(meta_path)
        step_files = meta.get("files", {})
        for key in LANG_KEYS:
            current = step_files.get(key, files[key])
            if not current:
                continue
            template = with_lang(current)
            src, dst = step_dir / current, step_dir / named(template, base)
            if src.exists() and not dst.exists():
                src.rename(dst)
                renamed += 1
            if key in step_files:
                if template == templates[key]:
                    del step_files[key]
                else:
                    step_files[key] = template
        if "files" in meta and not meta["files"]:
            del meta["files"]
        if meta_path.exists():
            write_json(meta_path, meta)
    lesson["files"] = {**lesson.get("files", {}), **templates}
    lesson["languages"] = [base]
    lesson["defaultLanguage"] = base
    return renamed


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("lesson", help="lesson folder, for example lessons/clicker-button")
    ap.add_argument("lang", help="language code to add, for example en")
    ap.add_argument("--from", dest="source", help="language to copy from (default: the lesson's default language)")
    args = ap.parse_args()

    lesson_dir = Path(args.lesson)
    lesson_path = lesson_dir / "lesson.json"
    if not lesson_path.exists():
        die(f"{lesson_path} not found")
    lesson = read_json(lesson_path)

    if not lesson.get("languages"):
        base = args.source or (lesson.get("lang") or "").split("-")[0].lower()
        if not base:
            die("the lesson has no \"languages\" and no \"lang\"; say which language it is in with --from, for example --from nl")
        if base == args.lang:
            die(f"the lesson is already in {base}")
        renamed = convert(lesson_dir, lesson, base)
        print(f"Converted to a multilingual lesson in '{base}' ({renamed} file(s) renamed).")

    langs = lesson["languages"]
    source = args.source or lesson.get("defaultLanguage") or langs[0]
    if source not in langs:
        die(f"the lesson has no language '{source}'. Its languages: {', '.join(langs)}")
    if args.lang in langs:
        die(f"the lesson already has '{args.lang}'")

    files = {**FILE_DEFAULTS, **lesson.get("files", {})}
    steps_dir = lesson_dir / lesson.get("stepsDir", "steps")
    copied = 0
    for sid in lesson["steps"]:
        step_dir = steps_dir / sid
        meta_path = step_dir / "step.json"
        meta = read_json(meta_path)
        for key in ("subtitles", "explainer"):
            name = meta.get("files", {}).get(key, files[key])
            if not name or "{lang}" not in name:
                continue
            src, dst = step_dir / named(name, source), step_dir / named(name, args.lang)
            if src.exists() and not dst.exists():
                shutil.copyfile(src, dst)
                copied += 1
        changed = False
        for key in ("title", "chapter"):
            value = meta.get(key)
            if isinstance(value, str):
                meta[key] = {source: value, args.lang: value}
                changed = True
            elif isinstance(value, dict) and args.lang not in value and source in value:
                value[args.lang] = value[source]
                changed = True
        if changed:
            write_json(meta_path, meta)

    langs.append(args.lang)
    write_json(lesson_path, lesson)
    print(f"Added '{args.lang}': copied {copied} file(s) from '{source}'.")
    print("Translate the copied subtitles cue by cue (same number of cues), the explainers, and the titles in step.json.")


if __name__ == "__main__":
    main()
