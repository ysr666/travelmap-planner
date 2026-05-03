# 旅图 TripMap AI 行程包开放格式

旅图不内置 AI，也不会调用 AI API。你可以使用 ChatGPT、Claude、Gemini、DeepSeek 或其他工具生成符合本格式的 `trip-plan.json`，再在旅图中本地导入。

导入过程只读取你选择的 JSON / zip 文件，不上传服务器。

## 文件类型

### JSON 单文件

`trip-plan.json` 适合只导入行程、坐标、交通段、reference / external 票据。

JSON 单文件不支持 `storageMode: "copy"` 票据，因为 copy 附件必须来自 zip 内的 `files/` 目录。

### zip 行程包

```text
trip-plan.zip
├── trip-plan.json
└── files/
    ├── hotel-confirmation.pdf
    ├── museum-ticket.png
    └── train-ticket.pdf
```

zip 中可以包含附件，但旅图只读取 `trip-plan.json` 明确引用的文件。未引用文件会被忽略。

## 顶层结构

```json
{
  "schemaVersion": 1,
  "type": "trip-plan",
  "source": "ChatGPT",
  "trip": {
    "title": "东京 5 日旅行",
    "destination": "Tokyo, Japan",
    "startDate": "2026-04-10",
    "endDate": "2026-04-14",
    "notes": "请出发前人工核对营业时间。"
  },
  "days": [],
  "tickets": []
}
```

必须满足：

- `schemaVersion` 固定为 `1`
- `type` 固定为 `"trip-plan"`
- 日期使用 `YYYY-MM-DD`
- 时间使用 `HH:mm`
- 经纬度使用十进制度：`lat` 为 `-90..90`，`lng` 为 `-180..180`

## Day 和行程点

`days` 会按数组原顺序导入为 Day 顺序。如果日期顺序和数组顺序不一致，旅图会给出 warning，但仍保留原顺序。

```json
{
  "date": "2026-04-10",
  "title": "抵达与涩谷",
  "items": [
    {
      "title": "Hotel Metropolitan Tokyo 入住",
      "startTime": "15:00",
      "locationName": "Hotel Metropolitan Tokyo",
      "address": "1-6-1 Nishi-Ikebukuro, Toshima City, Tokyo",
      "lat": 35.72918,
      "lng": 139.71092,
      "transportMode": "train",
      "notes": "办理入住并寄存行李。"
    }
  ]
}
```

### 交通方式枚举

- `walk`
- `transit`
- `car`
- `train`
- `flight`
- `other`

从上一站到当前站的交通信息写在当前 item 上：

```json
{
  "title": "Shibuya Sky",
  "previousTransportMode": "train",
  "previousTransportDurationMinutes": 25,
  "previousTransportNote": "JR 山手线到涩谷站"
}
```

## 票据

票据支持三种模式。

### copy：保存文件副本

只能用于 zip 行程包。`filePath` 必须指向 zip 内的相对路径，不能是绝对路径，不能包含 `../`。

```json
{
  "title": "酒店确认单",
  "storageMode": "copy",
  "filePath": "files/hotel-confirmation.pdf",
  "fileName": "hotel-confirmation.pdf",
  "mimeType": "application/pdf",
  "bindTo": {
    "date": "2026-04-10",
    "itemTitle": "Hotel Metropolitan Tokyo 入住"
  }
}
```

### reference：仅记录文件位置

旅图不会保存文件副本，也不能直接打开本地路径。

```json
{
  "title": "签证材料位置",
  "storageMode": "reference",
  "referenceLocation": "iCloud Drive/日本旅行/签证材料.pdf"
}
```

### external：保存外部链接

只接受 `http://` 或 `https://`。

```json
{
  "title": "酒店订单网页",
  "storageMode": "external",
  "externalUrl": "https://example.com/order/123"
}
```

## 完整示例

```json
{
  "schemaVersion": 1,
  "type": "trip-plan",
  "source": "External AI",
  "trip": {
    "title": "东京周末旅行",
    "destination": "Tokyo, Japan",
    "startDate": "2026-04-10",
    "endDate": "2026-04-11",
    "notes": "AI 生成内容请人工核对。"
  },
  "days": [
    {
      "date": "2026-04-10",
      "title": "抵达与涩谷",
      "items": [
        {
          "title": "Hotel Metropolitan Tokyo 入住",
          "startTime": "15:00",
          "locationName": "Hotel Metropolitan Tokyo",
          "address": "1-6-1 Nishi-Ikebukuro, Toshima City, Tokyo",
          "lat": 35.72918,
          "lng": 139.71092
        },
        {
          "title": "Shibuya Sky",
          "startTime": "18:30",
          "locationName": "Shibuya Sky",
          "address": "2-24-12 Shibuya, Shibuya City, Tokyo",
          "lat": 35.65858,
          "lng": 139.70204,
          "previousTransportMode": "train",
          "previousTransportDurationMinutes": 25,
          "previousTransportNote": "JR 山手线到涩谷站"
        }
      ]
    }
  ],
  "tickets": [
    {
      "title": "酒店确认单位置",
      "storageMode": "reference",
      "referenceLocation": "iCloud Drive/东京旅行/酒店确认单.pdf",
      "bindTo": {
        "date": "2026-04-10",
        "itemTitle": "Hotel Metropolitan Tokyo 入住"
      }
    }
  ]
}
```

## 常见错误

- `type` 不是 `"trip-plan"`
- JSON 单文件中使用了 `storageMode: "copy"`
- zip 中缺少 `trip-plan.json`
- copy 票据的 `filePath` 不存在
- copy 票据的 `filePath` 使用了绝对路径或 `../`
- external 票据不是 `http://` 或 `https://`
- 日期不是 `YYYY-MM-DD`
- 经纬度超出合法范围

## 安全提醒

- AI 可能生成错误地点、错误营业时间、错误坐标。
- 出发前必须人工核对所有行程。
- 交通时间只作参考，应以 Apple Maps / Google Maps 实际路线为准。
- 不要把护照、签证、银行卡等敏感材料直接发给不可信 AI。
- AI 通常只能生成 `trip-plan.json`；真实酒店订单、门票、车票附件需要用户自己放入 zip 的 `files/` 目录。
- copy 模式必须使用 zip 行程包；JSON 单文件不支持 copy 附件。
