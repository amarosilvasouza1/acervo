[CmdletBinding()]
param(
    [string]$JavaHome,
    [string]$SdkRoot,
    [string]$GradleHome,
    [string]$ZxingJar,
    [string]$OutputDirectory
)
# The standalone source requires core library desugaring, provided by Gradle.
# ZxingJar is accepted for compatibility; Gradle resolves the pinned dependency.
$parameters = @{}
foreach ($name in @('JavaHome', 'SdkRoot', 'GradleHome', 'OutputDirectory')) {
    if ($PSBoundParameters.ContainsKey($name)) { $parameters[$name] = $PSBoundParameters[$name] }
}
& (Join-Path $PSScriptRoot 'build-gradle.ps1') @parameters
