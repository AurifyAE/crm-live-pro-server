from flask import Flask, request, jsonify
import MetaTrader5 as mt5
import sys
import json
import time
from datetime import datetime

app = Flask(__name__)

class MT5Connector:
    def __init__(self):
        self.connected = False
        
    def connect(self, server, login, password):
        try:
            if not mt5.initialize():
                return False, "MT5 initialization failed"
            
            authorized = mt5.login(login, password=password, server=server)
            if not authorized:
                error = mt5.last_error()
                return False, f"Login failed: {error}"
            
            self.connected = True
            account_info = mt5.account_info()
            if account_info and not account_info.trade_expert:
                return False, "AutoTrading disabled. Enable 'Algo Trading' in MT5"
            
            return True, {"message": "Connected", "account": account_info.login if account_info else None}
        except Exception as e:
            return False, str(e)

    def disconnect(self):
        self.connected = False
        mt5.shutdown()
        return True, "Disconnected"

    def get_symbols(self):
        try:
            if not self.connected:
                return False, "Not connected"
            symbols = mt5.symbols_get() or []
            return True, [symbol.name for symbol in symbols]
        except Exception as e:
            return False, str(e)

    def get_symbol_info(self, symbol):
        try:
            if not self.connected:
                return False, "Not connected"
            
            if not mt5.symbol_select(symbol, True):
                return False, f"Symbol {symbol} not selected"
            
            info = mt5.symbol_info(symbol)
            if not info:
                return False, f"Symbol {symbol} not found"
            
            stops_level = getattr(info, 'stops_level', 0)
            return True, {
                "name": info.name,
                "point": info.point,
                "digits": info.digits,
                "spread": info.spread,
                "trade_mode": info.trade_mode,
                "volume_min": info.volume_min,
                "volume_max": info.volume_max,
                "volume_step": info.volume_step,
                "stops_level": stops_level,
                "filling_mode": info.filling_mode
            }
        except Exception as e:
            return False, str(e)

    def get_price(self, symbol):
        try:
            if not self.connected:
                return False, "Not connected"
            
            if not mt5.symbol_select(symbol, True):
                return False, f"Symbol {symbol} not selected"
            
            time.sleep(0.1)  # Small delay for price update
            tick = mt5.symbol_info_tick(symbol)
            
            if not tick:
                rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 1)
                if not rates or not len(rates):
                    return False, f"No price data for {symbol}"
                
                rate = rates[0]
                return True, {
                    "symbol": symbol,
                    "bid": rate['close'],
                    "ask": rate['close'],
                    "spread": 0,
                    "time": datetime.fromtimestamp(rate['time']).isoformat()
                }
            
            symbol_info = mt5.symbol_info(symbol)
            spread = (tick.ask - tick.bid) / symbol_info.point if symbol_info.point > 0 else 0
            
            return True, {
                "symbol": symbol,
                "bid": tick.bid,
                "ask": tick.ask,
                "spread": spread,
                "time": datetime.fromtimestamp(tick.time).isoformat()
            }
        except Exception as e:
            return False, str(e)

    def place_trade(self, symbol, volume, order_type, sl_distance=10.0, tp_distance=10.0, comment="", magic=0):
        try:
            if not self.connected:
                return False, "Not connected"
            
            if not mt5.symbol_select(symbol, True):
                return False, f"Symbol {symbol} not selected"
            
            info = mt5.symbol_info(symbol)
            if not info:
                return False, f"Symbol {symbol} not found"
            
            if info.trade_mode == 0:
                return False, f"Symbol {symbol} not tradable"
            
            stop_level = getattr(info, 'stops_level', 0) * info.point
            if sl_distance < stop_level:
                sl_distance = stop_level
            if tp_distance < stop_level:
                tp_distance = stop_level

            tick = mt5.symbol_info_tick(symbol)
            if not tick:
                return False, f"No price for {symbol}"
            
            order_type = order_type.upper()
            if order_type == "BUY":
                mt5_type = mt5.ORDER_TYPE_BUY
                price = tick.ask
                sl = round(price - sl_distance, info.digits)
                tp = round(price + tp_distance, info.digits)
            elif order_type == "SELL":
                mt5_type = mt5.ORDER_TYPE_SELL
                price = tick.bid
                sl = round(price + sl_distance, info.digits)
                tp = round(price - tp_distance, info.digits)
            else:
                return False, f"Invalid order type {order_type}"

            volume = max(info.volume_min, min(info.volume_max, round(volume / info.volume_step) * info.volume_step))
            
            filling_type = {
                0: mt5.ORDER_FILLING_FOK,
                1: mt5.ORDER_FILLING_IOC,
                2: mt5.ORDER_FILLING_RETURN
            }.get(info.filling_mode & 0b11, mt5.ORDER_FILLING_IOC)

            request = {
                "action": mt5.TRADE_ACTION_DEAL,
                "symbol": symbol,
                "volume": volume,
                "type": mt5_type,
                "price": price,
                "sl": sl,
                "tp": tp,
                "deviation": 20,
                "magic": magic,
                "comment": comment,
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": filling_type
            }
            
            result = mt5.order_send(request)
            if result is None:
                error = mt5.last_error()
                error_code = error[0] if isinstance(error, tuple) else getattr(error, 'code', -1)
                error_comment = error[1] if isinstance(error, tuple) else getattr(error, 'comment', 'Unknown error')
                
                if error_code == 10013:
                    request["deviation"] = 50
                    result = mt5.order_send(request)
                    if result is None:
                        error = mt5.last_error()
                        error_code = error[0] if isinstance(error, tuple) else getattr(error, 'code', -1)
                        error_comment = error[1] if isinstance(error, tuple) else getattr(error, 'comment', 'Unknown error')
                        return False, f"Order failed: Code: {error_code} - {error_comment}"
                else:
                    return False, f"Order failed: Code: {error_code} - {error_comment}"
            
            if result.retcode == mt5.TRADE_RETCODE_DONE:
                return True, {
                    "order": result.order,
                    "deal": result.deal,
                    "volume": result.volume,
                    "price": result.price,
                    "sl": sl,
                    "tp": tp,
                    "comment": comment,
                    "retcode": result.retcode
                }
            
            error_codes = {
                10018: "Market closed",
                10019: "Insufficient funds",
                10020: "Prices changed",
                10021: "Invalid request (check volume, symbol, or market status)",
                10022: "Invalid SL/TP",
                10017: "Invalid parameters",
                10027: "AutoTrading disabled"
            }
            error_msg = error_codes.get(result.retcode, f"Error {result.retcode}")
            return False, f"Order failed: {error_msg}"
            
        except Exception as e:
            return False, str(e)

    def close_trade(self, ticket, volume=None, symbol=None, max_retries=3):
        try:
            if not self.connected:
                return False, "Not connected"
            
            position = mt5.positions_get(ticket=ticket)
            if not position:
                return False, f"Position {ticket} not found"
            
            pos = position[0]
            symbol = symbol or pos.symbol
            position_type = "BUY" if pos.type == mt5.POSITION_TYPE_BUY else "SELL"
            close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY
            
            if volume is None:
                volume = pos.volume
            else:
                volume = min(volume, pos.volume)
            
            if not mt5.symbol_select(symbol, True):
                return False, f"Symbol {symbol} not selected"
            
            info = mt5.symbol_info(symbol)
            if not info:
                return False, f"Symbol {symbol} not found"
            
            if info.trade_mode == 0:
                return False, f"Symbol {symbol} not tradable"
            
            volume = max(info.volume_min, min(info.volume_max, round(volume / info.volume_step) * info.volume_step))
            
            if volume < info.volume_min:
                return False, f"Volume {volume} below minimum {info.volume_min}"
            if volume > info.volume_max:
                return False, f"Volume {volume} exceeds maximum {info.volume_max}"

            filling_type = {
                0: mt5.ORDER_FILLING_FOK,
                1: mt5.ORDER_FILLING_IOC,
                2: mt5.ORDER_FILLING_RETURN
            }.get(info.filling_mode & 0b11, mt5.ORDER_FILLING_IOC)

            for attempt in range(max_retries):
                tick = mt5.symbol_info_tick(symbol)
                if not tick:
                    return False, f"No price for {symbol}"
                
                price = tick.bid if pos.type == mt5.POSITION_TYPE_BUY else tick.ask

                request = {
                    "action": mt5.TRADE_ACTION_DEAL,
                    "symbol": symbol,
                    "volume": volume,
                    "type": close_type,
                    "position": ticket,
                    "price": price,
                    "magic": pos.magic,
                    "comment": f"Close {ticket}",
                    "type_filling": filling_type,
                    "deviation": 20 + attempt * 10
                }
                
                result = mt5.order_send(request)
                if result is None:
                    error = mt5.last_error()
                    error_code = error[0] if isinstance(error, tuple) else getattr(error, 'code', -1)
                    error_comment = error[1] if isinstance(error, tuple) else getattr(error, 'comment', 'Unknown error')
                    return False, f"Close failed: Code: {error_code} - {error_comment}"
                
                if result.retcode == mt5.TRADE_RETCODE_DONE:
                    return True, {
                        "deal": result.deal,
                        "retcode": result.retcode,
                        "price": result.price,
                        "volume": result.volume,
                        "profit": pos.profit,
                        "symbol": symbol,
                        "position_type": position_type
                    }
                
                if result.retcode == 10021 and attempt < max_retries - 1:
                    filling_type = mt5.ORDER_FILLING_IOC if filling_type == mt5.ORDER_FILLING_FOK else mt5.ORDER_FILLING_FOK
                    time.sleep(0.5)
                    continue
                
                error_codes = {
                    10018: "Market closed",
                    10019: "Insufficient funds",
                    10020: "Prices changed",
                    10021: "Invalid request (check volume, symbol, or market status)",
                    10022: "Invalid SL/TP",
                    10017: "Invalid parameters",
                    10027: "AutoTrading disabled"
                }
                error_msg = error_codes.get(result.retcode, f"Error {result.retcode}")
                return False, f"Close failed: {error_msg}"
            
            return False, f"Close failed after {max_retries} attempts"
            
        except Exception as e:
            return False, str(e)

    def get_positions(self):
        try:
            if not self.connected:
                return False, "Not connected"
            
            positions = mt5.positions_get() or []
            return True, [{
                "ticket": p.ticket,
                "symbol": p.symbol,
                "type": "BUY" if p.type == mt5.POSITION_TYPE_BUY else "SELL",
                "volume": p.volume,
                "price_open": p.price_open,
                "price_current": p.price_current,
                "profit": p.profit,
                "comment": p.comment,
                "magic": p.magic
            } for p in positions]
        except Exception as e:
            return False, str(e)

