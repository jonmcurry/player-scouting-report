import os
import subprocess
import time

html_path = "/Users/jon/dev/player-scouting-report/docs/design/simplified-app/index.html"
chrome_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

screens = [
    "home",
    "record-upload",
    "report",
    "report-error",
    "progress",
    "coach-roster",
    "share-sheet"
]

with open(html_path, "r") as f:
    content = f.read()

script = """
<script>
  const params = new URLSearchParams(window.location.search);
  const screenIndex = params.get('screen');
  if (screenIndex !== null) {
    document.querySelector('.notes').style.display = 'none';
    document.body.style.padding = '0';
    document.body.style.background = '#121418';
    const screens = document.querySelectorAll('.screen');
    screens.forEach((s, i) => {
      if (i != screenIndex) s.style.display = 'none';
      else {
        s.style.boxShadow = 'none';
        s.style.border = 'none';
        s.style.borderRadius = '0';
      }
    });
    document.querySelector('.screens').style.display = 'block';
  }
</script>
</body>
"""
if "<script>" not in content:
    content = content.replace("</body>", script)
    with open(html_path, "w") as f:
        f.write(content)

for i, name in enumerate(screens):
    out_file = f"/Users/jon/dev/player-scouting-report/docs/design/simplified-app/{i+1}-{name}.png"
    url = f"file://{html_path}?screen={i}"
    cmd = [
        chrome_path,
        "--headless",
        f"--screenshot={out_file}",
        "--window-size=390,844",
        url
    ]
    print(f"Rendering {name}...")
    subprocess.run(cmd, check=False)
    time.sleep(1)

    if name in ["report", "progress"]:
        out_file_full = f"/Users/jon/dev/player-scouting-report/docs/design/simplified-app/{i+1}-{name}-full.png"
        url_full = f"file://{html_path}?screen={i}&full=1"
        cmd_full = [
            chrome_path,
            "--headless",
            f"--screenshot={out_file_full}",
            "--window-size=390,2000",
            url_full
        ]
        print(f"Rendering {name} (full height)...")
        subprocess.run(cmd_full, check=False)
        time.sleep(1)

print("Done rendering individual screens.")
