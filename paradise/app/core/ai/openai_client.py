import os
import base64
import json
import asyncio
from typing import Dict, Any, Optional, List
import requests
from loguru import logger
from openai import OpenAI
from app.config.settings import settings
from playwright.async_api import async_playwright

class OpenAIExtractor:
    """
    Class to handle OpenAI API interactions for smart extraction
    """
    def __init__(self):
        self.api_key = settings.OPENAI_API_KEY or os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            logger.warning("OPENAI_API_KEY not found in settings or environment variables")
        self.client = OpenAI(api_key=self.api_key)
        
    async def analyze_webpage(self, url: str, context: str, screenshot: Optional[str] = None) -> Dict[str, Any]:
        """
        Analyze a webpage using OpenAI's API
        
        Args:
            url: URL of the webpage to analyze
            context: User's description of what to extract
            screenshot: Optional base64 encoded screenshot
            
        Returns:
            Dictionary with extraction plan and preview
        """
        try:
            messages = [
                {"role": "system", "content": "You are an expert web content analyzer. Your task is to understand what the user wants to extract from a webpage and create a detailed extraction plan."},
                {"role": "user", "content": [
                    {"type": "text", "text": f"I need to extract information from this webpage: {url}\n\nHere's what I'm looking for: {context}"}
                ]}
            ]
            
            # If screenshot is provided, add it to the message
            if screenshot:
                messages[1]["content"].append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{screenshot}"
                    }
                })
            
            # Call OpenAI API
            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                max_tokens=1000
            )
            
            # Parse the response to create an extraction plan
            extraction_content = response.choices[0].message.content
            
            # Create a structured extraction plan
            extraction_plan = self._create_extraction_plan(extraction_content, url, context)
            
            return {
                "success": True,
                "extraction_plan": extraction_plan["plan"],
                "preview": extraction_plan["preview"]
            }
            
        except Exception as e:
            logger.error(f"Error analyzing webpage: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }
    
    def _create_extraction_plan(self, ai_response: str, url: str, context: str) -> Dict[str, Any]:
        """
        Create a structured extraction plan from the AI response
        
        Args:
            ai_response: Raw response from OpenAI
            url: Original URL
            context: User's context
            
        Returns:
            Dictionary with plan and preview
        """
        # Extract key information from the AI response
        lines = ai_response.split('\n')
        plan_lines = []
        preview_data = {}
        
        # Simple parsing of the AI response
        for line in lines:
            if line.strip():
                plan_lines.append(line)
                
                # Try to extract key-value pairs for preview
                if ':' in line:
                    parts = line.split(':', 1)
                    if len(parts) == 2:
                        key = parts[0].strip()
                        value = parts[1].strip()
                        if key and value:
                            preview_data[key] = value
        
        return {
            "plan": "\n".join(plan_lines),
            "preview": preview_data if preview_data else None
        }
    
    async def capture_screenshot(self, url: str) -> Optional[str]:
        """
        Capture a screenshot of a webpage using Playwright
        
        Args:
            url: URL to capture
            
        Returns:
            Base64 encoded screenshot or None if failed
        """
        try:
            logger.info(f"Capturing screenshot of {url}")
            
            async with async_playwright() as p:
                browser = await p.chromium.launch()
                page = await browser.new_page()
                
                # Navigate to the URL
                await page.goto(url, wait_until="networkidle")
                
                # Wait for the page to be fully loaded
                await page.wait_for_load_state("networkidle")
                
                # Take a screenshot
                screenshot_bytes = await page.screenshot(full_page=True)
                
                # Close the browser
                await browser.close()
                
                # Convert to base64
                base64_screenshot = base64.b64encode(screenshot_bytes).decode('utf-8')
                
                logger.info(f"Screenshot captured successfully for {url}")
                return base64_screenshot
                
        except Exception as e:
            logger.error(f"Error capturing screenshot: {str(e)}")
            return None 