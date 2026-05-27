import base64
import json
import mimetypes
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Dict, Generator, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

try:
    from app.session_manager import SessionManager
except ImportError:
    from session_manager import SessionManager


class FileDownloadInfo(BaseModel):
    file_name: str
    url: str
    mime_type: Optional[str] = None
    size: Optional[int] = 0


class SandboxRequest(BaseModel):
    code: str
    language: str = "python"
    timeout: int = 30
    session_id: Optional[str] = None
    cwd: Optional[str] = None
    env_vars: Optional[Dict[str, str]] = None
    files: Optional[Dict[str, str]] = None
    download_files: Optional[List[FileDownloadInfo]] = None


class SandboxResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    output_files: Optional[List[dict]] = None


class ShellRequest(BaseModel):
    command: str
    timeout: int = 30
    session_id: Optional[str] = None
    cwd: Optional[str] = None
    env_vars: Optional[Dict[str, str]] = None
    files: Optional[Dict[str, str]] = None


class ShellResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    output_files: Optional[List[dict]] = None


class FileReadRequest(BaseModel):
    path: str
    session_id: Optional[str] = None
    cwd: Optional[str] = None
    max_bytes: Optional[int] = None
    files: Optional[Dict[str, str]] = None


class FileReadResponse(BaseModel):
    path: str
    content: str
    size: int


class FileWriteRequest(BaseModel):
    path: str
    content: str
    session_id: Optional[str] = None
    cwd: Optional[str] = None
    append: bool = False
    files: Optional[Dict[str, str]] = None


class FileWriteResponse(BaseModel):
    path: str
    size: int
    written: int
    mode: str


class FileListRequest(BaseModel):
    path: Optional[str] = "."
    session_id: Optional[str] = None
    cwd: Optional[str] = None
    recursive: bool = False
    max_entries: int = 200
    files: Optional[Dict[str, str]] = None


class FileListResponse(BaseModel):
    base_path: str
    entries: List[str]

class SessionInfoRequest(BaseModel):
    session_id: str

class SessionCleanupRequest(BaseModel):
    session_id: Optional[str] = None
    expired_only: bool = False


APP = FastAPI(title="53AI Sandbox")
app = APP
BASE_WORKSPACE_DIR = os.getenv("SANDBOX_WORKSPACE_ROOT", "/tmp/53aihub_sandbox_workspaces")
SESSION_TTL_SECONDS = int(os.getenv("SANDBOX_SESSION_TTL_SECONDS", "3600"))
SESSION_MANAGER = SessionManager(BASE_WORKSPACE_DIR, SESSION_TTL_SECONDS)
MAX_FILE_BYTES = 10 * 1024 * 1024


def _resolve_workspace(session_id: Optional[str]) -> Path:
    SESSION_MANAGER.cleanup_expired()
    if session_id:
        return SESSION_MANAGER.get_workspace(session_id)
    return SESSION_MANAGER.ensure_workspace_layout(Path(tempfile.mkdtemp(prefix="sandbox_anon_")))


def _cleanup_workspace(session_id: Optional[str], workspace: Path) -> None:
    if session_id:
        SESSION_MANAGER.touch(session_id)
        return
    shutil.rmtree(workspace, ignore_errors=True)


def _safe_join(workspace: Path, rel_path: str, cwd: Optional[str] = None) -> Path:
    if not rel_path:
        raise HTTPException(status_code=400, detail="path is required")
    rel = rel_path.replace("\\", "/")
    if rel.startswith("/") or ".." in rel.split("/"):
        raise HTTPException(status_code=400, detail="invalid path")

    base = workspace
    if cwd:
        c = cwd.replace("\\", "/")
        if c.startswith("/") or ".." in c.split("/"):
            raise HTTPException(status_code=400, detail="invalid cwd")
        base = workspace / c

    target = (base / rel).resolve()
    root = workspace.resolve()
    if str(target).startswith(str(root)):
        return target
    raise HTTPException(status_code=400, detail="path traversal detected")


def _write_seed_files(workspace: Path, files: Optional[Dict[str, str]]) -> None:
    if not files:
        return
    for rel_path, content in files.items():
        file_path = _safe_join(workspace, rel_path)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")


