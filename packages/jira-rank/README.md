# Jira ticket ranker

Extract full Jira Cloud tickets (summary, description, comments, changelog) and rank them by relevance to a free-text description.

## Setup

```bash
cd packages/jira-rank
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Create an Atlassian API token at https://id.atlassian.com/manage-your-content/api-tokens and put it in `.env`:

```
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=...
JIRA_PROJECT_KEY=ABC
```

The first semantic run downloads `all-MiniLM-L6-v2` (offline after that).

## Examples

Semantic rank (embeddings):

```bash
python -m jira_rank --query "login timeout after SSO redirect" --top-n 10 --output-dir ./out
```

Keyword search via Jira JQL `text ~ "..."`:

```bash
python -m jira_rank --keyword --query "SSO timeout" --jql "project = ABC ORDER BY updated DESC"
```

Query from a file, skip cache, more workers:

```bash
python -m jira_rank --query-file notes.txt --no-cache --workers 8 --output-dir ./out
```

LiveTrack sidebar: open **Find**, paste a description, Rank. Credentials come from LiveTrack Settings (same Jira URL / email / token).

## Tests

```bash
python -m unittest discover -s tests -v
```

No live Jira calls — HTTP is mocked.
