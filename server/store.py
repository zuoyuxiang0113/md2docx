from contextlib import contextmanager
import hashlib
import json
import secrets
import sqlite3
import time
from .errors import ApiError

TERMINAL = {"succeeded", "partially_succeeded", "failed", "cancelled", "timed_out", "expired"}
ACTIVE = {"queued", "running", "cancelling"}


class Store:
    def __init__(self, settings):
        self.settings = settings
        settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        settings.data_dir.chmod(0o700)
        self.path = settings.data_dir / "state.sqlite3"
        with self.db() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, idem TEXT, fingerprint TEXT,
                    status TEXT NOT NULL, created REAL NOT NULL, expires REAL, payload TEXT NOT NULL,
                    UNIQUE(owner, idem));
                CREATE TABLE IF NOT EXISTS rates (id TEXT PRIMARY KEY, count INTEGER, expires REAL);
                CREATE INDEX IF NOT EXISTS jobs_state ON jobs(status,created);
                CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner,status);
            """)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def rate(self, scope, remote, limit):
        now = time.time()
        window = int(now // 60)
        key = hashlib.sha256(f"{scope}:{remote}:{window}".encode()).hexdigest()
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM rates WHERE expires < ?", (now,))
            row = db.execute("SELECT count FROM rates WHERE id=?", (key,)).fetchone()
            if row and row[0] >= limit:
                raise ApiError(429, "RATE_LIMITED", "请求过于频繁，请稍后重试。", retry_after=60 - int(now % 60))
            if not row and db.execute("SELECT count(*) FROM rates").fetchone()[0] >= 8000:
                raise ApiError(503, "SERVICE_BUSY", "当前服务繁忙，请稍后重试。", retry_after=30)
            db.execute("INSERT INTO rates VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1", (key, (window + 1) * 60))

    def session(self):
        token = secrets.token_urlsafe(32)
        owner = hashlib.sha256(token.encode()).hexdigest()
        expires = time.time() + self.settings.session_seconds
        with self.db() as db:
            db.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
            if db.execute("SELECT count(*) FROM sessions").fetchone()[0] >= self.settings.max_sessions:
                raise ApiError(503, "SERVICE_BUSY", "临时会话数量已达上限。", retry_after=60)
            db.execute("INSERT INTO sessions VALUES(?,?)", (owner, expires))
        return token, expires

    def authenticate(self, token):
        if not token or len(token) > 128:
            raise ApiError(401, "SESSION_REQUIRED", "请先创建免费临时会话。")
        owner = hashlib.sha256(token.encode()).hexdigest()
        with self.db() as db:
            row = db.execute("SELECT expires FROM sessions WHERE id=?", (owner,)).fetchone()
        if not row or row[0] <= time.time():
            raise ApiError(401, "SESSION_EXPIRED", "临时会话无效或已过期。")
        return owner

    def get(self, job_id, owner=None):
        with self.db() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row or (owner is not None and row["owner"] != owner):
            raise ApiError(404, "RESOURCE_NOT_FOUND", "任务不存在。")
        return json.loads(row["payload"])

    def existing(self, owner, key, fingerprint):
        if key is None:
            return None
        with self.db() as db:
            row = db.execute("SELECT * FROM jobs WHERE owner=? AND idem=?", (owner, key)).fetchone()
        if not row:
            return None
        if row["fingerprint"] != fingerprint:
            raise ApiError(409, "IDEMPOTENCY_CONFLICT", "同一个幂等键不能用于不同内容。")
        job = json.loads(row["payload"])
        if job["status"] == "expired" or (row["expires"] is not None and row["expires"] <= time.time()):
            raise ApiError(410, "RESOURCE_EXPIRED", "原任务已过期或删除，请使用新的幂等键重新提交。")
        return job

    def insert(self, owner, key, fingerprint, job):
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            active = db.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','running','cancelling')").fetchone()[0]
            own = db.execute("SELECT count(*) FROM jobs WHERE owner=? AND status IN ('queued','running','cancelling')", (owner,)).fetchone()[0]
            if active >= self.settings.max_queue:
                raise ApiError(503, "QUEUE_FULL", "转换队列已满，请稍后重试。", retry_after=15)
            if own >= self.settings.max_active_per_session:
                raise ApiError(429, "CONCURRENT_LIMIT", "该会话的活跃任务已达上限。", retry_after=15)
            if db.execute("SELECT count(*) FROM jobs").fetchone()[0] >= self.settings.max_jobs:
                raise ApiError(503, "STORAGE_BUSY", "任务存储已达上限。", retry_after=60)
            now = time.time()
            db.execute("INSERT INTO jobs VALUES(?,?,?,?,?,?,NULL,?)", (job["jobId"], owner, key, fingerprint, job["status"], now, json.dumps(job)))
            # Keep access alive longer than the newly accepted task's retention.
            db.execute("UPDATE sessions SET expires=max(expires,?) WHERE id=?", (now + self.settings.session_seconds, owner))

    def save(self, job):
        with self.db() as db:
            db.execute("UPDATE jobs SET status=?, expires=?, payload=? WHERE id=?", (job["status"], job.get("_expires"), json.dumps(job), job["jobId"]))

    def next_job(self):
        with self.db() as db:
            row = db.execute("SELECT payload FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
        return json.loads(row[0]) if row else None

    def all(self, statuses=None):
        with self.db() as db:
            rows = db.execute("SELECT payload FROM jobs").fetchall()
        values = [json.loads(row[0]) for row in rows]
        return [v for v in values if statuses is None or v["status"] in statuses]

    def expire(self, job):
        # Keep a small ownership/idempotency tombstone, never document data.
        self.save({"jobId": job["jobId"], "status": "expired", "_expires": time.time(), "items": []})

    def prune(self):
        now = time.time()
        with self.db() as db:
            db.execute("DELETE FROM jobs WHERE status='expired' AND expires < ?", (now - 86400,))
            db.execute("DELETE FROM sessions WHERE expires < ?", (now,))
            db.execute("DELETE FROM rates WHERE expires < ?", (now,))
