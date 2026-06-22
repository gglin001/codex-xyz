#!/usr/bin/env python3
import json
import os
import queue
import signal
import sys
import threading
import time

TIMEOUT_SECONDS = 120
messages = queue.Queue()
next_id = 0
server_stdin = None


def emit(prefix, payload):
    print(
        f"{prefix} {json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)}",
        flush=True,
    )


def read_fifo(path, source):
    with open(path, "r", buffering=1) as stream:
        for line in stream:
            if line := line.rstrip("\n"):
                messages.put((source, line))


def write(message):
    emit(">>>", message)
    server_stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
    server_stdin.flush()


def yolo_response(message):
    method = message.get("method")
    if method in {
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
    }:
        return {"decision": "accept"}
    if method == "item/permissions/requestApproval":
        params = message.get("params")
        permissions = params.get("permissions") if isinstance(params, dict) else None
        return {"permissions": permissions or {}, "scope": "session"}
    if method in {"execCommandApproval", "applyPatchApproval"}:
        return {"decision": "approved"}
    return None


def receive():
    source, line = messages.get(timeout=0.1)
    if source == "stderr":
        emit("***", {"stderr": line})
        return None
    try:
        message = json.loads(line)
    except json.JSONDecodeError:
        emit("!!!", {"unparsed": line})
        return None
    emit("<<<", message)
    return message if isinstance(message, dict) else None


def request(method, params, deadline, wait_done=False):
    global next_id
    next_id += 1
    request_id = next_id
    write({"id": request_id, "method": method, "params": params})

    result = None
    while time.monotonic() < deadline:
        try:
            message = receive()
        except queue.Empty:
            continue
        if message is None:
            continue

        response = yolo_response(message)
        message_id = message.get("id")
        if response is not None and message_id is not None:
            write({"id": message_id, "result": response})
            continue

        if message_id == request_id and ("result" in message or "error" in message):
            if "error" in message:
                raise RuntimeError(json.dumps(message["error"], ensure_ascii=False))
            result = message.get("result")
            if not wait_done:
                return result

        if wait_done and message.get("method") == "turn/completed":
            return result

    raise TimeoutError(f"timed out waiting for response id {request_id}")


def usage(message=None):
    if message:
        print(message, file=sys.stderr)
    print(
        "usage: scripts/app-server-stdio-debug.sh [--turn] prompt...",
        file=sys.stderr,
    )
    return 2


def main():
    global server_stdin
    if len(sys.argv) < 5:
        return usage()

    stdin_fifo, stdout_fifo, stderr_fifo, *prompt = sys.argv[1:]
    if prompt[:1] == ["--turn"]:
        prompt = prompt[1:]
    if not prompt:
        return usage("missing prompt")

    server_stdin = open(stdin_fifo, "w", buffering=1)
    for path, source in ((stdout_fifo, "stdout"), (stderr_fifo, "stderr")):
        threading.Thread(target=read_fifo, args=(path, source), daemon=True).start()

    deadline = time.monotonic() + TIMEOUT_SECONDS
    request(
        "initialize",
        {
            "clientInfo": {
                "name": "app-server-stdio-debug",
                "title": "app-server-stdio-debug",
                "version": "0.1.0",
            },
            "capabilities": {"experimentalApi": True, "requestAttestation": False},
        },
        deadline,
    )
    write({"method": "initialized"})

    thread_result = request(
        "thread/start",
        {
            "cwd": os.getcwd(),
            "serviceName": "app-server-stdio-debug",
            "threadSource": "user",
            "approvalPolicy": "never",
            "sandbox": "danger-full-access",
        },
        deadline,
    )
    thread = thread_result.get("thread") if isinstance(thread_result, dict) else None
    thread_id = thread.get("id") if isinstance(thread, dict) else None
    if not isinstance(thread_id, str):
        raise RuntimeError(f"thread/start did not return thread.id: {thread_result!r}")

    request(
        "turn/start",
        {
            "threadId": thread_id,
            "input": [{"type": "text", "text": " ".join(prompt), "text_elements": []}],
            "approvalPolicy": "never",
            "sandboxPolicy": {"type": "dangerFullAccess"},
        },
        deadline,
        wait_done=True,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        signal.signal(signal.SIGINT, signal.SIG_DFL)
        raise
