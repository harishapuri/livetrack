import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock

from jira_rank.config import JiraConfig
from jira_rank.jira_client import JiraClient, keyword_jql


def issue(key, summary="s"):
    return {
        "key": key,
        "fields": {
            "summary": summary,
            "description": {"type": "doc", "content": []},
            "status": {"name": "Open"},
            "assignee": {"displayName": "Ada"},
            "created": "2026-01-01T00:00:00.000Z",
            "updated": "2026-01-02T00:00:00.000Z",
        },
    }


class PaginationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = JiraConfig(
            base_url="https://example.atlassian.net",
            email="a@b.com",
            api_token="token",
            project_key="ABC",
            cache_dir=Path(self.tmp.name),
            use_cache=False,
        )
        self.client = JiraClient(self.config, sleeper=lambda _s: None)
        self.client.limiter.wait = lambda: None

    def test_search_follows_start_at_until_total(self):
        pages = [
            {"startAt": 0, "maxResults": 2, "total": 5, "issues": [issue("ABC-1"), issue("ABC-2")]},
            {"startAt": 2, "maxResults": 2, "total": 5, "issues": [issue("ABC-3"), issue("ABC-4")]},
            {"startAt": 4, "maxResults": 2, "total": 5, "issues": [issue("ABC-5")]},
        ]

        def fake_request(method, url, params=None, timeout=60):
            self.assertIn("/rest/api/3/search", url)
            idx = int(params["startAt"] / 2)
            payload = pages[idx]
            response = MagicMock()
            response.status_code = 200
            response.content = b"{}"
            response.json.return_value = payload
            response.headers = {}
            return response

        self.client.session.request = fake_request
        issues = self.client.search_issues("project = ABC", max_results=2)
        self.assertEqual([row["key"] for row in issues], ["ABC-1", "ABC-2", "ABC-3", "ABC-4", "ABC-5"])

    def test_comments_and_changelog_paginate(self):
        def fake_request(method, url, params=None, timeout=60):
            response = MagicMock()
            response.status_code = 200
            response.content = b"{}"
            response.headers = {}
            start = int(params.get("startAt") or 0)
            if url.endswith("/comment"):
                if start == 0:
                    response.json.return_value = {
                        "startAt": 0,
                        "maxResults": 1,
                        "total": 2,
                        "comments": [
                            {
                                "id": "1",
                                "author": {"displayName": "Ada"},
                                "created": "t1",
                                "updated": "t1",
                                "body": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "hi"}]}]},
                            }
                        ],
                    }
                else:
                    response.json.return_value = {
                        "startAt": 1,
                        "maxResults": 1,
                        "total": 2,
                        "comments": [
                            {
                                "id": "2",
                                "author": {"displayName": "Bob"},
                                "created": "t2",
                                "updated": "t2",
                                "body": "plain",
                            }
                        ],
                    }
            else:
                if start == 0:
                    response.json.return_value = {
                        "startAt": 0,
                        "maxResults": 1,
                        "total": 2,
                        "isLast": False,
                        "values": [
                            {
                                "id": "10",
                                "author": {"displayName": "Ada"},
                                "created": "c1",
                                "items": [{"field": "status", "fromString": "Open", "toString": "Done"}],
                            }
                        ],
                    }
                else:
                    response.json.return_value = {
                        "startAt": 1,
                        "maxResults": 1,
                        "total": 2,
                        "isLast": True,
                        "values": [
                            {
                                "id": "11",
                                "author": {"displayName": "Ada"},
                                "created": "c2",
                                "items": [{"field": "assignee", "fromString": None, "toString": "Bob"}],
                            }
                        ],
                    }
            return response

        self.client.session.request = fake_request
        comments = self.client.fetch_comments("ABC-1", page_size=1)
        changes = self.client.fetch_changelog("ABC-1", page_size=1)
        self.assertEqual(len(comments), 2)
        self.assertEqual(comments[0]["body"], "hi")
        self.assertEqual(comments[1]["author"], "Bob")
        self.assertEqual(len(changes), 2)
        self.assertEqual(changes[0]["items"][0]["toString"], "Done")

    def test_keyword_jql_keeps_order_by(self):
        self.assertEqual(
            keyword_jql("login timeout", "project = ABC ORDER BY created DESC"),
            '(project = ABC) AND text ~ "login timeout" ORDER BY created DESC',
        )

    def test_writes_cache_when_enabled(self):
        self.config = JiraConfig(
            base_url="https://example.atlassian.net",
            email="a@b.com",
            api_token="token",
            cache_dir=Path(self.tmp.name),
            use_cache=True,
        )
        self.client = JiraClient(self.config, sleeper=lambda _s: None)
        self.client.limiter.wait = lambda: None
        calls = {"n": 0}

        def fake_request(method, url, params=None, timeout=60):
            calls["n"] += 1
            response = MagicMock()
            response.status_code = 200
            response.content = b"{}"
            response.headers = {}
            response.json.return_value = {"ok": True, "n": calls["n"]}
            return response

        self.client.session.request = fake_request
        first = self.client.request_json("GET", "/rest/api/3/myself")
        second = self.client.request_json("GET", "/rest/api/3/myself")
        self.assertEqual(first, second)
        self.assertEqual(calls["n"], 1)
        self.assertTrue(any(Path(self.tmp.name).glob("*.json")))


if __name__ == "__main__":
    unittest.main()
