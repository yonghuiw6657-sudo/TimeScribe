# 启动入口：启动服务 → 等端口就绪 → 打开 Edge。
# 退出码：0 成功；1 失败（会打印原因）。

param(
    [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$startServer = Join-Path $root 'start-server.ps1'

function Get-EdgePath {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) { return $c }
    }
    return $null
}

function Show-Failure([string]$message) {
    Write-Host ''
    Write-Host 'Failed to start the local time tracker server.'
    Write-Host "Reason: $message"
    Write-Host "Files in: $root"
    Write-Host 'See server.log in that folder for details.'
    Write-Host ''
    Read-Host 'Press Enter to close'
}

function Test-HttpReady([int]$port) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$port/index.html" -UseBasicParsing -TimeoutSec 5
        return ($resp.StatusCode -eq 200)
    } catch {
        return $false
    }
}

if (-not (Test-Path -LiteralPath $startServer)) {
    Show-Failure 'start-server.ps1 is missing'
    exit 1
}

# 第一步：确认服务状态（已在运行 / 需要拉起 / 失败）
$probe = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startServer -Port $Port 2>&1
$probeText = ($probe | Out-String).Trim()
if ($probeText -notmatch 'SERVER_(PID|ALREADY)=') {
    Show-Failure ("start-server.ps1 did not start the server: " + $probeText)
    exit 1
}

# 第二步：等端口真正可用（刚拉起时需要一点时间；已在运行则立刻通过）
$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline) {
    if (Test-HttpReady $Port) { break }
    Start-Sleep -Milliseconds 300
}

if (-not (Test-HttpReady $Port)) {
    Show-Failure "the server did not become reachable on port $Port"
    exit 1
}

# 第三步：打开 Edge
$edge = Get-EdgePath
$url = "http://127.0.0.1:$Port/"
if ($edge) {
    Start-Process -FilePath $edge -ArgumentList $url | Out-Null
} else {
    Start-Process $url | Out-Null
}
exit 0
