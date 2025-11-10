 = @{ query='dental coverage'; companyId='amerivet' } | ConvertTo-Json
 = Invoke-RestMethod http://127.0.0.1:3000/api/qa -Method Post -Body  -ContentType 'application/json'
.metadata | Select-Object distinctDocIds, rerankedCount, groundingScore, rerankTokens
