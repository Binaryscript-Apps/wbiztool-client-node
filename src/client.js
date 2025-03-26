const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

class WbizToolClient {
  /**
   * Creates a new WbizTool client
   * @param {Object} options - Configuration options
   * @param {number|string} [options.clientId] - Client ID from WbizTool
   * @param {string} [options.apiKey] - API Key from WbizTool
   * @param {number|string} [options.whatsappClient] - WhatsApp Client ID from WbizTool
   * @param {string} [options.baseUrl='https://wbiztool.com/api/v1'] - Base URL for the API
   */
  constructor(options = {}) {
    this.clientId = options.clientId || process.env.WBIZTOOL_CLIENT_ID;
    this.apiKey = options.apiKey || process.env.WBIZTOOL_API_KEY;
    this.whatsappClient = options.whatsappClient || process.env.WBIZTOOL_WHATSAPP_CLIENT;
    this.baseUrl = options.baseUrl || 'https://wbiztool.com/api/v1';
    
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
    if (!this.whatsappClient) {
      throw new Error('WhatsApp Client ID is required. Provide it in the constructor or set WBIZTOOL_WHATSAPP_CLIENT environment variable.');
    }
  }

  /**
   * Send a simple text message
   * @param {Object} options - Message options
   * @param {string} options.phone - Recipient's phone number without country code
   * @param {string} options.countryCode - Recipient's country code
   * @param {string} options.message - Message content
   * @param {number} [options.expireAfterSeconds] - Expire message if not sent within this time
   * @param {string} [options.webhook] - Webhook URL for status updates
   * @returns {Promise<Object>} - API response
   */
  async sendMessage(options) {
    const payload = {
      client_id: this.clientId,
      api_key: this.apiKey,
      whatsapp_client: this.whatsappClient,
      msg_type: 0,
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

    return this.sendRequest('/send_msg/', payload);
  }

  /**
   * Send a message with an image
   * @param {Object} options - Message options
   * @param {string} options.phone - Recipient's phone number without country code
   * @param {string} options.countryCode - Recipient's country code
   * @param {string} options.message - Message content
   * @param {string} [options.imageUrl] - URL of the image to send
   * @param {string} [options.imagePath] - Path to the image file on disk
   * @param {number} [options.expireAfterSeconds] - Expire message if not sent within this time
   * @param {string} [options.webhook] - Webhook URL for status updates
   * @returns {Promise<Object>} - API response
   */
  async sendMessageWithImage(options) {
    if (!options.imageUrl && !options.imagePath) {
      throw new Error('Either imageUrl or imagePath must be provided');
    }

    const payload = {
      client_id: this.clientId,
      api_key: this.apiKey,
      whatsapp_client: this.whatsappClient,
      msg_type: 1,
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

    if (options.imageUrl) {
      payload.img_url = options.imageUrl;
      return this.sendRequest('/send_msg/', payload);
    } else {
      // Use FormData for file upload
      const formData = new FormData();
      
      // Add all fields to form data
      Object.entries(payload).forEach(([key, value]) => {
        formData.append(key, value);
      });
      
      // Add file to form data
      formData.append('file', fs.createReadStream(options.imagePath));
      
      return this.sendFormRequest('/send_msg/', formData);
    }
  }

  /**
   * Send a message with a file attachment
   * @param {Object} options - Message options
   * @param {string} options.phone - Recipient's phone number without country code
   * @param {string} options.countryCode - Recipient's country code
   * @param {string} options.message - Message content
   * @param {string} options.fileName - Name of the file
   * @param {string} [options.fileUrl] - URL of the file to send
   * @param {string} [options.filePath] - Path to the file on disk
   * @param {number} [options.expireAfterSeconds] - Expire message if not sent within this time
   * @param {string} [options.webhook] - Webhook URL for status updates
   * @returns {Promise<Object>} - API response
   */
  async sendMessageWithFile(options) {
    if (!options.fileUrl && !options.filePath) {
      throw new Error('Either fileUrl or filePath must be provided');
    }
    
    if (!options.fileName) {
      // If fileName is not provided, try to derive it from filePath or use a default
      options.fileName = options.filePath ? path.basename(options.filePath) : 'attachment';
    }

    const payload = {
      client_id: this.clientId,
      api_key: this.apiKey,
      whatsapp_client: this.whatsappClient,
      msg_type: 2,
      file_name: options.fileName,
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

    if (options.fileUrl) {
      payload.file_url = options.fileUrl;
      return this.sendRequest('/send_msg/', payload);
    } else {
      // Use FormData for file upload
      const formData = new FormData();
      
      // Add all fields to form data
      Object.entries(payload).forEach(([key, value]) => {
        formData.append(key, value);
      });
      
      // Add file to form data
      formData.append('file', fs.createReadStream(options.filePath));
      
      return this.sendFormRequest('/send_msg/', formData);
    }
  }

  /**
   * Get the list of WhatsApp clients
   * @returns {Promise<Object>} - API response with list of clients
   */
  async getWhatsAppClients() {
    const payload = {
      client_id: this.clientId,
      api_key: this.apiKey
    };

    return this.sendRequest('/list_whatsapp_clients/', payload);
  }

  /**
   * Get the status of a WhatsApp client
   * @param {number|string} whatsappClientId - ID of the WhatsApp client
   * @returns {Promise<Object>} - API response with client status
   */
  async getWhatsAppClientStatus(whatsappClientId) {
    const payload = {
      client_id: this.clientId,
      api_key: this.apiKey,
      whatsapp_client: whatsappClientId || this.whatsappClient
    };

    return this.sendRequest('/whatsapp_client_status/', payload);
  }

  /**
   * Get message history
   * @param {Object} options - Query options
   * @param {string} [options.phone] - Filter by phone number
   * @param {string} [options.countryCode] - Filter by country code
   * @param {number} [options.limit=10] - Maximum number of messages to return
   * @param {number} [options.offset=0] - Offset for pagination
   * @returns {Promise<Object>} - API response with message history
   */
  async getMessageHistory(options = {}) {
    const payload = {
      client_id: this.clientId,
      api_key: this.apiKey,
      whatsapp_client: this.whatsappClient,
      limit: options.limit || 10,
      offset: options.offset || 0
    };

    if (options.phone) {
      payload.phone = options.phone;
    }

    if (options.countryCode) {
      payload.country_code = options.countryCode;
    }

    return this.sendRequest('/history_msgs/', payload);
  }

  /**
   * Cancel a scheduled message
   * @param {number|string} messageId - ID of the message to cancel
   * @returns {Promise<Object>} - API response
   */
  async cancelMessage(messageId) {
    const payload = {
      client_id: this.clientId,
      api_key: this.apiKey,
      whatsapp_client: this.whatsappClient,
      msg_id: messageId
    };

    return this.sendRequest('/cancel_msg/', payload);
  }

  /**
   * Schedule a message for future delivery
   * @param {Object} options - Message options
   * @param {string} options.phone - Recipient's phone number without country code
   * @param {string} options.countryCode - Recipient's country code
   * @param {string} options.message - Message content
   * @param {string} options.scheduleTime - ISO string of when to send the message
   * @param {number} [options.msgType=0] - 0 for text, 1 for image, 2 for file
   * @param {string} [options.imageUrl] - URL of the image (for msgType=1)
   * @param {string} [options.fileUrl] - URL of the file (for msgType=2)
   * @param {string} [options.fileName] - Name of the file (for msgType=2)
   * @param {string} [options.webhook] - Webhook URL for status updates
   * @returns {Promise<Object>} - API response
   */
  async scheduleMessage(options) {
    if (!options.scheduleTime) {
      throw new Error('scheduleTime is required for scheduling a message');
    }

    const payload = {
      client_id: this.clientId,
      api_key: this.apiKey,
      whatsapp_client: this.whatsappClient,
      msg_type: options.msgType || 0,
      msg: options.message,
      phone: options.phone,
      country_code: options.countryCode,
      schedule_time: options.scheduleTime
    };

    if (options.webhook) {
      payload.webhook = options.webhook;
    }

    if (options.msgType === 1 && options.imageUrl) {
      payload.img_url = options.imageUrl;
    }

    if (options.msgType === 2) {
      if (options.fileUrl) payload.file_url = options.fileUrl;
      if (options.fileName) payload.file_name = options.fileName;
    }

    return this.sendRequest('/schedule_msg/', payload);
  }

  /**
   * Send a POST request to the API
   * @private
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request payload
   * @returns {Promise<Object>} - API response
   */
  async sendRequest(endpoint, data) {
    try {
      const response = await axios.post(`${this.baseUrl}${endpoint}`, data);
      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Send a FormData request to the API
   * @private
   * @param {string} endpoint - API endpoint
   * @param {FormData} formData - Form data with fields and files
   * @returns {Promise<Object>} - API response
   */
  async sendFormRequest(endpoint, formData) {
    try {
      const response = await axios.post(`${this.baseUrl}${endpoint}`, formData, {
        headers: {
          ...formData.getHeaders()
        }
      });
      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }
}

module.exports = { WbizToolClient };
