#!/usr/bin/env python
"""
Worker entry point for Arq.
Run with: python -m app.worker
"""

from arq.worker import run_worker
from app.scheduler.worker import WorkerSettings

if __name__ == "__main__":
    run_worker(WorkerSettings) 