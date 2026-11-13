globalThis.PdfiumWasmCommunicator = (function () {
  const worker = new Worker(globalThis.pdfiumWasmWorkerUrl);
  let requestId = 0;
  let callbackId = 0;
  const requestCallbacks = new Map();
  const registeredCallbacks = new Map();

  worker.onmessage = (event) => {
    const data = event.data;
    if (data.type === 'ready') {
      console.log('PDFium WASM worker is ready');
      return;
    }
    
    // Handle callback invocations from the worker
    if (data.type === 'callback') {
      const callback = registeredCallbacks.get(data.callbackId);
      if (callback) {
        try {
          callback(...data.args);
        } catch (e) {
          console.error('Error in callback:', e);
        }
      }
      return;
    }
    
    // For command responses, match using the request id.
    if (data.id) {
      const callback = requestCallbacks.get(data.id);
      if (callback) {
        if (data.status === 'success') {
          callback.resolve(data.result);
        } else {
          callback.reject(new Error(data.error, data.cause != null ? { cause: data.cause } : undefined));
        }
        requestCallbacks.delete(data.id);
      }
    }
  };

  worker.onerror = (err) => {
    console.error('Worker error:', err);
  };

  return {
    sendCommand: function (command, parameters = {}, transfer = []) {
      return new Promise((resolve, reject) => {
        const id = ++requestId;
        requestCallbacks.set(id, { resolve, reject });
        worker.postMessage({ id, command, parameters }, transfer);
      });
    },

    registerCallback: function (callback) {
      const id = ++callbackId;
      registeredCallbacks.set(id, callback);
      return id;
    },

    unregisterCallback: function (id) {
      registeredCallbacks.delete(id);
    }
  };
})();
