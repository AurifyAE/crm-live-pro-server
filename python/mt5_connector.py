import mt5linux as mt5
import sys
import json
import time
from datetime import datetime

class MT5Connector:
    def __init__(self):
        self.connected = False
        
    def connect(self, server, login, password):
        try:
            if not hasattr(mt5, 'initialize') or not mt5.initialize():
                print("MT5 initialization failed", file=sys.stderr)
                return {"success": False, "error": "MT5 initialization failed"}
            authorized = mt5.login(login, password=password, server=server)
            if not authorized:
                error = mt5.last_error()
                print(f"Login failed: {error}", file=sys.stderr)
                return {"success": False, "error": f"Login failed: {error}"}
            self.connected = True
            account_info = mt5.account_info()
            if account_info and not account_info.trade_expert:
                print("AutoTrading disabled", file=sys.stderr)
                return {"success": False, "error": "AutoTrading disabled. Enable 'Algo Trading' in MT5"}
            print(f"Connected to MT5, account: {account_info.login if account_info else None}", file=sys.stderr)
            return {"success": True, "data": {"message": "Connected", "account": account_info.login if account_info else None}}
        except Exception as e:
            print(f"Exception in connect: {str(e)}", file=sys.stderr)
            return {"success": False, "error": str(e)}

    def get_symbols(self):
        try:
            if not self.connected:
                return {"success": False, "error": "Not connected"}
            symbols = mt5.symbols_get() or []
            return {"success": True, "data": [symbol.name for symbol in symbols]}
        except Exception as e:
            print(f"Exception in get_symbols: {str(e)}", file=sys.stderr)
            return {"success": False, "error": str(e)}

    def get_symbol_info(self, symbol):
        try:
            if not self.connected:
                return {"success": False, "error": "Not connected"}
            if not mt5.symbol_select(symbol, True):
                print(f"Symbol {symbol} not selected", file=sys.stderr)
                return {"success": False, "error": f"Symbol {symbol} not selected"}
            info = mt5.symbol_info(symbol)
            if not info:
                print(f"Symbol {symbol} not found", file=sys.stderr)
                return {"success": False, "error": f"Symbol {symbol} not found"}
            stops_level = getattr(info, 'stops_level', 0)
            return {"success": True, "data": {
                "name": info.name, "point": info.point, "digits": info.digits, "spread": info.spread,
                "trade_mode": info.trade_mode, "volume_min": info.volume_min, "volume_max": info.volume_max,
                "volume_step": info.volume_step, "stops_level": stops_level, "filling_mode": info.filling_mode
            }}
        except Exception as e:
            print(f"Exception in get_symbol_info: {str(e)}", file=sys.stderr)
            return {"success": False, "error": str(e)}

    def get_price(self, symbol):
        try:
            if not self.connected:
                return {"success": False, "error": "Not connected"}
            if not mt5.symbol_select(symbol, True):
                print(f"Symbol {symbol} not selected", file=sys.stderr)
                return {"success": False, "error": f"Symbol {symbol} not selected"}
            time.sleep(0.1)
            tick = mt5.symbol_info_tick(symbol)
            if not tick:
                rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 1)
                if not rates or len(rates) == 0:
                    print(f"No tick or rates for {symbol}", file=sys.stderr)
                    return {"success": False, "error": f"No tick or rates for {symbol}"}
                rate = rates[0]
                return {"success": True, "data": {
                    "symbol": symbol,
                    "bid": rate['close'],
                    "ask": rate['close'],
                    "spread": 0,
                    "time": datetime.fromtimestamp(rate['time']).isoformat()
                }}
            spread = (tick.ask - tick.bid) / mt5.symbol_info(symbol).point if mt5.symbol_info(symbol) and mt5.symbol_info(symbol).point > 0 else 0
            return {"success": True, "data": {
                "symbol": symbol,
                "bid": tick.bid,
                "ask": tick.ask,
                "spread": spread,
                "time": datetime.fromtimestamp(tick.time).isoformat()
            }}
        except Exception as e:
            print(f"Exception in get_price: {str(e)}", file=sys.stderr)
            return {"success": False, "error": str(e)}

    def place_trade(self, symbol, volume, order_type, sl_distance=10.0, tp_distance=10.0, comment="", magic=0):
        try:
            if not self.connected:
                return {"success": False, "error": "Not connected"}
            if not mt5.symbol_select(symbol, True):
                print(f"Symbol {symbol} not selected", file=sys.stderr)
                return {"success": False, "error": f"Symbol {symbol} not selected"}
            info = mt5.symbol_info(symbol)
            if not info:
                print(f"Symbol {symbol} not found", file=sys.stderr)
                return {"success": False, "error": f"Symbol {symbol} not found"}
            if info.trade_mode == 0:
                print(f"Symbol {symbol} not tradable (trade_mode=0)", file=sys.stderr)
                return {"success": False, "error": f"Symbol {symbol} not tradable"}
            
            stop_level = getattr(info, 'stops_level', 0) * info.point
            if sl_distance < stop_level:
                sl_distance = stop_level
            if tp_distance < stop_level:
                tp_distance = stop_level

            tick = mt5.symbol_info_tick(symbol)
            if not tick:
                print(f"No price for {symbol}", file=sys.stderr)
                return {"success": False, "error": f"No price for {symbol}"}
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
                print(f"Invalid type {order_type}", file=sys.stderr)
                return {"success": False, "error": f"Invalid type {order_type}"}

            volume = max(info.volume_min, min(info.volume_max, round(volume / info.volume_step) * info.volume_step))
            filling_type = {0: mt5.ORDER_FILLING_FOK, 1: mt5.ORDER_FILLING_IOC, 2: mt5.ORDER_FILLING_RETURN}.get(info.filling_mode & 0b11, mt5.ORDER_FILLING_IOC)

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
            print(f"Trade request: {json.dumps(request)}", file=sys.stderr)
            result = mt5.order_send(request)
            if result is None:
                error = mt5.last_error()
                error_code = error[0] if isinstance(error, tuple) else getattr(error, 'code', -1)
                error_comment = error[1] if isinstance(error, tuple) else getattr(error, 'comment', 'Unknown error')
                print(f"Order send failed: {error_code} - {error_comment}", file=sys.stderr)
                if error_code == 10013:  # Requote
                    print(f"Requote detected, retrying with deviation 50", file=sys.stderr)
                    request["deviation"] = 50
                    result = mt5.order_send(request)
                    if result is None:
                        error = mt5.last_error()
                        error_code = error[0] if isinstance(error, tuple) else getattr(error, 'code', -1)
                        error_comment = error[1] if isinstance(error, tuple) else getattr(error, 'comment', 'Unknown error')
                        return {"success": False, "error": f"Order send failed: Code: {error_code} - {error_comment}"}
                else:
                    return {"success": False, "error": f"Order send failed: Code: {error_code} - {error_comment}"}
            if result.retcode == mt5.TRADE_RETCODE_DONE:
                return {"success": True, "data": {
                    "order": result.order, "deal": result.deal, "volume": result.volume, "price": result.price,
                    "sl": sl, "tp": tp, "comment": comment, "retcode": result.retcode
                }}
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
            print(f"Order failed with retcode {result.retcode}: {error_msg}", file=sys.stderr)
            return {"success": False, "error": f"Order failed: {error_msg}"}
        except Exception as e:
            print(f"Exception in place_trade: {str(e)}", file=sys.stderr)
            return {"success": False, "error": str(e)}

    def close_trade(self, ticket, volume, symbol=None, order_type=None, max_retries=3):
        try:
            if not self.connected:
                print("Not connected to MT5", file=sys.stderr)
                return {"success": False, "error": "Not connected"}
            
            print(f"Attempting to fetch position for ticket {ticket}", file=sys.stderr)
            position = mt5.positions_get(ticket=ticket)
            if not position:
                print(f"Position {ticket} not found in MT5", file=sys.stderr)
                return {"success": False, "error": f"Position {ticket} not found"}
            pos = position[0]
            
            symbol = symbol or pos.symbol
            position_type = "BUY" if pos.type == mt5.POSITION_TYPE_BUY else "SELL"
            close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY
            position_volume = pos.volume

            if order_type and order_type.upper() != ("SELL" if position_type == "BUY" else "BUY"):
                print(f"Invalid order type {order_type} for position type {position_type}", file=sys.stderr)
                return {"success": False, "error": f"Invalid order type {order_type} for position type {position_type}"}

            if not mt5.symbol_select(symbol, True):
                print(f"Symbol {symbol} not selected", file=sys.stderr)
                return {"success": False, "error": f"Symbol {symbol} not selected"}
            info = mt5.symbol_info(symbol)
            if not info:
                print(f"Symbol {symbol} not found", file=sys.stderr)
                return {"success": False, "error": f"Symbol {symbol} not found"}
            if info.trade_mode == 0:
                print(f"Symbol {symbol} not tradable (trade_mode=0)", file=sys.stderr)
                return {"success": False, "error": f"Symbol {symbol} not tradable"}

            if volume != position_volume:
                print(f"Volume mismatch: Requested {volume}, Position {position_volume}. Using position volume.", file=sys.stderr)
            volume = position_volume
            volume = max(info.volume_min, min(info.volume_max, round(volume / info.volume_step) * info.volume_step))
            
            if volume < info.volume_min:
                print(f"Volume {volume} below minimum {info.volume_min}", file=sys.stderr)
                return {"success": False, "error": f"Volume {volume} below minimum {info.volume_min}"}
            if volume > info.volume_max:
                print(f"Volume {volume} exceeds maximum {info.volume_max}", file=sys.stderr)
                return {"success": False, "error": f"Volume {volume} exceeds maximum {info.volume_max}"}

            tick = mt5.symbol_info_tick(symbol)
            if not tick:
                print(f"No price for {symbol}", file=sys.stderr)
                return {"success": False, "error": f"No price for {symbol}"}
            price = tick.bid if pos.type == mt5.POSITION_TYPE_BUY else tick.ask

            filling_type = {0: mt5.ORDER_FILLING_FOK, 1: mt5.ORDER_FILLING_IOC, 2: mt5.ORDER_FILLING_RETURN}.get(info.filling_mode & 0b11, mt5.ORDER_FILLING_IOC)

            for attempt in range(max_retries):
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
                    "deviation": Tide: 20 + attempt * 10
                }
                print(f"Close request (attempt {attempt + 1}/{max_retries}): {json.dumps(request)}", file=sys.stderr)
                result = mt5.order_send(request)
                
                if result is None:
                    error = mt5.last_error()
                    error_code = error[0] if isinstance(error, tuple) else getattr(error, 'code', -1)
                    error_comment = error[1] if isinstance(error, tuple) else getattr(error, 'comment', 'Unknown error')
                    print(f"Close failed: Code: {error_code} - {error_comment}", file=sys.stderr)
                    return {"success": False, "error": f"Close failed: Code: {error_code} - {error_comment}"}
                
                if result.retcode == mt5.TRADE_RETCODE_DONE:
                    print(f"Close successful: Ticket {ticket}, Volume {volume}, Price {result.price}", file=sys.stderr)
                    return {"success": True, "data": {
                        "deal": result.deal,
                        "retcode": result.retcode,
                        "price": result.price,
                        "volume": result.volume,
                        "profit": pos.profit,
                        "symbol": symbol,
                        "position_type": position_type
                    }}
                
                if result.retcode == 10021 and attempt < max_retries - 1:
                    print(f"Retcode 10021 (Invalid request) on attempt {attempt + 1}. Retrying with updated price and filling mode.", file=sys.stderr)
                    tick = mt5.symbol_info_tick(symbol)
                    if not tick:
                        print(f"No price for {symbol} on retry", file=sys.stderr)
                        return {"success": False, "error": f"No price for {symbol} on retry"}
                    price = tick.bid if pos.type == mt5.POSITION_TYPE_BUY else tick.ask
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
                print(f"Close failed with retcode {result.retcode}: {error_msg}", file=sys.stderr)
                return {"success": False, "error": f"Close failed: {error_msg}"}
        except Exception as e:
            print(f"Exception in close_trade: {str(e)}", file=sys.stderr)
            return {"success": False, "error": str(e)}

    def get_positions(self):
        try:
            if not self.connected:
                return {"success": False, "error": "Not connected"}
            positions = mt5.positions_get() or []
            print(f"Retrieved {len(positions)} positions from MT5", file=sys.stderr)
            return {"success": True, "data": [{
                "ticket": p.ticket, "symbol": p.symbol, "type": "BUY" if p.type == mt5.POSITION_TYPE_BUY else "SELL",
                "volume": p.volume, "price_open": p.price_open, "price_current": p.price_current, "profit": p.profit,
                "comment": p.comment, "magic": p.magic
            } for p in positions]}
        except Exception as e:
            print(f"Exception in get_positions: {str(e)}", file=sys.stderr)
            return {"success": False, "error": str(e)}

    def disconnect(self):
        self.connected = False
        mt5.shutdown()
        print("MT5 disconnected", file=sys.stderr)
        return {"success": True, "data": "Disconnected"}

