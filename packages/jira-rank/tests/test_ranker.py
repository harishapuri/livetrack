import unittest

from jira_rank.ranker import HashingBackend, cosine_similarity, rank_keyword_order, rank_tickets, ticket_blob


class RankerTests(unittest.TestCase):
    def test_ticket_blob_includes_summary_description_comments(self):
        blob = ticket_blob(
            {
                "summary": "SSO timeout",
                "description": "Users bounce after Okta",
                "comments": [{"body": "still broken on mobile"}],
            }
        )
        self.assertIn("SSO timeout", blob)
        self.assertIn("Okta", blob)
        self.assertIn("mobile", blob)

    def test_cosine_identical_vectors(self):
        self.assertAlmostEqual(cosine_similarity([1, 0, 0], [1, 0, 0]), 1.0)
        self.assertEqual(cosine_similarity([], [1]), 0.0)

    def test_semantic_rank_puts_closer_ticket_first(self):
        tickets = [
            {
                "key": "ABC-1",
                "summary": "printer jammed in lobby",
                "description": "paper tray",
                "status": "Done",
                "assignee": "Ada",
                "comments": [],
                "comment_count": 0,
                "change_count": 0,
            },
            {
                "key": "ABC-2",
                "summary": "SSO login timeout after redirect",
                "description": "Okta callback fails",
                "status": "Open",
                "assignee": "Bob",
                "comments": [{"body": "users cannot sign in"}],
                "comment_count": 1,
                "change_count": 2,
            },
        ]
        ranked = rank_tickets(
            tickets,
            "login times out during SSO",
            backend=HashingBackend(dims=128),
            top_n=2,
            browse_base="https://example.atlassian.net",
        )
        self.assertEqual(ranked[0]["key"], "ABC-2")
        self.assertGreater(ranked[0]["score"], ranked[1]["score"])
        self.assertEqual(ranked[0]["url"], "https://example.atlassian.net/browse/ABC-2")

    def test_keyword_mode_preserves_jira_order(self):
        tickets = [
            {"key": "ABC-9", "summary": "first", "status": "Open", "comment_count": 0, "change_count": 0},
            {"key": "ABC-8", "summary": "second", "status": "Open", "comment_count": 0, "change_count": 0},
        ]
        ranked = rank_keyword_order(tickets, top_n=20, browse_base="https://ex")
        self.assertEqual([row["key"] for row in ranked], ["ABC-9", "ABC-8"])
        self.assertGreater(ranked[0]["score"], ranked[1]["score"])


if __name__ == "__main__":
    unittest.main()
