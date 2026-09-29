"""Flatten Atlassian Document Format (ADF) JSON into plain text."""

from __future__ import annotations

from typing import Any


def flatten_adf(node: Any) -> str:
    """Return readable text from an ADF document, nested node, or plain string."""
    if node is None:
        return ""
    if isinstance(node, str):
        return _collapse(node)
    if isinstance(node, (int, float, bool)):
        return str(node)
    if isinstance(node, list):
        return _collapse("\n".join(flatten_adf(item) for item in node))
    if not isinstance(node, dict):
        return ""

    node_type = str(node.get("type") or "")
    if node_type == "text":
        return str(node.get("text") or "")
    if node_type == "hardBreak":
        return "\n"
    if node_type == "mention":
        attrs = node.get("attrs") or {}
        return str(attrs.get("text") or attrs.get("displayName") or "")
    if node_type == "emoji":
        attrs = node.get("attrs") or {}
        return str(attrs.get("text") or attrs.get("shortName") or "")
    if node_type == "inlineCard":
        attrs = node.get("attrs") or {}
        return str(attrs.get("url") or "")
    if node_type in {"media", "mediaSingle", "mediaGroup"}:
        return ""

    parts: list[str] = []
    content = node.get("content")
    if isinstance(content, list):
        for child in content:
            text = flatten_adf(child)
            if text:
                parts.append(text)

    joined = "\n".join(parts) if node_type in {
        "doc",
        "blockquote",
        "bulletList",
        "orderedList",
        "table",
        "tableRow",
        "panel",
        "expand",
        "nestedExpand",
    } else " ".join(parts)

    if node_type in {"paragraph", "heading", "listItem", "tableCell", "tableHeader", "codeBlock"}:
        joined = _collapse(joined)
        return f"{joined}\n" if joined else ""

    return _collapse(joined)


def _collapse(text: str) -> str:
    lines = [line.strip() for line in str(text).replace("\r\n", "\n").split("\n")]
    out: list[str] = []
    blank = False
    for line in lines:
        if not line:
            if out and not blank:
                out.append("")
            blank = True
            continue
        blank = False
        out.append(line)
    return "\n".join(out).strip()
