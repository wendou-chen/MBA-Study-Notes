@echo off
REM ============================================================
REM 抖音发布专用浏览器启动脚本
REM 
REM 功能：以专用用户目录 + 远程调试模式启动 Edge
REM       Cookie/登录状态会持久化保存到 chrome-profile 文件夹
REM       首次使用需手动登录，之后自动保持登录状态（通常数周有效）
REM
REM 用法：双击运行 或 在命令行执行
REM ============================================================

set PROFILE_DIR=%~dp0..\chrome-profile\douyin-session
set EDGE_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
set DEBUG_PORT=9222
set TARGET_URL=https://creator.douyin.com/creator-micro/content/upload?enter_from=dou_web

REM 检查是否已有调试端口占用
netstat -ano | findstr ":%DEBUG_PORT%" >nul 2>&1
if %errorlevel%==0 (
    echo [提示] 端口 %DEBUG_PORT% 已被占用，可能已有浏览器实例在运行。
    echo [提示] 如需重新启动，请先关闭已有浏览器实例。
    pause
    exit /b
)

echo ============================================================
echo   抖音发布专用浏览器
echo   配置目录: %PROFILE_DIR%
echo   调试端口: %DEBUG_PORT%
echo ============================================================
echo.

if not exist "%PROFILE_DIR%" (
    echo [首次运行] 正在创建持久化配置目录...
    mkdir "%PROFILE_DIR%"
    echo [首次运行] 请在浏览器中登录抖音创作者平台。
    echo [首次运行] 登录后 Cookie 会自动保存，下次无需重复登录。
    echo.
)

echo [启动] 正在打开 Edge 浏览器...
start "" "%EDGE_PATH%" ^
    --remote-debugging-port=%DEBUG_PORT% ^
    --user-data-dir="%PROFILE_DIR%" ^
    --no-first-run ^
    --no-default-browser-check ^
    --disable-features=TranslateUI ^
    --lang=zh-CN ^
    "%TARGET_URL%"

echo [就绪] 浏览器已启动。
echo [就绪] 等待 AI 自动化操作，或手动操作完成后关闭此窗口。
echo.
echo 按任意键关闭此提示（浏览器会继续运行）...
pause >nul
