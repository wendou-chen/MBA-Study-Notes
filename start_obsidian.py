import os
import sys
import asyncio
from pathlib import Path

# 1. 强制读取当前目录下的 .env 文件
env_path = Path(__file__).parent / ".env"

if env_path.exists():
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ[key] = value.strip()

# 2. 验证关键变量是否存在
if "OBSIDIAN_API_KEY" not in os.environ:
    print("Error: OBSIDIAN_API_KEY not found!", file=sys.stderr)
    sys.exit(1)

# 3. 启动 mcp-obsidian (异步函数需要用 asyncio.run)
from mcp_obsidian.server import main
asyncio.run(main())
