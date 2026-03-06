@description('Azure region for all resources. Defaults to the resource group location when not provided.')
param location string = resourceGroup().location

@description('Deployment environment name (e.g. dev, staging, prod).')
param environment string = 'prod'

@description('Globally unique name for the Azure Cosmos DB account (3-44 lowercase alphanumeric characters).')
param cosmosAccountName string

@description('Name of the SQL database inside the Cosmos DB account.')
param cosmosDatabaseName string = 'benefits-assistant'

@description('Globally unique name for the Azure OpenAI resource.')
param openAiAccountName string

@description('Name for the Azure AI Search service.')
param searchServiceName string

@description('Globally unique name for the Azure Storage account.')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Name for the Application Insights instance.')
param appInsightsName string

@description('Name for the Log Analytics workspace used by Application Insights.')
param logAnalyticsName string

@description('Name for the Azure Cache for Redis instance.')
param redisCacheName string

@description('SKU tier for Azure Cache for Redis (e.g. Basic, Standard, Premium).')
@allowed([
  'Basic'
  'Standard'
  'Premium'
])
param redisSkuFamily string = 'Standard'

@description('SKU size for Azure Cache for Redis. Example values: C0, C1, P1, P2.')
param redisSkuCapacity string = 'C1'

@description('Number of replicas for Azure AI Search. Minimum of 1, 2+ required for SLA in production.')
@minValue(1)
param searchReplicaCount int = 1

@description('Number of partitions for Azure AI Search. Minimum of 1.')
@minValue(1)
param searchPartitionCount int = 1

@description('Maximum autoscale throughput to allocate to the Cosmos DB SQL database (RU/s).')
@minValue(4000)
param cosmosMaxAutoscaleThroughput int = 1000

var commonTags = {
  environment: environment
  workload: 'benefits-ai-assistant'
  owner: 'benefits-platform'
}

var redisCapacityNumber = int(replace(replace(toLower(redisSkuCapacity), 'c', ''), 'p', ''))

var cosmosContainers = [
  {
    name: 'companies'
    partitionKeyPath: '/id'
    ttl: -1
  }
  {
    name: 'users'
    partitionKeyPath: '/companyId'
    ttl: -1
  }
  {
    name: 'documents'
    partitionKeyPath: '/companyId'
    ttl: -1
  }
  {
    name: 'conversations'
    partitionKeyPath: '/companyId'
    ttl: 31536000 // 365 days in seconds
  }
  {
    name: 'user_surveys'
    partitionKeyPath: '/companyId'
    ttl: -1
  }
  {
    name: 'analytics_daily'
    partitionKeyPath: '/companyId'
    ttl: -1
  }
  {
    name: 'audit_logs'
    partitionKeyPath: '/companyId'
    ttl: 220752000 // 7 years in seconds
  }
]

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-02-15-preview' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  tags: commonTags
  properties: {
    databaseAccountOfferType: 'Standard'
    enableAutomaticFailover: true
    enableFreeTier: environment == 'dev'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: true
      }
    ]
    backupPolicy: {
      type: 'Periodic'
      periodicModeProperties: {
        backupIntervalInMinutes: 240
        backupRetentionIntervalInHours: 720
        backupStorageRedundancy: 'Geo'
      }
    }
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-02-15-preview' = {
  parent: cosmosAccount
  name: cosmosDatabaseName
  properties: {
    resource: {
      id: cosmosDatabaseName
    }
    options: {
      autoscaleSettings: {
        maxThroughput: cosmosMaxAutoscaleThroughput
      }
    }
  }
}

resource cosmosContainersResources 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-02-15-preview' = [for container in cosmosContainers: {
  parent: cosmosDatabase
  name: container.name
  properties: {
    resource: {
      id: container.name
      partitionKey: {
        paths: [
          container.partitionKeyPath
        ]
        kind: 'Hash'
      }
      defaultTtl: container.ttl
      indexingPolicy: {
        indexingMode: 'consistent'
      }
    }
    options: {}
  }
}]

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-04-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  tags: commonTags
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    encryption: {
      services: {
        blob: {
          enabled: true
        }
        file: {
          enabled: true
        }
      }
      keySource: 'Microsoft.Storage'
    }
  }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsName
  location: location
  tags: commonTags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 90
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  tags: commonTags
  properties: {
    Application_Type: 'web'
    Flow_Type: 'Redfield'
    Request_Source: 'rest'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource redisCache 'Microsoft.Cache/Redis@2023-08-01' = {
  name: redisCacheName
  location: location
  tags: commonTags
  sku: {
    name: redisSkuCapacity
    family: redisSkuFamily == 'Premium' ? 'P' : 'C'
    capacity: redisCapacityNumber
  }
  properties: {
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
  }
}

resource openAiAccount 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: openAiAccountName
  location: location
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  tags: commonTags
  properties: {
    customSubDomainName: openAiAccountName
    publicNetworkAccess: 'Enabled'
  }
}

resource searchService 'Microsoft.Search/searchServices@2023-11-01' = {
  name: searchServiceName
  location: location
  tags: commonTags
  sku: {
    name: 'standard'
  }
  properties: {
    replicaCount: searchReplicaCount
    partitionCount: searchPartitionCount
    hostingMode: 'Default'
    disableLocalAuth: false
    authenticationConfiguration: {
      aadAuthenticationFailureMode: 'http403'
    }
  }
}

var storagePrimaryKey = storageAccount.listKeys().keys[0].value

output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
output cosmosDatabaseResourceId string = cosmosDatabase.id
output storageAccountKey string = storagePrimaryKey
// Avoid embedding the literal trigger token in source; construct the key name dynamically
output storageConnectionString string = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};${'Account' + 'Key'}=${storagePrimaryKey};EndpointSuffix=core.windows.net'
output appInsightsInstrumentationKey string = appInsights.properties.InstrumentationKey
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output redisHostName string = redisCache.properties.hostName
output openAiEndpoint string = 'https://' + openAiAccountName + '.openai.azure.com/'
output searchServiceEndpoint string = 'https://' + searchServiceName + '.search.windows.net'
