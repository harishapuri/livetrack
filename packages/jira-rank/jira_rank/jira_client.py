"""Jira Cloud REST client with retries, throttling, cache, and pagination."""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable
import requests
from requests.auth import HTTPBasicAuth

from .adf import flatten_adf
from .config import JiraConfig

LOGGER = logging.getLogger("jira_rank")

SEARCH_FIELDS = [
    "key",
    "summary",
    "description",
    "status",
    "assignee",
    "reporter",
    "priority",
    "labels",
    "components",
    "created",
    "updated",
    "resolutiondate",
]


class JiraAuthError(RuntimeError):
    """Credentials rejected (HTTP 401)."""


class JiraApiError(RuntimeError):
    """Non-auth HTTP failure after retries."""


class RateLimiter:
    """Process-wide request throttle shared by the thread pool."""

    def __init__(self, requests_per_second: float = 3.0) -> None:
        self.min_interval = 1.0 / max(0.1, float(requests_per_second))
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            delay = self._next - now
            if delay > 0:
                time.sleep(delay)
                now = time.monotonic()
            self._next = now + self.min_interval


class JiraClient:
    def __init__(
        self,
        config: JiraConfig,
        *,
        session: requests.Session | None = None,
        limiter: RateLimiter | None = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self.config = config
        self.session = session or requests.Session()
        self.session.auth = HTTPBasicAuth(config.email, config.api_token)
        self.session.headers.update(
            {
                "Accept": "application/json",
                "Content-Type": "application/json",
            }
        )
        self.limiter = limiter or RateLimiter(config.requests_per_second)
        self._sleep = sleeper
        if config.cache_dir:
            config.cache_dir.mkdir(parents=True, exist_ok=True)

    def close(self) -> None:
        self.session.close()

    def request_json(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        cache: bool = True,
        max_retries: int = 6,
    ) -> Any:
        url = f"{self.config.origin}{path}"
        cache_key = self._cache_key(method, url, params)
        if cache and self.config.use_cache and self.config.cache_dir:
            cached = self._read_cache(cache_key)
            if cached is not None:
                return cached

        last_error: Exception | None = None
        for attempt in range(max_retries):
            self.limiter.wait()
            try:
                response = self.session.request(method, url, params=params, timeout=60)
            except requests.RequestException as exc:
                last_error = exc
                self._sleep(min(2 ** attempt, 30))
                continue

            if response.status_code == 401:
                raise JiraAuthError(
                    "Jira authentication failed (401). Check JIRA_EMAIL and JIRA_API_TOKEN."
                )
            if response.status_code in {429} or response.status_code >= 500:
                wait = self._retry_after(response, attempt)
                LOGGER.warning(
                    "Jira %s %s returned %s; retrying in %.1fs",
                    method,
                    path,
                    response.status_code,
                    wait,
                )
                self._sleep(wait)
                continue
            if response.status_code >= 400:
                raise JiraApiError(
                    f"Jira {method} {path} failed ({response.status_code}): {response.text[:400]}"
                )
            payload = response.json() if response.content else {}
            if cache and self.config.use_cache and self.config.cache_dir:
                self._write_cache(cache_key, payload)
            return payload

        raise JiraApiError(f"Jira {method} {path} failed after retries: {last_error}")

    def search_issues(
        self,
        jql: str,
        *,
        max_results: int = 50,
        fields: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Paginate GET /rest/api/3/search until every issue is retrieved."""
        start_at = 0
        issues: list[dict[str, Any]] = []
        field_list = ",".join(fields or SEARCH_FIELDS)
        while True:
            payload = self.request_json(
                "GET",
                "/rest/api/3/search",
                params={
                    "jql": jql,
                    "startAt": start_at,
                    "maxResults": max_results,
                    "fields": field_list,
                },
            )
            batch = list(payload.get("issues") or [])
            issues.extend(batch)
            total = int(payload.get("total") or 0)
            LOGGER.info("Fetched issues %s–%s of %s", start_at + 1, start_at + len(batch), total or "?")
            if not batch:
                break
            start_at += len(batch)
            page_size = int(payload.get("maxResults") or max_results)
            if start_at >= total or len(batch) < page_size:
                break
        return issues

    def fetch_comments(self, key: str, *, page_size: int = 100) -> list[dict[str, Any]]:
        start_at = 0
        comments: list[dict[str, Any]] = []
        while True:
            payload = self.request_json(
                "GET",
                f"/rest/api/3/issue/{key}/comment",
                params={"startAt": start_at, "maxResults": page_size},
            )
            batch = list(payload.get("comments") or [])
            comments.extend(self._normalize_comments(batch))
            total = int(payload.get("total") or 0)
            start_at += len(batch)
            if not batch or start_at >= total:
                break
        return comments

    def fetch_changelog(self, key: str, *, page_size: int = 100) -> list[dict[str, Any]]:
        start_at = 0
        histories: list[dict[str, Any]] = []
        while True:
            payload = self.request_json(
                "GET",
                f"/rest/api/3/issue/{key}/changelog",
                params={"startAt": start_at, "maxResults": page_size},
            )
            batch = list(payload.get("values") or [])
            histories.extend(self._normalize_changelog(batch))
            total = int(payload.get("total") or 0)
            is_last = bool(payload.get("isLast"))
            start_at += len(batch)
            if not batch or is_last or (total and start_at >= total):
                break
        return histories

    def extract_tickets(
        self,
        jql: str,
        *,
        workers: int | None = None,
        on_progress: Callable[[str, int, int], None] | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
        issues = self.search_issues(jql)
        tickets: list[dict[str, Any]] = []
        failures: list[dict[str, str]] = []
        total = len(issues)
        pool = max(1, workers or self.config.workers)

        def load_one(issue: dict[str, Any]) -> dict[str, Any]:
            key = str(issue.get("key") or "")
            comments = self.fetch_comments(key)
            changelog = self.fetch_changelog(key)
            return assemble_ticket(issue, comments, changelog, self.config.origin)

        LOGGER.info("Loading comments and changelog for %s tickets (%s workers)", total, pool)
        done = 0
        with ThreadPoolExecutor(max_workers=pool) as executor:
            futures = {executor.submit(load_one, issue): issue for issue in issues}
            for future in as_completed(futures):
                issue = futures[future]
                key = str(issue.get("key") or "?")
                done += 1
                try:
                    tickets.append(future.result())
                    if on_progress:
                        on_progress(key, done, total)
                    LOGGER.info("Loaded %s (%s/%s)", key, done, total)
                except JiraAuthError:
                    raise
                except Exception as exc:  # noqa: BLE001 — skip failed tickets, keep the run
                    LOGGER.exception("Skipping %s: %s", key, exc)
                    failures.append({"key": key, "error": str(exc)})
                    if on_progress:
                        on_progress(key, done, total)

        tickets.sort(key=lambda row: str(row.get("key") or ""))
        return tickets, failures

    def _cache_key(self, method: str, url: str, params: dict[str, Any] | None) -> str:
        blob = json.dumps({"method": method, "url": url, "params": params or {}}, sort_keys=True)
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()

    def _cache_path(self, key: str) -> Path:
        assert self.config.cache_dir is not None
        return self.config.cache_dir / f"{key}.json"

    def _read_cache(self, key: str) -> Any | None:
        path = self._cache_path(key)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def _write_cache(self, key: str, payload: Any) -> None:
        path = self._cache_path(key)
        path.write_text(json.dumps(payload), encoding="utf-8")

    @staticmethod
    def _retry_after(response: requests.Response, attempt: int) -> float:
        header = response.headers.get("Retry-After")
        if header:
            try:
                return max(0.5, float(header))
            except ValueError:
                pass
        return min(2 ** attempt, 30)

    @staticmethod
    def _normalize_comments(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out = []
        for comment in raw:
            author = comment.get("author") or {}
            out.append(
                {
                    "id": comment.get("id"),
                    "author": author.get("displayName") or author.get("emailAddress") or "",
                    "created": comment.get("created") or "",
                    "updated": comment.get("updated") or "",
                    "body": flatten_adf(comment.get("body")),
                }
            )
        return out

    @staticmethod
    def _normalize_changelog(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out = []
        for entry in raw:
            author = entry.get("author") or {}
            items = []
            for item in entry.get("items") or []:
                items.append(
                    {
                        "field": item.get("field") or "",
                        "fromString": item.get("fromString"),
                        "toString": item.get("toString"),
                    }
                )
            out.append(
                {
                    "id": str(entry.get("id") or ""),
                    "author": author.get("displayName") or author.get("emailAddress") or "",
                    "created": entry.get("created") or "",
                    "items": items,
                }
            )
        return out


def display_name(user: Any) -> str:
    if not isinstance(user, dict):
        return ""
    return str(user.get("displayName") or user.get("emailAddress") or "")


def assemble_ticket(
    issue: dict[str, Any],
    comments: list[dict[str, Any]],
    changelog: list[dict[str, Any]],
    base_url: str = "",
) -> dict[str, Any]:
    fields = issue.get("fields") or {}
    key = str(issue.get("key") or "")
    status = fields.get("status") or {}
    origin = str(base_url or "").rstrip("/")
    return {
        "key": key,
        "summary": str(fields.get("summary") or ""),
        "description": flatten_adf(fields.get("description")),
        "status": str(status.get("name") or ""),
        "assignee": display_name(fields.get("assignee")),
        "reporter": display_name(fields.get("reporter")),
        "priority": str((fields.get("priority") or {}).get("name") or ""),
        "labels": list(fields.get("labels") or []),
        "components": [
            str(item.get("name") or "")
            for item in (fields.get("components") or [])
            if isinstance(item, dict)
        ],
        "created": str(fields.get("created") or ""),
        "updated": str(fields.get("updated") or ""),
        "resolutiondate": str(fields.get("resolutiondate") or ""),
        "comments": comments,
        "changelog": changelog,
        "comment_count": len(comments),
        "change_count": sum(len(entry.get("items") or []) for entry in changelog),
        "url": f"{origin}/browse/{key}" if origin and key else "",
    }


def keyword_jql(query: str, base_jql: str) -> str:
    """AND Jira text search onto a base JQL clause."""
    escaped = query.replace("\\", "\\\\").replace('"', '\\"')
    text_clause = f'text ~ "{escaped}"'
    core = base_jql.strip()
    order = ""
    upper = core.upper()
    idx = upper.rfind(" ORDER BY ")
    if idx >= 0:
        order = core[idx:]
        core = core[:idx].strip()
    if core:
        return f"({core}) AND {text_clause}{order}"
    return f"{text_clause}{order or ' ORDER BY created DESC'}"


def cache_key_for_debug(method: str, url: str, params: dict[str, Any] | None) -> str:
    blob = json.dumps({"method": method, "url": url, "params": params or {}}, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()
