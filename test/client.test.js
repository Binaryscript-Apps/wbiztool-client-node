// Unit tests for WbizToolClient. No network: axios.post is mocked. Run: npm test
const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const { WbizToolClient, WbizToolError } = require('../src');

const BASE = 'https://wbiztool.com/api/v1';
let post;

function reply(data, status = 200) {
  post.mock.mockImplementation(async () => {
    if (status >= 400) {
      const error = new Error(`Request failed with status code ${status}`);
      error.response = { status, data };
      throw error;
    }
    return { status, data };
  });
}

const lastCall = () => {
  const [url, body, config] = post.mock.calls.at(-1).arguments;
  return { url, body, config };
};

const client = (extra = {}) => new WbizToolClient({ clientId: 12345, apiKey: 'KEY', whatsappClient: 678, ...extra });

beforeEach(() => {
  post = mock.method(axios, 'post', async () => ({ status: 200, data: { status: 1 } }));
});

afterEach(() => {
  mock.restoreAll();
});

test('constructor needs clientId and apiKey but not whatsappClient', () => {
  const saved = { ...process.env };
  delete process.env.WBIZTOOL_CLIENT_ID;
  delete process.env.WBIZTOOL_API_KEY;
  delete process.env.WBIZTOOL_WHATSAPP_CLIENT;
  try {
    assert.throws(() => new WbizToolClient({ apiKey: 'KEY' }), /Client ID is required/);
    assert.throws(() => new WbizToolClient({ clientId: 1 }), /API Key is required/);
    const c = new WbizToolClient({ clientId: 1, apiKey: 'KEY' });
    assert.equal(c.whatsappClient, undefined);
  } finally {
    process.env = saved;
  }
});

test('sendMessage posts JSON to /send_msg/', async () => {
  reply({ msg_id: 9, message: 'Created', status: 1 });
  const result = await client().sendMessage({ phone: '9876543210', countryCode: '91', message: 'Hi', webhook: 'https://e.x/h' });
  const { url, body, config } = lastCall();
  assert.equal(url, `${BASE}/send_msg/`);
  assert.deepEqual(body, {
    client_id: 12345, api_key: 'KEY', whatsapp_client: 678, msg_type: 0, msg: 'Hi',
    phone: '9876543210', country_code: '91', webhook: 'https://e.x/h'
  });
  assert.equal(config.timeout, 60000);
  assert.equal(result.msg_id, 9);
});

test('sendMessage without a default whatsappClient leaves it out', async () => {
  reply({ msg_id: 9, message: 'Created', status: 1 });
  await new WbizToolClient({ clientId: 1, apiKey: 'K' }).sendMessage({ phone: '919876543210', message: 'Hi' });
  assert.equal('whatsapp_client' in lastCall().body, false);
});

test('HTTP 400 throws WbizToolError with the old message format', async () => {
  reply({ status: 0, message: 'Invalid phone number' }, 400);
  await assert.rejects(client().sendMessage({ phone: 'x', message: 'Hi' }), (error) => {
    assert.ok(error instanceof WbizToolError);
    assert.equal(error.message, 'API error: 400 - {"status":0,"message":"Invalid phone number"}');
    assert.equal(error.status, 400);
    assert.equal(error.apiMessage, 'Invalid phone number');
    return true;
  });
});

test('a non-JSON body throws', async () => {
  reply('<html>Server Error</html>', 500);
  await assert.rejects(client().getWhatsAppClients(), WbizToolError);
  reply('<html>oops</html>', 200);
  await assert.rejects(client().getWhatsAppClients(), WbizToolError);
});

