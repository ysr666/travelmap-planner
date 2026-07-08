export type GlobalAiCapabilityAnswer = {
  answer: string
  caveats: string[]
  sourceCards: Array<{
    id: string
    kind: 'local_context' | 'provider_caveat' | 'trip_intelligence'
    title: string
    detail?: string
  }>
  title: string
}

export function getGlobalAiCapabilityAnswer(command: string): GlobalAiCapabilityAnswer | null {
  const normalized = command.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
  if (matchesAny(command, ['你能干什么', '你能做什么', '可以做什么', '你会什么', '帮助', '怎么用']) || /\bhelp\b/.test(normalized)) {
    return {
      answer: [
        '我可以帮你做旅行里的只读咨询、打开功能入口、查看本地摘要、生成行程修改预览、做突发重排预览、查看账本摘要。',
        '能写入的数据都会先进入预览和确认；普通问答不会直接修改行程、票据、账本或资料。',
      ].join('\n'),
      caveats: ['实时开放时间、票价、交通和搜索结果需要来源确认；没有来源时我不会编实时事实。'],
      sourceCards: [
        { detail: '本回答来自本地能力注册表，离线也可用。', id: 'capability:local', kind: 'local_context', title: '本地能力说明' },
        { detail: '写入动作复用现有预览、确认和 Unified Intelligence 完成记录。', id: 'capability:safety', kind: 'trip_intelligence', title: '写入安全边界' },
      ],
      title: '我能帮你做什么',
    }
  }
  if (matchesAny(command, ['怎么添加票据', '添加票据', '上传票据', '票据怎么'])) {
    return {
      answer: '可以打开当前旅行的票据/资料页上传附件；如果材料来自 Travel Inbox，需要先确认识别预览，才会绑定到行程或生成费用草稿。',
      caveats: ['票据文件和 blob 不会发送给普通问答。'],
      sourceCards: [{ id: 'capability:tickets', kind: 'local_context', title: '票据入口', detail: '打开当前旅行后进入票据/资料页。' }],
      title: '添加票据',
    }
  }
  if (matchesAny(command, ['怎么导出', '导出备份', '出发前备份', '导出 zip'])) {
    return {
      answer: '出发前建议在设置或云同步相关区域导出本机备份；云同步不是实时协作，重要旅行仍建议保留离线备份。',
      caveats: ['导出前请确认当前账号和本机数据空间正确。'],
      sourceCards: [{ id: 'capability:backup', kind: 'local_context', title: '备份建议', detail: '出发前导出，避免弱网或设备切换造成不便。' }],
      title: '导出与备份',
    }
  }
  if (matchesAny(command, ['会自动写入吗', '会不会自动写入', '自动修改', '隐私', '安全吗'])) {
    return {
      answer: '不会。AI 修改、费用草稿、重排等写入都需要先预览，再由你确认。普通问答不会读取资料库明文或票据文件。',
      caveats: ['需要联网处理时，会先走确认流程。'],
      sourceCards: [{ id: 'capability:privacy', kind: 'provider_caveat', title: '隐私边界', detail: '普通问答不拥有数据库写权限。' }],
      title: 'AI 写入和隐私',
    }
  }
  return null
}

function matchesAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern))
}
