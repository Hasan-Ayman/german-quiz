"""Inventory the four local Spektrum PDFs without copying any source document."""
import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import re

import pypdfium2 as pdf

SOURCES = {
    "a1-book": ("Copy of Spektrum Deutsch A1 Kurs- und Arbeitsbuch.pdf", 276),
    "a2-book": ("Spektrum Deutsch A2plus KB und AB.pdf", 292),
    "a1-vocab": ("Spektrum_Deutsch_A1_Wortschatz_Herr_Mohamed_Abdelhalim (2).pdf", 62),
    "a2-vocab": ("Spektrum_Deutsch_A2_Wortschatz_komplett_Herr_Mohamed_Abdelhalim.pdf", 50),
}
SECTION = re.compile(r"^(\d{1,2}) (.+?) (\d+)\n(?=(?:Sprachhandlungen|Vertiefungsteil))", re.M)
MARKERS = {
    "grammar": r"\bStrukturen\b",
    "pronunciation": r"\b(?:Phonetik|Aussprache)\b",
    "listening": r"\b(?:Hören|Hörtext|Hörverstehen|CD)\b",
    "writing": r"\b(?:Schreiben|Schreibaufgabe|schriftlich)\b",
    "reading": r"\b(?:Lesen|Leseverstehen|Lesetext)\b",
    "review": r"\b(?:Vertiefungsteil|Übersichten)\b",
    "assessment": r"\bAbschlusstest\b",
    "exam": r"\b(?:Übungstest|Goethe-Zertifikat|Start Deutsch)\b",
    "dialogue": r"\b(?:Dialoge?|Partnerinterview|Gespräche?)\b",
}


def normalize(text):
    return "\n".join(line.strip() for line in text.replace("\ufffe", "").replace("\r", "").splitlines())


def bullets(text):
    return [" ".join(item.split()) for item in text.split("\uf0a7") if item.strip()]


def chapter_map(key, pages):
    contents = pages[4]["text"]
    starts = {}
    for match in SECTION.finditer(contents):
        number, title, main = match.groups()
        details = re.match(r"Vertiefungsteil (\d+)\nÜbersichten (\d+)\nAbschlusstest (\d+)", contents[match.end():])
        if details:
            starts[int(number)] = (title, int(main), *(int(value) for value in details.groups()))
    sections = {}
    for page in pages[5:9]:
        matches = list(SECTION.finditer(page["text"]))
        for pos, match in enumerate(matches):
            number, title, printed_start = match.groups()
            raw = page["text"][match.end():matches[pos+1].start() if pos + 1 < len(matches) else None]
            raw = re.sub(r"\n(?:vier|fünf|sechs|sieben)\b[\s\S]*$", "", raw, flags=re.I)
            grammar = re.match(r"Sprachhandlungen und Lernziele\n([\s\S]*?)\nThemen und Wortschatz\n([\s\S]*?)\nStrukturen\n([\s\S]*?)\nAussprache\n([\s\S]*)", raw)
            if not grammar:
                raise ValueError("Could not identify all sections for " + key + " chapter " + number)
            sections[int(number)] = (title, int(printed_start), page["page"], *(bullets(part) for part in grammar.groups()))
    if sorted(starts) != list(range(1, 13)) or sorted(sections) != list(range(1, 13)):
        raise ValueError("Incomplete chapter map for " + key)
    chapters = []
    for number, (title, start, workshop, summary, assessment) in sorted(starts.items()):
        paired_title, paired_start, overview, objectives, vocabulary, grammar, pronunciation = sections[number]
        if start != paired_start or not 1 <= start < workshop < summary <= assessment < len(pages) - 2:
            raise ValueError(f"Invalid or mismatched page anchors for {key} chapter {number}: {title!r}, {paired_title!r}, {(start, workshop, summary, assessment)}")
        book_to_pdf = 2
        first = start + book_to_pdf
        last = assessment + book_to_pdf
        region = pages[first-1:last]
        citations = {marker: [item["page"] for item in region if marker in item["markers"]]
                     for marker in ("grammar", "reading", "writing", "listening", "dialogue", "pronunciation")}
        chapters.append(dict(id=key[:2].upper() + ":" + str(number), source=key, number=number,
                             title=title, overviewTitle=paired_title, overviewPage=overview, printedStart=start, printedEnd=assessment,
                             startPage=first, endPage=last, workbookPage=workshop+2, summaryPage=summary+2,
                             assessmentPage=last, objectives=objectives, themes=vocabulary, grammar=grammar,
                             pronunciation=pronunciation, pageCandidates=citations))
    appendix = {}
    for marker, pattern in (("exam", r"Übungstest[^\n]+ (\d+)\n"),
                            ("grammarSummary", r"Übersicht zu den Strukturen (\d+)\n")):
        match = re.search(pattern, contents)
        if not match:
            raise ValueError("Missing appendix entry for " + key + " " + marker)
        appendix[marker] = int(match.group(1)) + 2
    return chapters, appendix


def audit(folder, output):
    sources, chapters, archive = [], [], {}
    for key, (name, expected) in SOURCES.items():
        path = folder / name
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        with closing(pdf.PdfDocument(path)) as doc:
            if len(doc) != expected:
                raise ValueError(f"Unexpected page count for {key}: {len(doc)}")
            pages = []
            for index in range(len(doc)):
                with closing(doc[index]) as page, closing(page.get_textpage()) as textpage:
                    raw = textpage.get_text_range()
                value = normalize(raw)
                pages.append(dict(page=index+1, text=value, raw=raw, hasText=bool(value.strip()),
                                  markers=[tag for tag, pattern in MARKERS.items() if re.search(pattern, value, re.I)],
                                  extractionStatus="needs_visual_review" if not value.strip() or "\ufffd" in raw else "machine_extracted"))
        archive[key] = pages
        entry = dict(id=key, name=name, sha256=digest, pages=len(pages),
                     textPages=sum(page["hasText"] for page in pages),
                     visualReviewPages=[page["page"] for page in pages if page["extractionStatus"] == "needs_visual_review"])
        if key.endswith("book"):
            book_chapters, entry["appendix"] = chapter_map(key, pages)
            chapters.extend(book_chapters)
        sources.append(entry)
    output.mkdir(parents=True, exist_ok=True)
    for name, data in [("curriculum-private.json", dict(sources=sources, chapters=chapters)),
                       ("page-inventory-private.json", archive)]:
        (output / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return sources, chapters


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        raise SystemExit("Choose a private output folder outside the working checkout.")
    sources, chapters = audit(args.sources, args.output)
    print(json.dumps({"pages": sum(item["pages"] for item in sources), "chapters": len(chapters),
                      "pages_with_text": sum(item["textPages"] for item in sources),
                      "pages_with_review_flags": sum(len(item["visualReviewPages"]) for item in sources)}, indent=2))


if __name__ == "__main__":
    main()
