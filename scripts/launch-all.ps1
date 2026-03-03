param(
    [string]$ServerDir = "C:\Users\dalla\Desktop\School\RAGCraft\mc\paper",
    [string]$ServerScript = "start.bat",
    [int]$ServerPort = 25565,
    [int]$ServerTimeoutSeconds = 180,
    [string]$Scenario = "lever",
    [int]$Repeats = 1,
    [int]$DelayMs = 1500,
    [string]$Mode = "distilled",
    [switch]$UseRunJs,
    [string]$RunCommand,
    [switch]$SkipServerStart,
    [switch]$StopServerWhenDone
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot

function Wait-ForServerPort {
    param(
        [string]$Host = 'localhost',
        [int]$Port = 25565,
        [int]$TimeoutSeconds = 180
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $check = Test-NetConnection -ComputerName $Host -Port $Port -WarningAction SilentlyContinue
        if ($check.TcpTestSucceeded) {
            return $true
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

if (-not $RunCommand) {
    if ($UseRunJs) {
        $RunCommand = "node run.js $Scenario --mode $Mode"
    } else {
        $RunCommand = "node runScenarios.js --scenario $Scenario --repeats $Repeats --delay $DelayMs"
    }
}

$serverProcess = $null
if (-not $SkipServerStart) {
    $serverScriptPath = Join-Path -Path $ServerDir -ChildPath $ServerScript
    if (-not (Test-Path -Path $serverScriptPath)) {
        throw "Server script not found: $serverScriptPath"
    }

    Write-Host "Starting Minecraft server from $ServerDir using $ServerScript ..."
    $serverCommand = "& { Set-Location -LiteralPath '$ServerDir'; .\$ServerScript }"
    $serverProcess = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $serverCommand -PassThru

    Write-Host "Waiting for server port $ServerPort ..."
    $ready = Wait-ForServerPort -Host 'localhost' -Port $ServerPort -TimeoutSeconds $ServerTimeoutSeconds
    if (-not $ready) {
        Write-Error "Server did not open port $ServerPort within $ServerTimeoutSeconds seconds."
        if ($serverProcess) {
            Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
        }
        exit 1
    }
} else {
    Write-Host "Skipping server startup (assuming it is already running)."
}

Push-Location $repoRoot
try {
    Write-Host "Running bot command: $RunCommand"
    & cmd.exe /c $RunCommand
} finally {
    Pop-Location
}

if ($serverProcess) {
    if ($StopServerWhenDone) {
        Write-Host "Stopping server window (PID $($serverProcess.Id))..."
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
        Write-Host "Server stop signal sent."
    } else {
        Write-Host "Server window left running. Close it manually when finished."
    }
}