def main():
    connector = MT5Connector()
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        try:
            request = json.loads(line.strip())
            request_id = request.get('requestId')
            action = request.get('action')
            result = {
                'connect': lambda: connector.connect(request['server'], request['login'], request['password']),
                'get_symbols': lambda: connector.get_symbols(),
                'get_symbol_info': lambda: connector.get_symbol_info(request['symbol']),
                'get_price': lambda: connector.get_price(request['symbol']),
                'place_trade': lambda: connector.place_trade(
                    request['symbol'], request['volume'], request['type'],
                    request.get('sl_distance', 10.0), request.get('tp_distance', 10.0),
                    request.get('comment', ''), request.get('magic', 0)
                ),
                'close_trade': lambda: connector.close_trade(
                    request['ticket'], request['volume'], 
                    request.get('symbol'), request.get('type')
                ),
                'get_positions': lambda: connector.get_positions(),
                'disconnect': lambda: connector.disconnect()
            }.get(action, lambda: {"success": False, "error": f"Unknown action {action}"})()
            result['requestId'] = request_id
            print(json.dumps(result))
            sys.stdout.flush()
        except json.JSONDecodeError:
            print(json.dumps({"success": False, "error": "Invalid JSON", "requestId": None}))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e), "requestId": request.get('requestId')}))
            sys.stdout.flush()

if __name__ == "__main__":
    try:
        # Verify mt5linux module is properly loaded
        if not hasattr(mt5, 'initialize'):
            print("Error: mt5linux module does not contain required MT5 functionality", file=sys.stderr)
            sys.exit(1)
        main()
    except ImportError as e:
        print(f"Failed to import mt5linux: {str(e)}", file=sys.stderr)
        sys.exit(1)