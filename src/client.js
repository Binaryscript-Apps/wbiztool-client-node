const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

/**
 * A request the WbizTool API refused, or answered with something that isn't JSON.
 *
 * Thrown for HTTP errors (400, 403, 429, 500 ...) and for refusals the API answers with HTTP 200
 * and `"status": 0` in the body (most errors of /schedule_msg/ and /cancel_msg/, for example).
 * The message keeps the format of earlier versions: `API error: <HTTP status> - <JSON body>`.
 */
class WbizToolError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   * @param {number} [details.status] - HTTP status code
   * @param {*} [details.data] - Response body
   * @param {Object} [details.response] - The axios response
   */
  constructor(message, { status, data, response } = {}) {
    super(message);
    this.name = 'WbizToolError';
    /** HTTP status code (200 for a "status": 0 refusal), or undefined when there was no response. */
    this.status = status;
    /** The parsed response body. */
    this.data = data;
    /** The API's `message`, when the body has one. */
    this.apiMessage = data && typeof data === 'object' ? data.message : undefined;
    this.response = response;
  }
}

function apiError(response) {
  return new WbizToolError(`API error: ${response.status} - ${JSON.stringify(response.data)}`, {
    status: response.status,
    data: response.data,
    response
  });
}

/** Which bodies count as success, per endpoint (the API isn't consistent). */
const SUCCESS = {
  // "status": 1 means it worked; anything else is a refusal
  status: (data) => data.status === 1,
  // /report/ answers "status": 0 even on success; it worked when `total` is present
  report: (data) => Object.prototype.hasOwnProperty.call(data, 'total'),
  // /whatsapp-client/status/ answers {"message": "Disconnected", "status": 0} for a disconnected number
  clientStatus: (data) => data.status === 1 || data.message === 'Disconnected'
};

const pad = (n) => String(n).padStart(2, '0');

/**
 * The schedule API's fields: date DD/MM/YYYY, time HH:MM (24-hour) and timezone.
 * A Date (or an ISO string with Z / an offset) is an exact moment: it is sent in UTC with timezone 'UTC'.
 * A string without an offset ('YYYY-MM-DD HH:MM[:SS]', 'YYYY-MM-DDTHH:MM' or 'DD/MM/YYYY HH:MM') is a wall-clock
 * time read in `timezone` (default 'UTC'). Seconds are dropped: the API schedules to the minute.
 * @private
 */
function scheduleFields(scheduleTime, timezone) {
  const zone = (timezone && String(timezone).trim()) || 'UTC';
  if (scheduleTime instanceof Date) {
    if (Number.isNaN(scheduleTime.getTime())) {
      throw new Error('scheduleTime is an invalid Date');
    }
    return {
      date: `${pad(scheduleTime.getUTCDate())}/${pad(scheduleTime.getUTCMonth() + 1)}/${scheduleTime.getUTCFullYear()}`,
      time: `${pad(scheduleTime.getUTCHours())}:${pad(scheduleTime.getUTCMinutes())}`,
      timezone: 'UTC'
    };
  }
  if (typeof scheduleTime !== 'string') {
    throw new Error('scheduleTime must be a Date or a string');
  }
  const text = scheduleTime.trim();
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    if (m[6]) {
      return scheduleFields(new Date(text.replace(' ', 'T')), zone);
    }
    return { date: `${m[3]}/${m[2]}/${m[1]}`, time: `${m[4]}:${m[5]}`, timezone: zone };
  }
  m = text.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::\d{2})?$/);
  if (m) {
    return { date: `${m[1]}/${m[2]}/${m[3]}`, time: `${m[4]}:${m[5]}`, timezone: zone };
  }
  throw new Error(
    `scheduleTime must be a Date or a string like 'YYYY-MM-DD HH:MM' or 'DD/MM/YYYY HH:MM' (got ${JSON.stringify(scheduleTime)})`
  );
}

/** The report API's DD-MM-YYYY date: a Date is formatted (its local calendar day), a string is sent as it is. */
function reportDate(value) {
  if (value instanceof Date) {
    return `${pad(value.getDate())}-${pad(value.getMonth() + 1)}-${value.getFullYear()}`;
  }
  return value;
}

