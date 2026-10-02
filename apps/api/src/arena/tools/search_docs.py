"""BM25 keyword search over the bundled document corpus.

No live web and no embeddings: the same query against the same corpus always
returns the same passages, so runs are reproducible.
"""

import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from arena.tools.base import ToolResult, string_argument

K1 = 1.5
B = 0.75
TOP_K = 5
_WORD = re.compile(r"[a-z0-9]+")


@dataclass(frozen=True)
class Passage:
    document: str
    heading: str
    text: str
    terms: tuple[str, ...]


def tokenize(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def split_passages(document: str, markdown: str) -> list[Passage]:
    """One passage per paragraph, each remembering the heading it sits under."""
    passages = []
    heading = document
    for block in re.split(r"\n\s*\n", markdown):
        block = block.strip()
        if not block:
            continue
        if block.startswith("#"):
            heading = block.lstrip("#").strip()
            continue
        # The heading is indexed with the paragraph so a query can match either.
        passages.append(Passage(document, heading, block, tuple(tokenize(f"{heading} {block}"))))
    return passages


class Bm25Index:
    def __init__(self, passages: list[Passage]) -> None:
        self.passages = passages
        self._counts = [Counter(p.terms) for p in passages]
        self._lengths = [len(p.terms) for p in passages]
        self._average_length = sum(self._lengths) / len(passages) if passages else 0.0
        document_frequency: Counter[str] = Counter()
        for counts in self._counts:
            document_frequency.update(counts.keys())
        total = len(passages)
        self._idf = {
            term: math.log(1 + (total - frequency + 0.5) / (frequency + 0.5))
            for term, frequency in document_frequency.items()
        }

    def _score(self, index: int, terms: list[str]) -> float:
        counts = self._counts[index]
        norm = K1 * (1 - B + B * self._lengths[index] / self._average_length)
        return sum(
            self._idf[term] * counts[term] * (K1 + 1) / (counts[term] + norm)
            for term in terms
            if term in counts
        )

    def search(self, query: str, top_k: int = TOP_K) -> list[tuple[Passage, float]]:
        terms = tokenize(query)
        scored = [(self._score(i, terms), i) for i in range(len(self.passages))]
        # Ties break on position, so the order never depends on hashing.
        ranked = sorted((s, i) for s, i in scored if s > 0)
        ranked.sort(key=lambda pair: (-pair[0], pair[1]))
        return [(self.passages[i], score) for score, i in ranked[:top_k]]


def load_corpus(corpus_dir: Path) -> Bm25Index:
    passages: list[Passage] = []
    for path in sorted(corpus_dir.glob("*.md")):
        passages.extend(split_passages(path.stem, path.read_text(encoding="utf-8")))
    return Bm25Index(passages)


class SearchDocs:
    name = "search_docs"
    description = (
        "Search the bundled document collection by keywords. Returns the best matching "
        "passages, each with the document it comes from. There is no web access."
    )
    parameters: dict[str, Any] = {  # noqa: RUF012 - read-only schema
        "type": "object",
        "properties": {"query": {"type": "string", "description": "Keywords to search for"}},
        "required": ["query"],
    }

    def __init__(self, corpus_dir: Path) -> None:
        self._index = load_corpus(corpus_dir)

    async def run(self, arguments: dict[str, Any]) -> ToolResult:
        query = string_argument(arguments, "query")
        if query is None:
            return ToolResult.failure("'query' must be a non-empty string")
        hits = self._index.search(query)
        if not hits:
            return ToolResult("No matching passages.")
        return ToolResult(
            "\n\n".join(f"[{p.document}] {p.heading}\n{p.text}" for p, _score in hits)
        )
