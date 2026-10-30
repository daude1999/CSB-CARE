# Windows PowerShell: start the LOCAL database again. Same as `npm run db:reset:local`.
#   .\scripts\local-reset.ps1          demo data
#   .\scripts\local-reset.ps1 -Clean   empty, ready for a real organisation
param([switch]$Clean)
$extra = @()
if ($Clean) { $extra += "--clean" }
node scripts/local-reset.mjs @extra
exit $LASTEXITCODE
