<#
.SYNOPSIS
    Douyin Publisher - Persistent Browser Launcher
.DESCRIPTION
    Launch Edge with a dedicated user-data-dir + remote debugging.
    Cookies persist across sessions. First login required only once.
.PARAMETER Force
    Force close existing instance and restart.
.PARAMETER Chrome
    Use Chrome instead of Edge.
#>
param(
    [switch]$Force,
    [switch]$Chrome
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProfileDir = Join-Path (Split-Path -Parent $ScriptDir) "chrome-profile\douyin-session"
$DebugPort = 9222
$TargetUrl = "https://creator.douyin.com/creator-micro/content/upload?enter_from=dou_web"

if ($Chrome) {
    $BrowserPath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
    $BrowserName = "Chrome"
}
else {
    $BrowserPath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    $BrowserName = "Edge"
}

if (-not (Test-Path $BrowserPath)) {
    Write-Host "[ERROR] Browser not found: $BrowserPath" -ForegroundColor Red
    exit 1
}

$portInUse = $null
try {
    $portInUse = Get-NetTCPConnection -LocalPort $DebugPort -ErrorAction SilentlyContinue
}
catch {}

if ($portInUse) {
    if ($Force) {
        Write-Host "[FORCE] Closing processes on port $DebugPort ..." -ForegroundColor Yellow
        $portInUse | ForEach-Object {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2
    }
    else {
        Write-Host "[INFO] Port $DebugPort already in use. Browser may be running." -ForegroundColor Cyan
        Write-Host "[INFO] Use -Force to restart, or proceed with automation." -ForegroundColor Cyan
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:${DebugPort}/json" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
            $pages = $response.Content | ConvertFrom-Json
            Write-Host "[CONNECTED] Open pages:" -ForegroundColor Green
            foreach ($p in $pages) {
                Write-Host "  - $($p.title)"
            }
        }
        catch {
            Write-Host "[WARN] Port in use but cannot connect. Try -Force." -ForegroundColor Yellow
        }
        return
    }
}

if (-not (Test-Path $ProfileDir)) {
    Write-Host "[FIRST RUN] Creating persistent profile directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
    Write-Host "[FIRST RUN] Please login to creator.douyin.com in the browser." -ForegroundColor Yellow
    Write-Host "[FIRST RUN] Cookies will be saved automatically after login." -ForegroundColor Yellow
}

$browserArgs = @(
    "--remote-debugging-port=$DebugPort",
    "--user-data-dir=`"$ProfileDir`"",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=TranslateUI",
    "--lang=zh-CN",
    $TargetUrl
)

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Douyin Publisher Browser ($BrowserName)" -ForegroundColor Cyan
Write-Host "  Profile: $ProfileDir" -ForegroundColor Gray
Write-Host "  Debug Port: $DebugPort" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Start-Process -FilePath $BrowserPath -ArgumentList $browserArgs
Write-Host "[LAUNCHED] $BrowserName started." -ForegroundColor Green
Write-Host "[WAITING] Connecting to browser..." -ForegroundColor Gray

$maxWait = 15
$waited = 0
while ($waited -lt $maxWait) {
    Start-Sleep -Seconds 1
    $waited++
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:${DebugPort}/json" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        Write-Host "[READY] Browser debug port is ready! (${waited}s)" -ForegroundColor Green
        $pages = $response.Content | ConvertFrom-Json
        $loginPage = $pages | Where-Object { $_.url -match "login|passport" }
        if ($loginPage) {
            Write-Host "[LOGIN] Login page detected. Please login in the browser." -ForegroundColor Yellow
        }
        else {
            $uploadPage = $pages | Where-Object { $_.url -match "upload|content" }
            if ($uploadPage) {
                Write-Host "[LOGGED IN] Upload page loaded. Session is valid!" -ForegroundColor Green
            }
        }
        break
    }
    catch {
        # still waiting
    }
}

if ($waited -ge $maxWait) {
    Write-Host "[TIMEOUT] Browser launch timed out. Please check manually." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Ready for AI automation." -ForegroundColor Cyan