# Global connector instance
connector = MT5Connector()

@app.route('/connect', methods=['POST'])
def connect():
    try:
        data = request.json
        if not data:
            return jsonify({"success": False, "error": "No JSON data provided"}), 400
        
        server = data.get('server')
        login = data.get('login')
        password = data.get('password')
        
        if not all([server, login, password]):
            return jsonify({"success": False, "error": "Missing server, login, or password"}), 400
        
        success, result = connector.connect(server, login, password)
        if success:
            return jsonify({"success": True, "data": result})
        else:
            return jsonify({"success": False, "error": result}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/disconnect', methods=['POST'])
def disconnect():
    try:
        success, result = connector.disconnect()
        return jsonify({"success": success, "message": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/symbols', methods=['GET'])
def symbols():
    try:
        success, result = connector.get_symbols()
        if success:
            return jsonify({"success": True, "data": result})
        else:
            return jsonify({"success": False, "error": result}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/symbol/<symbol>', methods=['GET'])
def symbol_info(symbol):
    try:
        success, result = connector.get_symbol_info(symbol)
        if success:
            return jsonify({"success": True, "data": result})
        else:
            return jsonify({"success": False, "error": result}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/price/<symbol>', methods=['GET'])
def price(symbol):
    try:
        success, result = connector.get_price(symbol)
        if success:
            return jsonify({"success": True, "data": result})
        else:
            return jsonify({"success": False, "error": result}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/positions', methods=['GET'])
def positions():
    try:
        success, result = connector.get_positions()
        if success:
            return jsonify({"success": True, "data": result})
        else:
            return jsonify({"success": False, "error": result}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/trade', methods=['POST'])
def trade():
    try:
        data = request.json
        if not data:
            return jsonify({"success": False, "error": "No JSON data provided"}), 400
        
        symbol = data.get('symbol')
        volume = float(data.get('volume', 0.1))
        order_type = data.get('type')
        sl_distance = float(data.get('sl_distance', 10.0))
        tp_distance = float(data.get('tp_distance', 10.0))
        comment = data.get('comment', '')
        magic = int(data.get('magic', 0))
        
        if not all([symbol, order_type]):
            return jsonify({"success": False, "error": "Missing symbol or order type"}), 400
        
        success, result = connector.place_trade(symbol, volume, order_type, sl_distance, tp_distance, comment, magic)
        if success:
            return jsonify({"success": True, "data": result})
        else:
            return jsonify({"success": False, "error": result}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/close', methods=['POST'])
def close():
    try:
        data = request.json
        if not data:
            return jsonify({"success": False, "error": "No JSON data provided"}), 400
        
        ticket = data.get('ticket')
        volume = data.get('volume')
        symbol = data.get('symbol')
        
        if not ticket:
            return jsonify({"success": False, "error": "Missing ticket"}), 400
        
        ticket = int(ticket)
        volume = float(volume) if volume else None
        
        success, result = connector.close_trade(ticket, volume, symbol)
        if success:
            return jsonify({"success": True, "data": result})
        else:
            return jsonify({"success": False, "error": result}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "success": True,
        "data": {
            "status": "running",
            "connected": connector.connected,
            "timestamp": datetime.now().isoformat()
        }
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)