class WbizToolClient {
  /**
   * Creates a new WbizTool client
   * @param {Object} options - Configuration options
   * @param {number|string} [options.clientId] - Client ID from WbizTool
   * @param {string} [options.apiKey] - API Key from WbizTool
   * @param {number|string} [options.whatsappClient] - Default WhatsApp Client ID to send from. Needed for
   *   scheduleMessage(), and for sending when the workspace has more than one connected number; each method
   *   also takes `whatsappClient` to override it.
   * @param {string} [options.baseUrl='https://wbiztool.com/api/v1'] - Base URL for the API
   * @param {number} [options.timeout=60000] - Request timeout in milliseconds
   */
  constructor(options = {}) {
    this.clientId = options.clientId || process.env.WBIZTOOL_CLIENT_ID;
    this.apiKey = options.apiKey || process.env.WBIZTOOL_API_KEY;
    this.whatsappClient = options.whatsappClient || process.env.WBIZTOOL_WHATSAPP_CLIENT;
    this.baseUrl = options.baseUrl || 'https://wbiztool.com/api/v1';
    this.timeout = options.timeout === undefined ? 60000 : options.timeout;

    this.validateCredentials();
  }

  /**
   * Validates that required credentials are provided
   * @private
   */
  validateCredentials() {
    if (!this.clientId) {
      throw new Error('Client ID is required. Provide it in the constructor or set WBIZTOOL_CLIENT_ID environment variable.');
    }
    if (!this.apiKey) {
      throw new Error('API Key is required. Provide it in the constructor or set WBIZTOOL_API_KEY environment variable.');
    }
  }

  /** @private */
  basePayload(options = {}) {
    const payload = { client_id: this.clientId, api_key: this.apiKey };
    const whatsappClient = options.whatsappClient || this.whatsappClient;
    if (whatsappClient) {
      payload.whatsapp_client = whatsappClient;
    }
    return payload;
  }

  /** @private */
  messagePayload(options, msgType) {
    const payload = {
      ...this.basePayload(options),
      msg_type: msgType,
      msg: options.message,
      phone: options.phone,
      country_code: options.countryCode
    };
    if (options.expireAfterSeconds) {
      payload.expire_after_seconds = options.expireAfterSeconds;
    }
    if (options.webhook) {
      payload.webhook = options.webhook;
    }
    return payload;
  }

  /**
   * Send a simple text message
   * @param {Object} options - Message options
   * @param {string} options.phone - Recipient's phone number without country code
   * @param {string} options.countryCode - Recipient's country code
   * @param {string} options.message - Message content
   * @param {number|string} [options.whatsappClient] - WhatsApp Client ID to send from (defaults to the constructor's)
   * @param {number} [options.expireAfterSeconds] - Expire message if not sent within this time
   * @param {string} [options.webhook] - Webhook URL for status updates
   * @returns {Promise<Object>} - API response ({ msg_id, message, status: 1 })
   * @throws {WbizToolError} When the API refuses the message
   */
  async sendMessage(options) {
    return this.sendRequest('/send_msg/', this.messagePayload(options, 0));
  }

  /**
   * Send a message with an image
   * @param {Object} options - Message options
   * @param {string} options.phone - Recipient's phone number without country code
   * @param {string} options.countryCode - Recipient's country code
   * @param {string} options.message - Message content
   * @param {string} [options.imageUrl] - URL of the image to send
   * @param {string} [options.imagePath] - Path to the image file on disk
   * @param {number|string} [options.whatsappClient] - WhatsApp Client ID to send from (defaults to the constructor's)
   * @param {number} [options.expireAfterSeconds] - Expire message if not sent within this time
   * @param {string} [options.webhook] - Webhook URL for status updates
   * @returns {Promise<Object>} - API response
   */
  async sendMessageWithImage(options) {
    if (!options.imageUrl && !options.imagePath) {
      throw new Error('Either imageUrl or imagePath must be provided');
    }

    const payload = this.messagePayload(options, 1);

    if (options.imageUrl) {
      payload.img_url = options.imageUrl;
      return this.sendRequest('/send_msg/', payload);
    }
    return this.sendFormRequest('/send_msg/', this.buildForm(payload, options.imagePath));
  }

  /**
   * Send a message with a file attachment
   * @param {Object} options - Message options
   * @param {string} options.phone - Recipient's phone number without country code
   * @param {string} options.countryCode - Recipient's country code
   * @param {string} options.message - Message content
   * @param {string} [options.fileName] - Name of the file (defaults to the file's name)
   * @param {string} [options.fileUrl] - URL of the file to send
   * @param {string} [options.filePath] - Path to the file on disk
   * @param {number|string} [options.whatsappClient] - WhatsApp Client ID to send from (defaults to the constructor's)
   * @param {number} [options.expireAfterSeconds] - Expire message if not sent within this time
   * @param {string} [options.webhook] - Webhook URL for status updates
   * @returns {Promise<Object>} - API response
   */
  async sendMessageWithFile(options) {
    if (!options.fileUrl && !options.filePath) {
      throw new Error('Either fileUrl or filePath must be provided');
    }

    const payload = this.messagePayload(options, 2);
    const fileName = options.fileName || (options.filePath ? path.basename(options.filePath) : undefined);
    if (fileName) {
      payload.file_name = fileName;
    }

    if (options.fileUrl) {
      payload.file_url = options.fileUrl;
      return this.sendRequest('/send_msg/', payload);
    }
    return this.sendFormRequest('/send_msg/', this.buildForm(payload, options.filePath));
  }

