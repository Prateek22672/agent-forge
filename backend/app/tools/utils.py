"""
Small utility tools — a safe calculator and the current date/time.

WHY A CALCULATOR TOOL?
    LLMs are notoriously unreliable at arithmetic. Giving them a calculator tool
    is the canonical example of "offload what the model is bad at to code."
"""
from __future__ import annotations

import ast
import operator
from datetime import datetime, timezone

from langchain_core.tools import tool

# Whitelist of allowed operators — we evaluate an AST, never eval() raw strings.
_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
    ast.USub: operator.neg,
    ast.FloorDiv: operator.floordiv,
}


def _eval(node: ast.AST) -> float:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp):
        return _OPS[type(node.op)](_eval(node.left), _eval(node.right))
    if isinstance(node, ast.UnaryOp):
        return _OPS[type(node.op)](_eval(node.operand))
    raise ValueError("Unsupported expression.")


@tool
def calculator(expression: str) -> str:
    """Evaluate a basic arithmetic expression, e.g. "12.5 * (3 + 4) ** 2".

    Supports + - * / // % ** and parentheses. Use this for any math instead of
    computing it yourself.
    """
    try:
        tree = ast.parse(expression, mode="eval")
        return str(_eval(tree.body))
    except Exception:
        return "Invalid expression."


@tool
def current_datetime() -> str:
    """Return the current UTC date and time in ISO format."""
    return datetime.now(timezone.utc).isoformat()
