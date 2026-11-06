import asyncio
import json
from .runner import Sandbox
from .settings import Settings


async def main():
    ready = await Sandbox(Settings.from_env()).probe()
    print(json.dumps({"sandboxReady": ready, "network": "isolated", "executor": "bubblewrap"}))
    if not ready:
        raise SystemExit("Bubblewrap namespace/runtime check failed; do not expose conversion endpoints")


if __name__ == "__main__":
    asyncio.run(main())