test('sendMessageWithFile uploads multipart without undefined fields', async () => {
  reply({ msg_id: 9, message: 'Created', status: 1 });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wbiz-')), 'invoice.pdf');
  fs.writeFileSync(file, '%PDF');
  // no countryCode: form-data used to throw on the undefined field
  await client().sendMessageWithFile({ phone: '919876543210', message: 'Invoice', filePath: file });
  const { url, body, config } = lastCall();
  assert.equal(url, `${BASE}/send_msg/`);
  assert.ok(body instanceof FormData);
  assert.match(config.headers['content-type'], /^multipart\/form-data; boundary=/);
  const text = body._streams.filter((s) => typeof s === 'string').join('');
  assert.match(text, /name="file_name"\r\n\r\ninvoice\.pdf/);
  assert.match(text, /name="msg_type"\r\n\r\n2/);
  assert.match(text, /name="file"; filename="invoice\.pdf"/);
  assert.doesNotMatch(text, /country_code/);
});

test('sendMessageWithImage by URL', async () => {
  reply({ msg_id: 9, message: 'Created', status: 1 });
  await client().sendMessageWithImage({ phone: '919876543210', message: 'Look', imageUrl: 'https://e.x/a.jpg' });
  assert.equal(lastCall().body.img_url, 'https://e.x/a.jpg');
  assert.equal(lastCall().body.msg_type, 1);
});

test('scheduleMessage sends date DD/MM/YYYY, time HH:MM and timezone', async () => {
  reply({ msg_id: 9817263, message: 'Created', status: 1 });
  const result = await client().scheduleMessage({
    phone: '9876543210', countryCode: '91', message: 'Hi', scheduleTime: '2026-12-24 09:00:00', timezone: 'Asia/Kolkata'
  });
  const { url, body } = lastCall();
  assert.equal(url, `${BASE}/schedule_msg/`);
  assert.deepEqual(body, {
    client_id: 12345, api_key: 'KEY', whatsapp_client: 678, msg_type: 0, msg: 'Hi',
    date: '24/12/2026', time: '09:00', timezone: 'Asia/Kolkata', phone: '9876543210', country_code: '91'
  });
  assert.equal('schedule_time' in body, false);
  assert.equal(result.msg_id, 9817263);
});

test('scheduleMessage: a Date is sent in UTC', async () => {
  reply({ msg_id: 1, message: 'Created', status: 1 });
  await client().scheduleMessage({
    phone: '919876543210', message: 'Hi', scheduleTime: new Date('2026-12-24T09:00:00+05:30'), timezone: 'Asia/Kolkata'
  });
  const { body } = lastCall();
  assert.deepEqual([body.date, body.time, body.timezone], ['24/12/2026', '03:30', 'UTC']);
});

test('scheduleMessage: ISO string with Z, API-format string, and date/time fields', async () => {
  reply({ msg_id: 1, message: 'Created', status: 1 });
  const c = client();
  await c.scheduleMessage({ phone: '919876543210', message: 'Hi', scheduleTime: '2026-12-24T18:45:30Z' });
  assert.deepEqual([lastCall().body.date, lastCall().body.time, lastCall().body.timezone], ['24/12/2026', '18:45', 'UTC']);
  await c.scheduleMessage({ phone: '919876543210', message: 'Hi', scheduleTime: '05/01/2027 07:30', timezone: 'IST' });
  assert.deepEqual([lastCall().body.date, lastCall().body.time, lastCall().body.timezone], ['05/01/2027', '07:30', 'IST']);
  await c.scheduleMessage({ phone: '919876543210', message: 'Hi', date: '06/01/2027', time: '23:59', timezone: 'PST' });
  assert.deepEqual([lastCall().body.date, lastCall().body.time, lastCall().body.timezone], ['06/01/2027', '23:59', 'PST']);
  await c.scheduleMessage({ phone: '919876543210', message: 'Hi', scheduleTime: '2027-01-07 08:15' });
  assert.equal(lastCall().body.timezone, 'UTC');
});

test('scheduleMessage to a group, and media by URL', async () => {
  reply({ msg_id: 1, message: 'Created', status: 1 });
  const c = client();
  await c.scheduleMessage({ groupName: 'Sales Team Mumbai', message: 'Meeting', scheduleTime: '2026-12-24 14:45' });
  assert.equal(lastCall().body.group_name, 'Sales Team Mumbai');
  assert.equal('phone' in lastCall().body, false);
  await c.scheduleMessage({ phone: '919876543210', msgType: '2', fileUrl: 'https://e.x/a.pdf', fileName: 'a.pdf', scheduleTime: '2026-12-24 14:45' });
  assert.deepEqual([lastCall().body.msg_type, lastCall().body.file_url, lastCall().body.file_name], [2, 'https://e.x/a.pdf', 'a.pdf']);
});

