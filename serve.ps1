# Local static file server for TimeScribe
# Serves this folder on http://127.0.0.1:8787/ so Edge can store data reliably
# (file:// origins are restricted by Edge for localStorage).
# Primary transport: HttpListener. Fallback: raw TcpListener HTTP/1.1.

param(
    [int]$Port = 8787,
    [string]$Root = $PSScriptRoot,
    [switch]$Quiet,
    [switch]$TestMode
)

$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path -LiteralPath $Root).Path

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.txt'  = 'text/plain; charset=utf-8'
    '.md'   = 'text/plain; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
}

function Get-ContentType([string]$path) {
    $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
    if ($mime.ContainsKey($ext)) { return $mime[$ext] }
    return 'application/octet-stream'
}

function Resolve-Target([string]$rawPath) {
    $p = $rawPath
    $qi = $p.IndexOf('?')
    if ($qi -ge 0) { $p = $p.Substring(0, $qi) }
    $hi = $p.IndexOf('#')
    if ($hi -ge 0) { $p = $p.Substring(0, $hi) }
    $p = [System.Uri]::UnescapeDataString($p)
    $p = $p -replace '/', '\'
    if ([string]::IsNullOrWhiteSpace($p) -or $p -eq '\') { $p = '\index.html' }
    if ($p.EndsWith('\')) { $p = $p + 'index.html' }
    $full = [System.IO.Path]::GetFullPath((Join-Path $Root $p.TrimStart('\')))
    if (-not $full.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }
    return $full
}

function Read-Asset([string]$target) {
    if (-not $target) {
        return @{ Code = 403; Type = 'text/plain; charset=utf-8'; Body = [byte[]][System.Text.Encoding]::UTF8.GetBytes('Forbidden') }
    }
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
        return @{ Code = 404; Type = 'text/plain; charset=utf-8'; Body = [byte[]][System.Text.Encoding]::UTF8.GetBytes('Not Found') }
    }
    try {
        $bytes = [System.IO.File]::ReadAllBytes($target)
    } catch {
        return @{ Code = 500; Type = 'text/plain; charset=utf-8'; Body = [byte[]][System.Text.Encoding]::UTF8.GetBytes('Read Error') }
    }
    return @{ Code = 200; Type = (Get-ContentType $target); Body = $bytes }
}

# ------------------------------------------------------------------ 自检结果通道
# 自检页面把测试结果 POST 到 /__result，自动化运行器再 GET 取回。
# 这样测试就不需要依赖 --virtual-time-budget 来"等页面跑完"，
# 计时类用例可以走真实时间，测出来的数字才有意义。
$script:lastResult = ''

function Get-TestResultResponse([string]$method, [string]$rawPath, [string]$body) {
    $pathOnly = $rawPath
    $qi = $pathOnly.IndexOf('?')
    if ($qi -ge 0) { $pathOnly = $pathOnly.Substring(0, $qi) }
    if ($pathOnly -ne '/__result') { return $null }

    if ($method -eq 'POST') {
        $script:lastResult = $body
        return @{ Code = 200; Type = 'text/plain; charset=utf-8'; Body = [byte[]][System.Text.Encoding]::UTF8.GetBytes('OK') }
    }
    if ([string]::IsNullOrEmpty($script:lastResult)) {
        return @{ Code = 204; Type = 'text/plain; charset=utf-8'; Body = [byte[]]@() }
    }
    return @{
        Code = 200
        Type = 'application/json; charset=utf-8'
        Body = [byte[]][System.Text.Encoding]::UTF8.GetBytes($script:lastResult)
    }
}

# ---------------------------------------------------------------- TcpListener
function Start-TcpServer([int]$port) {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
    $listener.Start()
    try {
        "$PID" | Out-File -FilePath $pidFile -Encoding ascii
        if (-not $Quiet) { Write-Host "[serve] fallback TCP server listening on 127.0.0.1:$port" }
        if ($TestMode) {
            $listener.Stop()
            return
        }
        while ($true) {
            $client = $listener.AcceptTcpClient()
            try {
                $stream = $client.GetStream()
                $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII)
                $requestLine = $reader.ReadLine()
                $contentLength = 0
                while ($true) {
                    $line = $reader.ReadLine()
                    if ($null -eq $line -or $line -eq '') { break }
                    if ($line -match '^(?i)Content-Length:\s*(\d+)') { $contentLength = [int]$Matches[1] }
                }

                $method = 'GET'
                $rawPath = '/'
                if ($requestLine) {
                    $parts = $requestLine.Split(' ')
                    if ($parts.Length -ge 1) { $method = $parts[0] }
                    if ($parts.Length -ge 2) { $rawPath = $parts[1] }
                }

                $body = ''
                if ($method -eq 'POST' -and $contentLength -gt 0) {
                    $buffer = New-Object char[] $contentLength
                    $read = 0
                    while ($read -lt $contentLength) {
                        $n = $reader.Read($buffer, $read, $contentLength - $read)
                        if ($n -le 0) { break }
                        $read += $n
                    }
                    $body = -join $buffer[0..([Math]::Max(0, $read - 1))]
                }

                $asset = $null
                $pathOnly = $rawPath
                $qi = $pathOnly.IndexOf('?')
                if ($qi -ge 0) { $pathOnly = $pathOnly.Substring(0, $qi) }
                if ($pathOnly -eq '/__result') {
                    $asset = Get-TestResultResponse $method $rawPath $body
                }
                if (-not $asset) {
                    $asset = Read-Asset (Resolve-Target $rawPath)
                }

                $head = "HTTP/1.1 $($asset.Code) $(if($asset.Code -eq 200){'OK'}else{'ERR'})`r`n" +
                        "Content-Type: $($asset.Type)`r`n" +
                        "Content-Length: $($asset.Body.Length)`r`n" +
                        "Cache-Control: no-store`r`n" +
                        "Connection: close`r`n`r`n"
                $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
                $stream.Write($headBytes, 0, $headBytes.Length)
                if ($asset.Body.Length -gt 0) { $stream.Write($asset.Body, 0, $asset.Body.Length) }
                $stream.Flush()
            } catch {
                # client vanished or bad request: keep serving
            } finally {
                try { $client.Close() } catch { }
            }
        }
    } finally {
        try { $listener.Stop() } catch { }
        try { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue } catch { }
    }
}

# --------------------------------------------------------------- HttpListener
function Start-HttpServer([int]$port, [string]$prefix) {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add($prefix)
    $listener.Start()
    try {
        "$PID" | Out-File -FilePath $pidFile -Encoding ascii
        if (-not $Quiet) { Write-Host "[serve] listening on $prefix" }
        if ($TestMode) {
            # 只验证能否绑定端口，立刻退出（供启动链路测试判断端口是否空闲）
            $listener.Stop()
            return
        }
        while ($listener.IsListening) {
            $context = $null
            try {
                $context = $listener.GetContext()
            } catch {
                break
            }
            try {
                $method = $context.Request.HttpMethod
                $asset = $null

                if ($context.Request.Url.AbsolutePath -eq '/__result') {
                    $body = ''
                    if ($method -eq 'POST') {
                        $reader = New-Object System.IO.StreamReader($context.Request.InputStream, [System.Text.Encoding]::UTF8)
                        $body = $reader.ReadToEnd()
                        $reader.Close()
                    }
                    $asset = Get-TestResultResponse $method $context.Request.Url.AbsolutePath $body
                }

                if (-not $asset) {
                    $asset = Read-Asset (Resolve-Target $context.Request.Url.AbsolutePath)
                }

                $context.Response.StatusCode = $asset.Code
                $context.Response.ContentType = $asset.Type
                $context.Response.Headers.Add('Cache-Control', 'no-store')
                $context.Response.ContentLength64 = $asset.Body.Length
                if ($asset.Body.Length -gt 0) {
                    $context.Response.OutputStream.Write($asset.Body, 0, $asset.Body.Length)
                }
            } catch {
                # ignore broken pipe
            } finally {
                try { $context.Response.OutputStream.Close() } catch { }
                try { $context.Response.Close() } catch { }
            }
        }
    } finally {
        try { $listener.Stop() } catch { }
        try { $listener.Close() } catch { }
        try { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue } catch { }
    }
}

# ------------------------------------------------------------------- dispatch
# 启动失败必须留下痕迹：静默退出会让用户看到"双击了但什么都没发生"。
$logFile = Join-Path $PSScriptRoot 'server.log'
$pidFile = Join-Path $PSScriptRoot 'server.pid'

function Write-StartupLog([string]$text) {
    "[$(Get-Date -Format s)] $text" | Out-File -FilePath $logFile -Append -Encoding utf8
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

if (Test-PortBusy $Port) {
    Write-StartupLog "port $Port is already in use; refusing to start a second server"
    if (-not $Quiet) { Write-Host "[serve] port $Port already in use" }
    exit 1
}

$usedTcp = $false
try {
    Start-HttpServer $Port "http://127.0.0.1:$Port/"
} catch {
    $msg = $_.Exception.Message
    $usedTcp = $true
    Write-StartupLog "HttpListener failed on port ${Port}: $msg"
    if (-not $Quiet) {
        Write-Host "[serve] HttpListener unavailable ($msg); trying TCP fallback"
    }
}

if ($usedTcp) {
    try {
        Start-TcpServer $Port
    } catch {
        Write-StartupLog "TCP fallback also failed on port ${Port}: $($_.Exception.Message)"
        if (-not $Quiet) {
            Write-Host "[serve] TCP fallback failed: $($_.Exception.Message)"
        }
        try { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue } catch { }
        exit 1
    }
}
