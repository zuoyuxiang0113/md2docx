import argparse
import os
import uvicorn


def main():
    parser = argparse.ArgumentParser(description="MD2DOCX anonymous conversion API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--docs", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be 1..65535")
    if args.docs:
        os.environ["MD2DOCX_DOCS"] = "1"
    uvicorn.run("server.app:create_app", factory=True, host=args.host, port=args.port, workers=1,
                access_log=False, proxy_headers=False, ws="none", http="h11",
                limit_concurrency=32, timeout_keep_alive=5, h11_max_incomplete_event_size=16384)


if __name__ == "__main__":
    main()