  /**
   * Get the WhatsApp numbers that are connected right now (POST /whatsapp-client/list/)
   * @returns {Promise<Object>} - { status: 1, whatsapp_clients: [{ whatsapp_client_id, whatsapp_client_number,
   *   platform, is_connected }] }
   */
  async getWhatsAppClients() {
    return this.sendRequest('/whatsapp-client/list/', { client_id: this.clientId, api_key: this.apiKey });
  }

  /**
   * Get the connection status of a WhatsApp number (POST /whatsapp-client/status/)
   * @param {number|string} [whatsappClientId] - ID of the WhatsApp client (defaults to the constructor's)
   * @returns {Promise<Object>} - { message: 'Connected', status: 1 } or { message: 'Disconnected', status: 0 }
   * @throws {WbizToolError} When the request fails (a disconnected number is a normal result)
   */
  async getWhatsAppClientStatus(whatsappClientId) {
    const whatsappClient = whatsappClientId || this.whatsappClient;
    if (!whatsappClient) {
      throw new Error('whatsappClientId is required (or set whatsappClient in the constructor)');
    }
    return this.sendRequest('/whatsapp-client/status/', {
      client_id: this.clientId,
      api_key: this.apiKey,
      whatsapp_client: whatsappClient
    }, 'clientStatus');
  }

  /**
   * Get message history (POST /report/), 200 messages per page
   * @param {Object} options - Query options
   * @param {string|Date} options.startDate - First day to include, DD-MM-YYYY (or a Date)
   * @param {string|Date} options.endDate - End of the range, DD-MM-YYYY (or a Date); this day itself isn't included
   * @param {number} [options.page=1] - Page number
   * @param {number|string} [options.whatsappClient] - Only messages sent from this WhatsApp number
   * @returns {Promise<Object>} - { message: 'Success', status: 0, total, history: [{ id, msg_type, contact,
   *   message_status }] } (status is always 0 on this endpoint)
   * @throws {WbizToolError} When the request fails (the response has no `total`)
   */
  async getMessageHistory(options = {}) {
    if (!options.startDate || !options.endDate) {
      throw new Error('startDate and endDate (DD-MM-YYYY) are required');
    }
    const payload = {
      client_id: this.clientId,
      api_key: this.apiKey,
      start_date: reportDate(options.startDate),
      end_date: reportDate(options.endDate),
      page: Number(options.page || 1) // must be a JSON number, or `history` comes back empty
    };
    if (options.whatsappClient) {
      payload.whatsapp_client = options.whatsappClient;
    }
    return this.sendRequest('/report/', payload, 'report');
  }

  /**
   * Cancel a scheduled or pending message
   * @param {number|string} messageId - ID of the message to cancel
   * @returns {Promise<Object>} - API response ({ message: 'Cancelled', status: 1 })
   * @throws {WbizToolError} When the message can't be cancelled (e.g. "Msg has been Sent")
   */
  async cancelMessage(messageId) {
    return this.sendRequest('/cancel_msg/', {
      client_id: this.clientId,
      api_key: this.apiKey,
      msg_id: messageId
    });
  }

