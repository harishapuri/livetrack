"""Load Jira Cloud credentials from the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional at test time
    def load_dotenv(*_args, **_kwargs):
        return False


class ConfigError(RuntimeError):
    """Missing or invalid configuration."""


@dataclass(frozen=True)
class JiraConfig:
    base_url: str
    email: str
    api_token: str
    project_key: str = ""
    requests_per_second: float = 3.0
    workers: int = 5
    cache_dir: Path | None = None
    use_cache: bool = True

    @property
    def origin(self) -> str:
        return self.base_url.rstrip("/")

    def browse_url(self, key: str) -> str:
        return f"{self.origin}/browse/{key}"

    def default_jql(self) -> str:
        if self.project_key:
            return f"project = {self.project_key} ORDER BY created DESC"
        return "ORDER BY created DESC"


def load_config(
    *,
    env_file: str | Path | None = None,
    cache_dir: str | Path | None = None,
    use_cache: bool = True,
    requests_per_second: float = 3.0,
    workers: int = 5,
) -> JiraConfig:
    if env_file:
        load_dotenv(env_file, override=False)
    else:
        load_dotenv(override=False)

    base_url = (os.environ.get("JIRA_BASE_URL") or "").strip()
    email = (os.environ.get("JIRA_EMAIL") or "").strip()
    token = (os.environ.get("JIRA_API_TOKEN") or "").strip()
    project_key = (os.environ.get("JIRA_PROJECT_KEY") or os.environ.get("PROJECT_KEY") or "").strip()

    missing = [
        name
        for name, value in (
            ("JIRA_BASE_URL", base_url),
            ("JIRA_EMAIL", email),
            ("JIRA_API_TOKEN", token),
        )
        if not value
    ]
    if missing:
        raise ConfigError(
            "Missing Jira credentials: "
            + ", ".join(missing)
            + ". Set them in the environment or a .env file."
        )

    resolved_cache = Path(cache_dir) if cache_dir else Path.cwd() / ".jira-rank-cache"
    return JiraConfig(
        base_url=base_url,
        email=email,
        api_token=token,
        project_key=project_key,
        requests_per_second=max(0.1, float(requests_per_second)),
        workers=max(1, int(workers)),
        cache_dir=resolved_cache if use_cache else None,
        use_cache=use_cache,
    )
