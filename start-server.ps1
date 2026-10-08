# 启动本机静态服务（供 launch.ps1 与自动化测试共用）。
#
# 输出（一行）：
#   SERVER_PID=<pid>        已经拉起服务（PID 为 serve.ps1 的进程号）
#   SERVER_ALREADY=<pid>    该端口上已有我们的服务在运行，没有重复启动
#   SERVER_FAIL=<原因>      无法启动
#
# 注意：这里故意不等待端口就绪——调用方自己轮询即可。
# 若在本脚本里用 Start-Process 并重定向其输出，父进程会被子进程的输出管道拖住不退出。

param(
    [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$serve = Join-Path $root 'serve.ps1'
$pidFile = Join-Path $root 'server.pid'

function Write-Trace([string]$text) {
    if ($env:TT_DEBUG_SERVER -eq '1') {
        "[$(Get-Date -Format s)] $text" | Out-File -FilePath (Join-Path $root 'start-server.trace.log') -Append -Encoding utf8
    }
}

function Test-PortBusy([int]$port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect('127.0.0.1', $port)
        $client.Close()
        return $true
    } catch {
        try { $client.Close() } catch { }
        return $false
    }
}

<#
  判断"我们的服务是否真的已经在运行"。
  不能只测 TCP 端口：Windows 的 HTTP.sys 会在 HttpListener 进程退出后继续替该端口接受连接，
  那样每次启动都会被误判为"已在运行"，真正的服务反而永远起不来。
  所以必须取到真实的页面内容，并确认那是本应用的页面。

  注意：这里判断的是"页面里的应用标记"，而不是某个具体名字。
  应用改过一次名字（我的时间账本 → TimeScribe），当时这条检查只认旧名字，
  结果改名后服务认不出自己、启动链路整个坏掉。因此这里改为匹配稳定的页面标记
  （data-app="timescribe"），并兼容旧标记。
#>
function Test-ServerAnswering([int]$port) {
    if (-not (Test-PortBusy $port)) { return $false }
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$port/index.html" -UseBasicParsing -TimeoutSec 6
        return ([string]$resp.Content -match 'data-app="timescribe"|data-app="timetracker"|TimeScribe')
    } catch {
        return $false
    }
}

function Get-PidFileValue([string]$file) {
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    try {
        $v = (Get-Content -LiteralPath $file -Raw -ErrorAction Stop).Trim()
        if ($v -match '^\d+$') { return [int]$v }
    } catch { }
    return $null
}

Write-Trace "start; Port=$Port; root=$root"

if (-not (Test-Path -LiteralPath $serve)) {
    Write-Output "SERVER_FAIL=serve.ps1 not found"
    exit 1
}

if (Test-ServerAnswering $Port) {
    $existing = Get-PidFileValue $pidFile
    if (-not $existing) { $existing = 0 }
    Write-Trace "already answering -> SERVER_ALREADY=$existing"
    Write-Output "SERVER_ALREADY=$existing"
    exit 0
}

if (Test-PortBusy $Port) {
    Write-Trace "port busy but not our server"
    Write-Output "SERVER_FAIL=port $Port is used by another program"
    exit 1
}

try { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue } catch { }

$proc = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $serve, '-Port', "$Port", '-Quiet') `
    -WindowStyle Hidden -PassThru
Write-Trace "spawned pid=$($proc.Id)"
Write-Output "SERVER_PID=$($proc.Id)"
exit 0
