import unittest

from jira_rank.adf import flatten_adf


class AdfFlattenTests(unittest.TestCase):
    def test_plain_string(self):
        self.assertEqual(flatten_adf("already text"), "already text")

    def test_none_and_empty(self):
        self.assertEqual(flatten_adf(None), "")
        self.assertEqual(flatten_adf({}), "")

    def test_doc_paragraphs_and_lists(self):
        doc = {
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "content": [{"type": "text", "text": "Outage"}],
                },
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "text", "text": "SSO"},
                        {"type": "hardBreak"},
                        {"type": "text", "text": "failed"},
                    ],
                },
                {
                    "type": "bulletList",
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "timeout"}],
                                }
                            ],
                        }
                    ],
                },
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "mention", "attrs": {"text": "@Ada"}},
                        {"type": "emoji", "attrs": {"shortName": ":warning:"}},
                    ],
                },
            ],
        }
        text = flatten_adf(doc)
        self.assertIn("Outage", text)
        self.assertIn("SSO", text)
        self.assertIn("failed", text)
        self.assertIn("timeout", text)
        self.assertIn("@Ada", text)
        self.assertIn(":warning:", text)

    def test_nested_list_of_nodes(self):
        text = flatten_adf(
            [
                {"type": "paragraph", "content": [{"type": "text", "text": "one"}]},
                {"type": "paragraph", "content": [{"type": "text", "text": "two"}]},
            ]
        )
        self.assertEqual(text, "one\n\ntwo")


if __name__ == "__main__":
    unittest.main()
