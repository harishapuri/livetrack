"""Pluggable embedding backends and cosine ranking."""

from __future__ import annotations

import math
import re
from abc import ABC, abstractmethod
from hashlib import md5
from typing import Any, Iterable, Sequence


class EmbeddingBackend(ABC):
    """Minimal embedding interface so backends can be swapped."""

    @abstractmethod
    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        raise NotImplementedError


class SentenceTransformerBackend(EmbeddingBackend):
    """Offline default: sentence-transformers/all-MiniLM-L6-v2."""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2") -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise RuntimeError(
                "sentence-transformers is required for semantic ranking. "
                "Install with: pip install sentence-transformers"
            ) from exc
        self.model = SentenceTransformer(model_name)

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        vectors = self.model.encode(list(texts), convert_to_numpy=True, show_progress_bar=False)
        return [row.tolist() for row in vectors]


class HashingBackend(EmbeddingBackend):
    """Tiny offline fallback used in tests and when transformers are unavailable."""

    def __init__(self, dims: int = 256) -> None:
        self.dims = dims

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for text in texts:
            vec = [0.0] * self.dims
            for token in tokenize(text):
                idx = int(md5(token.encode("utf-8")).hexdigest(), 16) % self.dims
                vec[idx] += 1.0
            out.append(vec)
        return out


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", str(text or "").lower())


def ticket_blob(ticket: dict[str, Any]) -> str:
    comments = ticket.get("comments") or []
    comment_text = "\n".join(str(item.get("body") or "") for item in comments)
    return "\n".join(
        part
        for part in (
            str(ticket.get("summary") or ""),
            str(ticket.get("description") or ""),
            comment_text,
        )
        if part.strip()
    )


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / math.sqrt(na * nb)


def rank_tickets(
    tickets: Iterable[dict[str, Any]],
    query: str,
    *,
    backend: EmbeddingBackend | None = None,
    top_n: int = 20,
    browse_base: str = "",
) -> list[dict[str, Any]]:
    rows = list(tickets)
    if not rows:
        return []
    embedder = backend or SentenceTransformerBackend()
    blobs = [ticket_blob(ticket) for ticket in rows]
    vectors = embedder.embed([query, *blobs])
    query_vec = vectors[0]
    scored: list[dict[str, Any]] = []
    origin = browse_base.rstrip("/")
    for ticket, vector in zip(rows, vectors[1:]):
        key = str(ticket.get("key") or "")
        url = str(ticket.get("url") or "")
        if not url and origin and key:
            url = f"{origin}/browse/{key}"
        scored.append(
            {
                "score": round(cosine_similarity(query_vec, vector), 6),
                "key": key,
                "summary": str(ticket.get("summary") or ""),
                "status": str(ticket.get("status") or ""),
                "assignee": str(ticket.get("assignee") or ""),
                "url": url,
                "comment_count": int(ticket.get("comment_count") or 0),
                "change_count": int(ticket.get("change_count") or 0),
                "ticket": ticket,
            }
        )
    scored.sort(key=lambda row: row["score"], reverse=True)
    limit = max(1, int(top_n))
    return scored[:limit]


def rank_keyword_order(
    tickets: Iterable[dict[str, Any]],
    *,
    top_n: int = 20,
    browse_base: str = "",
) -> list[dict[str, Any]]:
    """Preserve Jira text-search order and assign a decaying score."""
    origin = browse_base.rstrip("/")
    ranked: list[dict[str, Any]] = []
    rows = list(tickets)
    total = max(len(rows), 1)
    for index, ticket in enumerate(rows):
        key = str(ticket.get("key") or "")
        url = str(ticket.get("url") or "")
        if not url and origin and key:
            url = f"{origin}/browse/{key}"
        ranked.append(
            {
                "score": round(1.0 - (index / total), 6),
                "key": key,
                "summary": str(ticket.get("summary") or ""),
                "status": str(ticket.get("status") or ""),
                "assignee": str(ticket.get("assignee") or ""),
                "url": url,
                "comment_count": int(ticket.get("comment_count") or 0),
                "change_count": int(ticket.get("change_count") or 0),
                "ticket": ticket,
            }
        )
    return ranked[: max(1, int(top_n))]
