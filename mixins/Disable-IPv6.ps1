# https://superuser.com/a/532109/1266358
param([switch]$Elevated)
function Test-Admin {
    $currentUser = New-Object Security.Principal.WindowsPrincipal $([Security.Principal.WindowsIdentity]::GetCurrent())
    $currentUser.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

if ((Test-Admin) -eq $false)  {
    if ($elevated) {
        # tried to elevate, did not work, aborting
    } else {
        Start-Process pwsh -Verb RunAs -ArgumentList ('-noprofile -file "{0}" -elevated' -f ($myinvocation.MyCommand.Definition))
    }
    exit
}

Getmac /v /fo csv | ConvertFrom-Csv | Select-Object 'Connection Name' `
 | ForEach-Object {
  if (-Not $($_."Connection Name" -Contains "Clash")) {
    # netsh interface ipv4 set dnsservers $($_."Connection Name") static 198.18.0.2 validate=no
    netsh interface ipv6 set interface $($_."Connection Name") routerdiscovery=disabled
  }
}

ipconfig /release6

ipconfig /renew

ipconfig /flushdns
