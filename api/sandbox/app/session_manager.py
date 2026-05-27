import threading
import time
from pathlib import Path


class SessionManager:
    def __init__(self, base_dir: str, ttl_seconds: int = 3600):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.ttl_seconds = ttl_seconds
        self._lock = threading.Lock()
        self._last_access = {}

    def get_workspace(self, session_id: str) -> Path:
        safe_session = self._sanitize_session_id(session_id)
        workspace = self.base_dir / safe_session
        self._ensure_workspace_layout(workspace)
        with self._lock:
            self._last_access[safe_session] = int(time.time())
        return workspace

    def touch(self, session_id: str) -> None:
        safe_session = self._sanitize_session_id(session_id)
        with self._lock:
            self._last_access[safe_session] = int(time.time())

    def cleanup_expired(self) -> None:
        now = int(time.time())
        expired = []
        with self._lock:
            for session_id, ts in self._last_access.items():
                if now - ts > self.ttl_seconds:
                    expired.append(session_id)
            for session_id in expired:
                self._last_access.pop(session_id, None)

        for session_id in expired:
            workspace = self.base_dir / session_id
            self._safe_rmtree(workspace)

    def list_sessions(self):
        self.cleanup_expired()
        sessions = []
        with self._lock:
            items = list(self._last_access.items())
        for session_id, ts in items:
            sessions.append(self.get_session_info(session_id, include_cleanup=False, fallback_ts=ts))
        sessions.sort(key=lambda x: x.get("last_access", 0), reverse=True)
        return sessions

    def get_session_info(self, session_id: str, include_cleanup: bool = True, fallback_ts: int = 0):
        if include_cleanup:
            self.cleanup_expired()
        safe_session = self._sanitize_session_id(session_id)
        workspace = self.base_dir / safe_session
        with self._lock:
            last_access = self._last_access.get(safe_session, fallback_ts)
        exists = workspace.exists()
        file_count = 0
        total_bytes = 0
        if exists:
            for path in workspace.rglob("*"):
                if path.is_file():
                    file_count += 1
                    try:
                        total_bytes += path.stat().st_size
                    except OSError:
                        pass
        return {
            "session_id": safe_session,
            "workspace": str(workspace),
            "exists": exists,
            "last_access": last_access,
            "file_count": file_count,
            "total_bytes": total_bytes,
            "ttl_seconds": self.ttl_seconds,
        }

    def cleanup_session(self, session_id: str) -> bool:
        safe_session = self._sanitize_session_id(session_id)
        workspace = self.base_dir / safe_session
        with self._lock:
            self._last_access.pop(safe_session, None)
        existed = workspace.exists()
        self._safe_rmtree(workspace)
        return existed

    @staticmethod
    def ensure_workspace_layout(workspace: Path) -> Path:
        SessionManager._ensure_workspace_layout(workspace)
        return workspace

    @staticmethod
    def _ensure_workspace_layout(workspace: Path) -> None:
        workspace.mkdir(parents=True, exist_ok=True)
        # Final user-deliverable artifacts are expected under output/.
        (workspace / "output").mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _safe_rmtree(path: Path) -> None:
        if not path.exists():
            return
        for sub in sorted(path.rglob("*"), reverse=True):
            try:
                if sub.is_file() or sub.is_symlink():
                    sub.unlink(missing_ok=True)
                else:
                    sub.rmdir()
            except OSError:
                pass
        try:
            path.rmdir()
        except OSError:
            pass

    @staticmethod
    def _sanitize_session_id(session_id: str) -> str:
        if not session_id:
            raise ValueError("session_id is empty")
        safe = "".join(ch for ch in session_id if ch.isalnum() or ch in ("-", "_", "."))
        if not safe:
            raise ValueError("invalid session_id")
        return safe
