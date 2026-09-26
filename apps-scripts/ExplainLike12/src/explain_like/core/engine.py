"""
Core explanation engine for ExplainLike12.

Sends the source text to an LLM with the selected audience prompt and
returns the explanation.
"""

import time
from typing import Dict, Optional

from openai import OpenAI

from ..logging_utils import get_logger
from ..prompts import AUDIENCES, LENGTH_INSTRUCTIONS

logger = get_logger("engine")


class ExplainError(Exception):
    """Raised when explanation fails (bad key, network, API error)."""


class Explainer:
    """LLM client for explanation requests."""

    def __init__(self, model: str, api_key: str, base_url: Optional[str] = None,
                 max_retries: int = 3, retry_delay: float = 1.0):
        self.model = model
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        kwargs = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        self.client = OpenAI(**kwargs)

    def explain(self, text: str, audience: str = "12", length: str = "medium") -> str:
        preset = AUDIENCES.get(audience)
        if preset is None:
            raise ExplainError(f"Unknown audience '{audience}'")

        system_prompt = preset["system"]
        if length in LENGTH_INSTRUCTIONS:
            system_prompt += f"\n\n{LENGTH_INSTRUCTIONS[length]}"

        user_prompt = f"Explain the following text:\n\n{text}"

        logger.info(
            "Explaining %d chars | audience=%s | model=%s | length=%s",
            len(text), audience, self.model, length,
        )

        for attempt in range(self.max_retries + 1):  # +1 for the initial attempt
            try:
                resp = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.3,
                    max_tokens=1500,
                )
                explanation = resp.choices[0].message.content.strip()
                usage = resp.usage
                if usage:
                    logger.info(
                        "Explanation done - input: %s tokens, output: %s tokens",
                        usage.prompt_tokens, usage.completion_tokens,
                    )
                return explanation

            except Exception as exc:
                error_msg = str(exc)
                if attempt < self.max_retries:
                    delay = self.retry_delay * (2 ** attempt)
                    logger.warning(
                        "LLM call failed (attempt %d/%d): %s. Retrying in %.1fs...",
                        attempt + 1, self.max_retries + 1, error_msg, delay,
                    )
                    time.sleep(delay)
                else:
                    logger.error("Explanation failed after %d attempts: %s",
                                 self.max_retries + 1, error_msg)
                    raise ExplainError(f"LLM call failed: {error_msg}") from exc

        raise ExplainError("Explanation failed")
