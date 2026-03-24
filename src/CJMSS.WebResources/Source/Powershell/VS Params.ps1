
# From an elevated PowerShell window
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# If the script was downloaded, also remove Mark-of-the-Web:
Unblock-File -Path '.\Install-VS2022Pro.ps1'

# Now run your script
.\Install-VS2022Pro.ps1 -BootstrapperPath 'D:\Downloads\vs_professional.exe' --InstallPowerPlatformTools `--Verbose



vs_professional.exe
  -installPath "D:\Apps_Dev\VisualStudio" `
  -path install="D:\Apps_Dev\VisualStudio" `
  -path cache="D:\Apps_Dev\VS_Cache" `
  --add Microsoft.VisualStudio.Workload.ManagedDesktop `
  --add Microsoft.VisualStudio.Workload.NetWeb `
  --add Microsoft.VisualStudio.Workload.Office `
  --add Microsoft.VisualStudio.Workload.Azure `
  --add Microsoft.VisualStudio.Workload.Data `
  --add Microsoft.VisualStudio.Workload.Node `
  --includeRecommended `
  --includeOptional `
  --passive --norestart --wait `
  --log "D:\Apps_Dev\VS_Cache\Logs\VSInstall_$(Get-Date -f yyyyMMdd_HHmmss).log"