test('scheduleMessage: status 0 with HTTP 200 throws', async () => {
  reply({ message: 'Scheduled date & time is not in valid format', status: 0 });
  await assert.rejects(
    client().scheduleMessage({ phone: '919876543210', message: 'Hi', scheduleTime: '2026-12-24 09:00' }),
    (error) => error instanceof WbizToolError && error.status === 200 &&
      error.apiMessage === 'Scheduled date & time is not in valid format'
  );
});

test('scheduleMessage refuses bad input before sending', async () => {
  const c = client();
  const base = { phone: '919876543210', message: 'Hi' };
  await assert.rejects(c.scheduleMessage(base), /scheduleTime/);
  await assert.rejects(c.scheduleMessage({ ...base, scheduleTime: 'tomorrow' }), /scheduleTime must be/);
  await assert.rejects(c.scheduleMessage({ ...base, date: '2026-12-24', time: '09:00' }), /DD\/MM\/YYYY/);
  await assert.rejects(c.scheduleMessage({ ...base, groupName: 'g', scheduleTime: '2026-12-24 09:00' }), /either phone or groupName/);
  await assert.rejects(c.scheduleMessage({ ...base, msgType: 1, scheduleTime: '2026-12-24 09:00' }), /imageUrl/);
  assert.equal(post.mock.callCount(), 0);
});

test('cancelMessage: success, and "Msg has been Sent" throws', async () => {
  reply({ message: 'Cancelled', status: 1 });
  await client().cancelMessage(456);
  assert.equal(lastCall().url, `${BASE}/cancel_msg/`);
  assert.equal(lastCall().body.msg_id, 456);
  reply({ message: 'Msg has been Sent', status: 0 });
  await assert.rejects(client().cancelMessage(456), WbizToolError);
});

test('getWhatsAppClients calls /whatsapp-client/list/', async () => {
  reply({ status: 1, message: 'okay', whatsapp_clients: [] });
  await client().getWhatsAppClients();
  assert.equal(lastCall().url, `${BASE}/whatsapp-client/list/`);
});

test('getWhatsAppClientStatus calls /whatsapp-client/status/; Disconnected is a result', async () => {
  reply({ message: 'Connected', status: 1 });
  await client().getWhatsAppClientStatus(99);
  assert.equal(lastCall().url, `${BASE}/whatsapp-client/status/`);
  assert.equal(lastCall().body.whatsapp_client, 99);
  reply({ message: 'Disconnected', status: 0 });
  assert.equal((await client().getWhatsAppClientStatus()).message, 'Disconnected');
  assert.equal(lastCall().body.whatsapp_client, 678);
  reply({ message: 'Auth Error 2', status: 0 });
  await assert.rejects(client().getWhatsAppClientStatus(5), WbizToolError);
});

test('getMessageHistory calls /report/ with a numeric page; success is `total`', async () => {
  reply({ message: 'Success', status: 0, total: 1, history: [{ id: 1 }] });
  const result = await client().getMessageHistory({ startDate: '01-09-2026', endDate: new Date(2026, 8, 8), page: '2', whatsappClient: 678 });
  const { url, body } = lastCall();
  assert.equal(url, `${BASE}/report/`);
  assert.deepEqual(body, {
    client_id: 12345, api_key: 'KEY', start_date: '01-09-2026', end_date: '08-09-2026', page: 2, whatsapp_client: 678
  });
  assert.equal(result.total, 1);
  reply({ message: 'Error', status: 0, history: [] });
  await assert.rejects(client().getMessageHistory({ startDate: 'x', endDate: 'y' }), WbizToolError);
  await assert.rejects(client().getMessageHistory({}), /startDate and endDate/);
});
