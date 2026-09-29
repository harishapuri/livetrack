"""Command-line entry: extract Jira tickets and rank them."""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from pathlib import Path
from typing import Any, Sequence

from .config import ConfigError, load_config
from .jira_client import JiraAuthError, JiraClient, JiraApiError, keyword_jql
from .ranker import HashingBackend, SentenceTransformerBackend, rank_keyword_order, rank_tickets

LOGGER = logging.getLogger("jira_rank")


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract Jira Cloud tickets and rank them by relevance to a description.",
    )
    parser.add_argument("--jql", default="", help="JQL query. Default: project = <JIRA_PROJECT_KEY> ORDER BY created DESC")
    parser.add_argument("--query", default="", help="Free-text description to match against tickets")
    parser.add_argument("--query-file", default="", help="Read the description from a file")
    parser.add_argument("--top-n", type=int, default=20, help="Number of ranked results to keep (default 20)")
    parser.add_argument(
        "--keyword",
        action="store_true",
        help='Use Jira JQL text ~ "..." instead of embeddings',
    )
    parser.add_argument("--output-dir", default=".", help="Directory for JSON and CSV output")
    parser.add_argument("--no-cache", action="store_true", help="Do not read or write the on-disk HTTP cache")
    parser.add_argument("--workers", type=int, default=5, help="Thread-pool size for comments/changelog (default 5)")
    parser.add_argument("--rps", type=float, default=3.0, help="Global requests per second (default 3)")
    parser.add_argument("--cache-dir", default="", help="HTTP cache directory (default ./.jira-rank-cache)")
    parser.add_argument(
        "--hash-embeddings",
        action="store_true",
        help="Use the hashing backend instead of sentence-transformers (tests / no GPU)",
    )
    parser.add_argument("--json-stdout", action="store_true", help="Print ranked JSON to stdout")
    parser.add_argument("--env-file", default="", help="Optional .env path")
    return parser.parse_args(argv)


def read_query(args: argparse.Namespace) -> str:
    if args.query_file:
        return Path(args.query_file).read_text(encoding="utf-8").strip()
    if args.query:
        return str(args.query).strip()
    if not sys.stdin.isatty():
        return sys.stdin.read().strip()
    raise SystemExit("Provide --query, --query-file, or pipe a description on stdin.")


def write_outputs(output_dir: Path, ranked: list[dict[str, Any]], failures: list[dict[str, str]]) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "jira-rank-results.json"
    csv_path = output_dir / "jira-rank-summary.csv"
    serializable = []
    for row in ranked:
        item = dict(row)
        item["ticket"] = row.get("ticket")
        serializable.append(item)
    json_path.write_text(
        json.dumps({"results": serializable, "failures": failures}, indent=2),
        encoding="utf-8",
    )
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["score", "key", "summary", "status", "assignee", "url", "comment_count", "change_count"],
        )
        writer.writeheader()
        for row in ranked:
            writer.writerow({field: row.get(field, "") for field in writer.fieldnames})
    return json_path, csv_path


def print_table(ranked: list[dict[str, Any]]) -> None:
    if not ranked:
        print("No matching tickets.")
        return
    print(f"{'SCORE':<8} {'KEY':<14} {'STATUS':<16} SUMMARY")
    print("-" * 88)
    for row in ranked:
        summary = str(row.get("summary") or "").replace("\n", " ")
        if len(summary) > 52:
            summary = summary[:49] + "..."
        print(
            f"{row.get('score', 0):<8.4f} {str(row.get('key') or ''):<14} "
            f"{str(row.get('status') or ''):<16} {summary}"
        )
        url = row.get("url") or ""
        if url:
            print(f"{'':8} {url}")


def run(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = parse_args(argv)
    try:
        query = read_query(args)
        config = load_config(
            env_file=args.env_file or None,
            cache_dir=args.cache_dir or None,
            use_cache=not args.no_cache,
            requests_per_second=args.rps,
            workers=args.workers,
        )
        jql = args.jql.strip() or config.default_jql()
        if args.keyword:
            jql = keyword_jql(query, jql)
        client = JiraClient(config)
        try:
            tickets, failures = client.extract_tickets(jql, workers=args.workers)
        finally:
            client.close()
        if args.keyword:
            ranked = rank_keyword_order(tickets, top_n=args.top_n, browse_base=config.origin)
        else:
            backend = HashingBackend() if args.hash_embeddings else SentenceTransformerBackend()
            ranked = rank_tickets(
                tickets,
                query,
                backend=backend,
                top_n=args.top_n,
                browse_base=config.origin,
            )
        out_dir = Path(args.output_dir)
        json_path, csv_path = write_outputs(out_dir, ranked, failures)
        if args.json_stdout:
            print(
                json.dumps(
                    {
                        "ok": True,
                        "jql": jql,
                        "results": ranked,
                        "failures": failures,
                        "json_path": str(json_path),
                        "csv_path": str(csv_path),
                    }
                )
            )
        else:
            print_table(ranked)
            if failures:
                print(f"\nSkipped {len(failures)} ticket(s). See {json_path}")
            print(f"\nWrote {json_path}")
            print(f"Wrote {csv_path}")
        return 0
    except ConfigError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except JiraAuthError as exc:
        print(str(exc), file=sys.stderr)
        return 3
    except JiraApiError as exc:
        print(str(exc), file=sys.stderr)
        return 4


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