  /**
   * Schedule a message for future delivery (POST /schedule_msg/)
   * @param {Object} options - Message options
   * @param {string} [options.phone] - Recipient's phone number (or groupName)
   * @param {string} [options.groupName] - Name of a WhatsApp group to send to instead of phone
   * @param {string} [options.countryCode] - Recipient's country code
   * @param {string} [options.message] - Message content (required for text)
   * @param {Date|string} [options.scheduleTime] - When to send: a Date (an exact moment, sent in UTC), or a
   *   string 'YYYY-MM-DD HH:MM[:SS]' / 'DD/MM/YYYY HH:MM' read in `timezone`. Or pass `date` and `time`.
   * @param {string} [options.date] - Day in the API's format DD/MM/YYYY (with `time`, instead of scheduleTime)
   * @param {string} [options.time] - Time in the API's format HH:MM, 24-hour
   * @param {string} [options.timezone='UTC'] - Timezone of the time: an IANA name like 'Asia/Kolkata' or
   *   IST, UTC, GMT, EST, CST, MST, PST, CET, CEST, EET, EEST, JST, AEST, AEDT
   * @param {number} [options.msgType=0] - 0 for text, 1 for image, 2 for file
   * @param {string} [options.imageUrl] - URL of the image (for msgType=1)
   * @param {string} [options.fileUrl] - URL of the file (for msgType=2)
   * @param {string} [options.fileName] - Name of the file (for msgType=2)
   * @param {number|string} [options.whatsappClient] - WhatsApp Client ID (required here; defaults to the constructor's)
   * @param {string} [options.webhook] - Webhook URL for status updates
   * @returns {Promise<Object>} - API response ({ msg_id, message: 'Created', status: 1 })
   * @throws {WbizToolError} When the API refuses it (it answers most errors with HTTP 200 and status 0)
   */
  async scheduleMessage(options) {
    let when;
    if (options.date || options.time) {
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(options.date || '')) || !/^\d{2}:\d{2}$/.test(String(options.time || ''))) {
        throw new Error('date must be DD/MM/YYYY and time HH:MM (24-hour)');
      }
      when = { date: options.date, time: options.time, timezone: (options.timezone && String(options.timezone).trim()) || 'UTC' };
    } else if (options.scheduleTime) {
      when = scheduleFields(options.scheduleTime, options.timezone);
    } else {
      throw new Error('scheduleTime (or date and time) is required for scheduling a message');
    }
    if (Boolean(options.phone) === Boolean(options.groupName)) {
      throw new Error('Pass either phone or groupName (not both)');
    }
    const msgType = Number(options.msgType || 0);

    const payload = {
      ...this.basePayload(options),
      msg_type: msgType,
      msg: options.message || '',
      date: when.date,
      time: when.time,
      timezone: when.timezone
    };
    if (options.phone) {
      payload.phone = options.phone;
      if (options.countryCode) payload.country_code = options.countryCode;
    } else {
      payload.group_name = options.groupName;
    }

    if (options.webhook) {
      payload.webhook = options.webhook;
    }

    if (msgType === 1) {
      if (!options.imageUrl) throw new Error('imageUrl is required for msgType 1 (scheduled images go by URL)');
      payload.img_url = options.imageUrl;
    }

    if (msgType === 2) {
      if (!options.fileUrl) throw new Error('fileUrl is required for msgType 2 (scheduled files go by URL)');
      payload.file_url = options.fileUrl;
      if (options.fileName) payload.file_name = options.fileName;
    }

    return this.sendRequest('/schedule_msg/', payload);
  }

  /**
   * Multipart body for an upload: every field that has a value, then the file.
   * @private
   */
  buildForm(payload, filePath) {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    });
    formData.append('file', fs.createReadStream(filePath));
    return formData;
  }

  /**
   * Check a response: throw for HTTP errors, non-JSON bodies and refusals.
   * @private
   */
  handleResponse(response, check) {
    const data = response.data;
    if (!data || typeof data !== 'object') {
      throw apiError(response);
    }
    if (response.status >= 400 || (check && !SUCCESS[check](data))) {
      throw apiError(response);
    }
    return data;
  }

  /**
   * Send a POST request to the API
   * @private
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request payload
   * @param {string|null} [check='status'] - How success is recognised (see SUCCESS)
   * @returns {Promise<Object>} - API response
   */
  async sendRequest(endpoint, data, check = 'status') {
    let response;
    try {
      response = await axios.post(`${this.baseUrl}${endpoint}`, data, { timeout: this.timeout });
    } catch (error) {
      if (error.response) {
        throw apiError(error.response);
      }
      throw error;
    }
    return this.handleResponse(response, check);
  }

  /**
   * Send a FormData request to the API
   * @private
   * @param {string} endpoint - API endpoint
   * @param {FormData} formData - Form data with fields and files
   * @param {string|null} [check='status'] - How success is recognised (see SUCCESS)
   * @returns {Promise<Object>} - API response
   */
  async sendFormRequest(endpoint, formData, check = 'status') {
    let response;
    try {
      response = await axios.post(`${this.baseUrl}${endpoint}`, formData, {
        headers: {
          ...formData.getHeaders()
        },
        timeout: this.timeout
      });
    } catch (error) {
      if (error.response) {
        throw apiError(error.response);
      }
      throw error;
    }
    return this.handleResponse(response, check);
  }
}

module.exports = { WbizToolClient, WbizToolError };
