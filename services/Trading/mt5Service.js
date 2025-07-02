import { spawn } from "child_process";
import path from "path";
import EventEmitter from "events";

class MT5Service extends EventEmitter {
  constructor() {
    super();
    this.isConnected = false;
    this.pythonProcess = null;
    this.priceData = new Map();
    this.lastPriceUpdate = new Map();
    this.responseCallbacks = new Map();
    this.requestId = 0;
    this.availableSymbols = new Set();

    this.initializePythonBridge();
    this.setupResponseHandlers();
  }

initializePythonBridge() {
  try {
    const pythonScriptPath = "/home/ubuntu/crm-live-pro-server/python/mt5_connector.py";
    const pythonExecutable = "xvfb-run -a wine ~/.wine/drive_c/Python310/python.exe";
    this.pythonProcess = spawn(pythonExecutable, [pythonScriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    this.pythonProcess.stdout.on("data", (data) =>
      this.handlePythonResponse(data.toString())
    );
    this.pythonProcess.stderr.on("data", (data) =>
      console.error("MT5 Python log:", data.toString())
    );
    this.pythonProcess.on("close", (code) => {
      console.log(`MT5 Python exited with code ${code}`);
      this.isConnected = false;
      this.emit("disconnected");
    });
    console.log("MT5 Python bridge initialized");
  } catch (error) {
    console.error("Python bridge initialization failed:", error);
    throw error;
  }
}

  setupResponseHandlers() {
    this.on("price_update", (data) => {
      this.priceData.set(data.symbol, {
        bid: data.bid,
        ask: data.ask,
        spread: data.spread,
        timestamp: new Date(),
      });
      this.lastPriceUpdate.set(data.symbol, Date.now());
    });
  }

  handlePythonResponse(data) {
    try {
      const lines = data.trim().split("\n");
      lines.forEach((line) => {
        if (line.trim()) {
          try {
            const response = JSON.parse(line);
            if (response.type === "price_update") {
              this.emit("price_update", response.data);
            } else if (
              response.requestId &&
              this.responseCallbacks.has(response.requestId)
            ) {
              const callback = this.responseCallbacks.get(response.requestId);
              this.responseCallbacks.delete(response.requestId);
              callback(response);
            }
          } catch (jsonError) {
            console.warn("Skipping non-JSON line:", line);
          }
        }
      });
    } catch (error) {
      console.error("Python response parsing error:", error);
    }
  }

  async sendCommand(command, timeout = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.pythonProcess) {
        reject(new Error("Python process not initialized"));
      }

      const requestId = ++this.requestId;
      const commandWithId = { ...command, requestId };

      this.responseCallbacks.set(requestId, (response) => {
        console.log("Response received:", JSON.stringify(response, null, 2));
        if (!response || typeof response !== "object") {
          this.responseCallbacks.delete(requestId);
          reject(
            new Error(
              "Invalid response from MT5: response is undefined or not an object"
            )
          );
        } else if (response.success) {
          this.responseCallbacks.delete(requestId);
          resolve(response.data);
        } else {
          this.responseCallbacks.delete(requestId);
          reject(new Error(response.error || "Unknown error"));
        }
      });

      setTimeout(() => {
        if (this.responseCallbacks.has(requestId)) {
          this.responseCallbacks.delete(requestId);
          reject(new Error("Request timeout"));
        }
      }, timeout);

      this.pythonProcess.stdin.write(JSON.stringify(commandWithId) + "\n");
    });
  }

  async connect() {
    try {
      const result = await this.sendCommand({
        action: "connect",
        server: process.env.MT5_SERVER,
        login: parseInt(process.env.MT5_LOGIN),
        password: process.env.MT5_PASSWORD,
      });
      this.isConnected = true;
      this.emit("connected");
      await this.loadAvailableSymbols();
      return result;
    } catch (error) {
      console.error("MT5 connection failed:", error);
      throw error;
    }
  }

  async loadAvailableSymbols() {
    try {
      const symbols = await this.sendCommand({ action: "get_symbols" });
      this.availableSymbols = new Set(symbols);
      console.log(`Loaded ${symbols.length} symbols`);
      return symbols;
    } catch (error) {
      console.error("Symbol loading failed:", error);
      return [];
    }
  }

  async findSymbol(searchTerm) {
    if (this.availableSymbols.size === 0) await this.loadAvailableSymbols();
    const searchLower = searchTerm.toLowerCase();
    return Array.from(this.availableSymbols).filter(
      (s) =>
        s.toLowerCase().includes(searchLower) ||
        s.toLowerCase().includes("xau") ||
        s.toLowerCase().includes("gold") ||
        s === "XAUUSD_TTBAR.Fix"
    );
  }

  async getSymbolInfo(symbol) {
    try {
      return await this.sendCommand({ action: "get_symbol_info", symbol });
    } catch (error) {
      console.error("Symbol info fetch failed:", error);
      throw error;
    }
  }

  async validateSymbol(symbol) {
    if (this.availableSymbols.has(symbol)) {
      const info = await this.getSymbolInfo(symbol);
      if (info.trade_mode !== 0) return symbol;
      console.warn(`Symbol ${symbol} not tradable`);
    }
    const matches = await this.findSymbol(symbol);
    for (const match of matches) {
      const info = await this.getSymbolInfo(match);
      if (info.trade_mode !== 0) return match;
    }
    throw new Error(
      `Symbol ${symbol} not found or tradable. Alternatives: ${matches.join(
        ", "
      )}`
    );
  }

  async getPrice(symbol = "XAUUSD_TTBAR.Fix") {
    const validSymbol = await this.validateSymbol(symbol);
    const result = await this.sendCommand({
      action: "get_price",
      symbol: validSymbol,
    });
    this.priceData.set(validSymbol, {
      bid: result.bid,
      ask: result.ask,
      spread: result.spread,
      timestamp: new Date(),
    });
    return { ...result, symbol: validSymbol };
  }

  async placeTrade(tradeData, retryCount = 0) {
    const maxRetries = 3;
    try {
      if (!(await this.testConnection()).success)
        throw new Error("MT5 connection test failed");
      const symbol = await this.validateSymbol(
        tradeData.symbol || "XAUUSD_TTBAR.Fix"
      );
      const info = await this.getSymbolInfo(symbol);
      if (info.trade_mode === 0)
        throw new Error(`Symbol ${symbol} is not tradable`);

      let volume = parseFloat(tradeData.volume);
      if (isNaN(volume) || volume < info.volume_min)
        throw new Error(`Volume ${volume} below minimum ${info.volume_min}`);
      if (volume > info.volume_max)
        throw new Error(`Volume ${volume} exceeds maximum ${info.volume_max}`);
      volume = Math.round(volume / info.volume_step) * info.volume_step;

      const stopLevel = info.stops_level * info.point;
      let slDistance = parseFloat(tradeData.slDistance) || 10.0;
      let tpDistance = parseFloat(tradeData.tpDistance) || 10.0;
      if (slDistance < stopLevel) slDistance = stopLevel;
      if (tpDistance < stopLevel) tpDistance = stopLevel;

      let comment =
        tradeData.comment || `Ord-${Date.now().toString().slice(-6)}`;
      if (comment.length > 26) {
        comment = comment.slice(0, 26);
      }

      const request = {
        action: "place_trade",
        symbol,
        volume,
        type: tradeData.type.toUpperCase(),
        sl_distance: slDistance,
        tp_distance: tpDistance,
        comment: comment,
        magic: tradeData.magic || 123456,
      };
      console.log("Sending trade request:", JSON.stringify(request, null, 2));

      const result = await this.sendCommand(request, 45000);
      return {
        success: true,
        ticket: result.order || result.deal,
        deal: result.deal,
        volume: result.volume,
        price: result.price,
        symbol,
        type: tradeData.type,
        sl: result.sl,
        tp: result.tp,
        comment: result.comment,
        retcode: result.retcode,
      };
    } catch (error) {
      const errorCode = error.message.match(/Code: (\d+)/)?.[1];
      const errorMessage = errorCode
        ? {
            10018: "Market closed",
            10019: "Insufficient funds",
            10020: "Prices changed",
            10021: "Invalid request (check volume, symbol, or market status)",
            10022: "Invalid SL/TP",
            10017: "Invalid parameters",
            10027: "AutoTrading disabled",
          }[parseInt(errorCode)] || "Unknown error"
        : error.message.includes("connection")
        ? "MT5 connection issue"
        : error.message;
      if (
        (errorCode === "10020" || errorCode === "10021") &&
        retryCount < maxRetries
      ) {
        console.log(
          `Retrying trade (${
            retryCount + 1
          }/${maxRetries}) for error: ${errorMessage}`
        );
        await new Promise((r) => setTimeout(r, 1000));
        return this.placeTrade(
          { ...tradeData, deviation: (tradeData.deviation || 20) + 10 },
          retryCount + 1
        );
      }
      console.error("Trade placement failed:", error);
      throw new Error(errorMessage);
    }
  }

  async getPositions() {
    try {
      return await this.sendCommand({ action: "get_positions" });
    } catch (error) {
      console.error("Positions fetch failed:", error);
      throw error;
    }
  }

  async closeTrade(tradeData, retryCount = 0) {
    const maxRetries = 3;
    try {
      if (!tradeData.ticket || isNaN(tradeData.ticket)) {
        throw new Error(`Invalid ticket: ${tradeData.ticket}`);
      }
      if (!tradeData.symbol) {
        throw new Error(`Missing symbol`);
      }
      const validSymbol = await this.validateSymbol(tradeData.symbol);
      const info = await this.getSymbolInfo(validSymbol);
      if (info.trade_mode === 0) {
        throw new Error(`Symbol ${validSymbol} is not tradable`);
      }

      // Fetch the position to ensure it exists and get its volume
      console.log(`Fetching positions for ticket ${tradeData.ticket}`);
      const positions = await this.getPositions();
      if (!positions || !Array.isArray(positions)) {
        throw new Error(`Failed to retrieve positions for ticket: ${tradeData.ticket}`);
      }
      const position = positions.find((p) => p.ticket === parseInt(tradeData.ticket));
      
      // If position not found, try closing via MT5 to confirm status
      if (!position) {
        console.warn(`Position not found in initial check for ticket ${tradeData.ticket}. Attempting MT5 closure.`);
        const request = {
          action: "close_trade",
          ticket: parseInt(tradeData.ticket),
          symbol: validSymbol,
          volume: parseFloat(tradeData.volume),
          type: tradeData.type.toUpperCase(),
        };
        const result = await this.sendCommand(request, 45000);
        console.log(`MT5 response: ${JSON.stringify(result, null, 2)}`);

        if (!result || typeof result !== "object") {
          throw new Error("Invalid response from MT5: result is undefined or not an object");
        }

        const isStructuredResponse = result.success !== undefined && result.data;
        const retcode = isStructuredResponse ? result.data.retcode : result.retcode;
        if ((isStructuredResponse && result.success && retcode === 10009) || (!isStructuredResponse && retcode === 10009)) {
          console.log(`Trade closed successfully in MT5 for ticket ${tradeData.ticket}`);
          return {
            success: true,
            ticket: tradeData.ticket,
            closePrice: (isStructuredResponse ? result.data.price : result.price) || 0,
            profit: (isStructuredResponse ? result.data.profit : result.profit) || 0,
            symbol: validSymbol,
            data: {
              deal: isStructuredResponse ? result.data.deal : result.deal,
              retcode: retcode,
              price: (isStructuredResponse ? result.data.price : result.price) || 0,
              profit: (isStructuredResponse ? result.data.profit : result.profit) || 0,
              volume: (isStructuredResponse ? result.data.volume : result.volume) || tradeData.volume,
              symbol: (isStructuredResponse ? result.data.symbol : result.symbol) || validSymbol,
              position_type: isStructuredResponse ? result.data.position_type : tradeData.type,
            },
          };
        }
        if (result.error && result.error.includes("Position not found")) {
          console.warn(`Position ${tradeData.ticket} not found in MT5. Likely already closed.`);
          return {
            success: false,
            error: `Position ${tradeData.ticket} not found in MT5`,
            ticket: tradeData.ticket,
            likelyClosed: true,
          };
        }
        throw new Error(result.error || `Close failed: Retcode: ${retcode || "Unknown"}`);
      }

      // Use the position's volume to ensure exact match
      let volume = parseFloat(position.volume);
      if (!volume || isNaN(volume) || volume <= 0) {
        throw new Error(`Invalid position volume: ${volume} for ticket: ${tradeData.ticket}`);
      }

      // Validate volume against symbol info
      if (volume < info.volume_min) {
        throw new Error(`Volume ${volume} is below minimum ${info.volume_min} for ${validSymbol}`);
      }
      if (volume > info.volume_max) {
        throw new Error(`Volume ${volume} exceeds maximum ${info.volume_max} for ${validSymbol}`);
      }
      volume = Math.round(volume / info.volume_step) * info.volume_step;
      console.log(`Validated volume: ${volume} for ticket ${tradeData.ticket}`);

      // Fetch latest price
      const priceData = await this.getPrice(validSymbol);
      const closePrice = tradeData.type.toUpperCase() === "BUY" ? priceData.bid : priceData.ask;

      // Calculate profit if not provided
      const profit = tradeData.openingPrice
        ? tradeData.type.toUpperCase() === "BUY"
          ? (closePrice - tradeData.openingPrice) * volume
          : (tradeData.openingPrice - closePrice) * volume
        : position.profit || 0;

      const request = {
        action: "close_trade",
        ticket: parseInt(tradeData.ticket),
        symbol: validSymbol,
        volume: volume, // Use position volume
        type: tradeData.type.toUpperCase(),
      };
      console.log(`Sending close trade request: ${JSON.stringify(request, null, 2)} with price ${closePrice}`);

      const result = await this.sendCommand(request, 45000);
      if (!result || typeof result !== "object") {
        throw new Error("Invalid response from MT5: result is undefined or not an object");
      }

      // Log the full response for debugging
      console.log(`MT5 response: ${JSON.stringify(result, null, 2)}`);

      // Check for success
      const isStructuredResponse = result.success !== undefined && result.data;
      const retcode = isStructuredResponse ? result.data.retcode : result.retcode;
      const deal = isStructuredResponse ? result.data.deal : result.deal;
      const price = isStructuredResponse ? result.data.price : result.price;
      const volumeResult = isStructuredResponse ? result.data.volume : result.volume;
      const profitResult = isStructuredResponse ? result.data.profit : result.profit;
      const symbolResult = isStructuredResponse ? result.data.symbol : result.symbol;

      if ((isStructuredResponse && result.success && retcode === 10009) || (!isStructuredResponse && retcode === 10009)) {
        console.log(`Trade closed successfully for ticket ${tradeData.ticket}`);
        return {
          success: true,
          ticket: tradeData.ticket,
          closePrice: price || closePrice,
          profit: profitResult !== undefined ? profitResult : profit,
          symbol: symbolResult || validSymbol,
          data: {
            deal: deal,
            retcode: retcode,
            price: price || closePrice,
            profit: profitResult !== undefined ? result.profit : profit,
            volume: volumeResult || volume,
            symbol: symbolResult || validSymbol,
            position_type: isStructuredResponse ? result.data.position_type : position.type,
          },
        };
      }

      // Handle failure
      const errorMsg = isStructuredResponse
        ? result.error || `Close failed: Retcode: ${retcode || "Unknown"}`
        : `Close failed: Retcode: ${retcode || "Unknown"}`;
      if (errorMsg.includes("10021") && retryCount < maxRetries) {
        console.log(`Retrying close (${retryCount + 1}/${maxRetries}) for ticket ${tradeData.ticket} due to ${errorMsg}`);
        await new Promise((r) => setTimeout(r, 1000));
        return this.closeTrade({ ...tradeData, volume: position.volume, deviation: (tradeData.deviation || 20) + 10 }, retryCount + 1);
      }
      throw new Error(errorMsg);
    } catch (error) {
      const errorCode = error.message.match(/Retcode: (\d+)/)?.[1] || error.message.match(/-?\d+/)?.[0];
      const errorMessage = errorCode
        ? {
            10013: "Requote detected",
            10018: "Market closed",
            10019: "Insufficient funds",
            10020: "Prices changed",
            10021: "Invalid request (check volume, symbol, or market status)",
            10022: "Invalid SL/TP",
            10017: "Invalid parameters",
            10027: "AutoTrading disabled",
            "-2": `Invalid volume argument: Requested ${tradeData.volume}`,
          }[errorCode] || `Unknown error: ${error.message}`
        : error.message.includes("connection")
        ? "MT5 connection issue"
        : error.message.includes("Position not found")
        ? `Position ${tradeData.ticket} not found in MT5`
        : error.message;

      console.error(`Trade close failed for ticket ${tradeData.ticket}: ${errorMessage}, Stack: ${error.stack}`);
      return {
        success: false,
        error: errorMessage,
        ticket: tradeData.ticket,
        likelyClosed: errorMessage.includes("Position not found"),
      };
    }
  }

  getCachedPrice(symbol = "XAUUSD_TTBAR.Fix") {
    return this.priceData.get(symbol);
  }

  isPriceFresh(symbol = "XAUUSD_TTBAR.Fix", maxAge = 5000) {
    return (
      this.lastPriceUpdate.get(symbol) &&
      Date.now() - this.lastPriceUpdate.get(symbol) < maxAge
    );
  }

  async listAllSymbols() {
    try {
      const symbols = await this.loadAvailableSymbols();
      console.log("Available symbols:", symbols);
      return symbols;
    } catch (error) {
      console.error("Symbol listing failed:", error);
      return [];
    }
  }

  async testConnection() {
    try {
      if (!this.isConnected) throw new Error("Not connected");
      const testResult = await this.getPrice("XAUUSD_TTBAR.Fix");
      console.log("Connection test passed:", testResult);
      return { success: true, message: "MT5 working", testPrice: testResult };
    } catch (error) {
      console.error("Connection test failed:", error);
      return {
        success: false,
        message: "MT5 test failed",
        error: error.message,
      };
    }
  }

  async disconnect() {
    if (this.pythonProcess) {
      try {
        await this.sendCommand({ action: "disconnect" });
      } catch (error) {
        console.error("Disconnect error:", error);
      }
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
    this.isConnected = false;
  }
}

const mt5Service = new MT5Service();
export default mt5Service;