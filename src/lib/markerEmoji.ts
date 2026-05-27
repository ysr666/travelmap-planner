import type { ItineraryItem } from '../types'

type EmojiRule = {
  emoji: string
  patterns: RegExp[]
}

const rules: EmojiRule[] = [
  {
    emoji: '🍽️',
    patterns: [
      /餐厅|食堂|拉面|寿司|烧烤|咖啡|茶|居酒屋|酒吧|小吃|料理|美食|便当|甜品|烘焙|早午餐/i,
      /restaurant|cafe|bakery|brunch|diner|bar|pub|coffee|tea\s?house/i,
    ],
  },
  {
    emoji: '🏨',
    patterns: [
      /酒店|旅馆|民宿|宾馆|住宿|客栈|度假/i,
      /hotel|hostel|ryokan|inn|resort|lodge|airbnb/i,
    ],
  },
  {
    emoji: '🚃',
    patterns: [
      /车站|机场|码头|地铁|巴士|火车站|高铁|航站楼|渡轮/i,
      /station|airport|terminal|port|ferry|bus\s?stop|metro/i,
    ],
  },
  {
    emoji: '⛩️',
    patterns: [
      /神社|寺|塔|公园|博物馆|美术馆|景点|城|城堡|庭园|神宫|神殿/i,
      /castle|temple|museum|gallery|park|shrine|palace|monument|tower/i,
    ],
  },
  {
    emoji: '🛍️',
    patterns: [
      /商店|购物|市场|商场|免税|药妆|超市|百货/i,
      /mall|shop|store|market|outlet|supermarket|department/i,
    ],
  },
]

const textCache = new Map<string, string | null>()

function matchEmoji(text: string): string | null {
  const cached = textCache.get(text)
  if (cached !== undefined) return cached

  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        textCache.set(text, rule.emoji)
        return rule.emoji
      }
    }
  }

  textCache.set(text, null)
  return null
}

export function getMarkerEmoji(item: Pick<ItineraryItem, 'title' | 'locationName'>): string | null {
  const title = item.title?.trim()
  const locationName = item.locationName?.trim()

  if (title) {
    const fromTitle = matchEmoji(title)
    if (fromTitle) return fromTitle
  }

  if (locationName) {
    const fromLocation = matchEmoji(locationName)
    if (fromLocation) return fromLocation
  }

  return null
}
