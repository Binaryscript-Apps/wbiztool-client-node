# WbizTool Client for Node.js

A Node.js client library for the [WbizTool WhatsApp API](https://wbiztool.com).

## Installation

```bash
npm install wbiztool-client
```

## Usage

```javascript
const { WbizToolClient, WbizToolError } = require('wbiztool-client');

// Initialize the client
const client = new WbizToolClient({
  clientId: 12345,              // Your API Client ID (Settings -> API keys)
  apiKey: 'your_api_key',
  whatsappClient: 678           // Optional default WhatsApp number to send from
});

// Send a text message
client.sendMessage({
  phone: '919876543210',
  countryCode: '91',
  message: 'Hello from WbizTool!'
})
.then(response => {
  console.log('Message sent!', response.msg_id);
})
.catch(error => {
  console.error('Error sending message:', error.apiMessage || error.message);
});

// Send an image with message
client.sendMessageWithImage({
  phone: '919876543210',
  countryCode: '91',
  message: 'Check out this image!',
  imageUrl: 'https://example.com/image.jpg'   // or imagePath: './image.jpg' to upload
});

// Send a file
client.sendMessageWithFile({
  phone: '919876543210',
  message: 'Your invoice',
  fileUrl: 'https://example.com/invoice.pdf', // or filePath: './invoice.pdf' to upload
  fileName: 'invoice.pdf'
});
```

### Scheduling a message

```javascript
// A wall-clock time in a named timezone
await client.scheduleMessage({
  phone: '9876543210',
  countryCode: '91',
  message: 'A reminder that your appointment is today at 11:30 AM.',
  scheduleTime: '2026-12-24 09:00',  // or '24/12/2026 09:00'; or pass date: '24/12/2026', time: '09:00'
  timezone: 'Asia/Kolkata',          // IANA name or IST, UTC, EST, PST, CET ... (default: UTC)
  whatsappClient: 678                // required for scheduling (or set it in the constructor)
});

// An exact moment: a Date is sent in UTC
await client.scheduleMessage({
  phone: '919876543210',
  message: 'Reminder in one hour',
  scheduleTime: new Date(Date.now() + 60 * 60 * 1000)
});

// A WhatsApp group instead of a number
await client.scheduleMessage({
  groupName: 'Sales Team Mumbai',
  message: 'Team meeting starts in 15 minutes.',
  scheduleTime: '2026-12-24 14:45',
  timezone: 'Asia/Kolkata'
});
```

The API schedules to the minute (seconds are dropped), and takes scheduled images and files by URL
(`imageUrl` / `fileUrl`) only.

### Other methods

- `cancelMessage(msgId)` - cancel a queued or scheduled message
- `getMessageHistory({ startDate, endDate, page, whatsappClient })` - sent messages report (`DD-MM-YYYY` dates
  or `Date`s, `endDate` itself not included, 200 per page); success is the presence of `total`
- `getWhatsAppClients()` - the WhatsApp numbers connected right now
- `getWhatsAppClientStatus(whatsappClientId)` - `{ message: 'Connected', status: 1 }` or
  `{ message: 'Disconnected', status: 0 }`

### Errors

Every failed request throws a `WbizToolError`: HTTP errors (400, 403, 429, 500 ...) and the refusals the API
answers with HTTP 200 and `"status": 0` (most errors of scheduling and cancelling come back that way). Its
message is `API error: <HTTP status> - <JSON body>`; it also has `status` (HTTP status), `data` (the body) and
`apiMessage` (the API's `message`).

```javascript
try {
  await client.cancelMessage(9817263);
} catch (error) {
  if (error instanceof WbizToolError) {
    console.error(error.apiMessage); // e.g. "Msg has been Sent"
  }
}
```

A disconnected number in `getWhatsAppClientStatus()` is a normal result, not an error.

## Environment Variables

You can also configure the client using environment variables:

```javascript
// Load credentials from environment variables
// WBIZTOOL_CLIENT_ID, WBIZTOOL_API_KEY, WBIZTOOL_WHATSAPP_CLIENT
const client = new WbizToolClient();
```

## Development

```bash
npm ci
npm test   # node:test, HTTP mocked (Node 18+)
```

## Documentation

For complete documentation of the WbizTool API, visit:
https://wbiztool.com/docs/

## License

MIT
