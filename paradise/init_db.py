#!/usr/bin/env python
"""
Initialize the database with Alembic.
"""
import os
import subprocess
import sys
from loguru import logger

# Configure logger
logger.remove()
logger.add(
    sys.stdout,
    colorize=True,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    level="INFO"
)

def run_command(command):
    """Run a shell command and log the output."""
    logger.info(f"Running command: {command}")
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


def init_db():
    """Initialize the database with Alembic."""
    # Create the alembic revision
    logger.info("Creating initial Alembic revision...")
    result = run_command("alembic revision --autogenerate -m 'Initial migration'")
    if result != 0:
        logger.error("Failed to create Alembic revision")
        return False
    
    # Apply the migration
    logger.info("Applying migration...")
    result = run_command("alembic upgrade head")
    if result != 0:
        logger.error("Failed to apply migration")
        return False
    
    logger.info("Database initialization complete")
    return True


if __name__ == "__main__":
    init_db() 