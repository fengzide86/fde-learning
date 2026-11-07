"""Validate a public static learning-site bundle without changing its content.

Uses only the Python standard library. --pdf-scan additionally reads PDF text and
annotations with an already-installed pypdf; it never installs a dependency.
These checks do not claim browser playback, visual quality, or learner mastery.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import stat
import sys
from urllib.parse import parse_qs, unquote, urlsplit


PRIVATE_TEXT = [
    ("local_user_path", re.compile(r"C:[/\\]+Users[/\\]+(?:zide|冯伟豪)(?:[/\\]|\b)", re.I)),
    ("author_workspace_path", re.compile(r"D:[/\\]+(?:学习技术|vm2api)(?:[/\\]|\b)", re.I)),
    ("personal_progress", re.compile(r"02_FDE当前学习进度|00_FDE学习偏好与教学约定|90_旧版_勿学习")),
    ("private_cloud_document", re.compile(r"(?:docs\.google\.com/document/d/|drive\.google\.com/(?:file|drive)/|mcnrvslvxm0m\.feishu\.cn)", re.I)),
    ("github_token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,})\b")),
    ("api_secret", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b")),
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
]
FORBIDDEN_COMPONENTS = {".git", ".venv", "__pycache__", "node_modules", "qa", "evidence", "backups", "history", ".env"}
TEXT_SUFFIXES = {".html", ".htm", ".js", ".mjs", ".css", ".json", ".md", ".txt", ".svg", ".vtt", ".srt", ".xml", ".yml", ".yaml"}


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


class Markup(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.targets: list[tuple[str, str]] = []
        self.ids: list[str] = []
        self.tags = Counter()
        self.event_attributes: list[str] = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        self.tags[tag] += 1
        if attributes.get("id"):
            self.ids.append(attributes["id"])
        for attr in ("href", "src", "poster"):
            if attributes.get(attr):
                self.targets.append((tag + ":" + attr, attributes[attr]))
        self.event_attributes.extend(name for name, _ in attrs if name.lower().startswith("on"))


class Audit:
    def __init__(self, site: Path, pdf_scan: bool):
        self.site = site.resolve()
        self.pdf_scan = pdf_scan
        self.errors: list[dict] = []
        self.checks = Counter()
        self.links = 0
        self.external_links: set[str] = set()
        self.pdfs_scanned = 0
        self.chapters = {}
        self.videos = {}
        self.books = {}
        self.content = {}

    def check(self, condition, label, location=None):
        self.checks[label] += 1
        if not condition:
            self.errors.append({"check": label, "location": location})
        return bool(condition)

    def read(self, relative):
        path = self.site / relative
        if not self.check(path.is_file(), "required_file", str(relative)):
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8-sig"))
        except (ValueError, OSError) as error:
            self.errors.append({"check": "json_read", "location": str(relative), "reason": type(error).__name__})
            return None

    def private(self, text, location):
        self.check("\ufffd" not in text, "no_replacement_characters", location)
        for name, pattern in PRIVATE_TEXT:
            # Report only the file and category; never echo a matched secret.
            self.check(not pattern.search(text), name, location)

    def route(self, route, location):
        parsed = urlsplit(route.lstrip("#"))
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query)
        if path in {"/", "/library", "/videos", "/resources", "/about", "/search"}:
            if query.get("book"):
                self.check(query["book"][0] in self.books, "route_book_exists", location)
            return
        match = re.fullmatch(r"/chapter/([A-Z0-9-]+)", path)
        if match:
            cid = match[1]
            self.check(cid in self.chapters, "route_chapter_exists", location)
            if query.get("tab"):
                self.check(query["tab"][0] in {"read", "text", "video", "memory", "map"}, "route_tab_known", location)
            if query.get("section") and cid in self.content:
                ids = {row["id"] for row in self.content[cid].get("toc", [])}
                self.check(query["section"][0] in ids, "route_section_exists", location)
            return
        match = re.fullmatch(r"/video/([A-Z0-9-]+)", path)
        if match:
            self.check(match[1] in self.videos, "route_video_exists", location)
            return
        # Guides and whole-book memory tables use their declared content files.
        match = re.fullmatch(r"/(guide|memory)/([A-Z0-9]+)", path)
        if match:
            kind, bid = match.groups()
            key = "guide" if kind == "guide" else "memoryContent"
            self.check(bid in self.books and bool(self.books[bid].get(key)), "route_book_resource_exists", location)
            if query.get("section") and bid in self.books and self.books[bid].get(key):
                data = self.read(self.books[bid][key])
                if data:
                    self.check(query["section"][0] in {row["id"] for row in data.get("toc", [])}, "route_book_section_exists", location)
            return
        self.check(False, "known_hash_route", location + ":" + path)

    def link(self, target, location, base=None, document_ids=()):
        self.links += 1
        if not self.check(bool(target), "nonempty_url", location):
            return
        self.private(target, location)
        if target.startswith("#/"):
            self.route(target, location)
            return
        if target.startswith("#"):
            self.check(unquote(target[1:]) in document_ids, "local_anchor_exists", location)
            return
        parsed = urlsplit(target)
        if parsed.scheme in {"https", "http"}:
            self.external_links.add(target)
            return
        if parsed.scheme == "data":
            self.check(target.startswith("data:image/"), "only_image_data_url", location)
            return
        if parsed.scheme in {"mailto", "tel"}:
            self.check(False, "no_private_contact_link", location)
            return
        self.check(not parsed.scheme and not target.startswith(("/", "\\")), "portable_relative_url", location)
        if parsed.scheme or target.startswith(("/", "\\")):
            return
        relative = unquote(parsed.path)
        if not relative:
            return
        destination = ((base or self.site) / relative).resolve()
        if not self.check(destination.is_relative_to(self.site), "url_stays_in_site", location):
            return
        self.check(destination.is_file(), "linked_file_exists", location + ":" + relative)
        if parsed.fragment.startswith("page="):
            self.check(destination.suffix.lower() == ".pdf" and parsed.fragment[5:].isdigit() and int(parsed.fragment[5:]) > 0, "pdf_page_reference", location)

    def markup(self, html, location, base=None, trusted_shell=False):
        parser = Markup()
        parser.feed(html)
        self.check(len(parser.ids) == len(set(parser.ids)), "unique_dom_ids", location)
        self.check(not parser.event_attributes, "no_inline_event_handlers", location)
        if not trusted_shell:
            self.check(not any(parser.tags[tag] for tag in ("script", "iframe", "object", "embed", "form")), "content_is_passive_markup", location)
        for _, target in parser.targets:
            self.link(target, location, base, parser.ids)
        return parser

    def run(self):
        catalog = self.read("data/catalog.json")
        if not catalog:
            return self.result()
        for key, count in (("books", 9), ("chapters", 59), ("videos", 31)):
            values = catalog.get(key, [])
            self.check(len(values) == count, key + "_expected_count", "catalog")
            ids = [row.get("id") for row in values]
            self.check(all(ids) and len(ids) == len(set(ids)), key + "_unique_ids", "catalog")
            setattr(self, key, {row["id"]: row for row in values if row.get("id")})
        self.check(set(self.books) == {"00", "A", "B", "C", "D", "E", "F", "X", "P"}, "book_scope", "catalog")
        expected_chapters = {"00"} | {f"{b}{n:02}" for b, count in (("A", 13), ("B", 5), ("C", 6), ("D", 5), ("E", 6), ("F", 6), ("X", 4), ("P", 13)) for n in range(1, count + 1)}
        self.check(set(self.chapters) == expected_chapters, "complete_chapter_scope", "catalog")

        for cid, chapter in self.chapters.items():
            data = self.read(chapter.get("content", ""))
            if data:
                self.content[cid] = data
        for cid, chapter in self.chapters.items():
            self.check(chapter.get("book") in self.books, "chapter_book_exists", cid)
            self.link(chapter.get("pdf", ""), cid)
            self.check(isinstance(chapter.get("pdfPage"), int) and chapter["pdfPage"] > 0, "chapter_pdf_page", cid)
            ids = chapter.get("videos", [])
            self.check(len(ids) == len(set(ids)), "chapter_videos_unique", cid)
            for vid in ids:
                self.check(vid in self.videos and self.videos[vid].get("chapter") == cid, "chapter_video_mapping", cid)
            for aid in chapter.get("aids", []):
                self.link(aid.get("url", ""), cid + ":aid")
            for chart in chapter.get("maps", []):
                for key in ("url", "pdf"):
                    if chart.get(key): self.link(chart[key], cid + ":map")
            data = self.content.get(cid)
            if not data:
                continue
            self.check(data.get("id") == cid, "content_id_matches", cid)
            self.check(bool(data.get("html", "").strip()), "content_not_empty", cid)
            parser = self.markup(data.get("html", ""), cid)
            for heading in data.get("toc", []):
                self.check(heading.get("id") in parser.ids, "toc_target_exists", cid)
                self.check(heading.get("level") in range(1, 7), "toc_heading_level", cid)

        for bid, book in self.books.items():
            self.link(book.get("pdf", ""), bid + ":book")
            self.check(book.get("chapters") == [cid for cid, c in self.chapters.items() if c.get("book") == bid], "book_chapters_match", bid)
            for key in ("guide", "memory", "memoryContent"):
                if book.get(key):
                    self.link(book[key], bid + ":" + key)
                    if key in {"guide", "memoryContent"}:
                        data = self.read(book[key])
                        if data:
                            self.markup(data.get("html", ""), bid + ":" + key)

        for vid, video in self.videos.items():
            self.check(video.get("chapter") in self.chapters, "video_chapter_exists", vid)
            for key in ("url", "poster", "subtitle"):
                self.check(bool(video.get(key)), "video_" + key + "_provided", vid)
                if video.get(key): self.link(video[key], vid + ":" + key)
            duration = video.get("duration")
            self.check(isinstance(duration, (int, float)) and duration > 0, "positive_video_duration", vid)
            previous = 0
            for scene in video.get("scenes", []):
                start, end = scene.get("start"), scene.get("end")
                ok = isinstance(start, (int, float)) and isinstance(end, (int, float)) and 0 <= start < end <= duration + .01 and start >= previous - .01
                self.check(ok, "video_scene_range", vid)
                if ok: previous = end

        paths = list(self.site.rglob("*"))
        files = []
        for path in paths:
            relative = path.relative_to(self.site).as_posix()
            info = path.lstat()
            self.check(not path.is_symlink() and not (getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 1024)), "no_published_linked_paths", relative)
            self.check(not any(part in FORBIDDEN_COMPONENTS for part in path.relative_to(self.site).parts), "no_private_directories", relative)
            if path.is_file(): files.append(path)
        total_bytes = sum(p.stat().st_size for p in files)
        self.check(total_bytes < 1024 ** 3, "pages_site_under_1gib", "site")
        for path in files:
            relative = path.relative_to(self.site).as_posix()
            self.check(path.stat().st_size < 100 * 1024 ** 2, "file_under_github_100mib", relative)
            if path.suffix.lower() in TEXT_SUFFIXES:
                try:
                    text = path.read_text(encoding="utf-8-sig")
                except UnicodeError:
                    self.check(False, "utf8_text", relative)
                    continue
                self.private(text, relative)
                if path.suffix.lower() in {".html", ".htm"}:
                    self.markup(text, relative, path.parent, trusted_shell=relative in {"index.html", "404.html"})

        manifest = self.read("data/asset-manifest.json")
        if manifest:
            rows = manifest.get("files", [])
            names = [row.get("path") for row in rows]
            self.check(len(names) == len(set(names)), "asset_manifest_unique_paths", "manifest")
            for row in rows:
                path = (self.site / row["path"]).resolve()
                safe = self.check(path.is_relative_to(self.site) and path.is_file(), "manifest_file_exists", row["path"])
                if safe:
                    self.check(digest(path) == row.get("sha256"), "manifest_sha256", row["path"])
                    self.check(path.stat().st_size == row.get("bytes"), "manifest_bytes", row["path"])
            media = {p.relative_to(self.site).as_posix() for p in files if p.is_relative_to(self.site / "media")}
            self.check(media <= set(names), "all_media_allowlisted", "manifest")
            self.check(len([p for p in media if p.endswith(".mp4")]) == 31, "exact_public_video_count", "manifest")

        if self.pdf_scan:
            try:
                from pypdf import PdfReader
            except ImportError:
                self.check(False, "pdf_scan_dependency_available", "pypdf")
            else:
                for path in files:
                    if path.suffix.lower() != ".pdf": continue
                    relative = path.relative_to(self.site).as_posix()
                    try:
                        reader = PdfReader(path)
                        self.private(str(reader.metadata or ""), relative + ":metadata")
                        for page in reader.pages:
                            self.private(page.extract_text() or "", relative + ":text")
                            for annotation in page.get("/Annots", []):
                                obj = annotation.get_object()
                                action = obj.get("/A") or {}
                                if action.get("/URI"):
                                    self.private(str(action["/URI"]), relative + ":link")
                        self.pdfs_scanned += 1
                    except Exception as error:
                        self.errors.append({"check": "pdf_read", "location": relative, "reason": type(error).__name__})
        return self.result(total_bytes, len(files))

    def result(self, total_bytes=0, file_count=0):
        return {"status": "passed" if not self.errors else "failed",
                "checked_utc": datetime.now(timezone.utc).isoformat(),
                "books": len(self.books), "chapters": len(self.chapters), "videos": len(self.videos),
                "file_count": file_count, "bytes": total_bytes,
                "links_checked": self.links, "external_urls": len(self.external_links),
                "pdf_text_scan_requested": self.pdf_scan, "pdfs_scanned": self.pdfs_scanned,
                "checks": dict(self.checks), "errors": self.errors,
                "limits": ["Static files, data contracts, hash identities and navigable targets only.",
                           "External URLs are classified but not network-tested.",
                           "Known private-path and secret patterns are scanned; this is not a complete personal-data classifier.",
                           "No browser layout, audio listening, media playback or learner-effectiveness claim."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, default=Path("site"))
    parser.add_argument("--report", type=Path, default=Path("qa/validation.json"))
    parser.add_argument("--pdf-scan", action="store_true")
    args = parser.parse_args()
    audit = Audit(args.site, args.pdf_scan)
    result = audit.run()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = {key: value for key, value in result.items() if key not in {"checks", "limits"}}
    print(json.dumps(summary, ensure_ascii=False))
    return bool(result["errors"])


if __name__ == "__main__":
    raise SystemExit(main())
