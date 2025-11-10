$body = '{"query":"dental coverage","companyId":"amerivet"}'
try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/qa' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 30
    Write-Host "distinctDocIds: $($response.metadata.distinctDocIds)"
    Write-Host "rerankedCount: $($response.metadata.rerankedCount)"
    Write-Host "groundingScore: $($response.metadata.groundingScore)"
    Write-Host "rerankTokens: $($response.metadata.rerankTokens)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
    Write-Host "Details: $($_.ErrorDetails.Message)"
}
