"""Generate Pydantic models from the trace event JSON Schema.

With --check, exit non-zero if the committed models are stale instead of writing them.
"""

import subprocess
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
SCHEMA = API_ROOT.parents[1] / "packages" / "schema" / "trace-event.schema.json"
OUTPUT = API_ROOT / "src" / "arena" / "schema_gen.py"
HEADER = (
    "# GENERATED from packages/schema/trace-event.schema.json.\n"
    "# Do not edit by hand; run `pnpm schema:gen`."
)


def main() -> int:
    check = "--check" in sys.argv[1:]
    command = [
        "datamodel-codegen",
        "--input", str(SCHEMA),
        "--input-file-type", "jsonschema",
        "--output", str(OUTPUT),
        "--output-model-type", "pydantic_v2.BaseModel",
        "--target-python-version", "3.11",
        "--use-standard-collections",
        "--use-union-operator",
        "--use-title-as-name",
        "--use-annotated",
        "--field-constraints",
        "--collapse-root-models",
        "--enum-field-as-literal", "all",
        "--formatters", "ruff-format",
        "--extra-fields", "forbid",
        "--disable-timestamp",
        "--custom-file-header", HEADER,
    ]  # fmt: skip
    if check:
        command.append("--check")
    result = subprocess.run(command, check=False)
    if result.returncode == 0:
        print("Pydantic trace models are up to date.")
    elif check:
        print("schema_gen.py is stale. Run `pnpm schema:gen`.", file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
