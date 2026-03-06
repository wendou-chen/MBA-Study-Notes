$ErrorActionPreference = "Continue"

$TaskNames = @(
    "ObsidianSchedule-Morning7",
    "ObsidianSchedule-Night22"
)

foreach ($TaskName in $TaskNames) {
    & schtasks /Delete /TN $TaskName /F | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Removed: $TaskName" -ForegroundColor Green
    }
    else {
        Write-Host "Not found or failed to remove: $TaskName" -ForegroundColor Yellow
    }
}

Write-Host "Done." -ForegroundColor Cyan
