"""Export and check references without opening or mutating production state."""
from dataclasses import replace
import json
from pathlib import Path
import sys
import tempfile

project = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(project))
from server.app import create_app
from server.settings import Settings

with tempfile.TemporaryDirectory(prefix="md2docx-openapi-") as folder:
    schema = create_app(replace(Settings(), data_dir=Path(folder))).openapi()

def check(node):
    if isinstance(node, dict):
        if "$ref" in node and node["$ref"].startswith("#/"):
            target = schema
            for component in node["$ref"][2:].split("/"):
                target = target[component.replace("~1", "/").replace("~0", "~")]
        for value in node.values():
            check(value)
    elif isinstance(node, list):
        for item in node:
            check(item)
check(schema)
target = project / "server/openapi.json"
target.write_text(json.dumps(schema,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(f"Exported OpenAPI {schema['openapi']} with {len(schema['paths'])} paths; local references resolved")
