# WbizTool Client for Node.js

A Node.js client library for the [WbizTool WhatsApp API](https://wbiztool.com).

## Installation

```bash
npm install wbiztool-client
```

## Usage

```javascript
const { WbizToolClient } = require('wbiztool-client');

// Initialize the client
const client = new WbizToolClient({
  clientId: 'your_client_id',
  apiKey: 'your_api_key',
  whatsappClient: 'your_whatsapp_client_id'
});

// Send a text message
client.sendMessage({
  phone: '919876543210',
  countryCode: '91',
  message: 'Hello from WbizTool!'
})
.then(response => {
  console.log('Message sent!', response);
})
.catch(error => {
  console.error('Error sending message:', error);
});

// Send an image with message
client.sendMessageWithImage({
  phone: '919876543210',
  countryCode: '91',
  message: 'Check out this image!',
  imageUrl: 'https://example.com/image.jpg'
})
.then(response => {
  console.log('Image message sent!', response);
})
.catch(error => {
  console.error('Error sending image message:', error);
});
```

## Environment Variables

You can also configure the client using environment variables:

```javascript
// Load credentials from environment variables
// WBIZTOOL_CLIENT_ID, WBIZTOOL_API_KEY, WBIZTOOL_WHATSAPP_CLIENT
const client = new WbizToolClient();
```

## Documentation

For complete documentation of the WbizTool API, visit:
https://wbiztool.com/docs/

## License

MIT
