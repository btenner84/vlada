#!/usr/bin/env python
"""
Run the Web Monitoring & File Extraction Tool.
"""
import os
import subprocess
import sys
import time
from loguru import logger

# Configure logger
logger.remove()
logger.add(
    sys.stdout,
    colorize=True,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    level="INFO"
)


def run_command(command, background=False):
    """Run a shell command and log the output."""
    logger.info(f"Running command: {command}")
    
    if background:
        process = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True
        )
        return process
    else:
        process = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True
        )
        stdout, stderr = process.communicate()
        
        if stdout:
            logger.info(stdout)
        if stderr:
            logger.error(stderr)
        
        return process.returncode


def run_app():
    """Run the application."""
    # Create logs directory if it doesn't exist
    os.makedirs("logs", exist_ok=True)
    
    # Create data/downloads directory if it doesn't exist
    os.makedirs("data/downloads", exist_ok=True)
    
    # Start the worker
    logger.info("Starting worker...")
    worker_process = run_command("python -m app.worker", background=True)
    
    # Start the API
    logger.info("Starting API...")
    api_process = run_command("uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload", background=True)
    
    try:
        # Keep the script running
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        worker_process.terminate()
        api_process.terminate()
        logger.info("Application stopped")


if __name__ == "__main__":
    run_app() 