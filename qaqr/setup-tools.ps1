# Runs the upstream tool setup for one tool, unchanged.
#
# That script asks the GitHub API which file a release holds. GitHub allows an address 60 such
# requests an hour without a login, and shared CI runners use them up. When the job provides a
# token, the requests to api.github.com carry it; nothing else does, and the upstream script
# itself never sees the variable.
param(
  [Parameter(Mandatory = $true)][string]$Script,
  [Parameter(Mandatory = $true)][string]$Tool,
  [Parameter(Mandatory = $true)][string]$Bin
)

$token = $env:GITHUB_TOKEN
Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
if ($token) {
  $command = Get-Command Microsoft.PowerShell.Utility\Invoke-WebRequest
  $proxy = [System.Management.Automation.ProxyCommand]::Create([System.Management.Automation.CommandMetadata]::new($command))
  $marker = '$scriptCmd = {'
  if (-not $proxy.Contains($marker)) { throw 'Cannot wrap Invoke-WebRequest on this PowerShell' }
  $login = @'
if (([uri]$Uri).Host -eq 'api.github.com') {
            $merged = @{}
            if ($Headers) { foreach ($key in $Headers.Keys) { $merged[$key] = $Headers[$key] } }
            $merged['Authorization'] = 'Bearer __TOKEN__'
            $PSBoundParameters['Headers'] = $merged
        }

'@
  if ($token -notmatch '^[A-Za-z0-9_\-\.]+$') { throw 'Unexpected token format' }
  Set-Item -Path function:global:Invoke-WebRequest -Value ([scriptblock]::Create($proxy.Replace($marker, $login.Replace('__TOKEN__', $token) + $marker)))
}

& $Script -Install -Tools $Tool -Bin $Bin
exit $LASTEXITCODE
