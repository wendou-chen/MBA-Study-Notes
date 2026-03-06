import os
import sys
import asyncio
from pathlib import Path

# 1. 读取当前目录下的 .env 文件（如果存在）
env_path = Path(__file__).parent / ".env"
env_example_path = Path(__file__).parent / ".env.example"

if env_path.exists():
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ[key] = value.strip()

# 2. 验证关键变量是否存在
if "OBSIDIAN_API_KEY" not in os.environ:
    example_hint = f" Copy {env_example_path.name} to .env and fill in OBSIDIAN_API_KEY." if env_example_path.exists() else ""
    print(
        "Error: OBSIDIAN_API_KEY not found. Enable the Obsidian Local REST API plugin, then configure the key in .env."
        + example_hint,
        file=sys.stderr,
    )
    sys.exit(1)

# 3. 启动 mcp-obsidian (异步函数需要用 asyncio.run)
try:
    from mcp_obsidian.server import main
except ImportError:
    print(
        "Error: mcp-obsidian is not installed. Run `pip install mcp-obsidian` first.",
        file=sys.stderr,
    )
    sys.exit(1)

asyncio.run(main())
