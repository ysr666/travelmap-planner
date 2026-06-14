const destinationCurrencyRules: Array<[RegExp, string]> = [
  [/日本|东京|大阪|京都|札幌|Japan|Tokyo|Osaka|Kyoto/i, 'JPY'],
  [/美国|纽约|洛杉矶|旧金山|夏威夷|United States|USA|New York|Los Angeles/i, 'USD'],
  [/香港|Hong Kong/i, 'HKD'],
  [/英国|伦敦|United Kingdom|London/i, 'GBP'],
  [/泰国|曼谷|清迈|普吉|Thailand|Bangkok|Chiang Mai|Phuket/i, 'THB'],
  [/韩国|首尔|釜山|Korea|Seoul|Busan/i, 'KRW'],
  [/新加坡|Singapore/i, 'SGD'],
  [/澳大利亚|悉尼|墨尔本|Australia|Sydney|Melbourne/i, 'AUD'],
  [/加拿大|温哥华|多伦多|Canada|Vancouver|Toronto/i, 'CAD'],
  [/法国|德国|意大利|西班牙|葡萄牙|荷兰|比利时|奥地利|希腊|芬兰|爱尔兰|France|Germany|Italy|Spain|Portugal|Netherlands|Belgium|Austria|Greece|Finland|Ireland/i, 'EUR'],
]

export function suggestTripCurrency(destination: string) {
  return destinationCurrencyRules.find(([pattern]) => pattern.test(destination))?.[1] ?? 'CNY'
}

export const commonLedgerCurrencies = ['CNY', 'JPY', 'USD', 'EUR', 'HKD', 'GBP', 'THB', 'KRW', 'SGD', 'AUD', 'CAD']
