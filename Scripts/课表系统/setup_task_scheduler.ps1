param(
    [switch]$RunWhenLoggedOff,
    [string]$UserName = "$env:USERDOMAIN\$env:USERNAME",
    [string]$Password = ""
)

$ErrorActionPreference = "Stop"

# Use ASCII task names to avoid encoding issues in Windows PowerShell.
# Morning reminder (07:00): update_daily_07.bat
# Night reminder (22:00): update_daily_22.bat
$TaskMorning = "ObsidianSchedule-Morning7"
$TaskNight = "ObsidianSchedule-Night22"

# Use script directory to avoid any hardcoded non-ASCII path literal.
$ProjectDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ProjectDir)) {
    $ProjectDir = Split-Path -Parent $PSCommandPath
}

$MorningBat = Join-Path $ProjectDir "update_daily_07.bat"
$NightBat = Join-Path $ProjectDir "update_daily_22.bat"

if (-not (Test-Path $MorningBat)) {
    throw "Missing file: $MorningBat"
}
if (-not (Test-Path $NightBat)) {
    throw "Missing file: $NightBat"
}

if ($RunWhenLoggedOff -and [string]::IsNullOrWhiteSpace($Password)) {
    Write-Host "RunWhenLoggedOff enabled. Please enter the account password for $UserName" -ForegroundColor Yellow
    $SecurePwd = Read-Host -AsSecureString "Password"
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePwd)
    try {
        $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($BSTR)
    }
    finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
    }
}

function New-ObsidianTask {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$AtTime,
        [Parameter(Mandatory = $true)][string]$BatPath
    )

    # Build cmd.exe argument line:
    # /c schtasks /Create ... /TR "\"D:\path\script.bat\"" ...
    $CreateArgLine = '/c schtasks /Create /F /TN "' + $TaskName +
        '" /SC DAILY /ST ' + $AtTime +
        ' /TR "\"' + $BatPath + '\"" /RL LIMITED /RU "' + $UserName + '"'

    if ($RunWhenLoggedOff) {
        $CreateArgLine += ' /RP "' + $Password + '"'
    }
    else {
        $CreateArgLine += ' /IT'
    }

    $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList $CreateArgLine -NoNewWindow -Wait -PassThru

    if ($proc.ExitCode -ne 0) {
        throw "Failed to create task: $TaskName"
    }
}

Write-Host "Creating tasks..." -ForegroundColor Cyan
New-ObsidianTask -TaskName $TaskMorning -AtTime "07:00" -BatPath $MorningBat
New-ObsidianTask -TaskName $TaskNight -AtTime "22:00" -BatPath $NightBat

Write-Host "Done. Created tasks:" -ForegroundColor Green
Write-Host " - $TaskMorning (07:00)"
Write-Host " - $TaskNight (22:00)"
Write-Host ""
Write-Host "Quick check:" -ForegroundColor Cyan
Write-Host "schtasks /Query /TN `"$TaskMorning`" /V /FO LIST"
Write-Host "schtasks /Query /TN `"$TaskNight`" /V /FO LIST"
