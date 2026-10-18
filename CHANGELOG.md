# Changelog

## Unreleased (proposed 0.2.0)

### Fixed
- `scheduleMessage()` works: it sent `schedule_time`, which the API doesn't read, so every call was refused.
  It now sends `date` (`DD/MM/YYYY`), `time` (`HH:MM`) and `timezone` (option `timezone`, default `UTC`).
  `scheduleTime` can be a `Date` (sent as its exact moment, in UTC) or a string `'YYYY-MM-DD HH:MM[:SS]'` /
  `'DD/MM/YYYY HH:MM'`; or pass `date` and `time` in the API's format. `groupName` schedules for a group;
  `msgType` may be a string.
- `getWhatsAppClients()` calls `/whatsapp-client/list/` (it called `/list_whatsapp_clients/`, which doesn't exist).
- `getWhatsAppClientStatus()` calls `/whatsapp-client/status/` (it called `/whatsapp_client_status/`, which
  doesn't exist).
- `getMessageHistory()` calls `/report/` (it called `/history_msgs/`, which doesn't exist). It now takes
  `{ startDate, endDate, page, whatsappClient }` (the old `phone` / `limit` / `offset` options were never
  supported by the API) and sends `page` as a number.
- Uploads (`imagePath` / `filePath`) no longer crash when an optional field such as `countryCode` is left out
  (form-data threw on `undefined`).

### Changed
- Failed requests throw `WbizToolError` (message format unchanged: `API error: <status> - <body>`), with
  `status`, `data` and `apiMessage`. This now includes refusals the API answers with HTTP 200 and
  `"status": 0` (e.g. scheduling errors, `cancelMessage()` on a message already sent), which used to resolve
  as a normal result. A disconnected number in `getWhatsAppClientStatus()` still resolves.
- `whatsappClient` is optional in the constructor (cancel, list and history don't need it); every send and
  schedule method takes `whatsappClient` to override the default.
- New `timeout` constructor option (default 60000 ms; requests had none).
- The npm package contains only `src/`, the README and this changelog.

### Added
- `WbizToolError` export.
- Unit tests (`npm test`, node:test with mocked HTTP).

## 0.1.0

- First release.
