import asyncio
from playwright.async_api import async_playwright
import os

html_content = """
<!DOCTYPE html>
<html>
<head>
<style>
  body {
    margin: 0;
    padding: 0;
    width: 1024px;
    height: 1024px;
    background: transparent;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .icon {
    width: 1024px;
    height: 1024px;
    background: linear-gradient(135deg, #2563eb, #4f46e5);
    border-radius: 224px; /* like iOS squircle approx */
    display: flex;
    justify-content: center;
    align-items: center;
    box-shadow: 0 40px 100px rgba(79, 70, 229, 0.4); /* optional, maybe remove if Tauri adds drop shadow */
  }
  svg {
    width: 600px;
    height: 600px;
    color: white;
  }
</style>
</head>
<body>
  <div class="icon">
    <!-- Scheme A Logo -->
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="18" cy="5" r="3"></circle>
        <circle cx="6" cy="12" r="3"></circle>
        <circle cx="18" cy="19" r="3"></circle>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
    </svg>
  </div>
</body>
</html>
"""

async def generate_icon():
    with open("temp_icon.html", "w", encoding="utf-8") as f:
        f.write(html_content)
    
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1024, "height": 1024})
        await page.goto(f"file://{os.path.abspath('temp_icon.html')}")
        # wait a bit for rendering
        await page.wait_for_timeout(500)
        # take screenshot with transparent background
        await page.screenshot(path="app-icon.png", omit_background=True)
        await browser.close()
    
    os.remove("temp_icon.html")
    print("app-icon.png generated.")

asyncio.run(generate_icon())