def _download_files(workspace: Path, files: Optional[List[FileDownloadInfo]]) -> None:
    if not files:
        return
    failures = []
    for file_info in files:
        local_path = _safe_join(workspace, file_info.file_name)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with urllib.request.urlopen(file_info.url, timeout=60) as resp:
                data = resp.read(MAX_FILE_BYTES + 1)
                if len(data) > MAX_FILE_BYTES:
                    failures.append(f"{file_info.file_name}: file too large")
                    continue
                local_path.write_bytes(data)
        except Exception as exc:
            failures.append(f"{file_info.file_name}: {exc}")
    if failures:
        raise HTTPException(status_code=502, detail="download files failed: " + "; ".join(failures))


def _build_command(language: str, code: str, workspace: Path) -> List[str]:
    lang = (language or "python").lower()
    if lang in ("bash", "sh", "shell"):
        script = workspace / "tool.sh"
        script.write_text(code, encoding="utf-8")
        return ["bash", str(script)]
    if lang in ("node", "nodejs", "javascript", "js"):
        script = workspace / "tool.js"
        script.write_text(code, encoding="utf-8")
        return ["node", str(script)]
    script = workspace / "tool.py"
    script.write_text(code, encoding="utf-8")
    return ["python3", str(script)]


def _execute_command(cmd: List[str], workspace: Path, timeout: int, env_vars: Optional[Dict[str, str]]) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    if env_vars:
        env.update(env_vars)
    return subprocess.run(
        cmd,
        cwd=str(workspace),
        env=env,
        capture_output=True,
        text=True,
        timeout=max(1, timeout),
        check=False,
    )


def _execute_shell(command: str, workspace: Path, timeout: int, env_vars: Optional[Dict[str, str]], cwd: Optional[str]) -> subprocess.CompletedProcess:
    base = workspace
    if cwd:
        base = _safe_join(workspace, ".", cwd)
        base.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    if env_vars:
        env.update(env_vars)

    return subprocess.run(
        command,
        cwd=str(base),
        env=env,
        capture_output=True,
        text=True,
        shell=True,
        timeout=max(1, timeout),
        check=False,
    )


def _collect_output_files(workspace: Path) -> List[dict]:
    output_files: List[dict] = []
    scan_root = workspace / "output"
    if not scan_root.exists():
        scan_root = workspace

    for file_path in scan_root.rglob("*"):
        if not file_path.is_file():
            continue
        if file_path.name.startswith("."):
            continue
        if file_path.stat().st_size > MAX_FILE_BYTES:
            continue

        rel_path = file_path.relative_to(workspace)
        raw = file_path.read_bytes()
        mime_type, _ = mimetypes.guess_type(str(file_path))
        output_files.append(
            {
                "file_name": str(rel_path).replace("\\", "/"),
                "content": base64.b64encode(raw).decode("utf-8"),
                "mime_type": mime_type or "application/octet-stream",
                "size": len(raw),
            }
        )
        if len(output_files) >= 20:
            break
    return output_files


def _json_sse(event_type: str, payload: dict) -> str:
    return f"event: {event_type}\\ndata: {json.dumps(payload, ensure_ascii=False)}\\n\\n"


@APP.get("/health")
def health():
    return {"status": "ok"}


@APP.post("/execute", response_model=SandboxResponse)
def execute(request: SandboxRequest) -> SandboxResponse:
    workspace = _resolve_workspace(request.session_id)
    try:
        _write_seed_files(workspace, request.files)
        _download_files(workspace, request.download_files)
        cmd = _build_command(request.language, request.code, workspace)
        result = _execute_command(cmd, workspace, request.timeout, request.env_vars)
        return SandboxResponse(
            stdout=result.stdout,
            stderr=result.stderr,
            exit_code=result.returncode,
            output_files=_collect_output_files(workspace),
        )
    except subprocess.TimeoutExpired:
        return SandboxResponse(stdout="", stderr="Execution timeout", exit_code=124, output_files=[])
    finally:
        _cleanup_workspace(request.session_id, workspace)


