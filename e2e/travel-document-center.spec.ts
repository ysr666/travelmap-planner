import { expect, test } from '@playwright/test'
import { createDemoTripViaUi, expectNoHorizontalOverflow } from './helpers'

test('建立加密资料库并保存多人证件', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  await page.goto(`/#/documents?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: '旅行资料中心' })).toBeVisible()
  await page.getByLabel('恢复口令').fill('tripmap recovery phrase')
  await page.getByLabel('再次输入').fill('tripmap recovery phrase')
  await page.getByRole('button', { name: '建立资料库' }).click()
  await expect(page.getByText('资料库已解锁')).toBeVisible()

  await page.getByRole('button', { name: '添加旅客' }).click()
  await page.getByLabel('显示名称').fill('测试旅客')
  await page.getByLabel('国籍').fill('中国')
  await page.getByRole('button', { name: '保存旅客' }).click()
  await expect(page.getByText('测试旅客')).toBeVisible()

  await page.getByRole('button', { name: '添加证件' }).click()
  await page.getByLabel('名称').fill('英国电子签证')
  await page.getByLabel('证件号码').fill('SECRET-EVISA-001')
  await page.getByLabel('有效期至').fill('2027-06-11')
  await page.getByLabel('加密原件').setInputFiles({ buffer: Buffer.from('%PDF-1.4 encrypted attachment test'), mimeType: 'application/pdf', name: 'uk-evisa.pdf' })
  await page.getByText('测试旅客', { exact: true }).last().click()
  await page.getByRole('button', { name: '加密保存' }).click()
  await expect(page.getByText('英国电子签证')).toBeVisible()
  await expect(page.getByText('有效期至 2027-06-11')).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '解密下载原件' }).click()
  expect((await downloadPromise).suggestedFilename()).toBe('uk-evisa.pdf')

  await page.getByRole('button', { name: '锁定资料库' }).click()
  await expect(page.getByRole('heading', { name: '解锁旅行资料库' })).toBeVisible()
  await page.getByLabel('恢复口令').fill('tripmap recovery phrase')
  await page.getByRole('button', { name: '解锁', exact: true }).click()
  await expect(page.getByText('英国电子签证')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('保存跨时区多段交通并保留外部跳转', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  await page.goto(`/#/documents?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('恢复口令').fill('transport recovery phrase')
  await page.getByLabel('再次输入').fill('transport recovery phrase')
  await page.getByRole('button', { name: '建立资料库' }).click()
  await page.getByRole('button', { name: '大交通' }).click()
  await page.getByRole('button', { name: '添加大交通订单' }).click()

  await page.getByLabel('订单名称').fill('伦敦往返联程')
  await page.getByLabel('承运方/平台').fill('British Airways')
  await page.getByLabel('出发地').fill('London Heathrow')
  await page.getByLabel('到达地').fill('Shanghai Pudong')
  await page.getByLabel('出发日期').fill('2026-08-01')
  await page.getByLabel('出发时间').fill('20:30')
  await page.getByLabel('出发时区').fill('Europe/London')
  await page.getByLabel('到达日期').fill('2026-08-02')
  await page.getByLabel('到达时间').fill('15:30')
  await page.getByLabel('到达时区').fill('Asia/Shanghai')
  await page.getByLabel('PNR/预订编号').fill('SECRET-PNR')
  await page.getByLabel('HTTPS 链接').fill('https://www.britishairways.com/')
  await page.getByRole('button', { name: '保存订单并建立提醒' }).click()

  await expect(page.getByText('伦敦往返联程')).toBeVisible()
  await expect(page.getByText(/Europe\/London → Asia\/Shanghai/)).toBeVisible()
  await expect(page.getByRole('link', { name: '承运方官网' })).toHaveAttribute('href', 'https://www.britishairways.com/')
  await expectNoHorizontalOverflow(page)
})

test('交通票据先本机预览再应用到订单表单', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  await page.goto(`/#/documents?tripId=${tripId}&tab=transport`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '添加大交通订单' }).click()
  await page.getByRole('button', { name: '本机导入' }).click()
  await page.getByLabel('粘贴票据文本').fill([
    'Flight BA39',
    'London Heathrow → Beijing Capital',
    '2026-07-01 16:20',
    '2026-07-02 09:30',
  ].join('\n'))
  await page.getByRole('button', { name: '生成本机预览' }).click()

  await expect(page.getByText(/BA39 London Heathrow → Beijing Capital/)).toBeVisible()
  await page.getByRole('button', { name: '应用到表单' }).click()
  await expect(page.getByLabel('订单名称')).toHaveValue('BA39 London Heathrow → Beijing Capital')
  await expect(page.getByLabel('航班/车次')).toHaveValue('BA39')
  await expect(page.getByLabel('出发日期')).toHaveValue('2026-07-01')
  await expect(page.getByLabel('到达日期')).toHaveValue('2026-07-02')
  await expectNoHorizontalOverflow(page)
})

test('旧票据地址兼容跳转到资料中心附件页', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  await page.goto(`/#/tickets?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(new RegExp(`#/documents\\?tripId=${tripId}&tab=attachments`))
  await expect(page.getByRole('heading', { name: '票据和订单' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '暂无票据' })).toBeVisible()
})

test('Package 6 资料建议保持脱敏且过期风险只能稍后处理', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  await page.goto(`/#/documents?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('恢复口令').fill('redacted document test phrase')
  await page.getByLabel('再次输入').fill('redacted document test phrase')
  await page.getByRole('button', { name: '建立资料库' }).click()

  await page.getByRole('button', { name: '添加旅客' }).click()
  await page.getByLabel('显示名称').fill('脱敏测试旅客')
  await page.getByRole('button', { name: '保存旅客' }).click()
  await page.getByRole('button', { name: '添加证件' }).click()
  await page.getByLabel('名称').fill('绝不能出现在资料建议里的护照标题')
  await page.getByLabel('证件号码').fill('SECRET-PASSPORT-998877')
  await page.getByLabel('有效期至').fill('2025-01-01')
  await page.getByText('脱敏测试旅客', { exact: true }).last().click()
  await page.getByRole('button', { name: '加密保存' }).click()

  const suggestions = page.getByTestId('travel-document-intelligence-panel')
  await expect(suggestions).toBeVisible()
  await expect(suggestions).toContainText('签证已过期')
  await expect(suggestions).not.toContainText('绝不能出现在资料建议里的护照标题')
  await expect(suggestions).not.toContainText('SECRET-PASSPORT-998877')
  await expect(suggestions.getByRole('button', { name: /稍后处理/ })).toBeVisible()
  await expect(suggestions.getByRole('button', { name: /忽略建议/ })).toHaveCount(0)

  await suggestions.getByTestId('travel-document-intelligence-action').first().click()
  await expect(page.getByTestId('travel-document-documents-section')).toBeVisible()
  await expect(page.getByText('绝不能出现在资料建议里的护照标题')).toBeVisible()
})