@APP.post("/execute/stream")
def execute_stream(request: SandboxRequest):
    workspace = _resolve_workspace(request.session_id)

    def stream() -> Generator[str, None, None]:
        start = time.time()
        try:
            _write_seed_files(workspace, request.files)
            _download_files(workspace, request.download_files)
            cmd = _build_command(request.language, request.code, workspace)
            yield _json_sse("tool.started", {"request_id": f"sandbox-{int(start * 1000)}"})
            result = _execute_command(cmd, workspace, request.timeout, request.env_vars)
            if result.stdout:
                yield _json_sse("stdout.delta", {"content": result.stdout})
            if result.stderr:
                yield _json_sse("stderr.delta", {"content": result.stderr})
            yield _json_sse(
                "tool.completed",
                {
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "exit_code": result.returncode,
                    "execution_time": max(0.0, time.time() - start),
                    "output_files": _collect_output_files(workspace),
                },
            )
        except subprocess.TimeoutExpired:
            yield _json_sse("error", {"message": "Execution timeout"})
        finally:
            _cleanup_workspace(request.session_id, workspace)

    return StreamingResponse(stream(), media_type="text/event-stream")


@APP.post("/shell", response_model=ShellResponse)
def run_shell(request: ShellRequest) -> ShellResponse:
    workspace = _resolve_workspace(request.session_id)
    try:
        _write_seed_files(workspace, request.files)
        result = _execute_shell(request.command, workspace, request.timeout, request.env_vars, request.cwd)
        return ShellResponse(
            stdout=result.stdout,
            stderr=result.stderr,
            exit_code=result.returncode,
            output_files=_collect_output_files(workspace),
        )
    except subprocess.TimeoutExpired:
        return ShellResponse(stdout="", stderr="Execution timeout", exit_code=124, output_files=[])
    finally:
        _cleanup_workspace(request.session_id, workspace)


@APP.post("/file/read", response_model=FileReadResponse)
def file_read(request: FileReadRequest) -> FileReadResponse:
    workspace = _resolve_workspace(request.session_id)
    try:
        _write_seed_files(workspace, request.files)
        target = _safe_join(workspace, request.path, request.cwd)
        if not target.exists() or not target.is_file():
            raise HTTPException(status_code=404, detail="file not found")
        raw = target.read_bytes()
        if request.max_bytes and request.max_bytes > 0:
            raw = raw[: request.max_bytes]
        content = raw.decode("utf-8", errors="replace")
        return FileReadResponse(path=request.path, content=content, size=len(raw))
    finally:
        _cleanup_workspace(request.session_id, workspace)


@APP.post("/file/write", response_model=FileWriteResponse)
def file_write(request: FileWriteRequest) -> FileWriteResponse:
    workspace = _resolve_workspace(request.session_id)
    try:
        _write_seed_files(workspace, request.files)
        target = _safe_join(workspace, request.path, request.cwd)
        target.parent.mkdir(parents=True, exist_ok=True)
        mode = "a" if request.append else "w"
        with target.open(mode, encoding="utf-8") as f:
            written = f.write(request.content)
        size = target.stat().st_size if target.exists() else 0
        return FileWriteResponse(path=request.path, size=size, written=written, mode=("append" if request.append else "overwrite"))
    finally:
        _cleanup_workspace(request.session_id, workspace)


@APP.post("/file/list", response_model=FileListResponse)
def file_list(request: FileListRequest) -> FileListResponse:
    workspace = _resolve_workspace(request.session_id)
    try:
        _write_seed_files(workspace, request.files)
        base = _safe_join(workspace, request.path or ".", request.cwd)
        if not base.exists():
            raise HTTPException(status_code=404, detail="path not found")

        entries: List[str] = []
        if request.recursive:
            iterator = base.rglob("*")
        else:
            iterator = base.iterdir()

        for item in iterator:
            rel = item.relative_to(workspace)
            entries.append(str(rel).replace("\\", "/"))
            if len(entries) >= max(1, request.max_entries):
                break

        entries.sort()
        base_path = str(base.relative_to(workspace)).replace("\\", "/")
        return FileListResponse(base_path=base_path or ".", entries=entries)
    finally:
        _cleanup_workspace(request.session_id, workspace)


@APP.get("/session/list")
def session_list():
    return {"sessions": SESSION_MANAGER.list_sessions()}


@APP.post("/session/info")
def session_info(request: SessionInfoRequest):
    try:
        return SESSION_MANAGER.get_session_info(request.session_id)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))


@APP.post("/session/cleanup")
def session_cleanup(request: SessionCleanupRequest):
    if request.expired_only:
        SESSION_MANAGER.cleanup_expired()
        return {"ok": True, "mode": "expired_only"}
    if not request.session_id:
        raise HTTPException(status_code=400, detail="session_id is required when expired_only is false")
    try:
        removed = SESSION_MANAGER.cleanup_session(request.session_id)
        return {"ok": True, "removed": removed, "session_id": request.session_id}
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
